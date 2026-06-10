import type { Context, Next } from "hono";
import type { Env, Variables } from "../types";
import { verifyToken } from "../lib/jwt";
import { getDb, dyUsers } from "../db";
import { eq } from "drizzle-orm";

export async function authMiddleware(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header("Authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload || typeof payload.sub !== "string") {
    return c.json({ error: "Invalid token" }, 401);
  }

  const db = getDb(c.env.DB);
  const user = await db
    .select({ timezone: dyUsers.timezone, token_version: dyUsers.token_version })
    .from(dyUsers)
    .where(eq(dyUsers.id, payload.sub))
    .get();

  if (!user) {
    return c.json({ error: "Invalid token" }, 401);
  }

  // Revocación server-side: un token emitido antes de un revoke trae un `tv`
  // menor al actual y queda inválido. Tokens legados sin `tv` cuentan como 0.
  const tokenVersion = typeof payload.tv === "number" ? payload.tv : 0;
  if (tokenVersion !== user.token_version) {
    return c.json({ error: "Invalid token" }, 401);
  }

  c.set("userId", payload.sub);
  c.set("userTimezone", user.timezone ?? "America/Bogota");

  await next();
}
