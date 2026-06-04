import { describe, expect, it } from "vitest";
import {
  MIN_CORRELATION_SAMPLES,
  buildDashboardCorrelations,
  buildDashboardSummary,
  correlationInsight,
} from "./dashboard.service";

const TZ = "America/Bogota"; // UTC-5, no DST

function checkIn(logged_at: string, pain: number, trigger: string | null = null) {
  return {
    logged_at,
    eyelid_pain: pain,
    temple_pain: pain,
    masseter_pain: pain,
    cervical_pain: pain,
    orbital_pain: pain,
    trigger_type: trigger,
  };
}

describe("correlationInsight", () => {
  it("asks for more data below the sample threshold", () => {
    expect(correlationInsight(0.9, MIN_CORRELATION_SAMPLES - 1)).toContain(String(MIN_CORRELATION_SAMPLES));
  });

  it("reports insufficient variation when spearman is null", () => {
    expect(correlationInsight(null, MIN_CORRELATION_SAMPLES)).toContain("variacion");
  });

  it("picks the strong-negative bucket", () => {
    expect(correlationInsight(-0.8, 20)).toContain("menor dolor");
  });

  it("picks the weak bucket near zero", () => {
    expect(correlationInsight(0.05, 20)).toContain("debil");
  });

  it("picks the strong-positive bucket", () => {
    expect(correlationInsight(0.8, 20)).toContain("fuerte");
  });
});

describe("buildDashboardSummary", () => {
  const last30 = ["2026-06-03", "2026-06-04"];

  it("averages pain per day and exposes trend points", () => {
    const res = buildDashboardSummary(
      TZ,
      last30,
      [checkIn("2026-06-04T15:00:00Z", 4)],
      [{ logged_at: "2026-06-04T15:00:00Z", quantity: 2, drop_type_name: "Systane" }],
    );

    expect(res.trend.daysWithData).toBe(1);
    expect(res.trend.average7d).toBe(4);
    expect(res.trend.average30d).toBe(4);
    const point = res.trend.points.find((p) => p.dayKey === "2026-06-04");
    expect(point?.masseterPain).toBe(4);
    const empty = res.trend.points.find((p) => p.dayKey === "2026-06-03");
    expect(empty?.masseterPain).toBeNull();
    expect(res.drops.dropTypes).toEqual(["Systane"]);
  });

  it("attributes high-pain days to their trigger", () => {
    const res = buildDashboardSummary(
      TZ,
      last30,
      [checkIn("2026-06-04T15:00:00Z", 8, "stress")],
      [],
    );
    expect(res.highPainTriggerStats).toEqual([{ triggerType: "stress", days: 1 }]);
  });
});

describe("buildDashboardCorrelations", () => {
  it("pairs sleep hours with same-day masseter pain and computes spearman", () => {
    const checkIns = [
      checkIn("2026-06-02T15:00:00Z", 5),
      checkIn("2026-06-03T15:00:00Z", 4),
      checkIn("2026-06-04T15:00:00Z", 3),
    ];
    const sleep = [
      { day_key: "2026-06-02", sleep_hours: 5 },
      { day_key: "2026-06-03", sleep_hours: 6 },
      { day_key: "2026-06-04", sleep_hours: 7 },
    ];

    const res = buildDashboardCorrelations(TZ, checkIns, sleep, []);
    expect(res.correlation.sampleSize).toBe(3);
    expect(res.correlation.spearman).toBeCloseTo(-1, 5);
  });

  it("ignores check-ins without a matching sleep day", () => {
    const res = buildDashboardCorrelations(
      TZ,
      [checkIn("2026-06-04T15:00:00Z", 3)],
      [{ day_key: "2026-06-01", sleep_hours: 8 }],
      [],
    );
    expect(res.correlation.sampleSize).toBe(0);
    expect(res.correlation.spearman).toBeNull();
  });

  it("returns no therapy correlation below 3 therapy days", () => {
    const res = buildDashboardCorrelations(TZ, [checkIn("2026-06-04T15:00:00Z", 3)], [], [
      { logged_at: "2026-06-04T15:00:00Z" },
    ]);
    expect(res.therapyCorrelation).toBeNull();
  });
});
