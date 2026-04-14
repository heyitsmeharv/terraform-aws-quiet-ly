variable "project" {
  type        = string
  description = "Project name used for naming and tagging."
}

variable "environment" {
  type        = string
  description = "Environment name (matches folder under infra/env/)."
}

variable "aws_region" {
  type        = string
  description = "AWS region to deploy into."
  default     = "eu-west-2"
}