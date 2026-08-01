import { describe, expect, it } from "vitest"

import {
	assertMatchingGameKinds,
	matchingGameKinds,
	registeredGameAdapter,
	registeredGameCapability,
} from "./game-registry.ts"
import type { GameKind } from "./game-types.ts"

const adapters = {
	hearts: { label: "Hearts" },
	ohHell: { label: "Oh Hell!" },
	summoners: { label: "Summoners" },
} satisfies Record<GameKind, { label: string }>

describe("game registry dispatch", () => {
	it("resolves total adapters by discriminator", () => {
		expect(
			registeredGameAdapter<{ label: string }>("ohHell", adapters).label,
		).toBe("Oh Hell!")
	})

	it("represents unsupported capabilities as absence", () => {
		const capabilities = {
			hearts: { canPass: true },
		} satisfies Partial<Record<GameKind, unknown>>

		expect(
			registeredGameCapability<{ canPass: boolean }>("hearts", capabilities),
		).toEqual({ canPass: true })
		expect(
			registeredGameCapability<{ canPass: boolean }>("ohHell", capabilities),
		).toBeNull()
	})

	it("checks paired discriminators before dispatch", () => {
		const hearts = { gameKind: "hearts" } as const
		const ohHell = { gameKind: "ohHell" } as const
		expect(matchingGameKinds(hearts, hearts)).toBe(true)
		expect(matchingGameKinds(hearts, ohHell)).toBe(false)
		expect(() =>
			assertMatchingGameKinds(hearts, ohHell, "mismatched views"),
		).toThrow("mismatched views")
	})
})
