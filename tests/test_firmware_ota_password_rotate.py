"""#1009: the OTA password rotation helper stages, promotes and never prints a value.

A stub kubectl keeps the Secret in a JSON file and applies the merge and JSON
patches the helper sends; no cluster is touched. When Argo manages the Secret
the write modes refuse after a metadata-only read (2026-11-07: selfHeal reverted
a live promote in 9 s).
"""

import base64
import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/firmware-ota-password-rotate.sh"
OLD = "old-ota-password-0123"
NEW = "new-ota-password-4567"

STUB = r"""#!/usr/bin/env python3
import json, os, sys
store = os.environ["STUB_SECRET"]
args = sys.argv[1:]
with open(store + ".calls", "a") as log:
    log.write(" ".join(args) + "\n")
secret = json.load(open(store))
if "get" in args and "jsonpath={.metadata}" in args:
    print(json.dumps(secret.get("metadata", {})))
elif "get" in args:
    print(json.dumps(secret))
elif "patch" in args:
    kind = args[args.index("--type") + 1] if "--type" in args else args[[a.startswith("--type=") for a in args].index(True)].split("=", 1)[1]
    patch = json.load(open(args[args.index("--patch-file") + 1]))
    if kind == "merge":
        secret["data"].update(patch["data"])
    else:
        for op in patch:
            key = op["path"].rsplit("/", 1)[1]
            if op["op"] == "test" and secret["data"].get(key) != op["value"]:
                sys.exit("test failed")
            if op["op"] in ("replace", "add"):
                secret["data"][key] = op["value"]
            if op["op"] == "remove":
                del secret["data"][key]
    json.dump(secret, open(store, "w"))
else:
    sys.exit(2)
"""


def b64(value):
    return base64.b64encode(value.encode()).decode()


def run(tmp_path, *args, stdin=""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    (bin_dir / "kubectl").write_text(STUB)
    (bin_dir / "kubectl").chmod(0o755)
    env = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}", STUB_SECRET=str(tmp_path / "secret.json"))
    return subprocess.run(
        ["bash", str(SCRIPT), *args], input=stdin, capture_output=True, text=True, env=env, timeout=30
    )


def secret(tmp_path):
    return json.loads((tmp_path / "secret.json").read_text())["data"]


def test_stage_then_promote_rotates_without_printing_a_value(tmp_path):
    (tmp_path / "secret.json").write_text(json.dumps({"data": {"ota_password": b64(OLD)}}))
    staged = run(tmp_path, "stage", stdin=f"{NEW}\n{NEW}\n")
    assert staged.returncode == 0, staged.stderr
    assert secret(tmp_path) == {"ota_password": b64(OLD), "ota_password_next": b64(NEW)}
    assert json.loads(staged.stdout.strip().splitlines()[-1])["ota_password_next_reads_back"] is True
    again = run(tmp_path, "stage", stdin=f"{NEW}\n{NEW}\n")
    assert again.returncode != 0 and "already staged" in again.stderr
    status = run(tmp_path, "status")
    assert json.loads(status.stdout) == {
        "keys": ["ota_password", "ota_password_next"],
        "next_differs_from_current": True,
    }
    promoted = run(tmp_path, "promote")
    assert promoted.returncode == 0, promoted.stderr
    assert secret(tmp_path) == {"ota_password": b64(NEW), "ota_password_previous": b64(OLD)}
    forgotten = run(tmp_path, "forget")
    assert forgotten.returncode == 0, forgotten.stderr
    assert secret(tmp_path) == {"ota_password": b64(NEW)}
    for result in (staged, status, promoted, forgotten):
        for value in (OLD, NEW, b64(OLD), b64(NEW)):
            assert value not in result.stdout + result.stderr


def test_stage_refuses_a_mismatch_a_short_value_and_the_current_value(tmp_path):
    (tmp_path / "secret.json").write_text(json.dumps({"data": {"ota_password": b64(OLD)}}))
    assert "differ" in run(tmp_path, "stage", stdin=f"{NEW}\nother-value-000000\n").stderr
    assert "refused" in run(tmp_path, "stage", stdin="short\nshort\n").stderr
    assert "equals the current" in run(tmp_path, "stage", stdin=f"{OLD}\n{OLD}\n").stderr
    assert secret(tmp_path) == {"ota_password": b64(OLD)}
    assert "no ota_password_next" in run(tmp_path, "promote").stderr


def test_generate_stages_a_fresh_value(tmp_path):
    (tmp_path / "secret.json").write_text(json.dumps({"data": {"ota_password": b64(OLD)}}))
    result = run(tmp_path, "stage", "--generate")
    assert result.returncode == 0, result.stderr
    data = secret(tmp_path)
    assert data["ota_password"] == b64(OLD) and len(base64.b64decode(data["ota_password_next"])) >= 16


ARGO_METADATA = {
    "annotations": {
        "argocd.argoproj.io/tracking-id": "verdify-prod-secrets-local-prod:/Secret:verdify-prod/verdify-firmware-ota"
    },
    "managedFields": [{"manager": "argocd-controller", "operation": "Apply"}],
}


def test_write_modes_refuse_an_argo_managed_secret_from_metadata_alone(tmp_path):
    start = {
        "ota_password": b64(OLD),
        "ota_password_next": b64(NEW),
        "ota_password_previous": b64("prev-ota-password-89ab"),
    }
    (tmp_path / "secret.json").write_text(json.dumps({"metadata": ARGO_METADATA, "data": start}))
    for mode, swap in (
        ("stage", "add key ota_password_next"),
        ("promote", "drop ota_password_next"),
        ("forget", "drop key ota_password_previous"),
    ):
        calls = tmp_path / "secret.json.calls"
        calls.unlink(missing_ok=True)
        result = run(tmp_path, mode, stdin=f"{NEW}\n{NEW}\n")
        assert result.returncode == 3, (mode, result.stderr)
        assert "refused: Argo manages" in result.stderr and swap in result.stderr
        assert "platform/gitops/secrets-ksops/verdify-prod/secret-verdify-firmware-ota.enc.yaml" in result.stderr
        assert "value-blind helper" in result.stderr
        assert "managedFields manager argocd-controller" in result.stderr
        # Only the metadata read ran: no full get, no patch.
        assert calls.read_text().splitlines() == [
            "--context vallery -n verdify-prod get secret verdify-firmware-ota --show-managed-fields -o jsonpath={.metadata}"
        ]
        assert secret(tmp_path) == start
        for value in (OLD, NEW, b64(OLD), b64(NEW)):
            assert value not in result.stdout + result.stderr


def test_each_argo_marker_alone_refuses_and_status_still_reports(tmp_path):
    for metadata in (
        {"labels": {"app.kubernetes.io/instance": "verdify-prod-secrets-local-prod"}},
        {"annotations": {"argocd.argoproj.io/tracking-id": "x"}},
        {"managedFields": [{"manager": "argocd-application-controller"}]},
    ):
        (tmp_path / "secret.json").write_text(json.dumps({"metadata": metadata, "data": {"ota_password": b64(OLD)}}))
        assert run(tmp_path, "stage", "--generate").returncode == 3
        assert secret(tmp_path) == {"ota_password": b64(OLD)}
        status = run(tmp_path, "status")
        assert status.returncode == 0, status.stderr
        assert json.loads(status.stdout) == {"keys": ["ota_password"]}
        assert "Argo" in status.stderr
