"""Every template entity without a lambda must be published by firmware code (#1815).

A template sensor with no lambda publishes only when code calls publish_state on it (or
hands its pointer to code that does). ts_lead_fan had neither from 2026-06-11, so the
host's lead_fan stayed unknown. This guard reads the YAML and the firmware sources only.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
FW = ROOT / "firmware"


class _Loader(yaml.SafeLoader):
    pass


_Loader.add_multi_constructor("!", lambda loader, suffix, node: None)


def _config_files() -> list[Path]:
    return sorted((FW / "greenhouse").glob("*.yaml")) + [FW / "greenhouse.yaml"]


def _lambdaless_template_ids() -> list[str]:
    ids = []
    for path in _config_files():
        doc = yaml.load(path.read_text(), Loader=_Loader) or {}  # noqa: S506 (a SafeLoader that ignores ESPHome tags)
        if not isinstance(doc, dict):
            continue
        for domain in ("sensor", "text_sensor", "binary_sensor"):
            for entity in doc.get(domain) or []:
                if isinstance(entity, dict) and entity.get("platform") == "template" and "lambda" not in entity:
                    ids.append(entity["id"])
    return ids


def test_every_lambdaless_template_entity_is_published_by_code():
    sources = [p.read_text() for p in _config_files()] + [p.read_text() for p in (FW / "lib").glob("*.h")]
    code = "\n".join(sources)
    ids = _lambdaless_template_ids()
    assert "ts_lead_fan" in ids
    unpublished = []
    for entity_id in ids:
        published = re.search(rf"id\(\s*{re.escape(entity_id)}\s*\)\s*(?:\.|->)\s*publish_state\(", code)
        # Bound by pointer to code that publishes it (the irrigation engine's text sensors).
        bound = re.search(rf"=\s*id\(\s*{re.escape(entity_id)}\s*\)\s*;", code)
        if not (published or bound):
            unpublished.append(entity_id)
    assert unpublished == [], f"template entities nothing publishes: {unpublished}"
