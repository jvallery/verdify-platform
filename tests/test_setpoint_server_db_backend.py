"""Setpoint-server contract: grow lights only, no docker escape hatch (#447, #1656).

#447 (2026-07-10) found GET /setpoints returning HTTP 500 because its query path still shelled out to docker. #1656
(climate refactor 4.2) then retired the /setpoints route, its plan-reading helpers and its default copies: the
operator API calls only the lights route, and the plan it served no longer exists. These tests need no database and
no docker socket, and they prove:

  1. scripts/setpoint-server.py reaches no docker/psql subprocess and no longer serves /setpoints (HTTP 404).
  2. /health is unchanged.
  3. The rendered prod workload selects the in-cluster backend, mounts no docker socket and keeps the
     credential-injection and single-writer posture.
  4. The overlays/prod image pin can never regress to the known-broken pre-#447 build.
"""

from __future__ import annotations

import importlib.util
import json
import runpy
import sys
import threading
import urllib.error
import urllib.request
from http.server import HTTPServer
from pathlib import Path
from types import ModuleType

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPT = REPO_ROOT / "scripts" / "setpoint-server.py"
COMPONENT = REPO_ROOT / "deploy" / "k8s" / "components" / "setpoint-server" / "setpoint-server.yaml"
PROD_OVERLAY = REPO_ROOT / "deploy" / "k8s" / "overlays" / "prod"

# The 2026-06-04 pre-#447 build: its /setpoints path still resolved
# `docker exec ... psql` and 500'd in the k3s pod. The overlays/prod hand-pin
# must never point back at it.
PRE_FIX_BROKEN_DIGEST = "sha256:f49868cb9887c7e1dc18dc32f289fb873ee97dd1c5bd80bb961474a5f4976948"


def _stub_asyncpg_if_missing() -> None:
    """setpoint-server.py imports asyncpg at module level; the tests only need
    the name to resolve (they inject fake pools). Same pattern as
    tests/test_public_zone_renderer.py."""
    if "asyncpg" not in sys.modules and importlib.util.find_spec("asyncpg") is None:
        stub = ModuleType("asyncpg")

        async def _unavailable(*_a, **_k):  # pragma: no cover - never awaited here
            raise RuntimeError("asyncpg stub: no real DB in this test")

        stub.create_pool = _unavailable
        sys.modules["asyncpg"] = stub


@pytest.fixture(scope="module")
def setpoint_module() -> dict:
    """Load scripts/setpoint-server.py once (main() stays un-run: run_name
    differs from __main__)."""
    _stub_asyncpg_if_missing()
    return runpy.run_path(str(SCRIPT), run_name="_test_setpoint_server_backend")


@pytest.fixture(scope="module")
def module_globals(setpoint_module) -> dict:
    """The REAL shared globals dict of the module's functions.

    runpy.run_path returns a copy, so mutating its return value cannot reach
    the functions; patch through __globals__ instead.
    """
    return setpoint_module["record_state_change_sync"].__globals__


# ── 1. no docker / subprocess escape hatch exists at all ─────────────────────


def _executable_code_dump(src: str) -> str:
    """AST dump of the script with docstrings blanked: comments and docstrings
    (which legitimately narrate the #447 docker history) are excluded, while
    every identifier and runtime string constant remains visible."""
    import ast

    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.Module | ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef):
            body = getattr(node, "body", [])
            if (
                body
                and isinstance(body[0], ast.Expr)
                and isinstance(body[0].value, ast.Constant)
                and isinstance(body[0].value.value, str)
            ):
                body[0].value.value = ""
    return ast.dump(tree)


def test_script_has_no_subprocess_docker_or_psql_prefix_resolution(setpoint_module):
    """#447 acceptance: a docker-socket-less runtime cannot end up invoking
    `docker` because no code path resolves a psql prefix anymore."""
    src = SCRIPT.read_text()
    assert "_resolve_psql_prefix" not in src
    assert "psql-verdify" not in src
    assert "import subprocess" not in src
    code = _executable_code_dump(src)
    assert "docker" not in code.lower()
    assert "subprocess" not in code
    # #1656: the plan-reading /setpoints helpers are gone.
    for retired in ("get_setpoint_text_sync", "_db_text_safe", "setpoint_plan", "DIRECT_WET_DEFAULTS"):
        assert retired not in src
    # And the loaded module namespace confirms it (not just source text).
    assert "subprocess" not in setpoint_module
    assert "_resolve_psql_prefix" not in setpoint_module


