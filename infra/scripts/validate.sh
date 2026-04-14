#!/usr/bin/env bash

# validate.sh
# - Local/CI quality gate for an environment under infra/env/<environment>
# - Includes:
#   1) terraform fmt (writes changes)
#   2) terraform validate (syntax + internal consistency)
#   3) tflint (recursive linting)
#
# Usage:
#   bash infra/scripts/validate.sh <environment>

ENVIRONMENT="${1:-}"
if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: bash infra/scripts/validate.sh <environment>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$ROOT_DIR/env/$ENVIRONMENT"

if [ ! -d "$ENV_DIR" ]; then
  echo "Environment folder not found: $ENV_DIR"
  exit 1
fi

echo "Validate (fmt → terraform validate → tflint)"
echo "Environment: $ENVIRONMENT"
echo ""

echo "→ terraform fmt"
bash "$ROOT_DIR/scripts/fmt.sh"
echo ""

echo "→ terraform validate"
cd "$ENV_DIR"
terraform init -backend=false -input=false >/dev/null
terraform validate
echo "terraform validate passed"
echo ""

# tflint: required in CI, optional locally (but if present we run it).
echo "→ tflint"
if ! command -v tflint >/dev/null 2>&1; then
  echo "tflint is not installed"
  echo "Install: https://github.com/terraform-linters/tflint"
  exit 1
fi

cd "$ROOT_DIR"
tflint --recursive
echo "tflint passed"
echo ""

echo "validate complete for environment: $ENVIRONMENT"
