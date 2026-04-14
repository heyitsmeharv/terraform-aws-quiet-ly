#!/usr/bin/env bash

# prereqs.sh
# - Verifies required tooling is available *in this shell* (PATH).
# - Does not install anything; fails fast with a clear hint.
#
# Usage:
#   bash infra/scripts/prereqs.sh

need() {
  local bin="$1"
  local hint="$2"

  if ! command -v "$bin" >/dev/null 2>&1; then
    echo ""
    echo "Missing: $bin"
    echo "Fix: $hint"
    echo ""
    exit 1
  fi
}

echo "Checking prerequisites..."
echo ""

need terraform "Install Terraform and ensure it's on PATH"
need aws       "Install AWS CLI v2 and ensure it's on PATH"
need jq        "Install jq and ensure it's on PATH (optional for pretty output, but required by this template)"
need node      "Install Node.js (LTS) and ensure it's on PATH"
need npm       "npm should come with Node.js (LTS)"

# Optional locally. CI installs it in the workflow.
if ! command -v tflint >/dev/null 2>&1; then
  echo "Note: tflint not found (optional locally; CI installs it in the workflow)"
  echo "Install: https://github.com/terraform-linters/tflint"
  echo ""
fi

echo "All required tools are available."
echo ""

echo "terraform: $(terraform version | head -n 1)"
echo "aws:       $(aws --version 2>&1)"
echo "jq:        $(jq --version)"
echo "node:      $(node --version)"
echo "npm:       $(npm --version)"

if command -v tflint >/dev/null 2>&1; then
  echo "tflint:    $(tflint --version | head -n 1)"
fi

echo ""
