import { Hono } from "hono";
import type { Env, Variables } from "../types";
import { authMiddleware } from "../middleware/auth";
import { getDb } from "../db";
import { getDashboardCorrelations, getDashboardSummary } from "../services/dashboard.service";

const dashboard = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboard.use("*", authMiddleware);

dashboard.get("/summary", async (c) => {
  const data = await getDashboardSummary(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

dashboard.get("/correlations", async (c) => {
  const data = await getDashboardCorrelations(getDb(c.env.DB), c.get("userId"), c.get("userTimezone"));
  return c.json(data);
});

export { dashboard };
