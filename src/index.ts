import { Hono } from "hono";
import { cors } from "hono/cors";
import type { Env, Variables } from "./types";

import { auth } from "./routes/auth";
import { user } from "./routes/user";
import { checkIns } from "./routes/check-ins";
import { drops } from "./routes/drops";
import { dropTypes } from "./routes/drop-types";
import { sleep } from "./routes/sleep";
import { hygiene } from "./routes/hygiene";
import { triggers } from "./routes/triggers";
import { symptoms } from "./routes/symptoms";
import { observations } from "./routes/observations";
import { medications } from "./routes/medications";
import { dashboard } from "./routes/dashboard";
import { history } from "./routes/history";
import { report } from "./routes/report";

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// CORS — allow the frontend origin
app.use("*", async (c, next) => {
  const origin = c.env.FRONTEND_URL ?? "*";
  return cors({
    origin,
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: false,
    maxAge: 86400,
  })(c, next);
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/auth", auth);
app.route("/api/user", user);
app.route("/api/check-ins", checkIns);
app.route("/api/drops", drops);
app.route("/api/drop-types", dropTypes);
app.route("/api/sleep", sleep);
app.route("/api/hygiene", hygiene);
app.route("/api/triggers", triggers);
app.route("/api/symptoms", symptoms);
app.route("/api/observations", observations);
app.route("/api/medications", medications);
app.route("/api/dashboard", dashboard);
app.route("/api/history", history);
app.route("/api/report", report);

export default app;
