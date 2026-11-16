#!/usr/bin/env bash
# Fail if the kustomize render on stdin contains a top-level kind: Secret.
# The AppProject rejects a sync whose render holds a Secret, so every *.placeholder.yaml
# Secret must carry config.kubernetes.io/local-config as an annotation.
set -euo pipefail
if grep -qE '^kind:[[:space:]]*Secret[[:space:]]*$'; then
  echo "the render emits a kind: Secret; the AppProject rejects the whole sync" >&2
  exit 1
fi
echo "render holds no Secret"
