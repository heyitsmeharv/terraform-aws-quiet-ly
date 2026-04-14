# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## Unreleased

### Features

* CloudFront distribution provisioned automatically by default (`enable_cloudfront = true`). Enables country enrichment via `CloudFront-Viewer-Country`, HTTPS redirect, and IPv6 without additional configuration. Set `enable_cloudfront = false` to revert to a direct Lambda Function URL.
* Country enrichment now reads the `CloudFront-Viewer-Country` header when requests pass through CloudFront
* Removed bundled GeoIP database packaging and Lambda layer configuration from the module

## [0.1.0](https://github.com/heyitsmeharv/terraform-aws-quiet-ly/releases/tag/v0.1.0) (2026-04-14)

### Features

* Lambda Function URL with CORS — no API Gateway needed
* DynamoDB single-table design with two GSIs (by event type and page path)
* Ingest (`POST /`) and query (`GET /`) endpoints in one handler
* Configurable log retention, table name, and query endpoint toggle
* `examples/basic` showing all inputs and outputs
