import { Hono } from "hono";
import { bearerAuth } from "hono/bearer-auth";
import { bodyLimit } from "hono/body-limit";
import { serve } from "@hono/node-server";
import type { Server } from "node:http";

// --- Env validation ---
const API_TOKEN = process.env.API_TOKEN;
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 300_000);
const MAX_PENDING = Number(process.env.MAX_PENDING || 100);
const PORT = Number(process.env.PORT || 3000);

if (!API_TOKEN) {
  console.error("Missing required env var: API_TOKEN");
  process.exit(1);
}
if (!Number.isFinite(TIMEOUT_MS) || TIMEOUT_MS <= 0) {
  console.error("TIMEOUT_MS must be a positive number");
  process.exit(1);
}
if (!Number.isInteger(MAX_PENDING) || MAX_PENDING <= 0) {
  console.error("MAX_PENDING must be a positive integer");
  process.exit(1);
}
if (!Number.isInteger(PORT) || PORT <= 0 || PORT > 65535) {
  console.error("PORT must be a valid port number");
  process.exit(1);
}

// --- Pending request store ---
type PendingEntry = {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  resolved: boolean;
};
const pending = new Map<string, PendingEntry>();
const recentlyResolved = new Set<string>();

// --- App ---
const app = new Hono();

app.get("/health", (c) => c.json({ ok: true }));

app.use("/bridge", bearerAuth({ token: API_TOKEN }));
app.use("/callback/*", bearerAuth({ token: API_TOKEN }));
app.use("/bridge", bodyLimit({ maxSize: 1024 * 1024 }));
app.use("/callback/*", bodyLimit({ maxSize: 1024 * 1024 }));

app.post("/bridge", async (c) => {
  const id = crypto.randomUUID();

  // 1. Check capacity (only count unresolved entries)
  if (pending.size >= MAX_PENDING) {
    console.error(`[bridge] rejected — at capacity (${MAX_PENDING} pending)`);
    return c.json({ error: "Server at capacity, try again later" }, 503);
  }

  // 2. Create promise and store resolver BEFORE forwarding (prevents race condition)
  const { promise, resolve, reject } = Promise.withResolvers<unknown>();
  const timer = setTimeout(() => {
    const entry = pending.get(id);
    if (entry && !entry.resolved) {
      entry.resolved = true;
      pending.delete(id);
      reject(new Error("timeout"));
      console.error(`[bridge] timeout id=${id}`);
    }
  }, TIMEOUT_MS);
  pending.set(id, { resolve, reject, timer, resolved: false });

  // 3. Parse payload, extract target URL, inject callback URL
  let payload: Record<string, unknown>;
  try {
    payload = await c.req.json();
  } catch {
    clearTimeout(timer);
    pending.delete(id);
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const targetUrl = payload._mold_target_url;
  if (!targetUrl || typeof targetUrl !== "string") {
    clearTimeout(timer);
    pending.delete(id);
    return c.json({ error: "Missing _mold_target_url in request body" }, 400);
  }
  const targetAuth = payload._mold_target_auth_token;
  delete payload._mold_target_url;
  delete payload._mold_target_auth_token;

  const proto = c.req.header("x-forwarded-proto") || "http";
  const host = c.req.header("x-forwarded-host") || c.req.header("host");
  payload._mold_callback_url = `${proto}://${host}/callback/${id}`;

  // 4. Forward to target webhook (with timeout to prevent hanging on stalled connections)
  const forwardHeaders: Record<string, string> = { "Content-Type": "application/json" };
  if (typeof targetAuth === "string" && targetAuth) {
    forwardHeaders["x-clay-webhook-auth"] = targetAuth;
  }
  try {
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: forwardHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
    console.log(`[bridge] forwarded id=${id} status=${res.status}`);
    if (!res.ok) {
      clearTimeout(timer);
      pending.delete(id);
      return c.json(
        { error: "Table B webhook returned error", status: res.status },
        502
      );
    }
  } catch (err) {
    clearTimeout(timer);
    pending.delete(id);
    console.error(`[bridge] forward failed id=${id}`, err);
    return c.json({ error: "Failed to reach Table B webhook" }, 502);
  }

  // 5. Wait for callback
  try {
    const result = await promise;
    return c.json(result as object);
  } catch {
    return c.json({ error: "Timed out waiting for Table B callback" }, 504);
  }
});

app.post("/callback/:id", async (c) => {
  const { id } = c.req.param();
  const entry = pending.get(id);

  // Duplicate callback (recently resolved)
  if (recentlyResolved.has(id)) {
    console.log(`[callback] duplicate id=${id}`);
    return c.json({ status: "already_received" }, 200);
  }

  // Late/expired callback — return 200 to prevent retry storms
  if (!entry) {
    console.log(`[callback] late/unknown id=${id}`);
    return c.json({ status: "unknown" }, 200);
  }

  // Already resolved (concurrent duplicate)
  if (entry.resolved) {
    console.log(`[callback] duplicate id=${id}`);
    return c.json({ status: "already_received" }, 200);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    console.error(`[callback] invalid JSON body id=${id}`);
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  entry.resolved = true;
  clearTimeout(entry.timer);
  entry.resolve(body);

  // Move to recently-resolved set so it doesn't count toward capacity
  pending.delete(id);
  recentlyResolved.add(id);
  setTimeout(() => recentlyResolved.delete(id), 30_000);

  console.log(`[callback] received id=${id}`);
  return c.json({ status: "ok" }, 200);
});

// --- Start server ---
const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`mold listening on :${PORT}`);
}) as Server;

// Configure Node.js timeouts above TIMEOUT_MS to prevent premature connection kills
server.keepAliveTimeout = TIMEOUT_MS + 30_000;
server.headersTimeout = TIMEOUT_MS + 60_000;
