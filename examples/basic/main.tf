terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

module "analytics" {
  source = "../../"

  table_name            = var.table_name
  allowed_origin        = var.allowed_origin
  log_retention_days    = var.log_retention_days
  enable_cloudfront     = var.enable_cloudfront
  enable_query_endpoint = var.enable_query_endpoint
  tags                  = var.tags
}

output "analytics_endpoint" {
  description = "Analytics endpoint URL — pass this to the SDK config."
  value       = module.analytics.endpoint_url
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name."
  value       = module.analytics.cloudfront_domain_name
}

output "table_name" {
  description = "DynamoDB table name."
  value       = module.analytics.table_name
}
