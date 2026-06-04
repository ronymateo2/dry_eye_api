import { describe, expect, it } from "vitest";
import { parseJson, stringifyNullable } from "./json";

describe("parseJson", () => {
  it("parses valid JSON", () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("returns null for null/undefined/empty", () => {
    expect(parseJson(null)).toBeNull();
    expect(parseJson(undefined)).toBeNull();
    expect(parseJson("")).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    expect(parseJson("{not json")).toBeNull();
  });
});

describe("stringifyNullable", () => {
  it("stringifies truthy values", () => {
    expect(stringifyNullable([1, 2])).toBe("[1,2]");
    expect(stringifyNullable({ a: 1 })).toBe('{"a":1}');
  });

  it("returns null for falsy values", () => {
    expect(stringifyNullable(null)).toBeNull();
    expect(stringifyNullable(undefined)).toBeNull();
    expect(stringifyNullable("")).toBeNull();
    expect(stringifyNullable(0)).toBeNull();
  });
});
