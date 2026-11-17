"""#1549: the scheduled verdify-db restore drill stays isolated and its script copies match scripts/."""

import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "deploy/k8s/components/db-restore-drill"
COPIES = (
    "run-scheduled-restore-drill.sh",
    "verify-backup-pair.sh",
    "restore-backup-pair.sh",
    "logical-restore-audit.sql",
    "check-timescale-ownership.sql",
    "test-timescale-parent-owner.sql",
    "test-restored-timescale-parent-owner.sql",
)


@pytest.mark.parametrize("name", COPIES)
def test_src_copy_matches_canonical_script(name):
    assert (COMPONENT / "src" / name).read_bytes() == (ROOT / "scripts" / name).read_bytes(), name


@pytest.fixture(scope="module")
def rendered():
    out = subprocess.check_output(["kustomize", "build", "deploy/k8s/overlays/prod"], cwd=ROOT, text=True)
    return [x for x in yaml.safe_load_all(out) if x]


def _get(rendered, kind, name):
    (obj,) = [x for x in rendered if x["kind"] == kind and x["metadata"]["name"] == name]
    return obj


def test_drill_cronjob_is_isolated(rendered):
    cron = _get(rendered, "CronJob", "verdify-db-restore-drill")
    assert cron["metadata"]["namespace"] == "verdify-prod"
    assert cron["spec"]["suspend"] is False
    assert cron["spec"]["concurrencyPolicy"] == "Forbid"
    job = cron["spec"]["jobTemplate"]["spec"]
    assert job["activeDeadlineSeconds"] <= 3600
    pod = job["template"]["spec"]
    assert pod["automountServiceAccountToken"] is False
    assert pod["securityContext"]["runAsNonRoot"] is True
    (container,) = pod["containers"]
    # No credential of any kind: every env value is a literal.
    assert all("valueFrom" not in env for env in container["env"])
    assert "envFrom" not in container
    env = {e["name"]: e["value"] for e in container["env"]}
    assert env["PGDATABASE"] == "verdify_rehearsal"
    assert env["PGHOST"].startswith("/")
    assert int(env["DRILL_MAX_RPO_SECONDS"]) > 0 and int(env["DRILL_MAX_RTO_SECONDS"]) > 0
    mounts = {m["name"]: m for m in container["volumeMounts"]}
    assert mounts["dumps"]["readOnly"] is True
    volumes = {v["name"]: v for v in pod["volumes"]}
    assert volumes["dumps"]["persistentVolumeClaim"] == {"claimName": "verdify-db-dumps", "readOnly": True}
    assert "emptyDir" in volumes["restore-data"]
    # The production database claim is never mounted.
    claims = {v["persistentVolumeClaim"]["claimName"] for v in pod["volumes"] if "persistentVolumeClaim" in v}
    assert claims == {"verdify-db-dumps"}
    assert job["template"]["metadata"]["labels"]["app.kubernetes.io/component"] == "db-restore-drill"


def test_drill_pod_is_denied_all_traffic(rendered):
    policy = _get(rendered, "NetworkPolicy", "verdify-db-restore-drill-deny-all")
    assert policy["spec"]["podSelector"] == {"matchLabels": {"app.kubernetes.io/component": "db-restore-drill"}}
    assert sorted(policy["spec"]["policyTypes"]) == ["Egress", "Ingress"]
    assert "ingress" not in policy["spec"] and "egress" not in policy["spec"]
    # The DB's restore ingress allow names component db-restore, never the drill.
    allow = _get(rendered, "NetworkPolicy", "allow-db-from-restore")
    peers = [p["podSelector"]["matchLabels"] for r in allow["spec"]["ingress"] for p in r["from"]]
    assert {"app.kubernetes.io/component": "db-restore-drill"} not in peers
