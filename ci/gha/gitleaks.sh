#!/usr/bin/env bash
# GHA secret-scan: gitleaks from the estate-ci toolbox over the checked-out tree
# (verdify-platform#1542). Findings are redacted in the log;
# reviewed false positives are allowlisted in .gitleaks.toml.
set -eu
command -v gitleaks >/dev/null || { echo "secret-scan: gitleaks is not on the runner image" >&2; exit 1; }
gitleaks version
exec gitleaks dir --redact --no-banner --config .gitleaks.toml .
