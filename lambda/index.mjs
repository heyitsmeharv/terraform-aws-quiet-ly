import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

const BOT_RE = /bot|crawl|slurp|spider|mediapartners|googlebot|bingbot|yandex|baidu|duckduck|facebookexternalhit|twitterbot|rogerbot|linkedinbot|embedly|showyoubot|outbrain|pinterestbot|developers\.google\.com\/\+\/web\/snippet|www\.google\.com\/webmasters\/tools\/richsnippets|slackbot|vkshare|w3c_validator|redditbot|applebot|bitlybot|skypeuripreview|nuzzel|discordbot|google page speed|qwantify|bitrix link preview|xing-contenttabreceiver|chrome-lighthouse|telegrambot|headlesschrome|curl\/|wget\//i;

export function isBot(ua = "") {
  return BOT_RE.test(ua);
}

export function parseUserAgent(ua = "") {
  let device = "desktop";
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    device = "tablet";
  } else if (/mobile|iphone|ipod|android.*mobile|blackberry|windows phone/i.test(ua)) {
    device = "mobile";
  }

  let browser = "Other";
  if      (/edg\//i.test(ua))          browser = "Edge";
  else if (/samsungbrowser/i.test(ua)) browser = "Samsung";
  else if (/opera|opr\//i.test(ua))    browser = "Opera";
  else if (/chrome|crios/i.test(ua))   browser = "Chrome";
  else if (/firefox|fxios/i.test(ua))  browser = "Firefox";
  else if (/safari/i.test(ua))         browser = "Safari";

  return { device, browser };
}

function lookupCountry(headers = {}) {
  const country =
    headers["cloudfront-viewer-country"] ??
    headers["CloudFront-Viewer-Country"] ??
    "";

  if (typeof country !== "string") return "";

  const normalizedCountry = country.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalizedCountry) ? normalizedCountry : "";
}

// ─── Handler factory ──────────────────────────────────────────────────────────
// Accepts optional overrides so the handler can be tested without mocking modules.

export function createHandler(client = new DynamoDBClient({}), countryLookup = lookupCountry) {
  return async (event) => {
    const TABLE_NAME     = process.env.TABLE_NAME;
    const ENABLE_QUERY   = process.env.ENABLE_QUERY === "true";
    const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "";
    const method         = event.requestContext?.http?.method ?? "GET";
    const corsHeaders    = buildCorsHeaders(ALLOWED_ORIGIN);

    try {
      if (method === "OPTIONS") {
        return respond(204, undefined, {
          ...corsHeaders,
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "300",
        });
      }
      if (method === "POST") {
        return await handleIngest(event, client, TABLE_NAME, countryLookup, corsHeaders);
      }
      if (method === "GET" && ENABLE_QUERY) {
        return await handleQuery(event, client, TABLE_NAME, corsHeaders);
      }
      return respond(404, { error: "Not found" }, corsHeaders);
    } catch (err) {
      console.error(err);
      return respond(500, { error: "Internal server error" }, corsHeaders);
    }
  };
}

export const handler = createHandler();

// ─── Ingest ───────────────────────────────────────────────────────────────────

