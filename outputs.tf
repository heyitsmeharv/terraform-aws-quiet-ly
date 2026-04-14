output "endpoint_url" {
  description = "Analytics endpoint URL — pass this to the SDK `endpoint` config option. Returns the CloudFront URL when enable_cloudfront is true, otherwise the Lambda Function URL."
  value       = var.enable_cloudfront ? "https://${aws_cloudfront_distribution.analytics[0].domain_name}" : aws_lambda_function_url.handler.function_url
}

output "cloudfront_domain_name" {
  description = "CloudFront distribution domain name. Null when enable_cloudfront is false."
  value       = var.enable_cloudfront ? aws_cloudfront_distribution.analytics[0].domain_name : null
}

output "table_name" {
  description = "DynamoDB table name."
  value       = aws_dynamodb_table.events.name
}

output "table_arn" {
  description = "DynamoDB table ARN — useful for adding extra IAM grants."
  value       = aws_dynamodb_table.events.arn
}
