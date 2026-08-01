import { describe, expect, it } from "vitest"

import {
	deriveOhHellHandSchedule,
	FAMILY_VALLEY_OH_HELL_RULES,
	maximumOhHellHandSize,
	parseOhHellRules,
	STANDARD_PAGAT_OH_HELL_RULES,
} from "./oh-hell-rules.ts"

describe("Oh Hell rules", () => {
	it("uses the standard Pagat valley schedule by default", () => {
		expect(deriveOhHellHandSchedule(STANDARD_PAGAT_OH_HELL_RULES, 4)).toEqual([
			10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
		])
		expect(deriveOhHellHandSchedule(STANDARD_PAGAT_OH_HELL_RULES, 6)[0]).toBe(8)
		expect(deriveOhHellHandSchedule(STANDARD_PAGAT_OH_HELL_RULES, 7)[0]).toBe(7)
		expect(deriveOhHellHandSchedule(STANDARD_PAGAT_OH_HELL_RULES, 12)[0]).toBe(
			4,
		)
	})

	it("supports the family valley 8–1 profile", () => {
		expect(deriveOhHellHandSchedule(FAMILY_VALLEY_OH_HELL_RULES, 4)).toEqual([
			8, 7, 6, 5, 4, 3, 2, 1, 2, 3, 4, 5, 6, 7, 8,
		])
	})

	it("derives every schedule style without repeating the turning point", () => {
		const rules = {
			...STANDARD_PAGAT_OH_HELL_RULES,
			schedule: {
				maximumHandSize: 4,
				minimumHandSize: 2,
				style: "ascending" as const,
			},
		}
		expect(deriveOhHellHandSchedule(rules, 4)).toEqual([2, 3, 4])
		expect(
			deriveOhHellHandSchedule(
				{ ...rules, schedule: { ...rules.schedule, style: "descending" } },
				4,
			),
		).toEqual([4, 3, 2])
		expect(
			deriveOhHellHandSchedule(
				{ ...rules, schedule: { ...rules.schedule, style: "valley" } },
				4,
			),
		).toEqual([4, 3, 2, 3, 4])
		expect(
			deriveOhHellHandSchedule(
				{ ...rules, schedule: { ...rules.schedule, style: "mountain" } },
				4,
			),
		).toEqual([2, 3, 4, 3, 2])
	})

	it("supports bounded flat games and enforces the 52-card deck", () => {
		const rules = {
			...STANDARD_PAGAT_OH_HELL_RULES,
			schedule: { handSize: 4, roundCount: 12, style: "flat" as const },
		}
		expect(deriveOhHellHandSchedule(rules, 12)).toEqual(
			Array.from({ length: 12 }, () => 4),
		)
		expect(maximumOhHellHandSize(12)).toBe(4)
		expect(() =>
			deriveOhHellHandSchedule(
				{ ...rules, schedule: { ...rules.schedule, handSize: 5 } },
				12,
			),
		).toThrow("at most 4 cards")
	})

	it("strictly parses untrusted realtime and local-storage input", () => {
		expect(parseOhHellRules(FAMILY_VALLEY_OH_HELL_RULES)).toEqual(
			FAMILY_VALLEY_OH_HELL_RULES,
		)
		expect(() =>
			parseOhHellRules({
				...FAMILY_VALLEY_OH_HELL_RULES,
				requireTrumpBreak: "yes",
			}),
		).toThrow("must be true or false")
	})
})
