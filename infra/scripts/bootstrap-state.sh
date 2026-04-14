#!/usr/bin/env bash

# bootstrap-state.sh
# - Creates Terraform remote state prerequisites in the CURRENT AWS account:
#   - S3 bucket for state (versioning + encryption + public access block)
#   - DynamoDB table for state locking
# - Sets up GitHub Actions OIDC:
#   - IAM OIDC provider for token.actions.githubusercontent.com (idempotent)
#   - GitHub OIDC role that Actions assumes
# - Writes backend config to:
#   infra/env/<environment>/backend.hcl (via write-backend-hcl.sh)
#
# Usage (Git Bash, from repo root):
#   source infra/scripts/use-env.sh <environment>
#   bash infra/scripts/bootstrap-state.sh <environment> --region eu-west-2
#
# Notes:
# - This script creates resources in whichever AWS account your current auth points to.
# - Always check the printed Account + Caller ARN before continuing.

usage() {
  echo "Usage: bash infra/scripts/bootstrap-state.sh <environment> [--region eu-west-2] [--github-role-name GitHubOIDCTerraformRole] [--github-repo owner/repo] [--project-name template-terraform-boilerplate]"
  exit 1
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ENVIRONMENT="${1:-}"
shift || true
if [ -z "$ENVIRONMENT" ]; then
  usage
fi

REGION="${AWS_REGION:-eu-west-2}"
GITHUB_ROLE_NAME="GitHubOIDCTerraformRole"
GITHUB_REPO=""
PROJECT_NAME="template-terraform-boilerplate"

while [ "${1:-}" != "" ]; do
  case "$1" in
    --region)
      shift
      REGION="${1:-}"
      ;;
    --github-role-name)
      shift
      GITHUB_ROLE_NAME="${1:-}"
      ;;
    --github-repo)
      shift
      GITHUB_REPO="${1:-}"
      ;;
    --project-name)
      shift
      PROJECT_NAME="${1:-}"
      ;;
    *)
      echo "Unknown arg: $1"
      usage
      ;;
  esac
  shift || true
done

ENV_DIR="$ROOT_DIR/env/$ENVIRONMENT"
if [ ! -d "$ENV_DIR" ]; then
  echo "Environment folder not found: $ENV_DIR"
  echo "Create it under infra/env/ and try again."
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "AWS CLI is required."
  echo "Run: bash infra/scripts/prereqs.sh"
  exit 1
fi

ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"
CALLER_ARN="$(aws sts get-caller-identity --query Arn --output text 2>/dev/null || true)"

if [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "None" ] || [ -z "$CALLER_ARN" ] || [ "$CALLER_ARN" = "None" ]; then
  echo "Could not determine AWS account/principal. Are you authenticated?"
  echo "Tip: set AWS_PROFILE and run: aws sts get-caller-identity"
  exit 1
fi

# Detect owner/repo from git remote if not provided
if [ -z "$GITHUB_REPO" ] && command -v git >/dev/null 2>&1; then
  ORIGIN_URL="$(git config --get remote.origin.url 2>/dev/null || true)"
  if echo "$ORIGIN_URL" | grep -q "github.com"; then
    GITHUB_REPO="$(echo "$ORIGIN_URL" | sed -E 's#^(git@github\.com:|https://github\.com/)##; s#\.git$##')"
  fi
fi

if [ -z "$GITHUB_REPO" ]; then
  echo "Could not auto-detect the GitHub repo."
  echo "Fix: re-run with --github-repo owner/repo"
  exit 1
fi

STATE_BUCKET="${PROJECT_NAME}-${ACCOUNT_ID}-${REGION}"
LOCK_TABLE="${PROJECT_NAME}-${ACCOUNT_ID}-${REGION}-tflocks"
STATE_PREFIX="terraform-states"
STATE_KEY="${STATE_PREFIX}/${ENVIRONMENT}/terraform.tfstate"

OIDC_URL="https://token.actions.githubusercontent.com"
OIDC_PROVIDER_ARN="arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

echo ""
echo "Bootstrap (remote state + GitHub OIDC)"
echo "Environment:   $ENVIRONMENT"
echo "Account:       $ACCOUNT_ID"
echo "Region:        $REGION"
echo "Caller ARN:    $CALLER_ARN"
echo "GitHub repo:   $GITHUB_REPO"
echo "State bucket:  $STATE_BUCKET"
echo "State prefix:  $STATE_PREFIX"
echo "State key:     $STATE_KEY"
echo "Lock table:    $LOCK_TABLE"
echo "GitHub role:   $GITHUB_ROLE_NAME"
echo ""

echo "→ Ensuring S3 bucket exists..."
if aws s3api head-bucket --bucket "$STATE_BUCKET" >/dev/null 2>&1; then
  echo "  - Bucket exists: $STATE_BUCKET"
