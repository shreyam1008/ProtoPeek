"""Unprivileged trust/host guards; actual package lifecycle runs only in its hosted workflow."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch, Mock
import urllib.error

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("apt_verifier", ROOT / "scripts/verify-apt.py")
apt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(apt)


class AptVerificationTests(unittest.TestCase):
    def test_download_uses_scoped_update_options_and_failure_records_cleanup(self):
        with tempfile.TemporaryDirectory(prefix="apt-guard-test-", dir=ROOT / ".local") as directory:
            output = Path(directory)
            args = Mock(tag="v0.7.0", sha="a" * 40, previous_tag="v0.6.1")
            report = {"lifecycle": {"state": "not-started"}}
            commands = {}

            def command(argv, output, label, cwd=None):
                commands[label] = argv
                if label == "https-package-download":
                    raise ValueError("download rejected")

            def subprocess_result(argv, **kwargs):
                return Mock(stdout=b"[]" if argv[0:2] == ["git", "show"] else ("amd64\n" if argv[0] == "dpkg" else args.sha))

            key = (ROOT / "web/site/public/apt/key.gpg").read_bytes()
            with patch.object(apt.subprocess, "run", side_effect=subprocess_result), \
                 patch.object(apt.release, "get", return_value=b"archive"), \
                 patch.object(apt.release, "checksums", return_value={"protopeek_0.7.0_linux_x86_64.tar.gz": apt.release.digest(b"archive")}), \
                 patch.object(apt.release, "inspect_archive"), patch.object(apt, "check_redirect", return_value={}), \
                 patch.object(apt, "public_bytes", return_value=key), patch.object(apt, "run", side_effect=command), \
                 patch.object(apt, "remove_owned_file") as cleanup:
                with self.assertRaisesRegex(ValueError, "download rejected"), apt.verification_report(output, report):
                    apt.verify(args, output, report)
                self.assertEqual(cleanup.call_args_list[0].args[0], apt.SOURCE)
                self.assertEqual(cleanup.call_args_list[1].args[0], apt.KEY)
            update, download = commands["signed-https-update"], commands["https-package-download"]
            self.assertEqual(update[:2], ["sudo", "apt-get"])
            self.assertEqual(download[:-2], update[1:-1])
            self.assertEqual(download[-2:], ["download", "protopeek=0.7.0"])
            self.assertIn("Dir::Etc::sourcelist=" + str(apt.SOURCE), download)
            self.assertIn("Dir::Etc::sourceparts=-", download)
            receipt = json.loads((output / "summary.json").read_text())
            self.assertEqual(receipt["state"], "fail")
            self.assertEqual(receipt["lifecycle"]["state"], "fail")
            self.assertEqual(receipt["cleanup"]["source"]["state"], "pass")
            self.assertEqual(receipt["cleanup"]["key"]["state"], "pass")

    def test_receipt_waits_for_all_cleanup_and_does_not_claim_success_on_cleanup_failure(self):
        for fails in (False, True):
            with self.subTest(cleanup_fails=fails), tempfile.TemporaryDirectory(prefix="apt-guard-test-", dir=ROOT / ".local") as directory:
                output = Path(directory)
                report = {"lifecycle": {"state": "pass"}}
                removed = []

                def remove(filename, expected):
                    self.assertFalse((output / "summary.json").exists())
                    removed.append(filename)
                    if fails and filename == apt.SOURCE:
                        raise ValueError("source changed")

                with patch.object(apt, "remove_owned_file", side_effect=remove):
                    if fails:
                        with self.assertRaisesRegex(RuntimeError, "cleanup failed"), apt.verification_report(output, report):
                            apt.cleanup_owned(output, [], False, b"source", b"key", report)
                    else:
                        with apt.verification_report(output, report):
                            apt.cleanup_owned(output, [], False, b"source", b"key", report)
                self.assertEqual(removed, [apt.SOURCE, apt.KEY])
                receipt = json.loads((output / "summary.json").read_text())
                self.assertEqual(receipt["state"], "fail" if fails else "pass")
                self.assertEqual(receipt["lifecycle"]["state"], "pass")
                self.assertEqual(receipt["cleanup"]["source"]["state"], "fail" if fails else "pass")
                self.assertEqual(receipt["cleanup"]["key"]["state"], "pass")

    def test_preparation_failure_retains_failed_evidence_without_claiming_lifecycle(self):
        with tempfile.TemporaryDirectory(prefix="apt-guard-test-", dir=ROOT / ".local") as directory:
            output = Path(directory)
            report = {"lifecycle": {"state": "not-started"}, "cleanup": {"state": "not-needed"}}
            with self.assertRaisesRegex(ValueError, "tag differs"), apt.verification_report(output, report):
                raise ValueError("tag differs")
            receipt = json.loads((output / "summary.json").read_text())
            self.assertEqual(receipt["state"], "fail")
            self.assertEqual(receipt["lifecycle"]["state"], "not-started")
            self.assertEqual(receipt["failure"]["message"], "tag differs")

    def test_hosted_guard_requires_all_identity_fields(self):
        valid = {"GITHUB_ACTIONS": "true", "RUNNER_ENVIRONMENT": "github-hosted", "RUNNER_TEMP": "/tmp/owned"}
        apt.hosted_linux(valid, "Linux")
        for key in valid:
            bad = dict(valid)
            del bad[key]
            with self.assertRaises(ValueError):
                apt.hosted_linux(bad, "Linux")
        with self.assertRaises(ValueError):
            apt.hosted_linux({**valid, "RUNNER_ENVIRONMENT": "self-hosted"}, "Linux")
        with self.assertRaises(ValueError):
            apt.hosted_linux(valid, "Windows")

    def test_local_entrypoint_refuses_before_any_output_or_privileged_command(self):
        env = {key: value for key, value in os.environ.items() if key not in {"GITHUB_ACTIONS", "RUNNER_ENVIRONMENT", "RUNNER_TEMP"}}
        target = ROOT / ".local/apt-must-not-be-created"
        self.assertFalse(target.exists())
        result = subprocess.run([sys.executable, "-B", str(ROOT / "scripts/verify-apt.py"), "--tag", "v0.7.0", "--sha", "a" * 40,
                                 "--previous-tag", "v0.6.1", "--output", str(target)], capture_output=True, env=env, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(b"ephemeral GitHub-hosted Linux", result.stderr)
        self.assertFalse(target.exists())

    def test_redirect_requires_exact_fixed_release_destination(self):
        url = apt.SITE + "/pool/main/d/protopeek/protopeek_0.7.0_amd64.deb"
        expected = apt.DOWNLOAD + "v0.7.0/protopeek_0.7.0_amd64.deb"
        for destination, status, succeeds in [(expected, 302, True), (expected, 301, False),
                                               ("https://attacker.example/file.deb", 302, False),
                                               (expected + "?override=1", 302, False)]:
            opener = Mock()
            opener.open.side_effect = urllib.error.HTTPError(url, status, "redirect", {"Location": destination}, None)
            with patch.object(apt.urllib.request, "build_opener", return_value=opener):
                if succeeds:
                    self.assertEqual(apt.check_redirect(url, expected)["location"], expected)
                else:
                    with self.assertRaises(ValueError):
                        apt.check_redirect(url, expected)
            self.assertEqual(opener.open.call_args.args[0].method, "HEAD")

    def test_cleanup_refuses_a_changed_file_without_sudo(self):
        scratch = ROOT / ".local"
        scratch.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="apt-guard-test-", dir=scratch) as directory:
            owned = Path(directory) / "source.list"
            owned.write_bytes(b"changed")
            with patch.object(apt.subprocess, "run") as command:
                with self.assertRaises(ValueError):
                    apt.remove_owned_file(owned, b"expected")
                command.assert_not_called()
            self.assertEqual(owned.read_bytes(), b"changed")


if __name__ == "__main__":
    unittest.main()
