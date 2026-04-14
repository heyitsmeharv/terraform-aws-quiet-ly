# template-terraform-boilerplate
Reusable Terraform boilerplate repo: a clean starter structure for modules, multi environments, and CI-ready workflow.

---

## What this repo is

This repository is a practical Terraform starter designed to be:

- easy to navigate as it grows
- safe to run locally (repeatable scripts)
- ready for CI (validate + plan on PRs, controlled applies)

This repo does **not** enforce naming conventions. Any names you see are examples of shape and workflow.

You will need to replace any boilerplate naming conventions used (Search for PROJECT_NAME)

---

## What this repo contains

- **Environment roots** under `infra/env/` (one folder per environment / AWS account)
- **Reusable modules** under `infra/modules/` (inputs in, outputs out)
- A consistent local workflow via `infra/scripts/`:
  - `fmt → validate (includes tflint) → plan → apply`
- A GitHub Actions workflow that:
  - runs **validate + plan** on pull requests
  - runs **apply** manually via `workflow_dispatch`
  - supports approvals via GitHub Environments for sensitive environments

---

## Git Bash only

This repo assumes you run everything in **Git Bash** so we don’t need to accommodate CMD or Linux differences.

---

## Local setup + end-to-end test (all commands)

Run everything below in **Git Bash** from the repo root:

```bash
# verify prerequisites in THIS Git Bash shell
bash infra/scripts/prereqs.sh

# switch AWS context (AWS_PROFILE is set to match the environment and must exist under infra/env/)
export ENVIRONMENT="<aws-account>"
source infra/scripts/use-env.sh "$ENVIRONMENT"

# confirm which AWS account/role you are about to use
bash infra/scripts/whoami.sh

# bootstrap remote state + execution role in the CURRENT AWS account
# creates: S3 state bucket, DynamoDB lock table, OIDC Github Role
# generates: infra/backend.hcl
bash infra/scripts/bootstrap-state.sh "$ENVIRONMENT" --region eu-west-2

# initialise Terraform for the environment using the generated backend config
cd "infra/env/$ENVIRONMENT"
terraform init -backend-config=backend.hcl

# CD BACK TO THE ROOT TO RUN THE BELOW SCRIPTS

# validate (fmt check + validate + tflint)
bash infra/scripts/validate.sh "$ENVIRONMENT"

# plan (creates a saved tfplan file)
bash infra/scripts/plan.sh "$ENVIRONMENT"
test -f "infra/env/$ENVIRONMENT/tfplan" && echo "tfplan created" || (echo "tfplan missing" && exit 1)

# apply (applies the saved tfplan file)
bash infra/scripts/apply.sh "$ENVIRONMENT"
