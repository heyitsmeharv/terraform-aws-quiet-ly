output "demo_bucket_name" {
  description = "The name of the demo S3 bucket."
  value       = module.demo_bucket.bucket_name
}

output "demo_bucket_arn" {
  description = "The ARN of the demo S3 bucket."
  value       = module.demo_bucket.bucket_arn
}