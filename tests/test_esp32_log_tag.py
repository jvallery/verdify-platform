"""esp32_logs.tag from the message prefix when the API sends no tag (#1633 release 5)."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

INGESTOR_PATH = str(Path(__file__).resolve().parent.parent / "ingestor")
if INGESTOR_PATH not in sys.path:
    sys.path.insert(0, INGESTOR_PATH)
for key, value in (("DB_USER", "test"), ("DB_PASSWORD", "test"), ("DB_HOST", "127.0.0.1"), ("DB_PORT", "5432")):
    os.environ.setdefault(key, value)
os.environ.setdefault("DB_NAME", "test")

import ingestor  # noqa: E402


@pytest.fixture
def logs(monkeypatch):
    monkeypatch.setattr(ingestor, "_observation_spool_enabled", lambda: False)
    monkeypatch.setattr(ingestor.state, "pending_logs", [])
    monkeypatch.setattr(ingestor, "ESP32_LOG_LEVEL", ingestor.LogLevel.LOG_LEVEL_WARN)
    return ingestor.state.pending_logs


@pytest.mark.parametrize(
    ("message", "tag"),
    [
        ("\x1b[0;33m[W][modbus:063]: Stop waiting for response from 1 1001ms after last send\x1b[0m", "modbus"),
        ("[W][api.connection:2503]: verdify-ingestor (10.0.0.1): Reading failed", "api.connection"),
        ("Heap pressure: 7 KB free", None),
    ],
)
def test_the_tag_comes_from_the_prefix_when_the_api_sends_none(logs, message, tag):
    ingestor.on_log_message(SimpleNamespace(level=ingestor.LogLevel.LOG_LEVEL_WARN, tag="", message=message.encode()))
    assert [(level, got) for level, got, _ in logs] == [("WARN", tag)]
    assert "\x1b" not in logs[0][2]


def test_a_tag_the_api_sends_is_kept(logs):
    ingestor.on_log_message(
        SimpleNamespace(level=ingestor.LogLevel.LOG_LEVEL_WARN, tag=b"sensor", message=b"[W][modbus:063]: x")
    )
    assert logs[0][1] == "sensor"
