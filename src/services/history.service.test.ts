import { describe, expect, it } from "vitest";
import { buildGroups } from "./history.service";

const TZ = "America/Bogota"; // UTC-5, no DST

function empty() {
  return {
    checkIns: [],
    drops: [],
    triggers: [],
    symptoms: [],
    obs: [],
    sleep: [],
    hygiene: [],
    hygieneSessions: [],
    therapy: [],
    intakes: [],
  };
}

function run(p: ReturnType<typeof empty>) {
  return buildGroups(
    TZ,
    p.checkIns as never,
    p.drops as never,
    p.triggers as never,
    p.symptoms as never,
    p.obs as never,
    p.sleep as never,
    p.hygiene as never,
    p.hygieneSessions as never,
    p.therapy as never,
    p.intakes as never,
  );
}

describe("buildGroups", () => {
  it("groups entries by local day and sorts days descending", () => {
    const p = empty();
    p.checkIns = [
      { id: "a", logged_at: "2026-06-04T15:00:00Z", eyelid_pain: 1, temple_pain: 1, masseter_pain: 1, cervical_pain: 1, orbital_pain: 1, trigger_type: null, trigger_types: null, pain_quality: null, notes: null },
      { id: "c", logged_at: "2026-06-03T15:00:00Z", eyelid_pain: 2, temple_pain: 2, masseter_pain: 2, cervical_pain: 2, orbital_pain: 2, trigger_type: null, trigger_types: null, pain_quality: null, notes: null },
    ] as never;
    p.drops = [
      { id: "b", logged_at: "2026-06-04T18:00:00Z", quantity: 1, eye: "both", drop_type_name: "Systane" },
    ] as never;

    const res = run(p);
    expect(res.groups.map((g) => g.dayKey)).toEqual(["2026-06-04", "2026-06-03"]);
    expect(res.groups[0].entries.map((e) => e.id)).toEqual(["b", "a"]);
    expect(res.groups[1].entries.map((e) => e.id)).toEqual(["c"]);
  });

  it("orders entries within a day newest first", () => {
    const p = empty();
    p.drops = [
      { id: "early", logged_at: "2026-06-04T13:00:00Z", quantity: 1, eye: "both", drop_type_name: "X" },
      { id: "late", logged_at: "2026-06-04T20:00:00Z", quantity: 1, eye: "both", drop_type_name: "X" },
    ] as never;
    const res = run(p);
    expect(res.groups[0].entries.map((e) => e.id)).toEqual(["late", "early"]);
  });

  it("keeps a single sleep entry per local day", () => {
    const p = empty();
    p.sleep = [
      { id: "s1", logged_at: "2026-06-04T11:00:00Z", sleep_hours: 7, sleep_quality: "bueno" },
      { id: "s2", logged_at: "2026-06-04T12:00:00Z", sleep_hours: 8, sleep_quality: "excelente" },
    ] as never;
    const res = run(p);
    const sleepEntries = res.groups[0].entries.filter((e) => e.kind === "sleep");
    expect(sleepEntries).toHaveLength(1);
    expect(sleepEntries[0].id).toBe("s1");
  });

  it("creates an empty group for a hygiene-only day and attaches its sessions", () => {
    const p = empty();
    p.hygiene = [
      { day_key: "2026-06-02", last_logged_at: "2026-06-02T22:00:00Z", status: "completed", deviation_value: null, friction_type: null, user_note: null, completed_count: 1 },
    ] as never;
    p.hygieneSessions = [
      { id: "h1", day_key: "2026-06-02", logged_at: "2026-06-02T22:00:00Z" },
    ] as never;

    const res = run(p);
    const group = res.groups.find((g) => g.dayKey === "2026-06-02");
    expect(group?.entries).toEqual([]);
    expect(res.hygiene[0].sessions).toEqual([{ id: "h1", loggedAt: "2026-06-02T22:00:00Z" }]);
  });
});
