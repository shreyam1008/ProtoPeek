"""Explicit native APT lifecycle acceptance, restricted to ephemeral hosted Linux.

No signing, publication, credentials or repository changes. All downloads are
anonymous; APT verifies signed indexes and package hashes. Evidence stays in the
fresh RUNNER_TEMP output directory, including the actual redirect destination.
"""
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("release_verifier", ROOT / "scripts/verify-published-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)
SITE = "https://protopeek.shreyam1008.com.np/apt"
DOWNLOAD = "https://github.com/shreyam1008/ProtoPeek/releases/download/"
KEY = Path("/usr/share/keyrings/protopeek-release-verify.gpg")
SOURCE = Path("/etc/apt/sources.list.d/protopeek-release-verify.list")


def require(value, message):
    if not value:
        raise ValueError(message)


def hosted_linux(environment=None, system=None):
    env = os.environ if environment is None else environment
    require((system or platform.system()) == "Linux" and env.get("GITHUB_ACTIONS") == "true"
            and env.get("RUNNER_ENVIRONMENT") == "github-hosted" and env.get("RUNNER_TEMP"),
            "APT installation is restricted to an ephemeral GitHub-hosted Linux runner")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def check_redirect(url, expected):
    try:
        with urllib.request.build_opener(NoRedirect).open(urllib.request.Request(url, method="HEAD"), timeout=30):
            pass
    except urllib.error.HTTPError as response:
        require(response.code == 302 and response.headers.get("Location") == expected,
                "APT package did not redirect to its exact canonical GitHub release asset")
        return {"url": url, "status": response.code, "location": response.headers["Location"]}
    raise ValueError("APT package must return the reviewed 302 redirect")


def public_bytes(url, maximum):
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "ProtoPeek-APT-verifier"}), timeout=30) as response:
        require(response.status == 200 and response.url == url, "Unexpected public-key redirect/status")
        data = response.read(maximum + 1)
        require(len(data) <= maximum, "Public key exceeds its bound")
        return data


def run(args, output, label, cwd=None):
    with (output / (label + ".log")).open("wb") as stream:
        subprocess.run(args, cwd=cwd, stdout=stream, stderr=subprocess.STDOUT,
                       timeout=240, check=True, env=release.clean_environment())
    require((output / (label + ".log")).stat().st_size <= 4 << 20, "Command evidence exceeds its bound")
    return (output / (label + ".log")).read_text(encoding="utf-8", errors="replace")


def remove_owned_file(filename, expected):
    if filename.exists() or filename.is_symlink():
        require(filename.is_file() and not filename.is_symlink()
                and filename.read_bytes() == expected, "Owned APT cleanup file changed")
        subprocess.run(["sudo", "rm", "--", str(filename)], check=True, timeout=15)
        require(not filename.exists() and not filename.is_symlink(), "Owned APT cleanup file remains")