async function handleIngest(event, client, TABLE_NAME, countryLookup, corsHeaders) {
  const body = JSON.parse(event.body ?? "{}");
  const {
    appId, type, path, referrer,
    sessionId, visitorId, userId,
    timestamp, timezone, locale, params,
  } = body;

  if (!appId || !type || !timestamp) {
    return respond(400, { error: "Missing required fields: appId, type, timestamp" }, corsHeaders);
  }

  const ua = event.headers?.["user-agent"] ?? "";
  if (isBot(ua)) return respond(200, { ok: true }, corsHeaders);

  const country = countryLookup(event.headers ?? {});
  const { device, browser } = parseUserAgent(ua);

  const date    = timestamp.slice(0, 10); // YYYY-MM-DD
  const eventId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  await client.send(
    new PutItemCommand({
      TableName: TABLE_NAME,
      Item: marshall(
        {
          PK:        `APP#${appId}#${date}`,
          SK:        `${timestamp}#${eventId}`,
          GSI1PK:    `TYPE#${type}#${date}`,
          GSI2PK:    `PATH#${path ?? ""}#${date}`,
          appId,
          type,
          path:      path      ?? "",
          referrer:  referrer  ?? "",
          sessionId: sessionId ?? "",
          visitorId: visitorId ?? "",
          userId:    userId    ?? "",
          country,
          device,
          browser,
          timestamp,
          timezone:  timezone  ?? "",
          locale:    locale    ?? "",
          params:    JSON.stringify(params ?? {}),
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  return respond(200, { ok: true }, corsHeaders);
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function handleQuery(event, client, TABLE_NAME, corsHeaders) {
  const qs = event.queryStringParameters ?? {};
  const { appId, from, to, type, aggregate, funnelSteps, visitorId } = qs;

  if (!appId || !from || !to) {
    return respond(400, { error: "Missing required params: appId, from, to" }, corsHeaders);
  }

  const dates = getDatesInRange(from, to);
  if (dates.length > 366) {
    return respond(400, { error: "Date range must be 366 days or fewer" }, corsHeaders);
  }

  if (funnelSteps !== undefined) {
    let steps;
    try {
      steps = JSON.parse(funnelSteps);
    } catch {
      return respond(400, { error: "Invalid funnelSteps: must be a JSON array" }, corsHeaders);
    }
    if (!Array.isArray(steps) || steps.length < 2) {
      return respond(400, { error: "funnelSteps must be a JSON array with at least 2 steps" }, corsHeaders);
    }
    const results = await Promise.all(
      dates.map((date) => queryDate({ appId, date, client, TABLE_NAME }))
    );
    return respond(200, { funnel: computeFunnel(results.flat(), steps, visitorId ?? null) }, corsHeaders);
  }

  const results = await Promise.all(
    dates.map((date) => queryDate({ appId, type, date, client, TABLE_NAME }))
  );
  const events = results.flat();

  if (aggregate === "true") {
    return respond(200, { summary: buildSummary(events) }, corsHeaders);
  }

  if (visitorId) {
    const visitorEvents = events
      .filter((e) => e.visitorId === visitorId)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return respond(200, { events: visitorEvents }, corsHeaders);
  }

  return respond(200, { events }, corsHeaders);
}

function buildSummary(events) {
  const pageViews = events.filter((e) => e.type === "page_view");
  const uniqueVisitors = new Set(events.map((e) => e.visitorId).filter(Boolean)).size;

  return {
    totalEvents:    events.length,
    pageViews:      pageViews.length,
    uniqueVisitors,
    dailyCounts:    buildDailyCounts(pageViews),
    recentEvents:   buildRecentEvents(events),
    countryCounts:  buildCountryCounts(pageViews),
    topPages:       topN(pageViews, (e) => e.path                            || "(unknown)", "path"),
    topReferrers:   topN(pageViews, (e) => e.referrer                        || "(direct)",  "referrer"),
    topLocations:   topN(pageViews, (e) => e.country || e.timezone           || "(unknown)", "location"),
    topDevices:     topN(pageViews.filter((e) => e.device),  (e) => e.device,  "device"),
    topBrowsers:    topN(pageViews.filter((e) => e.browser), (e) => e.browser, "browser"),
  };
}

function buildDailyCounts(pageViews) {
  const counts = {};
  pageViews.forEach((e) => {
    const date = e.timestamp.slice(0, 10);
    counts[date] = (counts[date] ?? 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, views: count }));
}

function buildCountryCounts(pageViews) {
  const counts = {};
  pageViews.forEach((e) => {
    const country = e.country?.trim();
    if (country) counts[country] = (counts[country] ?? 0) + 1;
  });
  return counts;
}

function buildRecentEvents(events) {
  return [...events]
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, 20);
}

function topN(events, keyFn, label, n = 10) {
  const counts = {};
  events.forEach((e) => {
    const k = keyFn(e);
    counts[k] = (counts[k] ?? 0) + 1;
  });
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ [label]: key, count }));
}

async function queryDate({ appId, type, date, client, TABLE_NAME }) {
  let params;

  if (type) {
    params = {
      TableName: TABLE_NAME,
      IndexName: "GSI1",
      KeyConditionExpression: "GSI1PK = :pk",
      FilterExpression: "appId = :appId",
      ExpressionAttributeValues: marshall({
        ":pk":    `TYPE#${type}#${date}`,
        ":appId": appId,
      }),
    };
  } else {
    params = {
      TableName: TABLE_NAME,
      KeyConditionExpression: "PK = :pk",
      ExpressionAttributeValues: marshall({ ":pk": `APP#${appId}#${date}` }),
    };
  }

  const items = [];
  let lastKey;
  do {
    const resp = await client.send(new QueryCommand({ ...params, ExclusiveStartKey: lastKey }));
    items.push(...(resp.Items ?? []));
    lastKey = resp.LastEvaluatedKey;
  } while (lastKey);

  return items.map((item) => {
    const u = unmarshall(item);
    return { ...u, params: tryParseJson(u.params) };
  });
}

// ─── Funnel ───────────────────────────────────────────────────────────────────

function computeFunnel(events, steps, visitorId = null) {
  const byVisitor = Object.create(null);
  for (const event of events) {
    if (!event.visitorId) continue;
    if (visitorId && event.visitorId !== visitorId) continue;
    (byVisitor[event.visitorId] ??= []).push(event);
  }
  for (const visitorEvents of Object.values(byVisitor)) {
    visitorEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }

  const stepCounts = new Array(steps.length).fill(0);

  for (const visitorEvents of Object.values(byVisitor)) {
    let stepIndex = 0;
    for (const event of visitorEvents) {
      if (stepIndex >= steps.length) break;
      if (matchesStep(event, steps[stepIndex])) {
        stepCounts[stepIndex]++;
        stepIndex++;
      }
    }
  }

  return steps.map((step, i) => ({
    label: step.label || step.path || step.type,
    type: step.type,
    ...(step.path ? { path: step.path } : {}),
    count: stepCounts[i],
    conversionRate: i === 0 || stepCounts[i - 1] === 0
      ? null
      : stepCounts[i] / stepCounts[i - 1],
  }));
}

function matchesStep(event, step) {
  return event.type === step.type && (!step.path || event.path === step.path);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDatesInRange(from, to) {
  const dates = [];
  const end = new Date(to);
  for (let d = new Date(from); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function tryParseJson(str) {
  try {
    return JSON.parse(str);
  } catch {
    return {};
  }
}

function buildCorsHeaders(allowedOrigin) {
  if (!allowedOrigin) return {};

  const headers = {
    "Access-Control-Allow-Origin": allowedOrigin,
  };

  if (allowedOrigin !== "*") {
    headers.Vary = "Origin";
  }

  return headers;
}

function respond(statusCode, body, extraHeaders = {}) {
  const headers = { ...extraHeaders };
  const response = {
    statusCode,
    headers,
    body: "",
  };

  if (body !== undefined) {
    response.headers["Content-Type"] = "application/json";
    response.body = JSON.stringify(body);
  }

  return response;
}
