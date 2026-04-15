# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## 0.1.1 (2026-04-15)


### Features

* initial release of terraform-aws-quiet-ly ([45a1781](https://github.com/heyitsmeharv/quiet-ly-infra/commit/45a17814aa84881cf2f96aaf573d8a9f211e4b70))

## [0.1.0](https://github.com/heyitsmeharv/terraform-aws-quiet-ly/releases/tag/v0.1.0) (2026-04-14)

### Features

* Lambda Function URL with CORS — no API Gateway needed
* DynamoDB single-table design with two GSIs (by event type and page path)
* Ingest (`POST /`) and query (`GET /`) endpoints in one handler
* Configurable log retention, table name, and query endpoint toggle
* `examples/basic` showing all inputs and outputs
