import { describe, expect, it } from "vitest";
import { isoDateAfterDays, nextDayKey, shortDayLabel } from "./dates";

describe("nextDayKey", () => {
  it("advances one day", () => {
    expect(nextDayKey("2026-01-01")).toBe("2026-01-02");
  });

  it("crosses month boundary", () => {
    expect(nextDayKey("2026-01-31")).toBe("2026-02-01");
  });

  it("crosses year boundary", () => {
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01");
  });

  it("handles leap day", () => {
    expect(nextDayKey("2024-02-28")).toBe("2024-02-29");
  });
});

describe("isoDateAfterDays", () => {
  it("adds days across month boundary", () => {
    expect(isoDateAfterDays("2026-01-30", 3)).toBe("2026-02-02");
  });

  it("supports zero offset", () => {
    expect(isoDateAfterDays("2026-06-15", 0)).toBe("2026-06-15");
  });

  it("supports negative offset", () => {
    expect(isoDateAfterDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("shortDayLabel", () => {
  it("formats day before month, separated by a slash", () => {
    expect(shortDayLabel("2026-06-04")).toMatch(/^0?4\/0?6$/);
  });

  it("returns raw key when malformed", () => {
    expect(shortDayLabel("not-a-date")).toBe("not-a-date");
  });
});
