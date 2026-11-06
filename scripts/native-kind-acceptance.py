#!/usr/bin/env python3
"""Exercise kubectl service forwarding against an owned disposable kind cluster.

Run only on a disposable Linux runner with Docker, kind, kubectl and Go available:
  python3 scripts/native-kind-acceptance.py /absolute/path/to/pp
The cluster has a private kubeconfig and the fixture listens only via a local
kubectl port-forward. No existing Kubernetes contexts or resources are touched.
"""
import json
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import time

from container_acceptance import expected_response, fixture_image, inspect, launcher, local_environment, prepare_fixture, run, stop, temp_root

NODE_IMAGE = "kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"


def main():
    if len(sys.argv) != 2 or sys.platform != "linux":
        raise SystemExit("usage: python3 scripts/native-kind-acceptance.py /absolute/path/to/pp")
    exe = Path(sys.argv[1]).resolve(strict=True)
    if not exe.is_file() or not os.access(exe, os.X_OK):
        raise RuntimeError("expected an executable ProtoPeek launcher")
    root = temp_root()
    suffix = secrets.token_hex(6)
    name = "protopeek-qa-" + suffix
    image = "localhost/protopeek-qa-fixture:" + suffix
    with tempfile.TemporaryDirectory(prefix="protopeek-kind-", dir=root) as temp:
        scratch = Path(temp).resolve()
        if scratch.parent != root or not scratch.name.startswith("protopeek-kind-"):
            raise RuntimeError("unsafe temporary directory")
        kubeconfig = scratch / "kubeconfig"
        env = local_environment()
        env["KUBECONFIG"] = str(kubeconfig)
        env["KIND_EXPERIMENTAL_PROVIDER"] = "docker"
        kubectl = ["kubectl", "--kubeconfig", str(kubeconfig), "--namespace", "default"]
        clusters = run(["kind", "get", "clusters"], env=env, timeout=30).stdout.splitlines()
        if name in clusters:
            raise RuntimeError("randomized cluster name already exists")
        context = prepare_fixture(scratch)
        with fixture_image(["docker"], context, image):
            try:
                run(["kind", "create", "cluster", "--name", name, "--kubeconfig", str(kubeconfig),
                     "--image", NODE_IMAGE, "--wait", "180s"], env=env, timeout=300)
                run(["kind", "load", "docker-image", "--name", name, image], env=env, timeout=120)
                manifest = {"apiVersion": "v1", "kind": "List", "items": [
                    {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": "fixture", "labels": {"app": "fixture"}},
                     "spec": {"containers": [{"name": "fixture", "image": image, "imagePullPolicy": "Never",
                                               "ports": [{"containerPort": 8080}]}]}},
                    {"apiVersion": "v1", "kind": "Service", "metadata": {"name": "example"},
                     "spec": {"selector": {"app": "fixture"}, "ports": [{"port": 80, "targetPort": 8080}]}}
                ]}
                run(kubectl + ["create", "-f", "-"], input=json.dumps(manifest), env=env, timeout=30)
                run(kubectl + ["wait", "--for=condition=Ready", "pod/fixture", "--timeout=120s"], env=env, timeout=135)
                log_path = scratch / "forward.log"
                with log_path.open("w") as log:
                    forward = subprocess.Popen(kubectl + ["port-forward", "--address", "127.0.0.1", "service/example", ":80"],
                                               env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
                    try:
                        deadline = time.monotonic() + 30
                        while time.monotonic() < deadline:
                            match = re.search(r"Forwarding from 127\.0\.0\.1:(\d+) ->", log_path.read_text())
                            if match:
                                port = int(match.group(1))
                                break
                            if forward.poll() is not None:
                                raise RuntimeError("kubectl port-forward exited before readiness")
                            time.sleep(0.1)
                        else:
                            raise RuntimeError("kubectl port-forward timed out")
                        with launcher(exe, scratch) as (client, base, token):
                            if not expected_response(inspect(client, base, token, port)):
                                raise RuntimeError("forwarded response did not match the owned fixture")
                    finally:
                        stop(forward)
            finally:
                # A unique name was checked before creation; only this cluster is removed.
                run(["kind", "delete", "cluster", "--name", name, "--kubeconfig", str(kubeconfig)], env=env, timeout=90)
                remaining = run(["kind", "get", "clusters"], env=env, timeout=30).stdout.splitlines()
                if name in remaining:
                    raise RuntimeError("owned kind cluster still exists")
        print("PASS: kubectl service forward to owned kind fixture via native ProtoPeek HTTP API; owned resources removed", flush=True)


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda _signum, _frame: sys.exit("interrupted"))
    main()
