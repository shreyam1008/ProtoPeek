"""Shared primitives for the isolated native container guide checks."""

from contextlib import contextmanager
import http.cookiejar
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

REPO = Path(__file__).resolve().parent.parent
BODY = "protopeek-container-fixture\n"


def run(args, *, cwd=None, env=None, timeout=120, check=True, input=None):
    result = subprocess.run(args, cwd=cwd, env=env, input=input, capture_output=True,
                            text=True, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f"{args[0]} failed ({result.returncode}): {result.stderr[-1000:]}")
    return result


def local_environment():
    env = os.environ.copy()
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"):
        env.pop(key, None)
    env["NO_PROXY"] = env["no_proxy"] = "127.0.0.1,localhost,::1"
    return env


def temp_root():
    return Path(os.environ.get("RUNNER_TEMP") or tempfile.gettempdir()).resolve(strict=True)


def prepare_fixture(root):
    context = root / "image"
    context.mkdir()
    env = os.environ.copy()
    env.update(CGO_ENABLED="0", GOFLAGS="-mod=readonly")
    run(["go", "build", "-o", str(context / "fixture"), "./scripts/container-fixture"], cwd=REPO, env=env)
    (context / "Dockerfile").write_text('FROM scratch\nCOPY fixture /fixture\nENTRYPOINT ["/fixture"]\n', encoding="utf-8")
    return context


def stop(process):
    if process is None:
        return
    try:
        if process.poll() is None:
            process.terminate()
        process.wait(timeout=15)
    except ProcessLookupError:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


@contextmanager
def launcher(executable, root):
    env = local_environment()
    for key in ("HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_CACHE_HOME", "TMPDIR"):
        path = root / key
        path.mkdir()
        env[key] = str(path)
    log_path = root / "launcher.log"
    with log_path.open("w") as log:
        proc = subprocess.Popen([str(executable), "-port=0", "-open-browser=false"], cwd=REPO,
                                env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline:
                match = re.search(r"ProtoPeek available at (http://127\.0\.0\.1:\d+)/", log_path.read_text())
                if match:
                    base = match.group(1)
                    break
                if proc.poll() is not None:
                    raise RuntimeError(f"launcher exited with {proc.returncode}")
                time.sleep(0.1)
            else:
                raise RuntimeError("launcher startup timed out")
            cookies = http.cookiejar.CookieJar()
            client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(cookies))
            with client.open(base + "/", timeout=10) as response:
                response.read()
            token = next(c.value for c in cookies if c.name == "_protopeek_csrf_token")
            yield client, base, token
        finally:
            stop(proc)


def inspect(client, base, token, port):
    payload = json.dumps({"method": "GET", "url": f"http://127.0.0.1:{port}/", "timeoutMs": 5000}).encode()
    request = urllib.request.Request(base + "/api/http/request", data=payload,
        headers={"Origin": base, "Content-Type": "application/json", "x-protopeek-csrf-token": token})
    with client.open(request, timeout=10) as response:
        return json.load(response)


def expected_response(result):
    return result.get("statusCode") == 200 and result.get("body") == BODY and result.get("bodyEncoding") == "text"


@contextmanager
def fixture_image(engine, context, tag):
    # Listing must succeed; an inaccessible engine does not establish absence.
    existing = run(engine + ["images", "-aq", "--filter", f"reference={tag}"], timeout=30)
    if existing.stdout.strip():
        raise RuntimeError("generated image tag is already in use")
    try:
        run(engine + ["build", "--network=none", "-t", tag, str(context)], timeout=180)
        yield
    finally:
        removed = run(engine + ["image", "rm", tag], check=False, timeout=30)
        # Engine availability must be established even when the build never completed.
        run(engine + ["info"], timeout=30)
        remaining = run(engine + ["images", "-aq", "--filter", f"reference={tag}"], timeout=30)
        if remaining.stdout.strip():
            raise RuntimeError(f"owned image tag remains: {removed.stderr[-300:]}")
