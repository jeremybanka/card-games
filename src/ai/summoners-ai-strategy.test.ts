import { describe, expect, it } from "vitest"

import type { PlayerId } from "../game/game-types.ts"
import {
	createSummonersGame,
	createSummonersPhysicalCardIds,
	joinSummonersGame,
	selectSummonersDeck,
	startSummonersGame,
	toSummonersPrivatePlayerView,
	toSummonersPublicGameView,
} from "../summoners/summoners-engine.ts"
import { renderAiGameFacts, type AiGameContextFor } from "./ai-game-facts.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import { fallbackAiDecision } from "./ai-strategy.ts"

const lunaId =
	"user::00000000-0000-4000-8000-0000000000a1" satisfies PlayerId
const rivalId =
	"user::00000000-0000-4000-8000-0000000000b2" satisfies PlayerId

function physicalCards() {
	let index = 0
	return createSummonersPhysicalCardIds(() => `summoners-ai-${index++}`)
}

describe("Summoners AI strategy", () => {
	it("chooses a starter deck without exposing opaque card IDs", () => {
		let state = createSummonersGame("LUNA", lunaId, "Luna", physicalCards())
		state.players[0]!.aiModel = "gpt-5.6-luna"
		state.players[0]!.kind = "ai"
		const context: AiGameContextFor<"summoners"> = {
			memoryLedger: [],
			playerId: lunaId,
			previousPlan: "",
			privateView: toSummonersPrivatePlayerView(state, lunaId),
			publicView: toSummonersPublicGameView(state),
		}

		const decision = fallbackAiDecision(context)
		expect(decision.nextAction).toEqual({
			action: "selectDeck",
			deck: "emberReliquary",
		})
		expect(aiGameStrategy("summoners").isLegalAction(
			context,
			decision.nextAction,
		)).toBe(true)
		const facts = renderAiGameFacts(context)
		expect(facts).toContain("Valid deck IDs")
		expect(facts).not.toContain("card::")
	})

	it("produces a legal action from a private hand and a public battlefield", () => {
		let state = createSummonersGame("LUNA", lunaId, "Luna", physicalCards())
		state.players[0]!.aiModel = "gpt-5.6-luna"
		state.players[0]!.kind = "ai"
		state = joinSummonersGame(state, rivalId, "Rival Luna", {
			aiModel: "gpt-5.6-luna",
			kind: "ai",
		})
		state = selectSummonersDeck(state, lunaId, "emberReliquary")
		state = selectSummonersDeck(state, rivalId, "verdantCompact")
		state = startSummonersGame(state, lunaId, () => 0.375)
		const context: AiGameContextFor<"summoners"> = {
			memoryLedger: [],
			playerId: lunaId,
			previousPlan: "",
			privateView: toSummonersPrivatePlayerView(state, lunaId),
			publicView: toSummonersPublicGameView(state),
		}

		const decision = fallbackAiDecision(context)
		expect(
			aiGameStrategy("summoners").isLegalAction(
				context,
				decision.nextAction,
			),
		).toBe(true)
		const facts = renderAiGameFacts(context)
		expect(facts).toContain("Your private hand:")
		expect(facts).toContain("Hidden-information boundary")
		expect(facts).not.toContain("card::")
	})

	it("rejects malformed model actions", () => {
		const strategy = aiGameStrategy("summoners")
		expect(
			strategy.parseDecision({
				currentPlan: "Invent a target.",
				nextAction: {
					action: "attack",
					attacker: "the big one",
					target: "the enemy",
				},
			}).ok,
		).toBe(false)
		expect(
			strategy.parseDecision({
				currentPlan: "Cheat.",
				nextAction: { action: "peekAtOpponentHand" },
			}).ok,
		).toBe(false)
	})
})
