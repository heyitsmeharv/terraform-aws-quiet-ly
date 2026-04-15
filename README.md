# terraform-aws-quiet-ly

Terraform module that provisions the AWS backend for [`@quiet-ly/analytics`](https://github.com/heyitsmeharv/quiet-ly).

A Lambda Function URL and DynamoDB table wired together as a self-hosted, privacy-first analytics collector. No cookies. No third-party data sharing. Everything stays in your own AWS account.

> **quiet-ly** - track what matters, without making any noise.

---

## Overview

This module creates:

- a CloudFront distribution as the public HTTPS entry point (enables country enrichment, IPv6, and HTTPS redirect by default)
- a Lambda Function URL behind CloudFront for ingest and dashboard queries
- a DynamoDB table using a single-table design with two GSIs
- an IAM execution role scoped to the minimum required permissions
- a CloudWatch log group with configurable retention

No API Gateway. Lambda Function URLs provide a free HTTPS endpoint with built-in CORS and scale to zero when idle. At portfolio traffic levels the entire stack runs within the AWS free tier (~$0/month).

---

## Architecture

```
Browser
  └── @quiet-ly/analytics (SDK)
        │
        │  POST /   (ingest event)
        │  GET  /   (dashboard query)
        ▼
  CloudFront Distribution
  (HTTPS redirect, IPv6, country header injection)
        │
        ▼
  AWS Lambda Function URL
        │
        ├── PutItem  ──▶  DynamoDB  ◀──  Query
        │                (events table)
        │
        └── CloudWatch Logs
```

---

## Quick Start

```hcl
module "analytics" {
  source  = "heyitsmeharv/quiet-ly/aws"
  version = "~> 0.1"

  table_name     = "my-portfolio-events"
  allowed_origin = "https://yourportfolio.com"
}

output "analytics_endpoint" {
  value = module.analytics.endpoint_url
}
```

```bash
terraform init
terraform apply
# Outputs: analytics_endpoint = "https://xxxx.lambda-url.eu-west-2.on.aws/"
```

Pass the endpoint to the SDK:

```ts
import { Analytics } from '@quiet-ly/analytics'

const analytics = new Analytics({
  endpoint: 'https://xxxx.lambda-url.eu-west-2.on.aws',
  appId: 'my-portfolio',
})

analytics.pageview()
analytics.track('contact_submitted', { form: 'contact' })
```

---

## Requirements

| Name | Version |
|------|---------|
| Terraform | >= 1.6.0 |
| AWS provider | ~> 6.28 |
| Node.js | >= 22 (module development only - not required to use the module) |

The AWS credentials used to run `terraform apply` require:

```
dynamodb:CreateTable
dynamodb:DescribeTable
lambda:CreateFunction
lambda:UpdateFunctionCode
lambda:CreateFunctionUrlConfig
lambda:AddPermission
lambda:RemovePermission
iam:CreateRole
iam:PutRolePolicy
logs:CreateLogGroup
logs:PutRetentionPolicy
```

---

## Inputs

| Name | Type | Default | Required | Description |
|------|------|---------|:--------:|-------------|
| `allowed_origin` | `string` | - | yes | CORS allowed origin for the Lambda Function URL (e.g. `https://yourportfolio.com`). Use `*` to allow all origins. |
| `table_name` | `string` | `"quiet-ly-events"` | no | DynamoDB table name. |
| `log_retention_days` | `number` | `30` | no | CloudWatch log retention period in days. |
| `enable_cloudfront` | `bool` | `true` | no | Provision a CloudFront distribution in front of the Lambda Function URL. Enables HTTPS redirect, IPv6, and country enrichment. Set to `false` to expose the Lambda Function URL directly. |
| `enable_query_endpoint` | `bool` | `true` | no | Expose the GET query endpoint for dashboard use. Set to `false` for ingest-only deployments. |
| `tags` | `map(string)` | `{}` | no | Tags applied to all created AWS resources. |

---

## Outputs

| Name | Description |
|------|-------------|
| `endpoint_url` | Analytics endpoint URL - pass this to the SDK `endpoint` config option. Returns the CloudFront URL when `enable_cloudfront` is `true`, otherwise the Lambda Function URL. |
| `cloudfront_domain_name` | CloudFront distribution domain name. `null` when `enable_cloudfront` is `false`. |
| `table_name` | DynamoDB table name. |
| `table_arn` | DynamoDB table ARN - useful for attaching additional IAM grants. |

---

## Resources

| Resource | Purpose |
|----------|---------|
| `aws_cloudfront_distribution` | Public HTTPS entry point. Injects `CloudFront-Viewer-Country`, enforces HTTPS, and enables IPv6. Created when `enable_cloudfront` is `true`. |
| `aws_dynamodb_table` | Stores all events using a single-table design with two GSIs. |
| `aws_lambda_function` | Handles ingest (`POST`) and query (`GET`) requests. |
| `aws_lambda_permission` | Grants public invoke access required for a `NONE` auth Lambda Function URL. |
| `aws_iam_role` | Lambda execution role. |
| `aws_iam_role_policy` | `dynamodb:PutItem` + `dynamodb:Query` scoped to the events table. |
| `aws_lambda_function_url` | HTTPS endpoint with CORS - sits behind CloudFront when enabled. |
| `aws_cloudwatch_log_group` | Lambda logs with configurable retention. |

---

## Backend Contract

The module exposes a single Lambda Function URL root. The `@quiet-ly/analytics` SDK and dashboard are designed to work against this contract directly.

### Ingest

Called by the SDK on every `pageview()` and `track()`:

```
POST <endpoint>
Content-Type: application/json
```

```ts
{
  appId:     string        // required
  type:      string        // required
  timestamp: string        // required - ISO 8601
  path:      string
  referrer:  string
  sessionId: string
  visitorId: string
  userId:    string
  timezone:  string
  locale:    string
  params:    Record<string, unknown>
}
```

Returns `{ ok: true }` on success. Returns `400` when `appId`, `type`, or `timestamp` are missing.

### Query

Called by the dashboard component:

```
GET <endpoint>?appId=my-portfolio&from=2026-04-01&to=2026-04-14
```

The `type` parameter is optional and filters by event type:

```
GET <endpoint>?appId=my-portfolio&from=2026-04-01&to=2026-04-14&type=page_view
```

Returns a top-level `{ events: [...] }` array. Date ranges are capped at 366 days. The query endpoint can be disabled with `enable_query_endpoint = false`.

---

## DynamoDB Design

Single-table design with three access patterns:

| Pattern | Key |
|---------|-----|
| All events for an app on a date | `PK: APP#<appId>#<date>` |
| Events filtered by type on a date | `GSI1PK: TYPE#<type>#<date>` |
| Events filtered by page on a date | `GSI2PK: PATH#<path>#<date>` |

---

## Country Enrichment

When `enable_cloudfront` is `true` (the default), CloudFront automatically injects the `CloudFront-Viewer-Country` header on every request. The Lambda handler reads this header and stores a two-letter ISO country code in the `country` field on each event.

When `enable_cloudfront` is `false`, requests reach the Lambda Function URL directly and the header is absent, so `country` is stored as an empty string.

The `@quiet-ly/analytics` dashboard prefers `country` for location display and falls back to `timezone` when country enrichment is unavailable.

## Troubleshooting

If the browser reports `CORS header 'Access-Control-Allow-Origin' missing` together with a `403` from the CloudFront endpoint, the usual cause is not CORS itself. A Lambda Function URL with `authorization_type = "NONE"` still needs resource-based invoke permissions. This module now creates those permissions explicitly, so re-running `terraform init -upgrade` and `terraform apply` fixes the CloudFront `403` and allows the Function URL CORS headers to flow back to the browser.

---

## License

MIT
