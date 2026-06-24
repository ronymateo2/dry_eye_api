import { describe, expect, it } from "vitest";
import { parseTodayWidgetConfig } from "./user.service";

describe("parseTodayWidgetConfig", () => {
  it("parses a valid config array", () => {
    const raw = JSON.stringify([
      { id: "symptoms", visible: true },
      { id: "schedule", visible: false },
    ]);
    expect(parseTodayWidgetConfig(raw)).toEqual([
      { id: "symptoms", visible: true },
      { id: "schedule", visible: false },
    ]);
  });

  it("returns [] for malformed JSON", () => {
    expect(parseTodayWidgetConfig("{not json")).toEqual([]);
  });

  it("returns [] for null/undefined", () => {
    expect(parseTodayWidgetConfig(null)).toEqual([]);
    expect(parseTodayWidgetConfig(undefined)).toEqual([]);
  });

  it("returns [] for non-array JSON", () => {
    expect(parseTodayWidgetConfig("{}")).toEqual([]);
    expect(parseTodayWidgetConfig("42")).toEqual([]);
  });

  it("drops entries with wrong shape", () => {
    const raw = JSON.stringify([
      { id: "symptoms", visible: true },
      { id: 42, visible: true },
      { visible: true },
      { id: "schedule", visible: "yes" },
      "garbage",
    ]);
    expect(parseTodayWidgetConfig(raw)).toEqual([{ id: "symptoms", visible: true }]);
  });
});
