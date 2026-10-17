/**
 * The closed failure vocabulary: the set itself, and the one recovery text
 * each code owns (architecture.md → 闭集错误码体系).
 */
import { describe, expect, it } from "vitest";
import {
	FAILURE_CODES,
	isFailureCode,
	recoveryFor,
} from "../../src/failure/codes";

/** The architecture table, in table order. A closed set is the one case a
 * literal list is the criterion: adding or dropping a code is a design change. */
const DOCUMENTED_CODES = [
	"ID_NAME_INVALID",
	"ID_LOCATION_UNKNOWN",
	"ID_NOT_FOUND",
	"ID_AMBIGUOUS",
	"REF_PATH_INVALID",
	"PATH_NOT_FOUND",
	"READ_FAILED",
	"FILE_NOT_TEXT",
	"SECTION_NOT_FOUND",
	"FILTER_INVALID",
	"BATCH_EMPTY",
	"NOT_LOADED",
	"LOCATION_READ_ONLY",
	"TARGET_EXISTS",
	"WRITE_FAILED",
] as const;

function sorted(codes: readonly string[]): string[] {
	return [...codes].sort();
}

describe("the closed code set", () => {
	it("is exactly the fifteen codes the architecture table lists", () => {
		expect(sorted(FAILURE_CODES)).toEqual(sorted(DOCUMENTED_CODES));
	});

	it("holds no duplicate code", () => {
		expect(new Set(FAILURE_CODES).size).toBe(FAILURE_CODES.length);
	});
});

describe("recoveryFor", () => {
	it("gives every code a non-empty sentence", () => {
		for (const code of FAILURE_CODES) {
			expect(recoveryFor(code).trim().length).toBeGreaterThan(0);
		}
	});

	it("keeps one recovery per code, so codes are not merged by accident", () => {
		const recoveries = FAILURE_CODES.map((code) => recoveryFor(code));
		expect(new Set(recoveries).size).toBe(FAILURE_CODES.length);
	});
});

describe("isFailureCode", () => {
	it("accepts every member of the set", () => {
		for (const code of FAILURE_CODES) {
			expect(isFailureCode(code)).toBe(true);
		}
	});

	it("rejects values outside the set", () => {
		expect(isFailureCode("ID_EMPTY_NAME")).toBe(false);
		expect(isFailureCode("")).toBe(false);
		expect(isFailureCode(undefined)).toBe(false);
		expect(isFailureCode(42)).toBe(false);
	});
});
