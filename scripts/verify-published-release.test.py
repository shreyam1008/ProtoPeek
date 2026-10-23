"""Offline regression checks for release-verifier trust and isolation boundaries."""

import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

SCRIPT = Path(__file__).with_name("verify-published-release.py")
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("verify_published_release", SCRIPT)
verify = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verify)
SHA = "a" * 40


class PublishedReleaseVerification(unittest.TestCase):
    def test_checksums_refuse_duplicate_traversal_and_malformed_entries(self):
        good = ("a" * 64 + "  release.zip\n").encode()
        self.assertEqual(verify.checksums(good), {"release.zip": "a" * 64})
        for data in (good + good, good.replace(b"release.zip", b"../release.zip"), b"not-a-sha  release.zip\n"):
            with self.subTest(data=data), self.assertRaises(ValueError):
                verify.checksums(data)

    def test_asset_authority_and_size_are_checked_before_network_io(self):
        for url, size in (("https://attacker.invalid/release.zip", 10), (verify.BASE + "v1.2.3/release.zip", verify.MAX_ASSET + 1)):
            value = {"tag": "v1.2.3", "assets": {"release.zip": {"browser_download_url": url, "size": size}}}
            with self.subTest(url=url), patch.object(verify, "get") as get, self.assertRaises(ValueError):
                verify.asset(value, "release.zip", Path("unused"))
            get.assert_not_called()

    def test_exact_expected_tag_commit_precedes_asset_or_output_acceptance(self):
        metadata = {"tag_name": "v1.2.3", "draft": False, "prerelease": False, "published_at": "2026-10-23T00:00:00Z", "assets": []}
        with patch.object(verify, "public_json", return_value=metadata), patch.object(verify, "resolve_tag", return_value="b" * 40), self.assertRaisesRegex(ValueError, "commit differs"):
            verify.release("v1.2.3", SHA, None)

    def test_public_mode_refuses_draft_metadata(self):
        metadata = {"tag_name": "v1.2.3", "draft": True, "prerelease": False, "published_at": None, "assets": []}
        with patch.object(verify, "public_json", return_value=metadata), self.assertRaisesRegex(ValueError, "visibility"):
            verify.release("v1.2.3", SHA, None)

    def test_draft_asset_bytes_must_match_declared_size_and_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets, output = root / "assets", root / "output"
            assets.mkdir()
            output.mkdir()
            (assets / "release.zip").write_bytes(b"changed")
            value = {"tag": "v1.2.3", "assetDirectory": str(assets), "assets": {"release.zip": {"browser_download_url": verify.BASE + "v1.2.3/release.zip", "size": 7, "digest": "sha256:" + "a" * 64}}}
            with patch.object(verify, "get") as get, self.assertRaisesRegex(ValueError, "digest mismatch"):
                verify.asset(value, "release.zip", output)
            get.assert_not_called()
            self.assertEqual(list(output.iterdir()), [])

    def test_archive_traversal_and_symlink_refused_without_binary_execution(self):
        for symlink in (False, True):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                item = zipfile.ZipInfo("link" if symlink else "../protopeek.exe")
                if symlink:
                    item.create_system = 3
                    item.external_attr = 0o120777 << 16
                archive.writestr(item, "target")
            with self.subTest(symlink=symlink), patch.object(verify.subprocess, "run") as run, self.assertRaises(ValueError):
                verify.inspect_archive(stream.getvalue(), "release.zip", {}, Path("unused"), "windows", "amd64", True)
            run.assert_not_called()

    def test_archive_entry_count_is_bounded_before_binary_execution(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            for index in range(verify.MAX_MEMBERS + 1):
                archive.writestr(str(index), b"")
        with patch.object(verify.subprocess, "run") as run, self.assertRaisesRegex(ValueError, "bound exceeded"):
            verify.inspect_archive(stream.getvalue(), "release.zip", {}, Path("unused"), "windows", "amd64", True)
        run.assert_not_called()

    def test_wrong_linker_version_prevents_native_app_execution(self):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, "w") as archive:
            for name in ("protopeek.exe", "pp.exe"):
                archive.writestr(name, b"binary fixture")
            for name in ("protopeek.1", "pp.1"):
                archive.writestr("man/" + name, '.TH PROTOPEEK 1 "October 2026" "ProtoPeek 1.2.3"\n')
        wrong = subprocess.CompletedProcess([], 0, stdout=("build -ldflags=\"-X main.version=v1.2.30\"\nbuild vcs.revision=" + SHA + "\nbuild GOOS=windows\nbuild GOARCH=amd64\n").encode())
        with tempfile.TemporaryDirectory() as directory, patch.object(verify.subprocess, "run", return_value=wrong) as run, self.assertRaisesRegex(ValueError, "linker version differs"):
            verify.inspect_archive(stream.getvalue(), "release.zip", {"tag": "v1.2.3", "sha": SHA}, Path(directory), "windows", "amd64", False)
        self.assertEqual(run.call_args.args[0][:3], ["go", "version", "-m"])

    def test_child_environment_drops_release_overrides_and_tokens(self):
        values = {"PROTOPEEK_DOWNLOAD_URL": "file:///untrusted", "protopeek_repo": "untrusted", "PROTOPEEK_VERSION": "v9.9.9", "GH_TOKEN": "test-sentinel", "GITHUB_TOKEN": "test-sentinel"}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, values):
            env = verify.child_environment(Path(directory))
        self.assertFalse(any(key.upper().startswith("PROTOPEEK_") for key in env))
        self.assertNotIn("GH_TOKEN", env)
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertEqual(env.get("HOME"), os.environ.get("HOME"))

    def test_public_install_cannot_inherit_test_download_overrides(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            prefix = root / "install"
            prefix.mkdir()
            hashes = {}
            for name in ("protopeek.exe", "pp.exe"):
                data = name.encode()
                (prefix / name).write_bytes(data)
                hashes[name] = hashlib.sha256(data).hexdigest()
            (prefix / ".protopeek-install").write_text("ProtoPeek " + hashes["pp.exe"])
            value = {"tag": "v1.2.3", "hashes": hashes}
            calls = []

            def command(args, env, log):
                calls.append((args, env.copy()))
                return "protopeek v1.2.3\n"

            with patch.dict(os.environ, {"PROTOPEEK_DOWNLOAD_URL": "file:///untrusted", "PROTOPEEK_REPO": "untrusted"}), patch.object(verify, "user_path", return_value="original"), patch.object(verify, "command", side_effect=command):
                result = verify.install(root / "install.ps1", value, prefix, root / "profile", "public", root, True)
            args, env = calls[0]
            self.assertNotIn("-DownloadUrl", args)
            self.assertNotIn("-ChecksumUrl", args)
            self.assertIn("-NoPathUpdate", args)
            self.assertIn("-NoShortcuts", args)
            self.assertFalse(any(key.upper().startswith("PROTOPEEK_") for key in env))
            self.assertEqual(result["installerSource"], "anonymous-official-release-URLs")

    def test_default_path_mode_refuses_local_execution_before_any_installer(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"GITHUB_ACTIONS": "false"}), patch.object(verify, "install") as install, self.assertRaisesRegex(ValueError, "GitHub-hosted"):
            verify.ephemeral_default(Path("unused"), {}, Path(directory), True, False)
        install.assert_not_called()

    def test_public_default_exercises_latest_resolver_while_draft_and_private_are_pinned(self):
        for windows in (False, True):
            for draft in (False, True):
                for default in (False, True):
                    with self.subTest(windows=windows, draft=draft, default=default), tempfile.TemporaryDirectory() as directory:
                        root = Path(directory)
                        prefix = root / "install"
                        prefix.mkdir()
                        names = ("protopeek.exe", "pp.exe") if windows else ("protopeek", "pp")
                        hashes = {}
                        for name in names:
                            data = name.encode()
                            (prefix / name).write_bytes(data)
                            hashes[name] = hashlib.sha256(data).hexdigest()
                        (prefix / ".protopeek-install").write_text("ProtoPeek " + hashes[names[1]])
                        if not windows:
                            (prefix / "man").mkdir()
                            for name in ("protopeek.1", "pp.1"):
                                data = name.encode()
                                (prefix / "man" / name).write_bytes(data)
                                hashes["man/" + name] = hashlib.sha256(data).hexdigest()
                        value = {"tag": "v1.2.3", "hashes": hashes, "archivePath": str(root / "archive.zip"), "checksumPath": str(root / "checksums.txt")}
                        calls = []

                        def command(args, env, log):
                            calls.append((args, env.copy()))
                            return "protopeek v1.2.3\n"

                        inherited = {"PROTOPEEK_VERSION": "v9.9.9", "PROTOPEEK_CHANNEL": "nightly", "PROTOPEEK_DOWNLOAD_URL": "file:///untrusted"}
                        with patch.dict(os.environ, inherited), patch.object(verify, "user_path", return_value="original"), patch.object(verify, "command", side_effect=command):
                            result = verify.install(root / ("install.ps1" if windows else "install.sh"), value, prefix, root / "profile", "matrix", root, windows, draft, default)
                        args, env = calls[0]
                        explicit = draft or not default
                        if windows:
                            self.assertEqual("-Version" in args, explicit)
                            if explicit:
                                self.assertEqual(args[args.index("-Version") + 1], "v1.2.3")
                            self.assertEqual("-DownloadUrl" in args, draft)
                        else:
                            self.assertEqual(env.get("PROTOPEEK_VERSION"), "v1.2.3" if explicit else None)
                            self.assertEqual("PROTOPEEK_DOWNLOAD_URL" in env, draft)
                        self.assertNotIn("PROTOPEEK_CHANNEL", env)
                        self.assertEqual(result["versionSelection"], "explicit-tag" if explicit else "latest-stable-resolver")


if __name__ == "__main__":
    unittest.main()
