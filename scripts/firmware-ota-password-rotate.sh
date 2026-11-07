#!/usr/bin/env bash
# Rotate the controller's OTA password (#1009) without ever printing it.
#
# The Secret verdify-prod/verdify-firmware-ota is delivered by Argo app
# verdify-prod-secrets-local-prod (automated selfHeal, server-side apply) from the
# KSOPS file platform/gitops/secrets-ksops/verdify-prod/secret-verdify-firmware-ota.enc.yaml
# in jvallery/agents. A live patch is reverted within seconds: on 2026-11-07 a
# promote was undone 9 s later, leaving the old values and an orphan
# ota_password_previous key. So a rotation is a change to that KSOPS file, made by
# a value-blind helper (a sops edit that never prints a value), merged and synced:
#
#   stage    add key ota_password_next with the new password. The device still
#            runs ota_password.
#   promote  after the rotated firmware is flashed and pinned: ota_password takes
#            the ota_password_next value, the old value moves to
#            ota_password_previous (a rollback to a pre-rotation image needs it
#            for every later flash), and ota_password_next is dropped, in one
#            change to the file.
#   forget   once no pre-rotation image can run again (a rotated release is
#            last-good): drop ota_password_previous.
#
# This script's stage, promote and forget modes write the live Secret directly
# with write-only patches. Before any write they read the Secret's metadata (never
# its values) and refuse when Argo manages it: an argocd.argoproj.io/tracking-id
# annotation, an app.kubernetes.io/instance label, or a managedFields manager
# containing "argocd". They remain only for a Secret that is out of band again.
#   status   key names, and whether ota_password_next differs from ota_password;
#            works either way, and notes on stderr when Argo manages the Secret.
#
# Between stage and promote the build uses ota_password_next and every flash
# Job uses the key the device runs now (docs/runbooks/firmware-signed-artifacts.md,
# "OTA password rotation"):
#   firmware-release-job.py build --ota-key ota_password_next ...
#   firmware-release-job.py flash ...                         # old image running
#   firmware-release-job.py flash --ota-key ota_password_next # rotated image running (rollback)
# After promote, a pre-rotation image (a rollback) answers to ota_password_previous.
#
# Usage: scripts/firmware-ota-password-rotate.sh stage [--generate] [--replace]
#        scripts/firmware-ota-password-rotate.sh promote
#        scripts/firmware-ota-password-rotate.sh forget
#        scripts/firmware-ota-password-rotate.sh status
set -euo pipefail

CONTEXT="${KUBE_CONTEXT:-vallery}"
NS=verdify-prod
SECRET=verdify-firmware-ota
KSOPS_REPO=jvallery/agents
KSOPS_FILE=platform/gitops/secrets-ksops/verdify-prod/secret-verdify-firmware-ota.enc.yaml
ARGO_APP=verdify-prod-secrets-local-prod
k() { kubectl --context "$CONTEXT" -n "$NS" "$@"; }

mode="${1:-}"
shift || true
generate=0
replace=0
for arg in "$@"; do
    case "$arg" in
        --generate) generate=1 ;;
        --replace) replace=1 ;;
        *) echo "unknown option: $arg" >&2; exit 64 ;;
    esac
done

umask 077
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# Value-blind report of the live Secret: key names and comparisons only.
report() {
    k get secret "$SECRET" -o json > "$work/live.json"
    python3 - "$work/live.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1])).get("data", {})
out = {"keys": sorted(data)}
if "ota_password_next" in data:
    out["next_differs_from_current"] = data["ota_password_next"] != data.get("ota_password")
print(json.dumps(out))
PY
}

# Metadata-only check for Argo ownership: prints one marker per line. It asks
# kubectl for .metadata alone, so the data map is never fetched.
argo_markers() {
    k get secret "$SECRET" --show-managed-fields -o 'jsonpath={.metadata}' > "$work/meta.json"
    python3 - "$work/meta.json" <<'PY'
import json, sys
meta = json.load(open(sys.argv[1]))
if "argocd.argoproj.io/tracking-id" in (meta.get("annotations") or {}):
    print("annotation argocd.argoproj.io/tracking-id")
if "app.kubernetes.io/instance" in (meta.get("labels") or {}):
    print("label app.kubernetes.io/instance")
for entry in meta.get("managedFields") or []:
    manager = entry.get("manager") or ""
    if "argocd" in manager.lower():
        print(f"managedFields manager {manager}")
PY
}

# Refuse a live write when Argo manages the Secret: selfHeal would revert it.
refuse_if_argo_managed() {
    local markers swap line
    markers="$(argo_markers)"
    [[ -z "$markers" ]] && return 0
    case "$mode" in
        stage) swap="add key ota_password_next holding the new password; leave ota_password as it is" ;;
        promote) swap="set ota_password to the ota_password_next value and ota_password_previous to the old ota_password value, and drop ota_password_next, in one commit" ;;
        forget) swap="drop key ota_password_previous" ;;
    esac
    {
        echo "refused: Argo manages secret $NS/$SECRET (app $ARGO_APP, automated selfHeal); a live $mode would be reverted within seconds."
        echo "Argo markers found:"
        while IFS= read -r line; do echo "  $line"; done <<<"$markers"
        echo "Make the change in $KSOPS_REPO, file $KSOPS_FILE:"
        echo "  $swap."
        echo "A value-blind helper must do the sops edit: no value printed, logged or committed in clear."
        echo "Merge it, let Argo sync, then check with: $0 status"
    } >&2
    exit 3
}

