#!/usr/bin/env python3
"""Exercise real discovery and approved transfer between isolated Linux peers.

Run as root on a disposable Linux runner: python3 scripts/native-network-namespaces.py /absolute/path/to/pp
Requires iproute2 and permission to create network namespaces. The two namespaces
share one private veth link and have no default route or connection to the host LAN.
"""
import base64
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


def call_in_namespace():
    """Local browser-equivalent request with an independently obtained CSRF cookie."""
    request = json.load(sys.stdin)
    base = "http://127.0.0.1:43118"
    cookies = http.cookiejar.CookieJar()
    client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies))
    with client.open(base + "/", timeout=10) as response:
        response.read()
    token = next(cookie.value for cookie in cookies if cookie.name == "_protopeek_csrf_token")
    payload = base64.b64decode(request["body"]) if request.get("raw") else json.dumps(request["body"]).encode()
    headers = {"Origin": base, "x-protopeek-csrf-token": token}
    headers["Content-Type"] = "application/octet-stream" if request.get("raw") else "application/json"
    req = urllib.request.Request(base + request["path"], data=payload, headers=headers, method="POST")
    with client.open(req, timeout=45) as response:
        sys.stdout.write(response.read().decode())


def main():
    if len(sys.argv) != 2 or os.geteuid() != 0:
        raise SystemExit("usage: sudo python3 scripts/native-network-namespaces.py /absolute/path/to/pp")
    executable = Path(sys.argv[1]).resolve(strict=True)
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError("launcher is not an executable file")
    if not shutil.which("ip"):
        raise RuntimeError("iproute2 is required")
    temp_root = Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()).resolve(strict=True)
    run = Path(tempfile.mkdtemp(prefix="protopeek-netns-", dir=temp_root)).resolve()
    if run.parent != temp_root or not run.name.startswith("protopeek-netns-"):
        raise RuntimeError("unsafe temporary directory")
    suffix = secrets.token_hex(4)
    namespaces = [f"ppqa-{suffix}-a", f"ppqa-{suffix}-b"]
    interfaces = [f"pa{suffix[:6]}a", f"pa{suffix[:6]}b"]
    created = []
    children = []
    handles = []
    env = os.environ.copy()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(key, None)
    env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost,::1"

    def ip(*args):
        return subprocess.run(["ip", *args], check=True, capture_output=True, text=True, timeout=15)

    def start(namespace, label, args, child_env):
        log = (run / f"{label}.log").open("w+b")
        handles.append(log)
        process = subprocess.Popen(["ip", "netns", "exec", namespace, *map(str, args)], env=child_env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
        children.append(process)
        return process

    def invoke(namespace, path, body, raw=False, asynchronous=False):
        data = {"path": path, "body": base64.b64encode(body).decode() if raw else body, "raw": raw}
        command = ["ip", "netns", "exec", namespace, sys.executable, str(Path(__file__).resolve()), "--client"]
        if asynchronous:
            process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
            children.append(process)
            process.stdin.write(json.dumps(data).encode())
            process.stdin.close()
            return process
        result = subprocess.run(command, input=json.dumps(data).encode(), capture_output=True, env=env, timeout=60)
        if result.returncode:
            status = re.search(rb"HTTP Error \d{3}", result.stderr)
            raise RuntimeError(f"local API {path.split('?')[0]} failed: {status.group().decode() if status else 'connection error'}")
        return json.loads(result.stdout)

    def wait_snapshot(namespace, predicate):
        deadline = time.monotonic() + 25
        while time.monotonic() < deadline:
            value = invoke(namespace, "/api/local-share/snapshot", {})
            if predicate(value):
                return value
            time.sleep(0.1)
        raise RuntimeError("timed out waiting for transfer state")

    try:
        for name in namespaces:
            ip("netns", "add", name)
            created.append(name)
        ip("link", "add", interfaces[0], "netns", namespaces[0], "type", "veth", "peer", "name", interfaces[1], "netns", namespaces[1])
        for index, name in enumerate(namespaces):
            ip("-n", name, "link", "set", "lo", "up")
            ip("-n", name, "addr", "add", f"10.248.231.{index + 1}/30", "dev", interfaces[index])
            ip("-n", name, "link", "set", interfaces[index], "up")
            if any(ip("-n", name, family, "route", "show", "default").stdout.strip() for family in ("-4", "-6")):
                raise RuntimeError("namespace unexpectedly has a default route")
        for index, name in enumerate(namespaces):
            home = run / f"peer-{index}"
            home.mkdir()
            for directory in ("config", "cache", "receive", "tmp"):
                (home / directory).mkdir()
            peer_env = env | {"HOME": str(home), "USERPROFILE": str(home), "XDG_CONFIG_HOME": str(home / "config"),
                              "XDG_CACHE_HOME": str(home / "cache"), "APPDATA": str(home / "config"),
                              "LOCALAPPDATA": str(home / "cache"), "TMPDIR": str(home / "tmp"),
                              "TMP": str(home / "tmp"), "TEMP": str(home / "tmp"),
                              "PROTOPEEK_AGENT_CONNECTION": str(home / "agent.json")}
            start(name, f"launcher-{index}", [executable, "-port=43118", "-open-browser=false"], peer_env)
        start(namespaces[1], "http-fixture", [sys.executable, "-m", "http.server", "8080", "--bind", "10.248.231.2", "--directory", run / "peer-1" / "receive"], env)
        for name in namespaces:
            deadline = time.monotonic() + 25
            while True:
                try:
                    invoke(name, "/api/local-share/snapshot", {})
                    break
                except (RuntimeError, subprocess.TimeoutExpired):
                    if time.monotonic() >= deadline or any(process.poll() is not None for process in children):
                        raise RuntimeError("owned launcher or fixture did not become ready")
                    time.sleep(0.1)
        deadline = time.monotonic() + 10
        while True:
            probe = subprocess.run(["ip", "netns", "exec", namespaces[0], sys.executable, "-c",
                                    "import socket; socket.create_connection(('10.248.231.2', 8080), 1).close()"],
                                   capture_output=True, timeout=3)
            if probe.returncode == 0:
                break
            if time.monotonic() >= deadline or any(process.poll() is not None for process in children):
                raise RuntimeError("owned HTTP fixture did not become ready")
            time.sleep(0.1)
        discovery = invoke(namespaces[0], "/api/network/discover", {"cidr": "10.248.231.2/32", "profile": "quick", "consent": True})
        hosts = [host for host in discovery["hosts"] if host["address"] == "10.248.231.2"]
        if discovery["hostCount"] != 1 or len(hosts) != 1 or not any(port["port"] == 8080 and port["state"] == "open" for port in hosts[0]["ports"]):
            raise RuntimeError("native discovery did not report the owned HTTP port")
        print("PASS native /32 discovery observed the owned TCP 8080 service", flush=True)
        for index, name in enumerate(namespaces):
            invoke(name, "/api/local-share/start", {"name": f"fixture-{index}", "directory": str(run / f"peer-{index}" / "receive")})
        receiver = invoke(namespaces[1], "/api/local-share/snapshot", {})
        connected = invoke(namespaces[0], "/api/local-share/connect", {"address": "10.248.231.2:53318", "fingerprint": receiver["fingerprint"]})
        peer = next((item for item in connected["peers"] if item["address"] == "10.248.231.2:53318"), None)
        if not peer:
            raise RuntimeError("receiver did not appear after pinned connect")
        payload = b"ProtoPeek isolated namespace acceptance\n" * 128
        digest = hashlib.sha256(payload).hexdigest()
        query = urllib.parse.urlencode({"peer": peer["id"], "name": "fixture.bin"})
        sending = invoke(namespaces[0], "/api/local-share/send?" + query, payload, raw=True, asynchronous=True)
        pending = wait_snapshot(namespaces[1], lambda value: any(job["state"] == "pending" for job in value["jobs"]))
        job = next(job for job in pending["jobs"] if job["state"] == "pending")
        destination = run / "peer-1" / "receive" / "fixture.bin"
        if sending.poll() is not None or destination.exists():
            raise RuntimeError("transfer completed before receiver consent")
        invoke(namespaces[1], "/api/local-share/decide", {"id": job["id"], "accept": True})
        sending.wait(timeout=45)
        if sending.returncode or json.loads(sending.stdout.read()) != {"sent": True}:
            raise RuntimeError("approved sender did not finish")
        completed = wait_snapshot(namespaces[1], lambda value: any(item["id"] == job["id"] and item["state"] == "completed" for item in value["jobs"]))
        recorded = next(item for item in completed["jobs"] if item["id"] == job["id"])
        if recorded["sha256"] != digest or destination.read_bytes() != payload:
            raise RuntimeError("received bytes or reported SHA-256 differ")
        for name in namespaces:
            if invoke(name, "/api/local-share/stop", {})["running"]:
                raise RuntimeError("transfer listener did not stop")
        print("PASS pinned two-peer transfer waited for acceptance and matched bytes and SHA-256", flush=True)
    finally:
        cleanup_errors = []
        for process in reversed(children):
            try:
                if process.poll() is None:
                    process.terminate()
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait(timeout=5)
            except (OSError, subprocess.SubprocessError):
                cleanup_errors.append("an owned process could not be stopped")
        for handle in handles:
            handle.close()
        for name in reversed(created):
            try:
                remaining = ip("netns", "pids", name).stdout.strip()
                if remaining:
                    cleanup_errors.append("a namespace still has processes; it was preserved")
                    continue
                ip("netns", "delete", name)
            except (OSError, subprocess.SubprocessError):
                cleanup_errors.append("an owned namespace could not be removed")
        if run.resolve().parent != temp_root or not run.name.startswith("protopeek-netns-"):
            cleanup_errors.append("unexpected temporary directory; it was preserved")
        elif not cleanup_errors:
            shutil.rmtree(run)
        if cleanup_errors:
            raise RuntimeError("; ".join(cleanup_errors))
        print("Removed owned processes, isolated namespaces and temporary profile", flush=True)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--client":
        call_in_namespace()
    else:
        main()
