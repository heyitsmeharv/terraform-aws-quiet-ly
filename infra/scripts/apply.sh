#!/usr/bin/env bash

# apply.sh
# - Applies a previously generated plan file (tfplan).
#
# Usage:
#   bash infra/scripts/apply.sh <environment>

ENVIRONMENT="${1:-}"
if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: bash infra/scripts/apply.sh <environment>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$ROOT_DIR/env/$ENVIRONMENT"

if [ ! -d "$ENV_DIR" ]; then
  echo "Environment folder not found: $ENV_DIR"
  exit 1
fi

echo "Apply"
echo "Environment: $ENVIRONMENT"
echo ""

cd "$ENV_DIR"

if [ ! -f "tfplan" ]; then
  echo "No tfplan found in $ENV_DIR"
  echo "Run: bash infra/scripts/plan.sh $ENVIRONMENT"
  exit 1
fi

terraform apply -input=false "tfplan"
echo "apply complete for environment: $ENVIRONMENT"