@contextmanager
def verification_report(output, report):
    try:
        yield
    except Exception as error:
        report["state"] = "fail"
        report["failure"] = {"type": type(error).__name__, "message": str(error)[:4096]}
        raise
    else:
        report["state"] = "pass"
    finally:
        (output / "summary.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def cleanup_owned(output, apt, owned_package, source_bytes, key_bytes, report):
    cleanup = report["cleanup"] = {}
    failures = []

    def package():
        if owned_package:
            run(apt + ["remove", "-y", "protopeek"], output, "failure-cleanup-package")
            require(not Path("/usr/bin/protopeek").exists() and not Path("/usr/bin/pp").exists(),
                    "Cleanup left installed commands")

    for name, action in (("package", package), ("source", lambda: remove_owned_file(SOURCE, source_bytes)),
                         ("key", lambda: remove_owned_file(KEY, key_bytes))):
        try:
            action()
            cleanup[name] = {"state": "not-needed" if name == "package" and not owned_package else "pass"}
        except Exception as error:
            cleanup[name] = {"state": "fail", "type": type(error).__name__, "message": str(error)[:4096]}
            failures.append(error)
    if failures:
        raise RuntimeError("APT verification cleanup failed; see summary.json") from failures[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--sha", required=True)
    parser.add_argument("--previous-tag", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    hosted_linux()
    require(release.TAG.fullmatch(args.tag) and release.TAG.fullmatch(args.previous_tag)
            and re.fullmatch("[a-f0-9]{40}", args.sha), "Exact stable tags and source SHA required")
    require(tuple(map(int, args.previous_tag[1:].split('.'))) < tuple(map(int, args.tag[1:].split('.'))),
            "Baseline must precede the target upgrade version")
    output = args.output.resolve()
    require(output.is_relative_to(Path(os.environ["RUNNER_TEMP"]).resolve())
            and output != Path(os.environ["RUNNER_TEMP"]).resolve(), "Output must be a new RUNNER_TEMP child")
    require(not KEY.exists() and not KEY.is_symlink() and not SOURCE.exists() and not SOURCE.is_symlink(),
            "An APT verification source/key already exists")
    require(not shutil.which("protopeek") and not shutil.which("pp"), "A ProtoPeek command already exists")
    prior = subprocess.run(["dpkg-query", "-W", "-f=${Status}", "protopeek"], capture_output=True)
    require(b"install ok installed" not in prior.stdout, "ProtoPeek is already installed")
    output.mkdir(parents=True, exist_ok=False)
    report = {"tag": args.tag, "sourceSHA": args.sha, "previousTag": args.previous_tag,
              "lifecycle": {"state": "not-started"}, "cleanup": {"state": "not-needed"}}
    with verification_report(output, report):
        verify(args, output, report)
    print(json.dumps({"state": "pass", "tag": args.tag, "sha": args.sha, "evidence": str(output)}))


def verify(args, output, report):
    actual_sha = subprocess.run(["git", "rev-parse", f"refs/tags/{args.tag}^{{commit}}"], cwd=ROOT,
                                capture_output=True, text=True, check=True).stdout.strip()
    require(actual_sha == args.sha, "Release tag differs from explicit source SHA")
    manifest = json.loads(subprocess.run(["git", "show", args.sha + ":web/src/console/extension-manifest.json"],
                                        cwd=ROOT, capture_output=True, check=True).stdout)
    catalog = [{"id": item["id"], "capability": item["capability"]} for item in manifest]
    arch = subprocess.run(["dpkg", "--print-architecture"], capture_output=True, text=True, check=True).stdout.strip()
    archive_arch = {"amd64": "x86_64", "arm64": "arm64", "i386": "x86_32"}[arch]
    current = {"tag": args.tag, "sha": args.sha}
    current_hashes = release.checksums(release.get(DOWNLOAD + args.tag + "/checksums.txt", 1 << 20))
    archive_name = f"protopeek_{args.tag[1:]}_linux_{archive_arch}.tar.gz"
    archive = release.get(DOWNLOAD + args.tag + "/" + archive_name, release.MAX_ASSET)
    require(release.digest(archive) == current_hashes.get(archive_name), "Reference archive hash mismatch")
    release.inspect_archive(archive, archive_name, current, output, "linux", {"amd64": "amd64", "arm64": "arm64", "i386": "386"}[arch], True)
    filename = f"protopeek_{args.tag[1:]}_{arch}.deb"
    redirect = check_redirect(SITE + "/pool/main/d/protopeek/" + filename, DOWNLOAD + args.tag + "/" + filename)
    key_bytes = public_bytes(SITE + "/key.gpg", 1 << 20)
    require(key_bytes == (ROOT / "web/site/public/apt/key.gpg").read_bytes(), "HTTPS APT public key differs from committed trust anchor")
    key_local, source_local = output / "key.gpg", output / "source.list"
    key_local.write_bytes(key_bytes)
    source_bytes = f"deb [signed-by={KEY}] {SITE} stable main\n".encode()
    source_local.write_bytes(source_bytes)
    cache = output / "cache"
    cache.mkdir(mode=0o755)
    apt = ["sudo", "apt-get", "-o", "Dir::Etc::sourcelist=" + str(SOURCE), "-o", "Dir::Etc::sourceparts=-",
           "-o", "APT::Get::List-Cleanup=0", "-o", "APT::Update::Error-Mode=any",
           "-o", "Dir::Cache::archives=" + str(cache), "-o", "Acquire::Retries=3"]
    owned_package = False
    report.update({"architecture": arch, "publicKeySHA256": release.digest(key_bytes), "redirect": redirect})
    try:
        run(["sudo", "install", "-m", "644", str(key_local), str(KEY)], output, "key-install")
        run(["sudo", "install", "-m", "644", str(source_local), str(SOURCE)], output, "source-install")
        run(apt + ["update"], output, "signed-https-update")
        run(apt[1:] + ["download", "protopeek=" + args.tag[1:]], output, "https-package-download", cache)
        package_bytes = (cache / filename).read_bytes()
        require(release.digest(package_bytes) == current_hashes.get(filename), "APT-downloaded package differs from public release checksum")
        report["packageSHA256"] = release.digest(package_bytes)

        def installed(label):
            versions = {}
            for command in ("protopeek", "pp"):
                binary = Path("/usr/bin") / command
                require(release.digest(binary.read_bytes()) == current["hashes"][command], "Installed binary differs from exact tagged reference archive")
                text = run([str(binary), "-version"], output, label + "-" + command)
                require(re.search(r"(?<!\S)" + re.escape(args.tag) + r"(?!\S)", text), "Installed alias version mismatch")
                versions[command] = text.strip()
            return {"CLI": versions, "HTTP": release.smoke(Path("/usr/bin/protopeek"), current,
                    output / (label + "-profile"), label, output, catalog)}

        owned_package = True
        run(apt + ["install", "-y", "protopeek=" + args.tag[1:]], output, "fresh-install")
        report["fresh"] = installed("fresh")
        run(apt + ["remove", "-y", "protopeek"], output, "fresh-remove")
        require(not Path("/usr/bin/protopeek").exists() and not Path("/usr/bin/pp").exists(), "Fresh removal left installed commands")
        previous_name = f"protopeek_{args.previous_tag[1:]}_{arch}.deb"
        baseline_hashes = release.checksums(release.get(DOWNLOAD + args.previous_tag + "/checksums.txt", 1 << 20))
        baseline = release.get(DOWNLOAD + args.previous_tag + "/" + previous_name, release.MAX_ASSET)
        require(release.digest(baseline) == baseline_hashes.get(previous_name), "Baseline Debian checksum mismatch")
        previous = output / previous_name
        previous.write_bytes(baseline)
        run(apt + ["install", "-y", str(previous)], output, "baseline-install")
        for command in ("protopeek", "pp"):
            text = run(["/usr/bin/" + command, "-version"], output, "baseline-" + command)
            require(re.search(r"(?<!\S)" + re.escape(args.previous_tag) + r"(?!\S)", text), "Real baseline CLI not installed")
        report["baselineSHA256"] = release.digest(baseline)
        run(apt + ["install", "-y", "protopeek=" + args.tag[1:]], output, "real-upgrade")
        report["upgrade"] = installed("upgrade")
        run(apt + ["remove", "-y", "protopeek"], output, "final-remove")
        require(not Path("/usr/bin/protopeek").exists() and not Path("/usr/bin/pp").exists(), "Removal left installed commands")
        owned_package = False
        report["removal"] = "Both aliases removed after fresh install and real package upgrade"
    except Exception as error:
        report["lifecycle"] = {"state": "fail", "type": type(error).__name__, "message": str(error)[:4096]}
        raise
    else:
        report["lifecycle"] = {"state": "pass"}
    finally:
        cleanup_owned(output, apt, owned_package, source_bytes, key_bytes, report)


if __name__ == "__main__":
    main()