case "$mode" in
status)
    report
    markers="$(argo_markers)"
    if [[ -n "$markers" ]]; then
        echo "note: Argo ($ARGO_APP) manages this Secret; rotate through $KSOPS_REPO $KSOPS_FILE, not stage/promote/forget" >&2
    fi
    ;;
stage)
    refuse_if_argo_managed
    k get secret "$SECRET" -o json > "$work/live.json"
    if [[ "$replace" != 1 ]] && python3 -c 'import json,sys; sys.exit(0 if "ota_password_next" in json.load(open(sys.argv[1])).get("data", {}) else 1)' "$work/live.json"; then
        echo "ota_password_next already staged; promote it first, or re-run with --replace" >&2
        exit 1
    fi
    if [[ "$generate" == 1 ]]; then
        python3 -c 'import secrets; print(secrets.token_urlsafe(24), end="")' > "$work/new"
    else
        IFS= read -rs -p "New OTA password: " first; echo
        IFS= read -rs -p "Again: " second; echo
        [[ "$first" == "$second" ]] || { echo "the two entries differ" >&2; exit 1; }
        printf '%s' "$first" > "$work/new"
        unset first second
    fi
    python3 - "$work/live.json" "$work/new" "$work/patch.json" <<'PY'
import base64, json, sys
data = json.load(open(sys.argv[1])).get("data", {})
new = open(sys.argv[2], "rb").read()
if len(new) < 16 or any(b < 0x21 or b > 0x7E for b in new):
    sys.exit("refused: use at least 16 printable ASCII characters and no spaces")
if base64.b64encode(new).decode() == data.get("ota_password"):
    sys.exit("refused: the new password equals the current one")
json.dump({"data": {"ota_password_next": base64.b64encode(new).decode()}}, open(sys.argv[3], "w"))
PY
    k patch secret "$SECRET" --type=merge --patch-file "$work/patch.json" >/dev/null
    k get secret "$SECRET" -o json > "$work/after.json"
    python3 - "$work/after.json" "$work/new" <<'PY'
import base64, json, sys
data = json.load(open(sys.argv[1]))["data"]
ok = data.get("ota_password_next") == base64.b64encode(open(sys.argv[2], "rb").read()).decode()
print(json.dumps({"keys": sorted(data), "ota_password_next_reads_back": ok}))
sys.exit(0 if ok else 1)
PY
    ;;
promote)
    refuse_if_argo_managed
    k get secret "$SECRET" -o json > "$work/live.json"
    python3 - "$work/live.json" "$work/patch.json" "$work/next.sha" <<'PY'
import hashlib, json, sys
data = json.load(open(sys.argv[1])).get("data", {})
nxt = data.get("ota_password_next")
if not nxt:
    sys.exit("refused: no ota_password_next to promote")
if nxt == data.get("ota_password"):
    sys.exit("refused: ota_password_next equals ota_password")
cur = data["ota_password"]
json.dump(
    [
        {"op": "test", "path": "/data/ota_password_next", "value": nxt},
        {"op": "test", "path": "/data/ota_password", "value": cur},
        {"op": "add", "path": "/data/ota_password_previous", "value": cur},
        {"op": "replace", "path": "/data/ota_password", "value": nxt},
        {"op": "remove", "path": "/data/ota_password_next"},
    ],
    open(sys.argv[2], "w"),
)
open(sys.argv[3], "w").write(hashlib.sha256(nxt.encode()).hexdigest() + " " + hashlib.sha256(cur.encode()).hexdigest())
PY
    k patch secret "$SECRET" --type=json --patch-file "$work/patch.json" >/dev/null
    k get secret "$SECRET" -o json > "$work/after.json"
    python3 - "$work/after.json" "$work/next.sha" <<'PY'
import hashlib, json, sys
data = json.load(open(sys.argv[1]))["data"]
nxt, cur = open(sys.argv[2]).read().split()
h = lambda key: hashlib.sha256(data.get(key, "").encode()).hexdigest()
ok = sorted(data) == ["ota_password", "ota_password_previous"] and h("ota_password") == nxt and h("ota_password_previous") == cur
print(json.dumps({"keys": sorted(data), "ota_password_is_the_promoted_value": ok}))
sys.exit(0 if ok else 1)
PY
    ;;
forget)
    refuse_if_argo_managed
    k get secret "$SECRET" -o json > "$work/live.json"
    python3 - "$work/live.json" "$work/patch.json" <<'PY'
import json, sys
data = json.load(open(sys.argv[1])).get("data", {})
if "ota_password_previous" not in data:
    sys.exit("refused: no ota_password_previous to forget")
if "ota_password_next" in data:
    sys.exit("refused: a rotation is staged; promote it first")
json.dump([{"op": "remove", "path": "/data/ota_password_previous"}], open(sys.argv[2], "w"))
PY
    k patch secret "$SECRET" --type=json --patch-file "$work/patch.json" >/dev/null
    report
    ;;
*)
    sed -n '2,41p' "$0" >&2
    exit 64
    ;;
esac
