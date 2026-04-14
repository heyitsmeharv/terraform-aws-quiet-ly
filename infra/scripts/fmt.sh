#!/usr/bin/env bash

# fmt.sh
# - Formats Terraform code under infra/ recursively.
# - This modifies files (not a check-only).
#
# Usage:
#   bash infra/scripts/fmt.sh

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

terraform fmt -recursive
echo "fmt complete"
