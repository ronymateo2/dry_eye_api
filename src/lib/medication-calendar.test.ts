import { describe, expect, it } from "vitest";
import { buildSegments, buildSummary, parsePhasesJson, parseTimesJson } from "./medication-calendar";

const TODAY = "2026-06-04";

describe("parseTimesJson", () => {
  it("keeps only valid HH:MM entries", () => {
    expect(parseTimesJson('["08:00","9:00","20:30","bad"]')).toEqual(["08:00", "20:30"]);
  });

  it("returns empty for null, non-array, or malformed", () => {
    expect(parseTimesJson(null)).toEqual([]);
    expect(parseTimesJson('{"a":1}')).toEqual([]);
    expect(parseTimesJson("{broken")).toEqual([]);
  });
});

describe("parsePhasesJson", () => {
  it("parses an array of phases", () => {
    const phases = parsePhasesJson('[{"label":"A","dosage":"1","start_date":"2026-06-01","end_date":null}]');
    expect(phases).toHaveLength(1);
    expect(phases[0].label).toBe("A");
  });

  it("returns empty for null/non-array/malformed", () => {
    expect(parsePhasesJson(null)).toEqual([]);
    expect(parsePhasesJson('"x"')).toEqual([]);
    expect(parsePhasesJson("{broken")).toEqual([]);
  });
});

describe("buildSegments — no phases", () => {
  it("creates one open segment defaulting until +365 days", () => {
    const segs = buildSegments({ start_date: null, end_date: null, dosage: "1 gota", phases_json: null }, TODAY);
    expect(segs).toEqual([
      { phaseIndex: null, startDate: TODAY, untilDate: "2027-06-04", dosage: "1 gota", label: null },
    ]);
  });

  it("clamps start to today when start_date is in the past", () => {
    const segs = buildSegments({ start_date: "2026-01-01", end_date: "2026-12-31", dosage: null, phases_json: null }, TODAY);
    expect(segs[0].startDate).toBe(TODAY);
    expect(segs[0].untilDate).toBe("2026-12-31");
  });

  it("returns no segments when the medication already ended", () => {
    const segs = buildSegments({ start_date: "2026-01-01", end_date: "2026-05-01", dosage: null, phases_json: null }, TODAY);
    expect(segs).toEqual([]);
  });
});

describe("buildSegments — with phases", () => {
  it("emits one segment per active phase and inherits med dosage when phase has none", () => {
    const phases = JSON.stringify([
      { label: "Fase 1", dosage: "2 gotas", start_date: "2026-06-01", end_date: "2026-06-30" },
      { label: "Fase 2", dosage: "", start_date: "2026-07-01", end_date: null },
    ]);
    const segs = buildSegments({ start_date: null, end_date: "2026-12-31", dosage: "1 gota", phases_json: phases }, TODAY);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ phaseIndex: 0, startDate: TODAY, untilDate: "2026-06-30", dosage: "2 gotas", label: "Fase 1" });
    expect(segs[1]).toMatchObject({ phaseIndex: 1, startDate: "2026-07-01", untilDate: "2026-12-31", dosage: "1 gota", label: "Fase 2" });
  });

  it("skips phases without a start_date or already ended", () => {
    const phases = JSON.stringify([
      { label: "sin inicio", dosage: "1", start_date: "", end_date: null },
      { label: "vieja", dosage: "1", start_date: "2026-01-01", end_date: "2026-03-01" },
      { label: "activa", dosage: "1", start_date: "2026-06-01", end_date: null },
    ]);
    const segs = buildSegments({ start_date: null, end_date: null, dosage: "1", phases_json: phases }, TODAY);
    expect(segs).toHaveLength(1);
    expect(segs[0].label).toBe("activa");
  });
});

describe("buildSummary", () => {
  it("includes name, dosage and label", () => {
    const s = buildSummary("Restasis", { phaseIndex: 0, startDate: TODAY, untilDate: TODAY, dosage: "1 gota", label: "Fase 1" });
    expect(s).toBe("Medicamento: Restasis (1 gota) — Fase 1");
  });

  it("omits dosage and label when absent", () => {
    expect(buildSummary("Restasis", { phaseIndex: null, startDate: TODAY, untilDate: TODAY, dosage: null, label: null })).toBe(
      "Medicamento: Restasis",
    );
  });
});
