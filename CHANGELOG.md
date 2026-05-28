# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.1.9](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.8...v0.1.9) (2026-05-28)


### Features

* return visitor events chronologically when visitorId is queried ([51605d7](https://github.com/heyitsmeharv/quiet-ly-infra/commit/51605d7fd1c4789c13605dc3035c16190e8abb32))

## [0.1.8](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.7...v0.1.8) (2026-05-28)


### Features

* feat: funnel query endpoint, visitorId scoping, and build cleanup ([248b970](https://github.com/heyitsmeharv/quiet-ly-infra/commit/248b970359796d1bb5206f7ea0121f1d858fd38a))

## [0.1.7](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.6...v0.1.7) (2026-05-27)


### Bug Fixes

* deploy latest lambda changes ([8010de5](https://github.com/heyitsmeharv/quiet-ly-infra/commit/8010de518aa542a0124a08227374ced47188133e))

## [0.1.6](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.5...v0.1.6) (2026-05-27)


### Features

* refine aggregation endpoint summary shape ([dd70ada](https://github.com/heyitsmeharv/quiet-ly-infra/commit/dd70adabea580b624b84dc5b0c803deb1593e1d5))

## [0.1.5](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.4...v0.1.5) (2026-05-27)


### Features

* add device/browser enrichment, bot filtering, and aggregation ([b39a818](https://github.com/heyitsmeharv/quiet-ly-infra/commit/b39a818b0608ccd64ec77fda1a40d51f8a1f9ac1))

## [0.1.4](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.3...v0.1.4) (2026-05-19)


### Bug Fixes

* add lambda timeout to prevent 502 on large date range queries ([de50e4f](https://github.com/heyitsmeharv/quiet-ly-infra/commit/de50e4f3f827a4477cb103ef508293ff93c9abee))

## [0.1.3](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.2...v0.1.3) (2026-04-15)


### Bug Fixes

* handle CORS in Lambda responses instead of Function URL config ([81d5bd5](https://github.com/heyitsmeharv/quiet-ly-infra/commit/81d5bd5a9b3f9ae83cad259e773c938d8d225993))

## [0.1.2](https://github.com/heyitsmeharv/quiet-ly-infra/compare/v0.1.1...v0.1.2) (2026-04-15)


### Bug Fixes

* add the missing public lambda function url permissions ([df6faf0](https://github.com/heyitsmeharv/quiet-ly-infra/commit/df6faf0594b69520f827a91801f9b349714a304a))

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
