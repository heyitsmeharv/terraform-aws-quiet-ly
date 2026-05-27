import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { createHandler, parseUserAgent, isBot } from "./index.mjs";


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

// ─── UA parsing ───────────────────────────────────────────────────────────────

describe("parseUserAgent", () => {
  it("identifies desktop Chrome", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
    assert.deepEqual(parseUserAgent(ua), { device: "desktop", browser: "Chrome" });
  });

  it("identifies desktop Firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0";
    assert.deepEqual(parseUserAgent(ua), { device: "desktop", browser: "Firefox" });
  });

  it("identifies desktop Safari", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
    assert.deepEqual(parseUserAgent(ua), { device: "desktop", browser: "Safari" });
  });

  it("identifies desktop Edge", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0";
    assert.deepEqual(parseUserAgent(ua), { device: "desktop", browser: "Edge" });
  });

  it("identifies mobile Chrome on Android", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36";
    assert.deepEqual(parseUserAgent(ua), { device: "mobile", browser: "Chrome" });
  });

  it("identifies mobile Safari on iPhone", () => {
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    assert.deepEqual(parseUserAgent(ua), { device: "mobile", browser: "Safari" });
  });

  it("identifies tablet (iPad)", () => {
    const ua = "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    assert.deepEqual(parseUserAgent(ua), { device: "tablet", browser: "Safari" });
  });

  it("identifies Samsung Browser (not Chrome, despite Chrome in UA)", () => {
    const ua = "Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36";
    assert.deepEqual(parseUserAgent(ua), { device: "mobile", browser: "Samsung" });
  });

  it("identifies Opera (not Chrome, despite Chrome in UA)", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 OPR/110.0.0.0";
    assert.deepEqual(parseUserAgent(ua), { device: "desktop", browser: "Opera" });
  });

  it("returns desktop/Other for an empty string", () => {
    assert.deepEqual(parseUserAgent(""), { device: "desktop", browser: "Other" });
  });
});

describe("POST / — device & browser enrichment", () => {
  beforeEach(() => mockSend.mock.resetCalls());

  it("stores device and browser parsed from the user-agent header", async () => {
    await handler(event({
      body: validPayload,
      headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    }));
    const item = mockSend.mock.calls[0].arguments[0].input.Item;
    assert.deepEqual(item.device,  { S: "desktop" });
    assert.deepEqual(item.browser, { S: "Chrome" });
  });

  it("stores desktop/Other when user-agent header is absent", async () => {
    await handler(event({ body: validPayload }));
    const item = mockSend.mock.calls[0].arguments[0].input.Item;
    assert.deepEqual(item.device,  { S: "desktop" });
    assert.deepEqual(item.browser, { S: "Other" });
  });
});

// ─── Bot filtering ───────────────────────────────────────────────────────────

