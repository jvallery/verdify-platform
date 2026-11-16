"""Equipment-source collector credential install/attestation hook contract (#1649 reduced it to one login)."""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).parents[1]
PROD = REPO_ROOT / "deploy/k8s/overlays/prod"
JOB_NAME = "verdify-experiment-v2-credential-bootstrap"

COLLECTOR_LOGIN = "verdify_experiment_v2_equipment_source_collector_login"
COLLECTOR_DUTY = "verdify_experiment_equipment_source_collector"


@pytest.fixture(scope="module")
def rendered() -> list[dict]:
    result = subprocess.run(
        ["kustomize", "build", str(PROD)],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return [document for document in yaml.safe_load_all(result.stdout) if document]


def _job(documents: list[dict], name: str) -> dict:
    return next(
        document for document in documents if document.get("kind") == "Job" and document["metadata"]["name"] == name
    )


def _container(job: dict) -> dict:
    containers = job["spec"]["template"]["spec"]["containers"]
    return next(
        (container for container in containers if container["name"] == "bootstrap-and-attest"),
        containers[0],
    )


def _env(job: dict) -> dict[str, dict]:
    return {item["name"]: item for item in _container(job)["env"]}


def _script(documents: list[dict]) -> str:
    return _container(_job(documents, JOB_NAME))["args"][0]


def _secret_ref(item: dict, name: str, key: str) -> None:
    assert item["valueFrom"]["secretKeyRef"] == {"name": name, "key": key}


def test_bootstrap_is_wave_ordered_bounded_and_uses_exact_migrate_image(rendered: list[dict]) -> None:
    migration = _job(rendered, "verdify-migrate")
    ordinary = _job(rendered, "verdify-runtime-role-bootstrap")
    experiment = _job(rendered, JOB_NAME)
    annotations = experiment["metadata"]["annotations"]

    assert experiment["metadata"]["namespace"] == "verdify-prod"
    assert annotations == {
        "argocd.argoproj.io/hook": "PreSync",
        "argocd.argoproj.io/hook-delete-policy": "BeforeHookCreation",
        "argocd.argoproj.io/sync-wave": "2",
    }
    assert int(migration["metadata"]["annotations"].get("argocd.argoproj.io/sync-wave", "0")) == 0
    assert ordinary["metadata"]["annotations"]["argocd.argoproj.io/sync-wave"] == "1"
    assert experiment["spec"]["backoffLimit"] == 0
    assert experiment["spec"]["activeDeadlineSeconds"] == 240
    assert experiment["spec"]["ttlSecondsAfterFinished"] == 600

    pod = experiment["spec"]["template"]["spec"]
    assert pod["restartPolicy"] == "Never"
    assert "hostNetwork" not in pod
    assert pod["automountServiceAccountToken"] is False
    assert pod["enableServiceLinks"] is False
    assert "serviceAccountName" not in pod
    assert pod["imagePullSecrets"] == [{"name": "zot-origin-cluster-pull"}]
    assert experiment["spec"]["template"]["metadata"]["labels"]["app.kubernetes.io/component"] == "migrate"

    container = _container(experiment)
    assert container["image"] == _container(migration)["image"]
    assert container["image"].startswith("registry.vallery.net/verdifyconsultancy/verdify-migrate@sha256:")
    assert container["command"] == ["/bin/sh", "-ec"]
    assert container["securityContext"] == {
        "allowPrivilegeEscalation": False,
        "readOnlyRootFilesystem": True,
        "capabilities": {"drop": ["ALL"]},
    }
    assert not any(document.get("kind") == "Secret" for document in rendered)


def test_bootstrap_consumes_only_the_collector_and_guard_secrets(rendered: list[dict]) -> None:
    env = _env(_job(rendered, JOB_NAME))
    assert set(env) == {
        "DB_HOST",
        "DB_PORT",
        "DB_NAME",
        "DB_ADMIN_USER",
        "DB_ADMIN_PASSWORD",
        "ORDINARY_API_DB_PASSWORD",
        "ORDINARY_INGESTOR_DB_PASSWORD",
        "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER",
        "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD",
        "PGAPPNAME",
    }
    for name in ("DB_HOST", "DB_PORT", "DB_NAME"):
        assert env[name]["valueFrom"]["configMapKeyRef"] == {"name": "verdify-config", "key": name}
    assert env["DB_ADMIN_USER"]["valueFrom"]["configMapKeyRef"] == {"name": "verdify-config", "key": "DB_USER"}
    _secret_ref(env["DB_ADMIN_PASSWORD"], "verdify-app-secrets", "POSTGRES_PASSWORD")
    _secret_ref(env["ORDINARY_API_DB_PASSWORD"], "verdify-app-secrets", "VERDIFY_API_RUNTIME_DB_PASSWORD")
    _secret_ref(env["ORDINARY_INGESTOR_DB_PASSWORD"], "verdify-app-secrets", "VERDIFY_INGESTOR_RUNTIME_DB_PASSWORD")
    for name in (
        "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER",
        "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD",
    ):
        _secret_ref(env[name], "verdify-app-secrets", name)
    pod = _job(rendered, JOB_NAME)["spec"]["template"]["spec"]
    assert [volume["name"] for volume in pod["volumes"]] == ["tmp"]


def test_script_is_transactional_nonlogging_and_exact_duty_locked(rendered: list[dict]) -> None:
    script = _script(rendered)
    subprocess.run(["/bin/sh", "-n"], input=script, text=True, check=True, capture_output=True)
    assert "--single-transaction" in script
    assert "SET password_encryption = 'scram-sha-256'" in script
    assert f"--command='\\password {COLLECTOR_LOGIN}'" in script
    assert f"attest_login {COLLECTOR_LOGIN}" in script
    assert COLLECTOR_DUTY in script
    assert script.count("--command='\\password verdify_experiment") == 1
    assert script.count("attest_login verdify_experiment") == 1
    assert "candidate.proname LIKE 'fn_experiment_v2_%'" in script
    assert "candidate.proname LIKE 'fn_record_equipment_%'" in script
    assert "has_table_privilege(" in script
    assert "has_sequence_privilege(" in script
    assert "equipment-source collector login installed and attested" in script
    assert "direct-bootstrap" not in script
    for forbidden in ("set -x", "printenv", "postgresql://", "--password=", "ALTER ROLE", "ESP32", "MQTT"):
        assert forbidden not in script
    for line in script.splitlines():
        if "psql " in line or "--set=" in line:
            assert "_PASSWORD}" not in line


def test_collector_allowlist_is_lockstep_with_ledgered_grants(rendered: list[dict]) -> None:
    script = _script(rendered)
    pairs = re.findall(r"^\s*\('([^']+)', '([^']+)'\),?$", script, re.MULTILINE)
    assert {duty for duty, _ in pairs} == {COLLECTOR_DUTY}
    assert {signature for _, signature in pairs} == {
        "public.fn_record_equipment_counter_sample(uuid,timestamp with time zone,text,text,text,double precision,text,uuid,double precision,uuid,bigint,text)",
        "public.fn_record_equipment_direct_state_snapshot(uuid,uuid,text,text,jsonb,double precision,uuid,bigint,text)",
        "public.fn_record_equipment_state_source_receipt(uuid,timestamp with time zone,text,text,jsonb,boolean,uuid,bigint,text)",
    }


def _activation_env(tmp_path: Path) -> dict[str, str]:
    return {
        **os.environ,
        "DB_HOST": "db.invalid",
        "DB_PORT": "5432",
        "DB_NAME": "verdify",
        "DB_ADMIN_USER": "verdify",
        "DB_ADMIN_PASSWORD": "owner-password-marker-never-printed",
        "ORDINARY_API_DB_PASSWORD": "a" * 64,
        "ORDINARY_INGESTOR_DB_PASSWORD": "b" * 64,
        "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_USER": COLLECTOR_LOGIN,
        "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD": "3" * 64,
        "FAKE_PSQL_TRACE": str(tmp_path / "psql.trace"),
    }


def _install_fake_psql(tmp_path: Path) -> None:
    fake = tmp_path / "psql"
    fake.write_text(
        r"""#!/bin/sh
set -eu
args=" $* "
for argument in "$@"; do
  for secret in "$DB_ADMIN_PASSWORD" "$VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD"; do
    case "$argument" in *"$secret"*) exit 80 ;; esac
  done
done
case "$args" in
  *" --single-transaction "*)
    [ "$PGPASSWORD" = "$DB_ADMIN_PASSWORD" ] || exit 81
    IFS= read -r source_1 && IFS= read -r source_2 || exit 82
    [ "$source_1:$source_2" = "$VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD:$VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD" ] || exit 85
    if IFS= read -r unexpected; then exit 89; fi
    printf '%s\n' install >>"$FAKE_PSQL_TRACE"
    ;;
  *)
    login=
    previous=
    for argument in "$@"; do
      if [ "$previous" = "-U" ]; then login="$argument"; fi
      previous="$argument"
    done
    [ "$login" = verdify_experiment_v2_equipment_source_collector_login ] || exit 90
    [ "$PGPASSWORD" = "$VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD" ] || exit 91
    payload="$(cat)"
    case "$payload" in *"$DB_ADMIN_PASSWORD"*|*"$VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD"*) exit 92 ;; esac
    printf '%s\n' "$login" >>"$FAKE_PSQL_TRACE"
    printf '%s\n' t
    ;;
esac
"""
    )
    fake.chmod(0o755)


def test_script_pipes_verifier_and_attests_without_exposing_values(rendered: list[dict], tmp_path: Path) -> None:
    _install_fake_psql(tmp_path)
    environment = _activation_env(tmp_path)
    environment["PATH"] = f"{tmp_path}:{os.environ['PATH']}"
    result = subprocess.run(
        ["/bin/sh", "-ec", _script(rendered)], env=environment, check=True, capture_output=True, text=True
    )
    output = result.stdout + result.stderr
    assert "equipment-source collector login installed and attested" in output
    for name, value in environment.items():
        if name.endswith("_PASSWORD"):
            assert value not in output
    assert (tmp_path / "psql.trace").read_text().splitlines() == ["install", COLLECTOR_LOGIN]


@pytest.mark.parametrize("failure_kind", ["shape", "owner-reuse"])
def test_script_rejects_bad_collector_material_before_psql(
    rendered: list[dict], tmp_path: Path, failure_kind: str
) -> None:
    fake = tmp_path / "psql"
    fake.write_text('#!/bin/sh\n: >"$FAKE_PSQL_CALLED"\nexit 0\n')
    fake.chmod(0o755)
    environment = _activation_env(tmp_path)
    environment["PATH"] = f"{tmp_path}:{os.environ['PATH']}"
    environment["FAKE_PSQL_CALLED"] = str(tmp_path / "called")
    key = "VERDIFY_EXPERIMENT_EQUIPMENT_SOURCE_COLLECTOR_DB_PASSWORD"
    environment[key] = "g" * 64 if failure_kind == "shape" else environment["ORDINARY_API_DB_PASSWORD"]
    result = subprocess.run(
        ["/bin/sh", "-ec", _script(rendered)], env=environment, check=False, capture_output=True, text=True
    )
    assert result.returncode == 1
    assert not (tmp_path / "called").exists()
    output = result.stdout + result.stderr
    assert "fail-closed" in output
    for name, value in environment.items():
        if name.endswith("_PASSWORD"):
            assert value not in output
