/**
 * The shared shape predicates: what they accept, and what they refuse.
 */
import { describe, expect, it } from "vitest";
import { isRecord } from "../../src/shared/predicates";

describe("isRecord", () => {
	it("accepts a plain object, empty included", () => {
		expect(isRecord({})).toBe(true);
		expect(isRecord({ a: 1 })).toBe(true);
		expect(isRecord(Object.create(null))).toBe(true);
	});

	it("refuses null, arrays, and primitives", () => {
		expect(isRecord(null)).toBe(false);
		expect(isRecord([])).toBe(false);
		expect(isRecord([1, 2])).toBe(false);
		expect(isRecord("text")).toBe(false);
		expect(isRecord(42)).toBe(false);
		expect(isRecord(true)).toBe(false);
		expect(isRecord(undefined)).toBe(false);
	});

	it("narrows the value for the caller", () => {
		const value: unknown = { kind: "record" };
		if (!isRecord(value)) throw new Error("expected a record");
		expect(value.kind).toBe("record");
	});
});
