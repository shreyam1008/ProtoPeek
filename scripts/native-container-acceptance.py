#!/usr/bin/env python3
"""Exercise Docker and Podman port guides against a private real launcher.

Usage: python3 scripts/native-container-acceptance.py /absolute/path/to/pp [--sudo-podman]
Requires Go, Docker, and Podman on a disposable Linux host. The fixture image is
built locally FROM scratch; only unique test containers and image tags are removed.
"""
import os
from pathlib import Path
import re
import secrets
import signal
import shutil
import sys
import tempfile
import time
import urllib.error

from container_acceptance import expected_response, fixture_image, inspect, launcher, prepare_fixture, run, temp_root


def require_unused_container(engine, container):
    # A failed listing is not evidence that the generated name is available.
    existing = run(engine + ["ps", "-aq", "--filter", f"name={container}"], timeout=30)
    if existing.stdout.strip():
        raise RuntimeError("generated container name is already in use")


def main():
    if sys.platform != "linux" or len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--sudo-podman"):
        raise SystemExit(__doc__)
    executable = Path(sys.argv[1]).resolve(strict=True)
    if not executable.is_file() or not os.access(executable, os.X_OK):
        raise RuntimeError("pp must be an executable file")
    for command in ("go", "docker", "podman"):
        if not shutil.which(command):
            raise RuntimeError(f"missing required command: {command}")
    if len(sys.argv) == 3 and not shutil.which("sudo"):
        raise RuntimeError("--sudo-podman requires sudo")
    root_dir = temp_root()
    suffix = secrets.token_hex(8)
    engines = [("docker", "docker (host daemon)", ["docker"]),
               ("podman", "podman (rootful)" if len(sys.argv) == 3 else "podman (rootless)",
                ["sudo", "-n", "podman"] if len(sys.argv) == 3 else ["podman"])]
    with tempfile.TemporaryDirectory(prefix="protopeek-container-", dir=root_dir) as tmp:
        root = Path(tmp).resolve()
        if root.parent != root_dir or not root.name.startswith("protopeek-container-"):
            raise RuntimeError("unsafe temporary root")
        context = prepare_fixture(root)
        with launcher(executable, root) as (client, base, token):
            for engine_id, name, engine in engines:
                tag = f"localhost/protopeek-accept-{suffix}-{engine_id}:fixture"
                container = f"protopeek-accept-{suffix}-{engine_id}"
                require_unused_container(engine, container)
                with fixture_image(engine, context, tag):
                    try:
                        run(engine + ["run", "-d", "--pull=never", "--name", container,
                                      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only",
                                      "--user=65532:65532", "--pids-limit=64", "-p", "127.0.0.1::8080", tag])
                        mapping = run(engine + ["port", container, "8080/tcp"]).stdout.strip()
                        match = re.fullmatch(r"127\.0\.0\.1:(\d+)", mapping)
                        if not match or not 0 < int(match.group(1)) < 65536:
                            raise RuntimeError(f"{name} did not report a loopback-only mapped port: {mapping!r}")
                        port = int(match.group(1))
                        deadline = time.monotonic() + 20
                        while True:
                            try:
                                if expected_response(inspect(client, base, token, port)):
                                    break
                            except (OSError, urllib.error.URLError, ValueError):
                                pass
                            if time.monotonic() >= deadline:
                                raise RuntimeError(f"{name} mapped endpoint did not return expected HTTP body")
                            time.sleep(0.2)
                    finally:
                        # A name collision was excluded before this run; never prune shared resources.
                        removed = run(engine + ["rm", "-f", container], check=False, timeout=30)
                        run(engine + ["info"], timeout=30)
                        remaining = run(engine + ["ps", "-aq", "--filter", f"name={container}"], timeout=30)
                        if remaining.stdout.strip():
                            raise RuntimeError(f"{name} owned container remains: {removed.stderr[-300:]}")
                print(f"PASS {name}: real CLI reported loopback mapped port; ProtoPeek HTTP returned exact fixture body; container and image removed", flush=True)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda _signum, _frame: sys.exit("interrupted"))
    main()
