variable "table_name" {
  type        = string
  description = "DynamoDB table name."
  default     = "quiet-ly-events"
}

variable "allowed_origin" {
  type        = string
  description = "CORS allowed origin (e.g. https://yourportfolio.com)."
}

variable "region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "eu-west-2"
}

variable "log_retention_days" {
  type        = number
  description = "CloudWatch log retention in days."
  default     = 30
}

variable "enable_cloudfront" {
  type        = bool
  description = "Provision a CloudFront distribution in front of the Lambda Function URL."
  default     = true
}

variable "enable_query_endpoint" {
  type        = bool
  description = "Expose GET endpoint for dashboard queries."
  default     = true
}

variable "tags" {
  type        = map(string)
  description = "Tags to apply to all created AWS resources."
  default     = {}
}