else
  if [ "$REGION" = "us-east-1" ]; then
    aws s3api create-bucket --bucket "$STATE_BUCKET" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "$STATE_BUCKET" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
  echo "  - Bucket created: $STATE_BUCKET"
fi

echo "→ Configuring bucket (versioning, encryption, public access block)..."
aws s3api put-bucket-versioning \
  --bucket "$STATE_BUCKET" \
  --versioning-configuration Status=Enabled >/dev/null

aws s3api put-bucket-encryption \
  --bucket "$STATE_BUCKET" \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
  }' >/dev/null

aws s3api put-public-access-block \
  --bucket "$STATE_BUCKET" \
  --public-access-block-configuration '{
    "BlockPublicAcls":true,
    "IgnorePublicAcls":true,
    "BlockPublicPolicy":true,
    "RestrictPublicBuckets":true
  }' >/dev/null

echo "  - Bucket configured"

echo "→ Ensuring terraform state prefix exists..."
aws s3api put-object \
  --bucket "$STATE_BUCKET" \
  --key "${STATE_PREFIX}/" >/dev/null

echo "  - State prefix ensured: s3://${STATE_BUCKET}/${STATE_PREFIX}/"

echo ""
echo "→ Ensuring DynamoDB lock table exists..."
if aws dynamodb describe-table --table-name "$LOCK_TABLE" >/dev/null 2>&1; then
  echo "  - Table exists: $LOCK_TABLE"
else
  aws dynamodb create-table \
    --table-name "$LOCK_TABLE" \
    --attribute-definitions AttributeName=LockID,AttributeType=S \
    --key-schema AttributeName=LockID,KeyType=HASH \
    --billing-mode PAY_PER_REQUEST >/dev/null

  echo "  - Table created: $LOCK_TABLE"
  echo "  - Waiting for table to become ACTIVE..."
  aws dynamodb wait table-exists --table-name "$LOCK_TABLE"
fi

echo ""
echo "→ Ensuring GitHub OIDC provider exists..."
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" >/dev/null 2>&1; then
  echo "  - OIDC provider exists"
else
  THUMBPRINT="6938fd4d98bab03faadb97b34396831e3780aea1"
  aws iam create-open-id-connect-provider \
    --url "$OIDC_URL" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "$THUMBPRINT" >/dev/null
  echo "  - OIDC provider created"
fi

echo "→ Ensuring GitHub OIDC role exists..."
if aws iam get-role --role-name "$GITHUB_ROLE_NAME" >/dev/null 2>&1; then
  echo "  - Role exists: $GITHUB_ROLE_NAME"
else
  GITHUB_TRUST_POLICY="$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowGitHubActionsOIDC",
      "Effect": "Allow",
      "Principal": { "Federated": "${OIDC_PROVIDER_ARN}" },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
        }
      }
    }
  ]
}
EOF
)"
  aws iam create-role \
    --role-name "$GITHUB_ROLE_NAME" \
    --assume-role-policy-document "$GITHUB_TRUST_POLICY" >/dev/null
  echo "  - Role created: $GITHUB_ROLE_NAME"
fi

GITHUB_ROLE_ARN="$(aws iam get-role --role-name "$GITHUB_ROLE_NAME" --query 'Role.Arn' --output text 2>/dev/null || true)"
if [ -z "$GITHUB_ROLE_ARN" ] || [ "$GITHUB_ROLE_ARN" = "None" ]; then
  echo "Could not resolve GitHub role ARN for: $GITHUB_ROLE_NAME"
  exit 1
fi

echo "→ Ensuring GitHub role has permissions (AdministratorAccess)..."
aws iam attach-role-policy \
  --role-name "$GITHUB_ROLE_NAME" \
  --policy-arn "arn:aws:iam::aws:policy/AdministratorAccess" >/dev/null || true

echo ""
echo "→ Writing backend.hcl for $ENVIRONMENT..."
bash "$ROOT_DIR/scripts/write-backend-hcl.sh" "$ENVIRONMENT" --region "$REGION" --project-name "$PROJECT_NAME"

echo ""
echo "Bootstrap complete"
echo ""
echo "Next (local):"
echo "  source infra/scripts/use-env.sh $ENVIRONMENT"
echo "  bash infra/scripts/whoami.sh"
echo "  cd infra/env/$ENVIRONMENT"
echo "  terraform init -backend-config=backend.hcl"
echo ""
echo "Next (GitHub):"
echo "  Create GitHub Environment named: $ENVIRONMENT"
echo "  Add Environment secret AWS_ROLE_ARN = $GITHUB_ROLE_ARN"
echo ""