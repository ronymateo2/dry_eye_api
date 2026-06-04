import { describe, expect, it } from "vitest";
import { getSpearmanCorrelation } from "./stats";

describe("getSpearmanCorrelation", () => {
  it("returns 1 for perfect monotonic increase", () => {
    expect(getSpearmanCorrelation([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5);
  });

  it("returns -1 for perfect monotonic decrease", () => {
    expect(getSpearmanCorrelation([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 5);
  });

  it("handles non-linear monotonic relation via ranks", () => {
    expect(getSpearmanCorrelation([1, 2, 3, 4], [1, 4, 9, 16])).toBeCloseTo(1, 5);
  });

  it("handles tied values with average ranks", () => {
    const r = getSpearmanCorrelation([1, 1, 2, 3], [5, 5, 6, 7]);
    expect(r).toBeCloseTo(1, 5);
  });

  it("returns null for fewer than 2 points", () => {
    expect(getSpearmanCorrelation([1], [1])).toBeNull();
  });

  it("returns null on length mismatch", () => {
    expect(getSpearmanCorrelation([1, 2], [1])).toBeNull();
  });

  it("returns null when a variable has zero variance", () => {
    expect(getSpearmanCorrelation([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});
