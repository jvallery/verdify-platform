"""Unit tests for the #1534 build base and PR build-check helpers.

ci/gha/last_built_main.py picks the push-build impact base; ci/gha/buildcheck_matrix.py
turns a path-impact receipt into the build-check matrix. The GitHub API and git
are faked; nothing here builds an image.
"""

import contextlib
import importlib.util
import io
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
GHA = ROOT / "ci/gha"


def load(name):
    spec = importlib.util.spec_from_file_location(f"{name}_under_test", GHA / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


LAST = load("last_built_main")
sys.path.insert(0, str(GHA))
MATRIX = load("buildcheck_matrix")
IMPACT = load("verdify_path_impact")

A, B, C, HEAD = ("a" * 40, "b" * 40, "c" * 40, "d" * 40)


class LastBuiltMainTest(unittest.TestCase):
    ENV = {"GITHUB_REPOSITORY": "jvallery/verdify-platform", "GITHUB_TOKEN": "t"}

    def run_main(self, shas, ancestors, env=None):
        out, err = io.StringIO(), io.StringIO()
        with (
            patch.object(LAST, "successful_build_shas", return_value=shas),
            patch.object(LAST, "is_strict_ancestor", side_effect=lambda sha, head: sha in ancestors),
            patch.dict(LAST.os.environ, env if env is not None else self.ENV, clear=True),
            patch.object(LAST.sys, "argv", ["last_built_main.py", HEAD]),
            contextlib.redirect_stdout(out),
            contextlib.redirect_stderr(err),
        ):
            code = LAST.main()
        return code, out.getvalue().strip()

    def test_newest_successful_ancestor_is_the_base(self):
        # B is newest but not an ancestor (another branch's history): skip it.
        self.assertEqual(self.run_main([B, A, C], ancestors={A, C}), (0, A))

    def test_a_displaced_commit_is_not_the_base(self):
        # C was displaced (no successful build), so the base stays at A and the
        # diff A..HEAD includes C's changes.
        self.assertEqual(self.run_main([A], ancestors={A, C}), (0, A))

    def test_no_ancestor_or_no_token_falls_back(self):
        self.assertEqual(self.run_main([B], ancestors=set()), (1, ""))
        self.assertEqual(self.run_main([A], ancestors={A}, env={}), (1, ""))

    def test_api_failure_falls_back(self):
        err = io.StringIO()
        with (
            patch.object(LAST, "successful_build_shas", side_effect=OSError("down")),
            patch.dict(LAST.os.environ, self.ENV, clear=True),
            patch.object(LAST.sys, "argv", ["last_built_main.py", HEAD]),
            contextlib.redirect_stdout(io.StringIO()) as out,
            contextlib.redirect_stderr(err),
        ):
            self.assertEqual(LAST.main(), 1)
        self.assertEqual(out.getvalue(), "")

    def test_head_itself_is_never_the_base(self):
        self.assertFalse(LAST.is_strict_ancestor(HEAD, HEAD))

    def test_rerun_runs_are_deduplicated_newest_first(self):
        runs = {
            "workflow_runs": [
                {"head_sha": A, "created_at": "2026-11-09T10:00:00Z"},
                {"head_sha": B, "created_at": "2026-11-09T12:00:00Z"},
                {"head_sha": A, "created_at": "2026-11-09T13:00:00Z"},
                {"head_sha": "not-a-sha", "created_at": "2026-11-09T14:00:00Z"},
            ]
        }

        class Response(io.BytesIO):
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

        with patch.object(LAST.urllib.request, "urlopen", return_value=Response(json.dumps(runs).encode())):
            self.assertEqual(LAST.successful_build_shas("r", "t", "https://api"), [A, B])

    def test_bad_head_is_a_usage_error(self):
        with patch.object(LAST.sys, "argv", ["last_built_main.py", "HEAD"]), contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(LAST.main(), 2)


class BuildcheckMatrixTest(unittest.TestCase):
    def test_images_cover_exactly_the_classifier_profiles(self):
        self.assertEqual(set(MATRIX.IMAGES), set(IMPACT.PROFILES))

    def test_matrix_entries(self):
        entries = MATRIX.matrix({"profiles": ["api", "migrate"]}, HEAD)
        self.assertEqual(
            entries,
            [
                {
                    "profile": "api",
                    "image": "verdifyconsultancy/verdify-api",
                    "dockerfile": IMPACT.PROFILES["api"],
                    "build-args": f"GIT_SHA={HEAD}",
                },
                {
                    "profile": "migrate",
                    "image": "verdifyconsultancy/verdify-migrate",
                    "dockerfile": IMPACT.PROFILES["migrate"],
                    "build-args": "",
                },
            ],
        )
        self.assertEqual(MATRIX.matrix({"profiles": []}, HEAD), [])

    def test_drift_between_images_and_profiles_fails(self):
        with patch.dict(MATRIX.IMAGES, {"extra": ("x", False)}), self.assertRaises(SystemExit):
            MATRIX.matrix({"profiles": []}, HEAD)


if __name__ == "__main__":
    unittest.main()
