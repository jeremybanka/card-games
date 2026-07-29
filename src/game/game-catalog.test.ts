import { describe, expect, it } from "vitest"

import {
	gameCatalog,
	gameKinds,
	isGameKind,
	parseGameKind,
	privatePlayerView,
	publicGameView,
} from "./game-catalog.ts"
import type { CardId, PlayerId } from "./game-types.ts"

const hostId = "user::catalog-host" satisfies PlayerId
const physicalCardIds = Array.from(
	{ length: 52 },
	(_, index) => `card::catalog-${index}` as CardId,
)

describe("game catalog", () => {
	it("registers every supported game exactly once", () => {
		expect(Object.keys(gameCatalog)).toEqual(gameKinds)
		expect(new Set(gameKinds).size).toBe(gameKinds.length)
	})

	it.each(gameKinds)(
		"dispatches %s public and private projections through its registration",
		(kind) => {
			const game = gameCatalog[kind]
			const state = game.createInitialState(
				"WIND",
				hostId,
				"Ada",
				physicalCardIds,
			)

			expect(publicGameView(state).gameKind).toBe(kind)
			expect(privatePlayerView(state, hostId).gameKind).toBe(kind)
		},
	)

	it("validates external kinds instead of defaulting unknown games to Hearts", () => {
		expect(isGameKind("hearts")).toBe(true)
		expect(isGameKind("ohHell")).toBe(true)
		expect(isGameKind("summons")).toBe(false)
		expect(() => parseGameKind("summons")).toThrow(
			"Choose a supported card game.",
		)
	})
})
