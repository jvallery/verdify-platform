#!/usr/bin/env python3
"""Trusted Verdify adapter for the existing exact-checkout validate/build path.

Treat repository Dockerfiles as data, never execute/import repository code.
Unsupported COPY/ignore syntax conservatively rebuilds every registered profile.
No credential, deployment, model or device operation exists in this adapter.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shlex
import subprocess
from pathlib import Path, PurePosixPath

PROFILES = {
    "api": "api/Dockerfile",
    "mcp": "mcp/Dockerfile",
    "ingestor": "ingestor/Dockerfile",
    "migrate": "db/Dockerfile.migrate",
    "setpoint-server": "scripts/Dockerfile.setpoint-server",
    "lab-publisher": "scripts/Dockerfile.lab-publisher",
    # The dashboard.verdify.ai web tier. Its Dockerfile copies only
    # dashboard/ paths, and no Python image copies dashboard/.
    "dashboard-web": "dashboard/Dockerfile",
    # #1113: the derived renderer (upstream image plus Debian's chromium fix). It copies
    # nothing from the repository, so only a change to its Dockerfile builds it.
    "grafana-image-renderer": "grafana/Dockerfile.image-renderer",
    # #1458: the derived Hermes agent (the pinned upstream digest plus Debian's security
    # updates). It copies nothing from the repository either.
    "hermes-agent": "hermes/Dockerfile.hermes-agent",
    # #1458: the derived TimescaleDB runtime (the pinned upstream digest without its Go
    # binaries, plus Alpine's security updates). It copies nothing from the repository.
    "timescaledb": "db/Dockerfile.timescaledb",
    # #1535: the firmware-secretless-compile job image (the ESPHome mirror plus the
    # PlatformIO platform and toolchain baked in). It copies nothing from the repository.
    "esphome-ci": "ci/esphome-ci.Dockerfile",
    # The verdify-platform-ci job image (python:3.13-bookworm, upgraded, plus PostgreSQL 16
    # and kustomize). It copies only .git/HEAD and the vendored PGDG key.
    "ci-validate": "ci/validate.Dockerfile",
}
# The dashboard tests (vitest and the browser shards) render e2e/fixtures/settings.json at
# test time with scripts/gen-dashboard-settings-fixture.py, so every repository file that
# script imports is a dashboard input (#1722 changed setting_help text and broke a
# browser test the dashboard job never ran). verdify_schemas/__init__.py imports most
# of the package, so this is most of verdify_schemas/*.py; it reads no data files.
# tests/test_gha_ci_light_paths.py recomputes this import closure and fails on drift.
DASHBOARD_FIXTURE_INPUTS = (
    "scripts/gen-dashboard-settings-fixture.py",
    "verdify_schemas/__init__.py",
    "verdify_schemas/activity.py",
    "verdify_schemas/alerts.py",
    "verdify_schemas/api.py",
    "verdify_schemas/band_rows.py",
    "verdify_schemas/catalog.py",
    "verdify_schemas/climate_intent.py",
    "verdify_schemas/climate_law_constants.py",
    "verdify_schemas/crop_profiles.py",
    "verdify_schemas/crops.py",
    "verdify_schemas/daily.py",
    "verdify_schemas/external.py",
    "verdify_schemas/fixed_panel_native_route.py",
    "verdify_schemas/forecast.py",
    "verdify_schemas/irrigation.py",
    "verdify_schemas/lessons.py",
    "verdify_schemas/mcp_responses.py",
    "verdify_schemas/media.py",
    "verdify_schemas/operations.py",
    "verdify_schemas/physical_crop_band.py",
    "verdify_schemas/plan.py",
    "verdify_schemas/realized_dryout.py",
    "verdify_schemas/setpoint.py",
    "verdify_schemas/setting_help/__init__.py",
    "verdify_schemas/setting_help/_entry.py",
    "verdify_schemas/setting_help/_planner.py",
    "verdify_schemas/setting_help/_reference.py",
    "verdify_schemas/setting_help/_safety.py",
    "verdify_schemas/setting_help/_scheduled.py",
    "verdify_schemas/setting_values.py",
    "verdify_schemas/solar.py",
    "verdify_schemas/system_infra.py",
    "verdify_schemas/telemetry.py",
    "verdify_schemas/topology.py",
    "verdify_schemas/tunable_registry.py",
    "verdify_schemas/tunables.py",
    "verdify_schemas/vault.py",
    "verdify_schemas/views.py",
)
# Check flags beside the profile flags. They select the PR
# checks that run on the exact checkout, not image builds; every fallback sets both.
CHECKS = {
    # The dashboard package, its contract and the sources its words table reads.
    "dashboard-check": (
        "dashboard/**",
        "docs/design/dashboard/openapi/**",
        "firmware/lib/greenhouse_types.h",
        *DASHBOARD_FIXTURE_INPUTS,
    ),
    # The ESPHome secretless compile: the firmware tree, the compile program and
    # its job image, and the CI plumbing that runs it. (The firmware logic suites
    # run in every full validate run since #1716 C2.)
    "firmware-check": (
        "firmware/**",
        "ci/esphome-ci.Dockerfile",
        "ci/gha/**",
        ".github/workflows/**",
    ),
}
# Carried inputs: files an image copies but never runs. A main push whose only
# changes to an image are carried inputs publishes no candidate for it, so a
# documentation or test merge opens no pin pull request; the next build of that
# image for any other cause ships them, because every build copies the whole
# checkout. The pull request build-check still builds on them, and a manual
# dispatch of build.yml publishes them (--include-carried).
#   docs/**                  the ingestor's site-content corpus, indexed as text.
#                            docs/planner/** is not carried: it is the planner
#                            playbook, which changes what the planner is told.
#   verdify_schemas/tests/** the schema package's tests; no image has pytest.
# tests/test_gha_build_carried_inputs.py checks both directions on the real
# Dockerfiles: these changes select nothing, a source change still selects.
CARRIED_INPUTS = ("docs/**", "verdify_schemas/tests/**")
CARRIED_EXCEPT = ("docs/planner/**",)
PIN_PATH = "deploy/k8s/overlays/prod/kustomization.yaml"
# Light paths (CI audit 2026-11-16): a PR or push whose every changed path is in
# one of these classes runs only the checks that prove that class; every other
# required context passes as "not impacted". Any other path selects the full run.
# pins: digest lines of the image pin files (and comment lines, which do not render).
LIGHT_PIN_PATHS = (
    PIN_PATH,
    "deploy/k8s/overlays/prod/release-pins.yaml",
    "deploy/k8s/dashboard/kustomization.yaml",
)
# docs: plain Markdown files (mode 100644, never a symlink) under the documentation
# roots, or top-level *.md, whose basename no test, script, CI file or generator
# names. Markdown anywhere else (cortex_planner prompts, firmware/, dashboard/,
# deploy/, site/, any code tree) is runtime or test input and selects the full run.
# Excluded roots are read by code: docs/planner/ (the Iris playbook and the
# site-content playbook root) and the dashboard OpenAPI folder (schema tests, the
# dashboard build).
# docs/ as a whole is copied into the ingestor image as the site-content corpus:
# content, not code, so the PR image build-check still builds the ingestor, and a
# main push publishes no ingestor candidate for it (CARRIED_INPUTS).
LIGHT_DOC_ROOTS = ("docs/", "research/")
LIGHT_DOC_EXCLUDED = ("docs/planner/", "docs/design/dashboard/openapi/")
REGULAR_FILE = "100644"
LIGHT_DOC_REFERENCE_ROOTS = ("tests", "verdify_schemas/tests", "scripts", "ci", ".github", "Makefile")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}")
FULL_VALIDATE_PARTS = ["containment-firmware", "pure-logic-1", "pure-logic-2", "rest"]
# One authentic next-main event repairs builds missed before the accepted pin
# checkpoint. These Git object IDs are trusted owner source, never caller inputs.
RECOVERY_EVENT_BASE = "daaa05f366017e38206f6b59e7c7bfa79ed9db94"
RECOVERY_BUILD_BASE = "67f08ccfd2dab0d3ae1c3962057ddc7832d2593a"
RECOVERY_PIN_COMMIT = "43d7cdf7ba338c153c76acfa57cecadd2fa9adf9"
RECOVERY_EVENT_HEAD = "c386f834de7a1acbd1ad74300218ab7922cf6d4b"
SHA = re.compile(r"^[0-9a-f]{40}$")


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args])


def blob(root, revision, path):
    return git(root, "show", revision + ":" + path).decode()


def copies(text):
    result = []
    for line in text.replace("\\\n", " ").splitlines():
        line = line.strip()
        if not re.match(r"(?i)^(COPY|ADD)\s", line):
            continue
        command, arguments = line.split(None, 1)
        if command.upper() == "ADD":
            raise ValueError("ADD requires conservative rebuild")
        if arguments.startswith("--from="):
            continue
        if arguments.startswith("--") or "$" in arguments or "\\" in arguments:
            raise ValueError("unresolved COPY syntax")
        parts = json.loads(arguments) if arguments.startswith("[") else shlex.split(arguments)
        if len(parts) < 2:
            raise ValueError("COPY has no source/destination")
        for source in parts[:-1]:
            if source.startswith("/") or ".." in PurePosixPath(source).parts:
                raise ValueError("COPY escapes root context")
            result.append(source.removeprefix("./").rstrip("/"))
    return result


def glob_match(path, pattern):
    # Docker/Go glob '*' cannot cross a directory separator. '**' is the
    # explicit recursive form; '**/' also matches zero directories.
    if any(c in pattern for c in "\\[]"):
        raise ValueError("unsupported glob syntax")
    parts = []
    i = 0
    while i < len(pattern):
        if pattern[i : i + 3] == "**/":
            parts.append("(?:.*/)?")
            i += 3
        elif pattern[i : i + 2] == "**":
            parts.append(".*")
            i += 2
        elif pattern[i] == "*":
            parts.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            parts.append("[^/]")
            i += 1
        else:
            parts.append(re.escape(pattern[i]))
            i += 1
    return bool(re.fullmatch("".join(parts), path))


def ignored(path, text):
    """Ordered root-relative Moby patterns including ancestor exclusions.

    Never prune traversal before later negations. Unsupported syntax causes a
    conservative full build at the caller instead of guessed exclusion credit.
    """
    excluded = False
    candidates = [path] + [str(p) for p in PurePosixPath(path).parents if str(p) != "."]
    for raw in text.splitlines():
        rule = raw.strip()
        if not rule or rule.startswith("#") or rule == ".":
            continue
        include = rule.startswith("!")
        rule = rule.lstrip("!").strip("/")
        if any(glob_match(candidate, rule) for candidate in candidates):
            excluded = not include
    return excluded


def matches(path, source):
    if source == ".":
        return True
    # Directory COPY/glob inputs include descendants of each selected directory.
    candidates = [path] + [str(p) for p in PurePosixPath(path).parents if str(p) != "."]
    return any(glob_match(candidate, source) for candidate in candidates)


def carried(path):
    """True for an input an image copies but never runs (CARRIED_INPUTS)."""
    return any(glob_match(path, pattern) for pattern in CARRIED_INPUTS) and not any(
        glob_match(path, pattern) for pattern in CARRIED_EXCEPT
    )


def checks_for(paths):
    """Check flags for an exact changed-path list; patterns are trusted constants."""
    return {
        name: any(glob_match(path, pattern) for path in paths for pattern in patterns)
        for name, patterns in CHECKS.items()
    }


def pin_only(root, base, head, paths):
    if paths != [PIN_PATH]:
        return False
    old, new = blob(root, base, PIN_PATH), blob(root, head, PIN_PATH)

    # Only existing candidate digest values may differ. Keep release pins and
    # every other byte fixed; a spoofed message never suppresses source checks.
    def normalize(text):
        selected = False
        in_images = False
        lines = []
        for line in text.splitlines(keepends=True):
            if line and not line[0].isspace() and not line.startswith("#"):
                in_images = line.rstrip() == "images:"
                selected = False
            if in_images and line.startswith("  - name:"):
                selected = line.strip().removeprefix("- name: ") in {
                    "ghcr.io/verdifyconsultancy/verdify-" + name
                    for name in (
                        "api",
                        "mcp",
                        "ingestor",
                        "migrate",
                    )
                }
            if selected:
                line = re.sub(
                    r"^    digest: sha256:[0-9a-f]{64}(?=\n?$)",
                    "    digest: <immutable>",
                    line,
                )
            lines.append(line)
        return "".join(lines)

    return old != new and normalize(old) == normalize(new)


def _mode(root, revision, path):
    """Tree mode of path at revision ("100644" for a plain file), or None if absent."""
    line = git(root, "ls-tree", revision, "--", path).decode().strip()
    return line.split(None, 1)[0] if line else None


def _without_digests(text):
    """Drop comment-only lines and blank every sha256 digest (pin-only comparison)."""
    return [DIGEST.sub("sha256:<digest>", line) for line in text.splitlines() if not line.lstrip().startswith("#")]


def light_pins(root, base, head, paths):
    """Every path is a pin file whose only change is digest values or comments."""
    if not paths or any(path not in LIGHT_PIN_PATHS for path in paths):
        return False
    for path in paths:
        # Added, deleted, a symlink or a mode change: not a digest-only change.
        if _mode(root, base, path) != REGULAR_FILE or _mode(root, head, path) != REGULAR_FILE:
            return False
        old, new = blob(root, base, path), blob(root, head, path)
        if _without_digests(old) != _without_digests(new):
            return False
    return True


def _doc_references(root, head):
    """Text of every file under LIGHT_DOC_REFERENCE_ROOTS at head (read as data)."""
    listing = git(root, "ls-tree", "-r", "-z", "--name-only", head, "--", *LIGHT_DOC_REFERENCE_ROOTS)
    texts = []
    for name in listing.decode().split("\0"):
        if not name or name.endswith((".gz", ".png", ".jpg", ".bin", ".csv")):
            continue
        try:
            texts.append(blob(root, head, name))
        except (subprocess.CalledProcessError, UnicodeDecodeError):
            continue
    return "\n".join(texts)


def _doc_path(path):
    if not path.endswith(".md"):
        return False
    if "/" not in path:
        return True  # top-level Markdown (README.md, AGENTS.md, ...)
    return path.startswith(LIGHT_DOC_ROOTS) and not path.startswith(LIGHT_DOC_EXCLUDED)


def light_docs(root, base, head, paths):
    """Every path is plain documentation Markdown that no test, script or CI file names."""
    if not paths or any(not _doc_path(path) for path in paths):
        return False
    for path in paths:
        # Present at head: a plain file. Deleted: it was a plain file at base.
        mode = _mode(root, head, path) or _mode(root, base, path)
        if mode != REGULAR_FILE:
            return False
    references = _doc_references(root, head)
    return not any(PurePosixPath(path).name in references for path in paths)


def light_class(root, base, head, paths):
    if light_pins(root, base, head, paths):
        return "pins"
    if light_docs(root, base, head, paths):
        return "docs"
    return "none"


def classify(root, base, head, publish=False):
    """Classify base..head. publish=True (a main push that publishes candidates)
    selects an image only when a changed input is more than a carried input."""
    if not SHA.fullmatch(head):
        raise ValueError("source must be exact lowercase SHA")
    if git(root, "rev-parse", "HEAD").decode().strip() != head:
        raise ValueError("checkout differs from requested source")
    result = {
        "schema": "verdify.path-impact/v1",
        "source_revision": head,
        "base_revision": base,
        "mode": "build",
        "profiles": list(PROFILES),
        "reasons": {},
        "checks": dict.fromkeys(CHECKS, True),
        "light": "none",
        "paths_sha256": None,
    }
    if not SHA.fullmatch(base or "") or set(base) == {"0"}:
        result["fallback"] = "missing usable exact base; build all profiles"
        return result
    try:
        paths = sorted(
            set(git(root, "diff", "--name-only", "-z", "--no-renames", base, head).decode().rstrip("\0").split("\0"))
            - {""}
        )
        result["paths_sha256"] = hashlib.sha256(json.dumps(paths, separators=(",", ":")).encode()).hexdigest()
        checks = checks_for(paths)
        result["light"] = light_class(root, base, head, paths)
        if pin_only(root, base, head, paths):
            result.update(
                mode="skip",
                profiles=[],
                reasons={"skip": "digest-only pin diff; no source/runtime input change"},
                checks=checks,
            )
            return result
        selected = {}
        held = {}
        for name, dockerfile in PROFILES.items():
            causes = set()
            for revision in (base, head):
                # A profile added (or removed) between base and head has no
                # Dockerfile on one side; its Dockerfile path is then in paths.
                if subprocess.run(
                    ["git", "-C", str(root), "cat-file", "-e", revision + ":" + dockerfile],
                    capture_output=True,
                ).returncode:
                    continue
                inputs = copies(blob(root, revision, dockerfile))
                ignore = blob(root, revision, ".dockerignore")
                for path in paths:
                    if path in (dockerfile, ".dockerignore") or (
                        not ignored(path, ignore) and any(matches(path, source) for source in inputs)
                    ):
                        causes.add(path)
            if publish and causes and all(carried(path) for path in causes):
                held[name] = len(causes)
                continue
            if causes:
                selected[name] = sorted(causes)
        if held:
            result["carried"] = held
        result.update(
            mode="build" if selected else "validate",
            profiles=list(selected),
            reasons=selected,
            checks=checks,
        )
    except (
        ValueError,
        subprocess.CalledProcessError,
        UnicodeDecodeError,
        json.JSONDecodeError,
    ):
        result["fallback"] = "unavailable base/input or unsupported syntax; build all profiles"
        result["checks"] = dict.fromkeys(CHECKS, True)
        result["light"] = "none"
    return result


def classify_push(root, base, head, include_carried=False):
    original = classify(root, base, head, publish=not include_carried)
    # A genuine candidate publication must never recurse into recovery builds.
    if original["mode"] == "skip" or base != RECOVERY_EVENT_BASE:
        return original
    if head != RECOVERY_EVENT_HEAD:
        raise ValueError("recovery requires the exact accepted next-main source")
    parents = git(root, "rev-list", "--parents", "-n", "1", head).decode().split()
    if parents != [head, RECOVERY_EVENT_BASE]:
        raise ValueError("recovery requires the authentic sole-parent next-main event")
    published = git(root, "rev-list", "--parents", "-n", "1", RECOVERY_PIN_COMMIT).decode().split()
    if len(published) != 2:
        raise ValueError("accepted candidate publication must have one parent")
    paths = git(root, "diff", "--name-only", published[1], RECOVERY_PIN_COMMIT).decode().splitlines()
    if not pin_only(root, published[1], RECOVERY_PIN_COMMIT, paths):
        raise ValueError("accepted candidate publication shape changed")
    # The accepted43d7 publication changed only ingestor. Preserve every other
    # candidate/release byte; this is a trusted exact checkpoint, not caller input.
    accepted_before = (
        "  - name: ghcr.io/verdifyconsultancy/verdify-ingestor\n"
        "    newName: registry.vallery.net/verdifyconsultancy/verdify-ingestor\n"
        "    digest: sha256:6e087f9a170f5feae962129bbc1f51d6fb3852e4e91b03ea294941c0910058c5\n"
    )
    accepted_after = accepted_before.replace(
        "6e087f9a170f5feae962129bbc1f51d6fb3852e4e91b03ea294941c0910058c5",
        "249c7647f3e09a80866d95975372535f68465a0e2f6a12faca3b8c0b17fe2ba2",
    )
    before, after = blob(root, published[1], PIN_PATH), blob(root, RECOVERY_PIN_COMMIT, PIN_PATH)
    if (
        published[1] != RECOVERY_BUILD_BASE
        or before.count(accepted_before) != 1
        or before.replace(accepted_before, accepted_after, 1) != after
    ):
        raise ValueError("accepted publication differs from the exact ingestor checkpoint")
    for ancestor, descendant in (
        (RECOVERY_BUILD_BASE, RECOVERY_PIN_COMMIT),
        (RECOVERY_PIN_COMMIT, base),
    ):
        subprocess.check_call(
            [
                "git",
                "-C",
                str(root),
                "merge-base",
                "--is-ancestor",
                ancestor,
                descendant,
            ]
        )
    result = classify(root, RECOVERY_BUILD_BASE, head)
    if "fallback" in result:
        raise ValueError("recovery source inputs unavailable; refusing ambiguous publication")
    result.update(
        event_base_revision=base,
        recovery_reason="single-event repair of unpublished source since accepted candidate checkpoint",
        accepted_candidate_publication=RECOVERY_PIN_COMMIT,
    )
    return result


def workflow_receipt(workflow):
    """Redacted reducer of existing Argo outputs; missing evidence never passes.

    ROOT/native archival publishes this JSON durably with deployment/rollback
    receipts. This adapter neither creates a second journal nor promotes code.
    """
    parameters = {
        x["name"]: x.get("value", "") for x in workflow.get("spec", {}).get("arguments", {}).get("parameters", [])
    }
    head = parameters.get("revision", parameters.get("head-revision", ""))
    if not SHA.fullmatch(head):
        raise ValueError("workflow does not bind exact source")
    metadata, status = workflow.get("metadata", {}), workflow.get("status", {})
    phase = status.get("phase", "Unknown")
    receipt = {
        "schema": "verdify.delivery-workflow/v1",
        "source_revision": head,
        "workflow_name": metadata.get("name"),
        "workflow_uid": metadata.get("uid"),
        "phase": phase,
        "started_at": status.get("startedAt"),
        "finished_at": status.get("finishedAt"),
        "verdict": "not_accepted",
        "builds": {},
        "evidence_errors": [],
    }
    if not metadata.get("uid"):
        receipt["evidence_errors"].append("workflow UID missing")
    nodes = status.get("nodes", {})
    raw = None
    for node in nodes.values():
        for item in node.get("outputs", {}).get("parameters", []):
            if item["name"] == "path-impact-receipt":
                raw = item.get("value")
    try:
        plan = json.loads(raw) if raw else None
        if (
            not isinstance(plan, dict)
            or plan.get("schema") != "verdify.path-impact/v1"
            or plan.get("source_revision") != head
        ):
            raise ValueError("missing or wrong exact-source classification receipt")
        if plan.get("mode") not in ("build", "validate", "skip") or not isinstance(plan.get("profiles"), list):
            raise ValueError("malformed classification receipt")
        receipt["path_impact"] = plan
        for profile in plan["profiles"]:
            if profile not in PROFILES:
                raise ValueError("unregistered build profile in receipt")
            candidates = [n for n in nodes.values() if n.get("displayName") == "build-" + profile]
            if len(candidates) != 1:
                receipt["evidence_errors"].append(profile + ": unique build node missing")
                continue
            node = candidates[0]
            outputs = {x["name"]: x.get("value") for x in node.get("outputs", {}).get("parameters", [])}
            image = "verdify-lab-publisher-k3s" if profile == "lab-publisher" else "verdify-" + profile
            reference = outputs.get("image-ref", "")
            source = outputs.get("source-revision", outputs.get("resolved-revision"))
            valid = (
                node.get("phase") == "Succeeded"
                and source == head
                and bool(
                    re.fullmatch(
                        re.escape("registry.vallery.net/verdifyconsultancy/" + image) + r"@sha256:[0-9a-f]{64}",
                        reference,
                    )
                )
            )
            receipt["builds"][profile] = {
                "phase": node.get("phase"),
                "source_revision": source if isinstance(source, str) and SHA.fullmatch(source) else None,
                "image_ref": reference if valid else None,
                "accepted": valid,
            }
            if not valid:
                receipt["evidence_errors"].append(profile + ": complete immutable exact-source build receipt missing")
    except (ValueError, TypeError, KeyError) as exc:
        receipt["evidence_errors"].append(str(exc))
    if workflow.get("spec", {}).get("shutdown") in ("Terminate", "Stop"):
        receipt["outcome"] = "cancelled"
    elif phase == "Error":
        receipt["outcome"] = "infrastructure_or_execution_error"
    elif phase == "Failed":
        receipt["outcome"] = "failed; inspect exact stage in retained native receipt"
    elif phase in ("Running", "Pending", "Unknown"):
        receipt["outcome"] = "pending_or_unknown; never restart solely on observation timeout"
    elif phase == "Succeeded" and not receipt["evidence_errors"]:
        receipt.update(verdict="accepted", outcome="succeeded")
    else:
        receipt["outcome"] = "missing_or_invalid_receipt"
    # Failure messages/logs/env are deliberately omitted from the public receipt.
    return receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--root", type=Path)
    p.add_argument(
        "--workflow",
        type=Path,
        help="reduce existing Argo JSON into redacted durable evidence",
    )
    p.add_argument("--base", default="")
    p.add_argument("--head")
    p.add_argument("--output", type=Path)
    p.add_argument("--push", action="store_true")
    p.add_argument(
        "--include-carried",
        action="store_true",
        help="with --push: also publish images whose only changes are carried inputs",
    )
    args = p.parse_args()
    if args.workflow:
        print(
            json.dumps(
                workflow_receipt(json.loads(args.workflow.read_text())),
                sort_keys=True,
                indent=2,
            )
        )
        return
    if not args.root or not args.head or not args.output:
        p.error("classification requires --root, --head and --output")
    if args.push:
        receipt = classify_push(args.root, args.base, args.head, include_carried=args.include_carried)
    else:
        receipt = classify(args.root, args.base, args.head)
    # PR validation always runs its gates, including pin-only changes.
    if not args.push and receipt["mode"] == "skip":
        receipt["mode"] = "validate"
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "receipt.json").write_text(json.dumps(receipt, sort_keys=True) + "\n")
    (args.output / "mode").write_text(receipt["mode"])
    for name in PROFILES:
        (args.output / name).write_text("true" if name in receipt["profiles"] else "false")
    for name in CHECKS:
        (args.output / name).write_text("true" if receipt["checks"][name] is True else "false")
    # Light path outputs (CI audit 2026-11-16): ci.yml skips or narrows its checks
    # from these; "none" (the fallback) runs everything.
    light = receipt.get("light", "none")
    (args.output / "light").write_text(light)
    parts = {"pins": ["pins"], "docs": []}.get(light, FULL_VALIDATE_PARTS)
    (args.output / "validate-parts").write_text(json.dumps(parts, separators=(",", ":")))
    (args.output / "full").write_text("true" if light == "none" else "false")
    print("VERDIFY_PATH_IMPACT=" + json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    main()
