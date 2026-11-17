"""#1748: the ingestor's liveness probe judges the process, never climate age.

A silent controller left the newest climate row stale, the old climate-age probe failed, and the kubelet restarted the
single writer about every 4.5 minutes for the whole silence (2026-11-17: 6 kills 03:50-04:12Z, 6 more 11:28-11:50Z).
The probe now passes while the event loop and the task supervisor beat (ingestor/process_liveness.py), whatever the data age.
"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
INGESTOR = ROOT / "ingestor"
PROBE = INGESTOR / "ingestor-liveness.py"
sys.path.insert(0, str(INGESTOR))
import process_liveness as liveness  # noqa: E402


def _probe(directory: Path, *extra: str) -> subprocess.CompletedProcess:
    # No database: DB_* point nowhere, so a probe that read climate could not pass.
    env = {k: v for k, v in os.environ.items() if not k.startswith(("DB_", "PG"))}
    env.update({"DB_HOST": "203.0.113.1", "DB_PORT": "1", "DB_NAME": "none", "DB_USER": "none", "DB_PASSWORD": "x"})
    return subprocess.run(
        [sys.executable, str(PROBE), "--dir", str(directory), *extra],
        cwd=INGESTOR,
        env=env,
        text=True,
        capture_output=True,
        timeout=30,
    )


def _write(directory: Path, name: str, at: float) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / name).write_text(f"{at:.3f}\n")


def test_a_healthy_process_passes_with_climate_30_minutes_old(tmp_path):
    now = time.time()
    for name in liveness.BEATS:
        _write(tmp_path, name, now - 5)
    result = _probe(tmp_path)
    assert result.returncode == 0, result.stderr
    # The probe has no database or climate input at all: the newest climate row's age cannot fail it.
    source = PROBE.read_text() + (INGESTOR / "process_liveness.py").read_text()
    assert "asyncpg" not in source and "max(ts)" not in source and "FROM climate" not in source


def test_a_blocked_event_loop_fails(tmp_path, monkeypatch):
    monkeypatch.setattr(liveness, "LIVENESS_DIR", tmp_path)
    monkeypatch.setattr(liveness, "EVENT_LOOP_BEAT_S", 0.05)
    monkeypatch.setattr(liveness, "BEAT_MIN_INTERVAL_S", 0.0)
    monkeypatch.setattr(liveness, "_last_beat", {})

    async def run_then_block():
        beater = asyncio.ensure_future(liveness.event_loop_heartbeat())
        await asyncio.sleep(0.2)
        liveness.beat(liveness.TASK_SUPERVISOR)
        assert _probe(tmp_path, "--max-age", "1.0").returncode == 0
        time.sleep(1.5)  # the loop is blocked: neither beat advances
        result = _probe(tmp_path, "--max-age", "1.0")
        beater.cancel()
        return result

    result = asyncio.run(run_then_block())
    assert result.returncode == 1
    assert "event_loop=" in result.stderr


def test_a_stopped_task_supervisor_fails(tmp_path):
    now = time.time()
    _write(tmp_path, liveness.EVENT_LOOP, now - 5)
    _write(tmp_path, liveness.TASK_SUPERVISOR, now - 600)
    result = _probe(tmp_path)
    assert result.returncode == 1 and "task_supervisor=600s" in result.stderr
    (tmp_path / liveness.TASK_SUPERVISOR).unlink()
    result = _probe(tmp_path)
    assert result.returncode == 1 and "task_supervisor=missing" in result.stderr


def test_beats_are_wired_into_the_event_loop_and_the_task_supervisor():
    source = (INGESTOR / "ingestor.py").read_text()
    task_loop = source[source.index("async def task_loop(") : source.index("# MQTT fan-out SUBSCRIBE mode")]
    assert "process_liveness.beat(process_liveness.TASK_SUPERVISOR)" in task_loop.split("while True:", 1)[1]
    main_gather = source[source.index("    main_tasks = asyncio.gather(") :]
    assert "process_liveness.event_loop_heartbeat()," in main_gather[: main_gather.index(")\n\n")]


def test_the_prod_liveness_probe_reads_no_climate():
    patch = ROOT / "deploy/k8s/overlays/prod/ingestor-resilience.patch.yaml"
    doc = yaml.safe_load(patch.read_text())
    (container,) = doc["spec"]["template"]["spec"]["containers"]
    probe = container["livenessProbe"]
    assert probe["exec"]["command"] == ["python", "ingestor-liveness.py"]
    assert "healthz" not in str(probe) and "climate" not in str(probe)
    assert "readinessProbe" not in container  # a silent controller must not hold a rollout either
    assert probe["initialDelaySeconds"] >= 60  # the task supervisor's first beat comes after its 30 s stagger
