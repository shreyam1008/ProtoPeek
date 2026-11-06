"""Safety checks for the disposable container acceptance helpers."""
import subprocess
import unittest
from unittest.mock import patch

import container_acceptance as acceptance


class FixtureImageTests(unittest.TestCase):
    def test_existing_tag_is_not_built_or_removed(self):
        with patch.object(acceptance, "run", return_value=subprocess.CompletedProcess([], 0, "existing\n", "")) as run:
            with self.assertRaisesRegex(RuntimeError, "already in use"):
                with acceptance.fixture_image(["docker"], "context", "fixture:unique"):
                    self.fail("existing image must not be touched")
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][1], "images")

    def test_failed_build_still_checks_owned_image_cleanup(self):
        calls = []

        def run(args, **kwargs):
            calls.append(args)
            if args[1] == "build":
                raise RuntimeError("build failed")
            return subprocess.CompletedProcess(args, 0, "", "")

        with patch.object(acceptance, "run", side_effect=run):
            with self.assertRaisesRegex(RuntimeError, "build failed"):
                with acceptance.fixture_image(["docker"], "context", "fixture:unique"):
                    self.fail("failed build cannot yield")
        self.assertEqual([args[1:3] for args in calls],
                         [["images", "-aq"], ["build", "--network=none"],
                          ["image", "rm"], ["info"], ["images", "-aq"]])
        self.assertEqual(calls[2][-1], "fixture:unique")

    def test_cleanup_fails_if_image_tag_remains(self):
        list_count = 0

        def run(args, **kwargs):
            nonlocal list_count
            if args[1] == "images":
                list_count += 1
                return subprocess.CompletedProcess(args, 0, "" if list_count == 1 else "still-present\n", "")
            return subprocess.CompletedProcess(args, 0, "", "")

        with patch.object(acceptance, "run", side_effect=run):
            with self.assertRaisesRegex(RuntimeError, "owned image tag remains"):
                with acceptance.fixture_image(["docker"], "context", "fixture:unique"):
                    pass


if __name__ == "__main__":
    unittest.main()
