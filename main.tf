data "archive_file" "lambda" {
  type        = "zip"
  source_file = "${path.module}/lambda/dist/index.js"
  output_path = "${path.module}/lambda/handler.zip"
}

# ─── DynamoDB ─────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "events" {
  name         = var.table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "PK"
  range_key    = "SK"

  attribute {
    name = "PK"
    type = "S"
  }

  attribute {
    name = "SK"
    type = "S"
  }

  # GSI1 — queries by event type + date (TYPE#<type>#<date>)
  attribute {
    name = "GSI1PK"
    type = "S"
  }

  # GSI2 — queries by page path + date (PATH#<path>#<date>)
  attribute {
    name = "GSI2PK"
    type = "S"
  }

  global_secondary_index {
    name            = "GSI1"
    hash_key        = "GSI1PK"
    range_key       = "SK"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "GSI2"
    hash_key        = "GSI2PK"
    range_key       = "SK"
    projection_type = "ALL"
  }

  tags = var.tags
}

# ─── CloudWatch Logs ──────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.table_name}-handler"
  retention_in_days = var.log_retention_days
  tags              = var.tags
}

# ─── IAM ──────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${var.table_name}-lambda-role"
  assume_role_policy = data.aws_iam_policy_document.assume_role.json
  tags               = var.tags
}

data "aws_iam_policy_document" "lambda_permissions" {
  statement {
    sid     = "DynamoDB"
    actions = ["dynamodb:PutItem", "dynamodb:Query"]
    resources = [
      aws_dynamodb_table.events.arn,
      "${aws_dynamodb_table.events.arn}/index/*",
    ]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.lambda.arn}:*"]
  }
}

resource "aws_iam_role_policy" "lambda" {
  name   = "${var.table_name}-lambda-policy"
  role   = aws_iam_role.lambda.id
  policy = data.aws_iam_policy_document.lambda_permissions.json
}

# ─── Lambda ───────────────────────────────────────────────────────────────────

resource "aws_lambda_function" "handler" {
  function_name    = "${var.table_name}-handler"
  role             = aws_iam_role.lambda.arn
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  handler          = "index.handler"
  runtime          = "nodejs22.x"

  environment {
    variables = {
      TABLE_NAME     = aws_dynamodb_table.events.name
      ENABLE_QUERY   = tostring(var.enable_query_endpoint)
      ALLOWED_ORIGIN = var.allowed_origin
    }
  }

  tags = var.tags

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# ─── Function URL ─────────────────────────────────────────────────────────────

resource "aws_lambda_function_url" "handler" {
  function_name      = aws_lambda_function.handler.function_name
  authorization_type = "NONE"
}

resource "aws_lambda_permission" "public_function_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.handler.function_name
  principal              = "*"
  function_url_auth_type = "NONE"

  depends_on = [aws_lambda_function_url.handler]
}

resource "aws_lambda_permission" "public_function_url_invoke" {
  statement_id             = "AllowPublicFunctionUrlInvoke"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.handler.function_name
  principal                = "*"
  invoked_via_function_url = true

  depends_on = [aws_lambda_function_url.handler]
}

# ─── CloudFront ───────────────────────────────────────────────────────────────

resource "aws_cloudfront_distribution" "analytics" {
  count = var.enable_cloudfront ? 1 : 0

  origin {
    # Strip the https:// scheme and trailing slash from the Function URL.
    domain_name = trimsuffix(trimprefix(aws_lambda_function_url.handler.function_url, "https://"), "/")
    origin_id   = "lambda"

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  enabled         = true
  is_ipv6_enabled = true
  comment         = "${var.table_name} analytics"

  default_cache_behavior {
    allowed_methods        = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods         = ["GET", "HEAD"]
    target_origin_id       = "lambda"
    viewer_protocol_policy = "redirect-to-https"
    compress               = true

    # CachingDisabled — analytics data must never be served stale.
    cache_policy_id = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad"

    # AllViewerExceptHostHeader — forwards query strings, all request headers
    # (including Origin for CORS and CloudFront-Viewer-Country for enrichment),
    # and the request body to the Lambda origin.
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = var.tags
}
