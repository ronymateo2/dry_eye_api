import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { verifyToken } from "../lib/jwt";
import { getDb, dyClientErrors } from "../db";

const errors = new Hono<{ Bindings: Env; Variables: Variables }>();

// Public: client crashes can happen before/without auth. userId is derived
// from a valid token if present — never trusted from the body.
errors.post("/", async (c) => {
  // Endpoint público sin auth → rate limit por IP para frenar spam de inserciones.
  const ip = c.req.header("CF-Connecting-IP") ?? "unknown";
  const { success } = await c.env.ERRORS_RATE_LIMITER.limit({ key: ip });
  if (!success) return c.json({ ok: false }, 429);

  const body = await c.req
    .json<{ message?: string; stack?: string; url?: string; appVersion?: string }>()
    .catch(() => null);

  const message = body?.message?.slice(0, 500);
  if (!message) return c.json({ ok: false }, 400);

  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  let userId: string | null = null;
  if (token) {
    const payload = await verifyToken(token, c.env.JWT_SECRET);
    if (payload && typeof payload.sub === "string") userId = payload.sub;
  }

  await getDb(c.env.DB)
    .insert(dyClientErrors)
    .values({
      id: crypto.randomUUID(),
      user_id: userId,
      message,
      stack: body?.stack?.slice(0, 4000) ?? null,
      url: body?.url?.slice(0, 500) ?? null,
      user_agent: c.req.header("User-Agent")?.slice(0, 500) ?? null,
      app_version: body?.appVersion?.slice(0, 50) ?? null,
    })
    .run()
    .catch(() => {});

  return c.json({ ok: true });
});

export { errors };
