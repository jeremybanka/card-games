import { describe, expect, it } from "vitest"

import {
	summonersCardKeywords,
	summonersKeywordLabel,
} from "./summoners-glossary.ts"

describe("Summoners glossary", () => {
	it("collects and deduplicates innate and granted card keywords", () => {
		expect(
			summonersCardKeywords({
				grantedKeywords: ["leech", "guard"],
				keywords: ["guard", "rush"],
			}),
		).toEqual(["guard", "rush", "leech"])
	})

	it("gives keywords display labels", () => {
		expect(summonersKeywordLabel("leech")).toBe("Leech")
	})
})
