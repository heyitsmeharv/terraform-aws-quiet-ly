#!/usr/bin/env bash

# use-env.sh
# - Switches local AWS context by setting AWS_PROFILE=<environment>.
# - Use with "source" so it persists in your current shell session.
#
# Usage:
#   source infra/scripts/use-env.sh <environment>
#
# Notes:
# - Assumes AWS profiles exist in ~/.aws/config
# - Sets region defaults (can be overridden per shell)

ENVIRONMENT="${1:-}"
if [ -z "$ENVIRONMENT" ]; then
  echo "Usage: source infra/scripts/use-env.sh <environment>"
  return 1 2>/dev/null || exit 1
fi

export AWS_PROFILE="$ENVIRONMENT"

export AWS_REGION="${AWS_REGION:-eu-west-2}"
export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"

echo "Switched AWS context"
echo "AWS_PROFILE=$AWS_PROFILE"
echo "AWS_REGION=$AWS_REGION"
echo ""
echo "Next:"
echo "  bash infra/scripts/whoami.sh"
echo "  cd infra/env/$ENVIRONMENT"
echo "  bash ../../scripts/write-backend-hcl.sh $ENVIRONMENT --region $AWS_REGION"
echo "  terraform init -backend-config=backend.hcl"
