"""The ingestor image copies only the scripts it runs (CI audit C5, #1716).

Every /app/scripts/<name> a workload on the ingestor image names, and the script the
ingestor's site_content refresh loads, must be copied by ingestor/Dockerfile; the
Dockerfile copies nothing else from scripts/. Each copied script may import only
modules the image ships (ingestor/, verdify_schemas/ and the standard library or
installed packages), never a sibling script.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
INGESTOR_IMAGE = "ghcr.io/verdifyconsultancy/verdify-ingestor"


def copied_scripts() -> set[str]:
    names = set()
    for line in (ROOT / "ingestor" / "Dockerfile").read_text().splitlines():
        parts = line.split()
        if parts[:1] == ["COPY"] and not parts[1].startswith("--"):
            for source in parts[1:-1]:
                assert source != "scripts/" and not source.startswith("scripts/*"), "copy named scripts only"
                if source.startswith("scripts/"):
                    names.add(source.removeprefix("scripts/"))
    return names


def _pod_specs(doc: dict):
    spec = doc.get("spec") or {}
    if doc.get("kind") == "CronJob":
        spec = (spec.get("jobTemplate") or {}).get("spec") or {}
    template = (spec.get("template") or {}).get("spec")
    return [template] if template else []


def scripts_run_by_ingestor_image() -> set[str]:
    names = set()
    for path in sorted((ROOT / "deploy" / "k8s").rglob("*.yaml")):
        try:
            docs = list(yaml.safe_load_all(path.read_text()))
        except yaml.YAMLError:
            continue
        for doc in docs:
            if not isinstance(doc, dict):
                continue
            for pod in _pod_specs(doc):
                for container in (pod.get("containers") or []) + (pod.get("initContainers") or []):
                    if not str(container.get("image", "")).startswith(INGESTOR_IMAGE):
                        continue
                    words = " ".join(map(str, (container.get("command") or []) + (container.get("args") or [])))
                    names.update(re.findall(r"/app/scripts/([A-Za-z0-9_.-]+)", words))
    common = (ROOT / "ingestor" / "tasks" / "_common.py").read_text()
    names.update(re.findall(r'REPO_ROOT / "scripts" / "([A-Za-z0-9_.-]+)"', common))
    return names


def test_the_image_copies_exactly_the_scripts_it_runs():
    run = scripts_run_by_ingestor_image()
    assert {"populate-site-content.py", "embed-corpora.py"} <= run
    assert copied_scripts() == run


def test_copied_scripts_import_no_sibling_script():
    siblings = {p.stem.replace("-", "_") for p in (ROOT / "scripts").glob("*.py")}
    for name in copied_scripts():
        text = (ROOT / "scripts" / name).read_text()
        imported = set(re.findall(r"^\s*(?:from|import)\s+([A-Za-z0-9_]+)", text, re.M))
        assert not imported & siblings, (name, imported & siblings)
        assert "spec_from_file_location" not in text, name
