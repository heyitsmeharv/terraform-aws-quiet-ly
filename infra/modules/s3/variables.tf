variable "bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name."
}

variable "versioning_enabled" {
  type        = bool
  description = "Enable versioning on the bucket."
  default     = true
}

variable "project" {
  type        = string
  description = "Project name (used for tagging/naming)."
}

variable "environment" {
  type        = string
  description = "Environment name (used for tagging/naming)."
}
