#!/usr/bin/env bash

# whoami.sh
# - Prints the current AWS identity (account + principal ARN).
# - Safety check before running plan/apply.
#
# Usage:
#   bash infra/scripts/whoami.sh

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required for this script."
  echo "Run: bash infra/scripts/prereqs.sh"
  exit 1
fi

if command -v jq >/dev/null 2>&1; then
  aws sts get-caller-identity | jq
else
  aws sts get-caller-identity
fi
