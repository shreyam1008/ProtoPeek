"""Offline regression checks for release-verifier trust and isolation boundaries."""

import hashlib
import copy
from contextlib import redirect_stdout
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
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
    def test_only_windows_powershell_children_normalize_inherited_module_path(self):
        inherited = {"pSmOdUlEpAtH": "incompatible-core-modules", "KEEP": "original"}
        for executable in ("powershell.exe", "C:/Windows/System32/WindowsPowerShell/v1.0/PowerShell.EXE", "pwsh.exe", "protopeek.exe"):
            with self.subTest(executable=executable), tempfile.TemporaryDirectory() as directory, patch.object(verify.subprocess, "Popen") as popen:
                popen.return_value.wait.return_value = 0
                verify.command([executable, "fixture"], inherited, Path(directory) / "child.log")
                actual = popen.call_args.kwargs["env"]
                self.assertEqual(any(key.upper() == "PSMODULEPATH" for key in actual), not executable.lower().endswith("powershell.exe"))
                self.assertEqual(actual["KEEP"], "original")
        self.assertEqual(inherited, {"pSmOdUlEpAtH": "incompatible-core-modules", "KEEP": "original"})
        result = subprocess.CompletedProcess([], 0, stdout=b'{"ok":true}')
        with patch.dict(os.environ, inherited, clear=True), patch.object(verify.subprocess, "run", return_value=result) as run:
            self.assertEqual(verify.powershell_json("fixture"), {"ok": True})
            self.assertFalse(any(key.upper() == "PSMODULEPATH" for key in run.call_args.kwargs["env"]))
            self.assertEqual(run.call_args.kwargs["env"]["KEEP"], "original")

    @unittest.skipUnless(os.name == "nt", "Real WindowsPowerShell5 inheritance regression requires Windows")
    def test_native_windows_powershell_hashes_with_inherited_core_module_path(self):
        pwsh = shutil.which("pwsh.exe") or shutil.which("pwsh")
        powershell = shutil.which("powershell.exe")
        self.assertIsNotNone(pwsh, "Native acceptance runs from PowerShell7 and requires its installed executable")
        self.assertIsNotNone(powershell, "WindowsPowerShell5 must be available for the official installer")
        core = subprocess.run([pwsh, "-NoProfile", "-NonInteractive", "-Command", "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); @{home=$PSHOME;major=$PSVersionTable.PSVersion.Major}|ConvertTo-Json -Compress"], capture_output=True, check=True, timeout=20)
        information = json.loads(core.stdout.decode("utf-8-sig"))
        self.assertGreaterEqual(information["major"], 7)
        core_modules = Path(information["home"]) / "Modules"
        self.assertTrue(core_modules.is_dir())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            known = root / "known-file.bin"
            known.write_bytes(b"Native installer SHA256 regression\x00\xff\n")
            expected = hashlib.sha256(known.read_bytes()).hexdigest()
            env = {key: value for key, value in verify.child_environment(root / "profile").items() if key.upper() != "PSMODULEPATH"}
            env["pSmOdUlEpAtH"] = str(core_modules)
            literal = str(known).replace("'", "''")
            code = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $hash=Get-FileHash -LiteralPath '" + literal + "' -Algorithm SHA256; @{hash=$hash.Hash.ToLowerInvariant();edition=$PSVersionTable.PSEdition;major=$PSVersionTable.PSVersion.Major}|ConvertTo-Json -Compress"
            with patch.dict(os.environ, env):
                text = verify.command([powershell, "-NoProfile", "-NonInteractive", "-Command", code], env, root / "native-hash.log")
                through_command = json.loads(text)
                through_json = verify.powershell_json(code)
            for actual in (through_command, through_json):
                self.assertEqual(actual, {"hash": expected, "edition": "Desktop", "major": 5})
            self.assertEqual(env["pSmOdUlEpAtH"], str(core_modules))

    def test_dispatch_scopes_write_visibility_to_draft_and_reuses_native_acceptance(self):
        workflows = SCRIPT.parent.parent / ".github/workflows"
        dispatch = (workflows / "verify-release.yml").read_text(encoding="utf-8")
        jobs = dict(verify.re.findall(r"(?ms)^  (draft|public):\n(.*?)(?=^  [a-z][a-z_-]*:|\Z)", dispatch.split("\njobs:\n", 1)[1]))
        self.assertEqual(set(jobs), {"draft", "public"})
        for mode, permission in (("draft", "write"), ("public", "read")):
            self.assertIn("if: inputs.mode == '" + mode + "'", jobs[mode])
            self.assertIn("permissions:\n      contents: " + permission, jobs[mode])
            self.assertIn("uses: ./.github/workflows/release-native-acceptance.yml", jobs[mode])
            self.assertNotIn("steps:", jobs[mode])
        native = (workflows / "release-native-acceptance.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_call:", native)
        self.assertNotRegex(native, r"(?m)^\s*permissions:")
        self.assertIn("os: [ubuntu-latest, macos-latest, windows-latest]", native)
        self.assertRegex(native, r"(?s)uses: actions/setup-go@[^\n]+\n\s+with:\n\s+go-version-file: go.mod\n\s+token: ''")
        self.assertEqual(native.count("GH_TOKEN:"), 1)
        self.assertRegex(native, r"(?s)if: inputs.mode == 'draft'\n\s+shell: pwsh\n\s+env:\n\s+GH_TOKEN:")

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

    def test_draft_untagged_browser_url_uses_exact_api_and_local_byte_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets, output = root / "assets", root / "output"
            assets.mkdir()
            output.mkdir()
            data = b"actual draft bytes"
            (assets / "release.zip").write_bytes(data)
            item = {"id": 456, "name": "release.zip", "url": verify.API + "/releases/assets/456", "browser_download_url": verify.BASE + "untagged-123456/release.zip", "size": len(data), "digest": "sha256:" + verify.digest(data)}
            metadata = {"id": 123, "url": verify.API + "/releases/123", "tag_name": "v1.2.3", "draft": True, "prerelease": False, "assets": [item]}
            metadata_path = root / "metadata.json"
            metadata_path.write_text(json.dumps(metadata), encoding="utf-8")
            with patch.object(verify, "resolve_tag", return_value=SHA), patch.object(verify, "get") as get:
                value = verify.release("v1.2.3", SHA, None, metadata_path)
                value["assetDirectory"] = str(assets)
                self.assertEqual(verify.asset(value, "release.zip", output), data)
            get.assert_not_called()
            self.assertEqual(value["releaseId"], 123)
            self.assertEqual(value["downloaded"][0]["assetId"], 456)
            # Untagged URLs are never accepted as public release downloads.
            with self.assertRaisesRegex(ValueError, "authority/name"):
                verify.asset_identity({"tag": "v1.2.3", "assets": {"release.zip": item}}, "release.zip")

    def test_draft_api_identity_cannot_redirect_authorized_downloads(self):
        item = {"id": 456, "name": "release.zip", "url": verify.API + "/releases/assets/456", "size": 8, "digest": "sha256:" + "a" * 64}
        value = {"draft": True, "releaseId": 123, "assets": {"release.zip": item}}
        for field, bad in (("id", 0), ("name", "different.zip"), ("url", "https://attacker.invalid/assets/456"), ("url", verify.API + "/releases/assets/789"), ("digest", "")):
            changed = copy.deepcopy(value)
            changed["assets"]["release.zip"][field] = bad
            with self.subTest(field=field, bad=bad), patch.object(verify, "get") as get, self.assertRaises(ValueError):
                verify.asset(changed, "release.zip", Path("unused"))
            get.assert_not_called()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metadata.json"
            metadata = {"id": 123, "url": verify.API + "/releases/999", "tag_name": "v1.2.3", "draft": True, "prerelease": False, "assets": [item]}
            for bad in (metadata, {**metadata, "url": verify.API + "/releases/123", "assets": [item, {**item, "name": "other.zip"}]}):
                path.write_text(json.dumps(bad), encoding="utf-8")
                with self.assertRaises(ValueError), patch.object(verify, "resolve_tag") as resolve:
                    verify.release("v1.2.3", SHA, None, path)
                resolve.assert_not_called()

    def test_draft_download_plan_emits_only_bounded_asset_api_identities(self):
        names = ["protopeek_1.2.3_windows_x86_64.zip", "protopeek_1.2.3_windows_x86_64.zip.sbom.json", "checksums.txt", "install.sh", "install.ps1", "aria2-1.37.0-companion-sources.tar.gz"]
        assets = [{"id": 456 + index, "name": name, "url": verify.API + "/releases/assets/" + str(456 + index), "browser_download_url": verify.BASE + "untagged-123/" + name, "size": 8, "digest": "sha256:" + "a" * 64} for index, name in enumerate(names)]
        with tempfile.TemporaryDirectory() as directory:
            metadata = Path(directory) / "metadata.json"
            metadata.write_text(json.dumps({"id": 123, "url": verify.API + "/releases/123", "tag_name": "v1.2.3", "draft": True, "prerelease": False, "assets": assets}), encoding="utf-8")
            stdout = io.StringIO()
            with patch.object(sys, "argv", [str(SCRIPT), "--tag", "v1.2.3", "--sha", SHA, "--draft-plan", str(metadata)]), patch.object(verify.platform, "system", return_value="Windows"), patch.object(verify.platform, "machine", return_value="amd64"), patch.object(verify, "resolve_tag", return_value=SHA), redirect_stdout(stdout):
                self.assertEqual(verify.main(), 0)
            plan = json.loads(stdout.getvalue())
            self.assertEqual(plan["releaseId"], 123)
            self.assertEqual([item["name"] for item in plan["assets"]], names)
            self.assertEqual([item["id"] for item in plan["assets"]], list(range(456, 462)))
            self.assertTrue(all(item["url"].startswith(verify.API + "/releases/assets/") for item in plan["assets"]))
            self.assertNotIn("browser_download_url", stdout.getvalue())

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

    def test_smoke_server_uses_owned_home_including_macos_config_location(self):
        observed = {}

        def capture(args, **kwargs):
            observed.update(kwargs["env"])
            raise RuntimeError("fixture stops before process launch")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            profile = root / "smoke-profile"
            original_home = os.environ.get("HOME")
            with patch.object(verify.subprocess, "Popen", side_effect=capture), self.assertRaisesRegex(RuntimeError, "before process launch"):
                verify.smoke(root / "never-executed", {}, profile, "smoke", root, [])
            self.assertEqual(Path(observed["HOME"]), profile / "home")
            self.assertTrue((Path(observed["HOME"]) / "Library/Application Support").is_relative_to(profile))
            self.assertTrue(Path(observed["HOME"]).is_dir())
            self.assertEqual(os.environ.get("HOME"), original_home)

    def test_default_cleanup_removes_new_empty_parents_and_preserves_existing_or_nonempty(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory).resolve()
            baseline = home / ".local"
            baseline.mkdir()
            prefix, manuals = baseline / "bin", baseline / "share/man/man1"
            missing = verify.missing_default_directories(home, (prefix, manuals))
            self.assertNotIn(baseline, missing)
            prefix.mkdir(parents=True)
            manuals.mkdir(parents=True)
            self.assertEqual(verify.remove_new_empty_directories(home, missing), [])
            self.assertTrue(baseline.is_dir())
            self.assertFalse((baseline / "share").exists())
            self.assertFalse(prefix.exists())
            missing = verify.missing_default_directories(home, (manuals,))
            manuals.mkdir(parents=True)
            keep = manuals / "unrelated.txt"
            keep.write_text("preserve")
            retained = verify.remove_new_empty_directories(home, missing)
            self.assertEqual(keep.read_text(), "preserve")
            self.assertEqual(len(retained), 3)

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
                        if default:
                            self.assertEqual(env.get("HOME"), os.environ.get("HOME"))
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
