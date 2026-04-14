#!/usr/bin/env bash

# plan.sh
# - Creates a plan for a chosen deployable root under infra/env/<environment>.
# - Uses env.tfvars to supply values.
# - Outputs a tfplan file so apply uses an exact, reviewed plan.
#
# Usage:
#   bash infra/scripts/plan.sh <environment>

ENVIRONMENT="${1:-}"
if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: bash infra/scripts/plan.sh <environment>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR="$ROOT_DIR/env/$ENVIRONMENT"

if [ ! -d "$ENV_DIR" ]; then
  echo "Environment folder not found: $ENV_DIR"
  exit 1
fi

echo "Plan"
echo "Environment: $ENVIRONMENT"
echo ""

cd "$ENV_DIR"

terraform init -input=false -backend-config=backend.hcl

terraform plan -input=false \
  -var-file="env.tfvars" \
  -out="tfplan"

echo "plan complete for environment: $ENVIRONMENT"
echo "Plan saved to: $ENV_DIR/tfplan"
