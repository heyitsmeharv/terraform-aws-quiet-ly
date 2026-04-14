import { DynamoDBClient, PutItemCommand, QueryCommand } from "@aws-sdk/client-dynamodb";
import { marshall, unmarshall } from "@aws-sdk/util-dynamodb";

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
    const TABLE_NAME   = process.env.TABLE_NAME;
    const ENABLE_QUERY = process.env.ENABLE_QUERY === "true";
    const method       = event.requestContext?.http?.method ?? "GET";

    try {
      if (method === "POST") {
        return await handleIngest(event, client, TABLE_NAME, countryLookup);
      }
      if (method === "GET" && ENABLE_QUERY) {
        return await handleQuery(event, client, TABLE_NAME);
      }
      return respond(404, { error: "Not found" });
    } catch (err) {
      console.error(err);
      return respond(500, { error: "Internal server error" });
    }
  };
}

export const handler = createHandler();

// ─── Ingest ───────────────────────────────────────────────────────────────────

async function handleIngest(event, client, TABLE_NAME, countryLookup) {
  const body = JSON.parse(event.body ?? "{}");
  const {
    appId, type, path, referrer,
    sessionId, visitorId, userId,
    timestamp, timezone, locale, params,
  } = body;

  if (!appId || !type || !timestamp) {
    return respond(400, { error: "Missing required fields: appId, type, timestamp" });
  }

  const country = countryLookup(event.headers ?? {});

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
          timestamp,
          timezone:  timezone  ?? "",
          locale:    locale    ?? "",
          params:    JSON.stringify(params ?? {}),
        },
        { removeUndefinedValues: true }
      ),
    })
  );

  return respond(200, { ok: true });
}

// ─── Query ────────────────────────────────────────────────────────────────────

async function handleQuery(event, client, TABLE_NAME) {
  const qs = event.queryStringParameters ?? {};
  const { appId, from, to, type } = qs;

  if (!appId || !from || !to) {
    return respond(400, { error: "Missing required params: appId, from, to" });
  }

  const dates = getDatesInRange(from, to);
  if (dates.length > 366) {
    return respond(400, { error: "Date range must be 366 days or fewer" });
  }

  const results = await Promise.all(
    dates.map((date) => queryDate({ appId, type, date, client, TABLE_NAME }))
  );
  return respond(200, { events: results.flat() });
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

  const resp = await client.send(new QueryCommand(params));
  return (resp.Items ?? []).map((item) => {
    const u = unmarshall(item);
    return { ...u, params: tryParseJson(u.params) };
  });
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

function respond(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
