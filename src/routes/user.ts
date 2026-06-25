import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { signToken, makePayload } from "../lib/jwt";
import {
  getUserMe,
  updateUserMe,
  revokeSessions,
  type UserUpdateInput,
} from "../services/user.service";

const user = new Hono<{ Bindings: Env; Variables: Variables }>();

user.use("*", authMiddleware);

user.get("/me", async (c) => {
  const row = await getUserMe(getDb(c.env.DB), c.get("userId"));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

user.put("/me", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<UserUpdateInput>();

  let result: Awaited<ReturnType<typeof updateUserMe>>;
  try {
    result = await updateUserMe(getDb(c.env.DB), userId, body);
  } catch (err) {
    if (err instanceof Error && err.message === "invalid_timezone") {
      return c.json({ error: "invalid_timezone" }, 400);
    }
    throw err;
  }

  if (!result) return c.json({ ok: true });

  const { row, timezoneChanged } = result;
  if (timezoneChanged && row) {
    const token = await signToken(
      makePayload(userId, row.timezone, row.token_version),
      c.env.JWT_SECRET,
    );
    return c.json({ ...row, token });
  }

  return c.json(row);
});

// Cierra todas las sesiones del usuario (logout server-side / revocación).
user.post("/revoke-sessions", async (c) => {
  await revokeSessions(getDb(c.env.DB), c.get("userId"));
  return c.json({ ok: true });
});

export { user };
