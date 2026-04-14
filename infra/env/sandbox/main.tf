module "demo_bucket" {
  source = "../../modules/s3"

  bucket_name        = "${var.project}-${var.environment}-${data.aws_caller_identity.current.account_id}-demo-bucket"
  versioning_enabled = false

  project = var.project
  environment = var.environment
}
