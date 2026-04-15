import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHandler } from "./index.mjs";


// ─── Mock client ──────────────────────────────────────────────────────────────

const mockSend = mock.fn(async () => ({ Items: [] }));
const mockClient = { send: mockSend };

process.env.TABLE_NAME = "test-table";
process.env.ENABLE_QUERY = "true";
process.env.ALLOWED_ORIGIN = "https://www.example.com";

const handler = createHandler(mockClient);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function event({ method = "POST", body, qs, headers } = {}) {
  return {
    requestContext: { http: { method } },
    body: body ? JSON.stringify(body) : undefined,
    headers: headers ?? {},
    queryStringParameters: qs ?? null,
  };
}

const validPayload = {
  appId: "test-app",
  type: "page_view",
  path: "/home",
  timestamp: "2026-04-14T10:00:00.000Z",
};

// ─── Ingest (POST) ────────────────────────────────────────────────────────────

describe("POST / — ingest", () => {
  beforeEach(() => mockSend.mock.resetCalls());

  it("returns 200 and calls DynamoDB for a valid payload", async () => {
    const res = await handler(event({ body: validPayload }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://www.example.com");
    assert.equal(mockSend.mock.calls.length, 1);
  });

  it("writes correct PK and GSI keys", async () => {
    await handler(event({ body: validPayload }));
    const item = mockSend.mock.calls[0].arguments[0].input.Item;
    assert.deepEqual(item.PK,     { S: "APP#test-app#2026-04-14" });
    assert.deepEqual(item.GSI1PK, { S: "TYPE#page_view#2026-04-14" });
    assert.deepEqual(item.GSI2PK, { S: "PATH#/home#2026-04-14" });
  });

  it("returns 400 when appId is missing", async () => {
    const res = await handler(event({ body: { type: "page_view", timestamp: "2026-04-14T10:00:00.000Z" } }));
    assert.equal(res.statusCode, 400);
    assert.equal(mockSend.mock.calls.length, 0);
  });

  it("returns 400 when type is missing", async () => {
    const res = await handler(event({ body: { appId: "test-app", timestamp: "2026-04-14T10:00:00.000Z" } }));
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when timestamp is missing", async () => {
    const res = await handler(event({ body: { appId: "test-app", type: "page_view" } }));
    assert.equal(res.statusCode, 400);
  });
});

// ─── Query (GET) ──────────────────────────────────────────────────────────────

describe("GET / — query", () => {
  beforeEach(() => mockSend.mock.resetCalls());

  it("returns 200 with an events array", async () => {
    const res = await handler(event({ method: "GET", qs: { appId: "test-app", from: "2026-04-01", to: "2026-04-03" } }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://www.example.com");
    assert.ok(Array.isArray(JSON.parse(res.body).events));
  });

  it("issues one DynamoDB query per day in the range", async () => {
    await handler(event({ method: "GET", qs: { appId: "test-app", from: "2026-04-01", to: "2026-04-03" } }));
    assert.equal(mockSend.mock.calls.length, 3);
  });

  it("queries the main table by default", async () => {
    await handler(event({ method: "GET", qs: { appId: "test-app", from: "2026-04-01", to: "2026-04-01" } }));
    const cmd = mockSend.mock.calls[0].arguments[0];
    assert.equal(cmd.input.IndexName, undefined);
    assert.match(cmd.input.KeyConditionExpression, /^PK/);
  });

  it("queries GSI1 when type param is provided", async () => {
    await handler(event({ method: "GET", qs: { appId: "test-app", from: "2026-04-01", to: "2026-04-01", type: "page_view" } }));
    const cmd = mockSend.mock.calls[0].arguments[0];
    assert.equal(cmd.input.IndexName, "GSI1");
  });

  it("returns 400 when appId is missing", async () => {
    const res = await handler(event({ method: "GET", qs: { from: "2026-04-01", to: "2026-04-03" } }));
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when from is missing", async () => {
    const res = await handler(event({ method: "GET", qs: { appId: "test-app", to: "2026-04-03" } }));
    assert.equal(res.statusCode, 400);
  });

  it("returns 400 when date range exceeds 366 days", async () => {
    const res = await handler(event({ method: "GET", qs: { appId: "test-app", from: "2025-01-01", to: "2026-04-14" } }));
    assert.equal(res.statusCode, 400);
    assert.equal(mockSend.mock.calls.length, 0);
  });
});

// ─── Country enrichment ───────────────────────────────────────────────────────

describe("POST / — country enrichment", () => {
  it("stores the country code from the CloudFront header", async () => {
    mockSend.mock.resetCalls();
    await handler(event({
      body: validPayload,
      headers: { "cloudfront-viewer-country": "gb" },
    }));
    const item = mockSend.mock.calls[0].arguments[0].input.Item;
    assert.deepEqual(item.country, { S: "GB" });
  });

  it("stores an empty string when the CloudFront header is missing", async () => {
    mockSend.mock.resetCalls();
    await handler(event({ body: validPayload }));
    const item = mockSend.mock.calls[0].arguments[0].input.Item;
    assert.deepEqual(item.country, { S: "" });
  });

  it("stores an empty string when the CloudFront header is invalid", async () => {
    mockSend.mock.resetCalls();
    await handler(event({
      body: validPayload,
      headers: { "cloudfront-viewer-country": "unknown" },
    }));
    const item = mockSend.mock.calls[0].arguments[0].input.Item;
    assert.deepEqual(item.country, { S: "" });
  });
});

// ─── Unknown method ───────────────────────────────────────────────────────────

describe("unknown method", () => {
  it("returns 404", async () => {
    const res = await handler(event({ method: "DELETE" }));
    assert.equal(res.statusCode, 404);
  });

  it("returns 204 for preflight requests", async () => {
    const res = await handler(event({ method: "OPTIONS" }));
    assert.equal(res.statusCode, 204);
    assert.equal(res.headers["Access-Control-Allow-Origin"], "https://www.example.com");
    assert.equal(res.headers["Access-Control-Allow-Methods"], "GET, POST, OPTIONS");
  });
});
