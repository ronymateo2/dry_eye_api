import { describe, expect, it } from "vitest";
import {
  isInQuietHours,
  localTimeToUtcMs,
  medActiveOn,
  medSlotsForDay,
  nextDropDoseMs,
  quietEndMs,
} from "./reminder-schedule";

const TZ = "America/Bogota"; // UTC-5, sin DST

describe("localTimeToUtcMs", () => {
  it("convierte hora local Bogota a UTC (+5h)", () => {
    expect(localTimeToUtcMs("2026-06-08", "08:00", TZ)).toBe(Date.UTC(2026, 5, 8, 13, 0));
  });

  it("hora UTC es identidad en UTC", () => {
    expect(localTimeToUtcMs("2026-06-08", "08:00", "UTC")).toBe(Date.UTC(2026, 5, 8, 8, 0));
  });
});

describe("nextDropDoseMs", () => {
  const last = "2026-06-08T12:00:00.000Z";
  it("suma el intervalo a la última dosis", () => {
    expect(nextDropDoseMs(last, 6)).toBe(Date.parse(last) + 6 * 3_600_000);
  });
  it("null sin registro o sin intervalo", () => {
    expect(nextDropDoseMs(null, 6)).toBeNull();
    expect(nextDropDoseMs(last, null)).toBeNull();
  });
});

describe("medActiveOn", () => {
  const base = { start_date: null, end_date: null, phases_json: null, times_json: null, archived_at: null };

  it("activa sin fechas", () => {
    expect(medActiveOn(base, "2026-06-08")).toBe(true);
  });
  it("respeta start/end", () => {
    const m = { ...base, start_date: "2026-06-01", end_date: "2026-06-10" };
    expect(medActiveOn(m, "2026-05-31")).toBe(false);
    expect(medActiveOn(m, "2026-06-05")).toBe(true);
    expect(medActiveOn(m, "2026-06-11")).toBe(false);
  });
  it("archivada nunca activa", () => {
    expect(medActiveOn({ ...base, archived_at: "2026-06-01T00:00:00Z" }, "2026-06-08")).toBe(false);
  });
  it("respeta fases", () => {
    const m = {
      ...base,
      phases_json: JSON.stringify([{ label: "f1", dosage: "1", start_date: "2026-06-05", end_date: "2026-06-07" }]),
    };
    expect(medActiveOn(m, "2026-06-06")).toBe(true);
    expect(medActiveOn(m, "2026-06-08")).toBe(false);
  });
});

describe("medSlotsForDay", () => {
  it("genera slots en UTC desde times_json", () => {
    const m = {
      start_date: null,
      end_date: null,
      phases_json: null,
      times_json: JSON.stringify(["08:00", "20:00"]),
      archived_at: null,
    };
    const slots = medSlotsForDay(m, TZ, "2026-06-08");
    expect(slots.map((s) => s.timeSlot)).toEqual(["08:00", "20:00"]);
    expect(slots[0].slotMs).toBe(Date.UTC(2026, 5, 8, 13, 0));
    expect(slots[1].slotMs).toBe(Date.UTC(2026, 5, 9, 1, 0));
  });
  it("vacío si inactiva ese día", () => {
    const m = {
      start_date: "2026-07-01",
      end_date: null,
      phases_json: null,
      times_json: JSON.stringify(["08:00"]),
      archived_at: null,
    };
    expect(medSlotsForDay(m, TZ, "2026-06-08")).toEqual([]);
  });
});

describe("isInQuietHours", () => {
  // 2026-06-08T06:00Z == 01:00 Bogota; T13:00Z == 08:00 Bogota
  const at = (h: number) => Date.UTC(2026, 5, 8, h, 0);
  it("ventana que cruza medianoche (22:00-07:00)", () => {
    expect(isInQuietHours(at(6), TZ, "22:00", "07:00")).toBe(true); // 01:00 local
    expect(isInQuietHours(at(15), TZ, "22:00", "07:00")).toBe(false); // 10:00 local
  });
  it("ventana normal (13:00-14:00)", () => {
    expect(isInQuietHours(at(18), TZ, "13:00", "14:00")).toBe(true); // 13:00 local
    expect(isInQuietHours(at(20), TZ, "13:00", "14:00")).toBe(false); // 15:00 local
  });
  it("sin config => false", () => {
    expect(isInQuietHours(at(6), TZ, null, null)).toBe(false);
  });
});

describe("quietEndMs", () => {
  it("hoy si el fin aún no pasó", () => {
    const now = Date.UTC(2026, 5, 8, 6, 0); // 01:00 local
    expect(quietEndMs(now, TZ, "07:00")).toBe(Date.UTC(2026, 5, 8, 12, 0)); // 07:00 local = 12:00Z
  });
  it("mañana si el fin ya pasó hoy", () => {
    const now = Date.UTC(2026, 5, 8, 18, 0); // 13:00 local
    expect(quietEndMs(now, TZ, "07:00")).toBe(Date.UTC(2026, 5, 9, 12, 0));
  });
});