describe("isBot", () => {
  it("detects Googlebot", () => {
    assert.equal(isBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"), true);
  });

  it("detects Bingbot", () => {
    assert.equal(isBot("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"), true);
  });

  it("detects headless Chrome", () => {
    assert.equal(isBot("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/124.0.0.0 Safari/537.36"), true);
  });

  it("detects curl", () => {
    assert.equal(isBot("curl/8.7.1"), true);
  });

  it("detects wget", () => {
    assert.equal(isBot("Wget/1.21.4"), true);
  });

  it("does not flag a real Chrome UA", () => {
    assert.equal(isBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36"), false);
  });

  it("does not flag WhatsApp in-app browser", () => {
    assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) WhatsApp/24.8 Mobile/15E148 Safari/604.1"), false);
  });

  it("does not flag Pinterest app", () => {
    assert.equal(isBot("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Pinterest/12.0 Mobile/15E148 Safari/604.1"), false);
  });

  it("does not flag an empty string", () => {
    assert.equal(isBot(""), false);
  });
});

describe("POST / — bot filtering", () => {
  beforeEach(() => mockSend.mock.resetCalls());

  it("returns 200 but does not write to DynamoDB for a bot", async () => {
    const res = await handler(event({
      body: validPayload,
      headers: { "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" },
    }));
    assert.equal(res.statusCode, 200);
    assert.equal(mockSend.mock.calls.length, 0);
  });

  it("writes to DynamoDB for a real user-agent", async () => {
    await handler(event({
      body: validPayload,
      headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36" },
    }));
    assert.equal(mockSend.mock.calls.length, 1);
  });
});

// ─── Aggregation endpoint ─────────────────────────────────────────────────────

describe("GET / — aggregate=true", () => {
  beforeEach(() => mockSend.mock.resetCalls());

  it("returns a summary object instead of raw events", async () => {
    mockSend.mock.mockImplementationOnce(async () => ({
      Items: [
        { PK: { S: "x" }, SK: { S: "y" }, appId: { S: "a" }, type: { S: "page_view" }, path: { S: "/home" }, referrer: { S: "" }, country: { S: "US" }, device: { S: "desktop" }, browser: { S: "Chrome" }, visitorId: { S: "v1" }, sessionId: { S: "s1" }, userId: { S: "" }, timestamp: { S: "2026-04-14T10:00:00.000Z" }, timezone: { S: "" }, locale: { S: "" }, params: { S: "{}" } },
        { PK: { S: "x" }, SK: { S: "z" }, appId: { S: "a" }, type: { S: "page_view" }, path: { S: "/about" }, referrer: { S: "https://google.com" }, country: { S: "GB" }, device: { S: "mobile" }, browser: { S: "Safari" }, visitorId: { S: "v2" }, sessionId: { S: "s2" }, userId: { S: "" }, timestamp: { S: "2026-04-14T11:00:00.000Z" }, timezone: { S: "" }, locale: { S: "" }, params: { S: "{}" } },
        { PK: { S: "x" }, SK: { S: "w" }, appId: { S: "a" }, type: { S: "custom_event" }, path: { S: "/home" }, referrer: { S: "" }, country: { S: "US" }, device: { S: "desktop" }, browser: { S: "Chrome" }, visitorId: { S: "v1" }, sessionId: { S: "s1" }, userId: { S: "" }, timestamp: { S: "2026-04-14T12:00:00.000Z" }, timezone: { S: "" }, locale: { S: "" }, params: { S: "{}" } },
      ],
    }));

    const res = await handler(event({
      method: "GET",
      qs: { appId: "test-app", from: "2026-04-14", to: "2026-04-14", aggregate: "true" },
    }));

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    const s = body.summary;
    assert.ok(s, "response should have a summary key");
    assert.ok(!body.events, "raw events should not be present");

    assert.equal(s.totalEvents, 3);
    assert.equal(s.pageViews, 2);
    assert.equal(s.uniqueVisitors, 2);

    // dailyCounts — page views only, sorted by date, field name is "views"
    assert.deepEqual(s.dailyCounts, [{ date: "2026-04-14", views: 2 }]);

    // recentEvents — all events, most recent first
    assert.equal(s.recentEvents.length, 3);
    assert.equal(s.recentEvents[0].timestamp, "2026-04-14T12:00:00.000Z");

    // topLocations uses "location" field and country takes priority
    assert.equal(s.topLocations[0].location, "US");

    // countryCounts is an uncapped object keyed by ISO code (for WorldMap)
    assert.deepEqual(s.countryCounts, { US: 1, GB: 1 });

    // top breakdowns
    // device/browser breakdowns are also page-views-only for consistency
    assert.equal(s.topDevices[0].device, "desktop");
    assert.equal(s.topBrowsers[0].browser, "Chrome");
  });

  it("dailyCounts spans multiple days in correct order", async () => {
    mockSend.mock.mockImplementationOnce(async () => ({
      Items: [
        { PK: { S: "x" }, SK: { S: "a" }, appId: { S: "a" }, type: { S: "page_view" }, path: { S: "/" }, referrer: { S: "" }, country: { S: "" }, device: { S: "desktop" }, browser: { S: "Chrome" }, visitorId: { S: "v1" }, sessionId: { S: "s1" }, userId: { S: "" }, timestamp: { S: "2026-04-15T08:00:00.000Z" }, timezone: { S: "" }, locale: { S: "" }, params: { S: "{}" } },
        { PK: { S: "x" }, SK: { S: "b" }, appId: { S: "a" }, type: { S: "page_view" }, path: { S: "/" }, referrer: { S: "" }, country: { S: "" }, device: { S: "desktop" }, browser: { S: "Chrome" }, visitorId: { S: "v2" }, sessionId: { S: "s2" }, userId: { S: "" }, timestamp: { S: "2026-04-14T09:00:00.000Z" }, timezone: { S: "" }, locale: { S: "" }, params: { S: "{}" } },
      ],
    }));

    const res = await handler(event({
      method: "GET",
      qs: { appId: "test-app", from: "2026-04-14", to: "2026-04-15", aggregate: "true" },
    }));

    const { summary } = JSON.parse(res.body);
    assert.deepEqual(summary.dailyCounts, [
      { date: "2026-04-14", views: 1 },
      { date: "2026-04-15", views: 1 },
    ]);
  });

  it("returns raw events when aggregate param is absent", async () => {
    const res = await handler(event({
      method: "GET",
      qs: { appId: "test-app", from: "2026-04-14", to: "2026-04-14" },
    }));
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(JSON.parse(res.body).events));
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
