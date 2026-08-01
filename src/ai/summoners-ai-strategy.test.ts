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
	type SummonersState,
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

function putBlueprintInHand(
	state: SummonersState,
	playerIndex: number,
	blueprintId: string,
): void {
	const player = state.players[playerIndex]
	if (player === undefined) throw new Error("Missing Summoners player.")
	if (
		player.hand.some(
			(cardId) => state.cardBlueprintById[cardId] === blueprintId,
		)
	) {
		return
	}
	const deckIndex = player.deck.findIndex(
		(cardId) => state.cardBlueprintById[cardId] === blueprintId,
	)
	const replacedCardId = player.hand[0]
	if (deckIndex === -1 || replacedCardId === undefined) {
		throw new Error(`${blueprintId} is unavailable for this test.`)
	}
	player.hand[0] = player.deck[deckIndex]!
	player.deck[deckIndex] = replacedCardId
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
		expect(facts).toContain("Select deck `emberReliquary`")
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
		expect(
			aiGameStrategy("summoners").isLegalAction(context, {
				action: "endTurn",
			}),
		).toBe(true)
		const facts = renderAiGameFacts(context)
		expect(facts).toContain("## Your hand")
		expect(facts).toContain("## Legal actions now")
		expect(facts).toContain("## End-turn audit")
		expect(facts).toContain("Unspent Spark:")
		expect(facts).toContain("choose exactly one listed legal action now")
		expect(facts).not.toContain("complete ordered sequence")
		expect(facts).toContain("[Guard](#guard)")
		expect(facts).toContain("### Guard")
		expect(facts).not.toContain("### Leech")
		expect(facts).toContain("Power status: unused this turn")
		expect(facts).toContain("Hidden-information boundary")
		expect(facts).not.toContain("card::")
		expect(aiGameStrategy("summoners").systemPrompt).toContain(
			"Summoners has no blocking or response window",
		)

		const continuingFacts = renderAiGameFacts({
			...context,
			previousPlan: "Build a wide board, then convert readiness into pressure.",
			summonersTurnLedger: [
				{
					action: {
						action: "playCard",
						card: "Cinderwing Finch",
						target: null,
					},
					actionReason: "A Rush Being converts Spark into immediate pressure.",
				},
			],
		})
		expect(continuingFacts).toContain("## Turn objective")
		expect(continuingFacts).toContain(
			"Build a wide board, then convert readiness into pressure.",
		)
		expect(continuingFacts).toContain("## Resolved actions this turn")
		expect(continuingFacts).toContain("Play Cinderwing Finch")
		expect(continuingFacts).toContain(
			"A Rush Being converts Spark into immediate pressure.",
		)
		expect(continuingFacts).toContain("Repeat the existing turn objective")
	})

	it("teaches attack-trigger-attack sequencing for readying keywords", () => {
		let state = createSummonersGame("FLOW", lunaId, "Luna", physicalCards())
		state = joinSummonersGame(state, rivalId, "Rival Luna")
		state = selectSummonersDeck(state, lunaId, "tidemarkMenagerie")
		state = selectSummonersDeck(state, rivalId, "emberReliquary")
		state = startSummonersGame(state, lunaId, () => 0.375)
		putBlueprintInHand(state, 0, "mistfin-minnow")
		putBlueprintInHand(state, 1, "brasshorn-ibex")

		const currentFacts = renderAiGameFacts({
			memoryLedger: [],
			playerId: lunaId,
			previousPlan: "",
			privateView: toSummonersPrivatePlayerView(state, lunaId),
			publicView: toSummonersPublicGameView(state),
		})
		expect(currentFacts).toContain("## Keyword strategy")
		expect(currentFacts).toContain(
			"attack with the ready Being first, cause a bonus draw to ready it, then attack with it again",
		)

		const blazeFacts = renderAiGameFacts({
			memoryLedger: [],
			playerId: rivalId,
			previousPlan: "",
			privateView: toSummonersPrivatePlayerView(state, rivalId),
			publicView: toSummonersPublicGameView(state),
		})
		expect(blazeFacts).toContain(
			"attack with the ready Being first, spend your last Spark to ready it, then attack with it again",
		)
	})

	it("parses one next action and rejects malformed model actions", () => {
		const strategy = aiGameStrategy("summoners")
		expect(
			strategy.parseDecision({
				actionReason: "Develop the board before spending readiness.",
				nextAction: {
					action: "playCard",
					card: "Cinder Pup",
					target: null,
				},
				turnObjective:
					"Develop a rushing attacker and convert it into pressure.",
			}),
		).toEqual({
			ok: true,
			value: {
				actionReason: "Develop the board before spending readiness.",
				currentPlan:
					"Develop a rushing attacker and convert it into pressure.",
				nextAction: {
					action: "playCard",
					card: "Cinder Pup",
					target: null,
				},
			},
		})
		expect(
			strategy.parseDecision({
				actionReason: "Attack an invented target.",
				nextAction: {
					action: "attack",
					attacker: "the big one",
					target: "the enemy",
				},
				turnObjective: "Invent a target.",
			}).ok,
		).toBe(false)
		expect(
			strategy.parseDecision({
				actionReason: "Gain hidden information.",
				nextAction: { action: "peekAtOpponentHand" },
				turnObjective: "Cheat.",
			}).ok,
		).toBe(false)
	})
})
