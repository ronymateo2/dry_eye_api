import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getReport } from "../services/report.service";

const report = new Hono<{ Bindings: Env; Variables: Variables }>();

report.use("*", authMiddleware);

report.get("/", async (c) => {
  const data = await getReport(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

export { report };