# ── 2. _db_text_safe failure semantics match the prior subprocess contract ───


# ── 3. endpoint behavior over a real HTTP round-trip ─────────────────────────


def _serve(module_globals, setpoint_module):
    server = HTTPServer(("127.0.0.1", 0), setpoint_module["LutronHandler"])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def test_setpoints_route_is_retired(module_globals, setpoint_module):
    server = None
    try:
        server, _ = _serve(module_globals, setpoint_module)
        port = server.server_address[1]
        with pytest.raises(urllib.error.HTTPError) as excinfo:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/setpoints", timeout=10)
        assert excinfo.value.code == 404
    finally:
        if server is not None:
            server.shutdown()


def test_health_endpoint_unchanged(module_globals, setpoint_module):
    server = None
    try:
        server, _ = _serve(module_globals, setpoint_module)
        port = server.server_address[1]
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=10) as resp:
            assert resp.status == 200
            payload = json.loads(resp.read().decode())
        assert payload["status"] == "ok"
        assert set(payload["lights"]) == {"main", "grow"}
    finally:
        if server is not None:
            server.shutdown()


# ── 4. rendered prod workload contract ───────────────────────────────────────


def _component_docs() -> list[dict]:
    return [d for d in yaml.safe_load_all(COMPONENT.read_text()) if d]


def _setpoint_deployment() -> dict:
    (dep,) = [d for d in _component_docs() if d["kind"] == "Deployment"]
    return dep


def test_prod_workload_selects_dsn_backend_via_verdify_config():
    """The k3s runtime contract (#24/#447): the pod inherits
    VERDIFY_DB_BACKEND=dsn from verdify-config, so nothing that ever consumes
    the lib/psql-verdify.sh seam inside this pod can resolve `docker`."""
    dep = _setpoint_deployment()
    container = dep["spec"]["template"]["spec"]["containers"][0]
    env_from = [ref.get("configMapRef", {}).get("name") for ref in container.get("envFrom", [])]
    assert "verdify-config" in env_from

    # The overlay patch that adds the key to verdify-config (#211) must stay
    # wired into overlays/prod.
    patch = yaml.safe_load((PROD_OVERLAY / "gather-script-env-configmap.yaml").read_text())
    assert patch["metadata"]["name"] == "verdify-config"
    assert patch["data"]["VERDIFY_DB_BACKEND"] == "dsn"
    kustomization = yaml.safe_load((PROD_OVERLAY / "kustomization.yaml").read_text())
    patch_paths = [p.get("path") for p in kustomization.get("patches", [])]
    assert "gather-script-env-configmap.yaml" in patch_paths
    assert "../../components/setpoint-server" in kustomization.get("components", [])


def test_pod_mounts_no_docker_socket_and_keeps_credential_injection():
    dep = _setpoint_deployment()
    pod = dep["spec"]["template"]["spec"]
    for vol in pod.get("volumes", []):
        host_path = (vol.get("hostPath") or {}).get("path", "")
        assert "docker" not in host_path, f"docker socket mount is forbidden (#447 non-goal): {vol}"

    container = pod["containers"][0]
    (pw_env,) = [e for e in container.get("env", []) if e["name"] == "POSTGRES_PASSWORD"]
    ref = pw_env["valueFrom"]["secretKeyRef"]
    assert ref["name"] == "verdify-setpoint-server-runtime-db"
    assert ref["key"] == "password"


def test_single_writer_posture_unchanged():
    dep = _setpoint_deployment()
    assert dep["spec"]["replicas"] == 1
    assert dep["spec"]["strategy"]["type"] == "Recreate"


def test_prod_pin_never_regresses_to_pre_fix_build():
    """The overlays/prod hand-pin must stay AT OR PAST the #447 fix. The
    2026-06-04 f49868cb build predates commit 7e0d8c0: syncing it would bring
    the docker-exec /setpoints path back to the only production environment."""
    kustomization = yaml.safe_load((PROD_OVERLAY / "kustomization.yaml").read_text())
    (pin,) = [img for img in kustomization["images"] if img["name"].endswith("/verdify-setpoint-server")]
    assert pin["digest"] != PRE_FIX_BROKEN_DIGEST
    assert pin["digest"].startswith("sha256:")


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
