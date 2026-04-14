variable "table_name" {
  type        = string
  description = "DynamoDB table name."
  default     = "quiet-ly-events"
}

variable "allowed_origin" {
  type        = string
  description = "CORS allowed origin for the Lambda Function URL (e.g. https://yourportfolio.com). Use * to allow all origins."
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention period in days."
  default     = 30
}

variable "enable_query_endpoint" {
  type        = bool
  description = "Expose GET endpoint for dashboard queries. Set to false for ingest-only deployments."
  default     = true
}

variable "enable_cloudfront" {
  type        = bool
  description = "Provision a CloudFront distribution in front of the Lambda Function URL. Enables HTTPS redirect, IPv6, and country enrichment via CloudFront-Viewer-Country. Set to false to expose the Lambda Function URL directly."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to all created AWS resources."
  default     = {}
}
