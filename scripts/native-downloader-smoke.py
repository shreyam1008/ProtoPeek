#!/usr/bin/env python3
"""Exercise a built lightweight pp binary with no installed aria2.

Usage: python scripts/native-downloader-smoke.py path/to/pp[.exe]
The HTTP server, user profile and downloads are isolated and temporary.
"""

import hashlib
import http.server
import json
import os
import pathlib
import platform
import subprocess
import sys
import tempfile
import threading


PAYLOAD = b"ProtoPeek native downloader acceptance fixture\n" * 4096
DIGEST = hashlib.sha256(PAYLOAD).hexdigest()


class Fixture(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Length", str(len(PAYLOAD)))
        self.send_header("ETag", '"protopeek-fixture-v1"')
        self.end_headers()
        self.wfile.write(PAYLOAD)

    def log_message(self, *_args):
        pass


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    binary = pathlib.Path(sys.argv[1]).resolve(strict=True)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Fixture)
    server_thread = threading.Thread(target=server.serve_forever, daemon=True)
    server_thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix="protopeek-native-download-") as temporary:
            root = pathlib.Path(temporary)
            downloads = root / "Downloads"
            downloads.mkdir()
            (root / "empty-path").mkdir()
            env = os.environ.copy()
            env.update({
                "HOME": str(root),
                "USERPROFILE": str(root),
                "APPDATA": str(root / "config"),
                "LOCALAPPDATA": str(root / "cache"),
                "XDG_CONFIG_HOME": str(root / "config"),
                "XDG_CACHE_HOME": str(root / "cache"),
                "PATH": str(root / "empty-path"),
            })
            # Repeat in the same profile to prove the first engine releases its
            # process lock and preserves a usable session across restarts.
            for name in ("first.bin", "second.bin"):
                url = f"http://127.0.0.1:{server.server_port}/file?token=fixture-secret"
                result = subprocess.run(
                    [str(binary), "download", "--output", name, "--sha256", DIGEST, url],
                    env=env, capture_output=True, text=True, timeout=30, check=False,
                )
                expected = downloads / name
                if result.returncode != 0:
                    raise RuntimeError(f"download failed: {result.stderr}")
                if result.stdout.strip() != str(expected) or expected.read_bytes() != PAYLOAD:
                    raise RuntimeError("download output or contents did not match the fixture")
                if "built-in HTTP engine" not in result.stderr or "fixture-secret" in result.stderr:
                    raise RuntimeError("native engine identity or secret redaction was incorrect")
            print(json.dumps({"platform": platform.system(), "arch": platform.machine(), "sha256": DIGEST, "downloads": 2}))
    finally:
        server.shutdown()
        server.server_close()
        server_thread.join(timeout=5)


if __name__ == "__main__":
    main()
