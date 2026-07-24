// @vitest-environment happy-dom

import { waitFor } from "@testing-library/react"
import { realtimeStateProvider } from "atom.io/realtime-server"
import { multiClient } from "atom.io/realtime-testing"
import { RealtimeContext, usePullAtom } from "atom.io/realtime-react"
import { createElement, type Context, useContext, useEffect } from "react"
import type { Socket } from "socket.io-client"
import { describe, expect, it } from "vitest"

import { parsePlayCardPayload } from "../game/hearts-actions.ts"
import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "../game/hearts-state.ts"
import type {
	CardId,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
} from "../game/hearts-types.ts"

const aiCardId = "card::ai-private-queen" satisfies CardId
const humanCardId = "card::human-private-ace" satisfies CardId

function publicView(playerId: PlayerId): PublicGameView {
	return {
		completedTricks: [],
		currentPlayerId: playerId,
		currentTrick: [],
		deckCardIds: [],
		heartsBroken: false,
		hostId: playerId,
		lastTrickWinnerId: null,
		passDirection: "hold",
		passSubmittedPlayerIds: [],
		phase: "playing",
		players: [
			{
				aiModel: "gpt-5.6-terra",
				capturedCardIds: [],
				connected: true,
				handCardIds: [aiCardId],
				id: playerId,
				kind: "ai",
				name: "Terra AI",
				roundPoints: 0,
				score: 0,
			},
		],
		roomCode: "TEST",
		roundNumber: 1,
		statusMessage: "Your play.",
		trickLeaderId: playerId,
		trickNumber: 1,
		winnerIds: [],
	}
}

function privateView(
	playerId: PlayerId,
	role: "ai" | "human",
): PrivatePlayerView {
	const ownCard: PrivatePlayerView["cards"][number] =
		role === "ai"
			? { id: aiCardId, rank: 12 as const, suit: "spades" as const }
			: { id: humanCardId, rank: 14 as const, suit: "hearts" as const }
	return {
		awardedLeftoverCard: null,
		cards: [ownCard],
		passSubmitted: false,
		playableCardIds: [ownCard.id],
		playerId,
	}
}

function createBoundaryClient(emitAction: boolean) {
	return function BoundaryClient() {
		const game = usePullAtom(publicGameViewAtom)
		const hand = usePullAtom(privatePlayerViewAtom)
		const { socket } = useContext(
			RealtimeContext as unknown as Context<{ socket: Socket | null }>,
		)
		useEffect(() => {
			const cardId = hand.playableCardIds[0]
			if (!emitAction || socket === null || cardId === undefined) return
			socket.emit("playCard", cardId)
		}, [hand.playableCardIds, socket])
		return createElement(
			"boundary-client",
			null,
			`${game.roomCode}:${hand.cards
				.map((card) => `${card.rank}-${card.suit}-${card.id}`)
				.join(",")}`,
		)
	}
}

describe("AI realtime isolation", () => {
	it("serves each simulated player only its own private hand", async () => {
		const harness = multiClient({
			clients: {
				AI: createBoundaryClient(false),
				HUMAN: createBoundaryClient(false),
			},
			server: ({ silo, socket, userKey }) => {
				const role = userKey.includes("AI-") ? "ai" : "human"
				const provide = realtimeStateProvider({
					consumer: userKey,
					socket,
					store: silo.store,
				})
				const disposePublic = provide(publicGameViewAtom, publicView(userKey))
				const disposePrivate = provide(
					privatePlayerViewAtom,
					privateView(userKey, role),
				)
				return () => {
					disposePrivate()
					disposePublic()
				}
			},
		})
		const ai = harness.clients.AI.init()
		const human = harness.clients.HUMAN.init()
		try {
			await waitFor(() => {
				expect(ai.renderResult.container.textContent).toContain(aiCardId)
				expect(human.renderResult.container.textContent).toContain(humanCardId)
			})
			expect(ai.renderResult.container.textContent).not.toContain(humanCardId)
			expect(human.renderResult.container.textContent).not.toContain(aiCardId)
		} finally {
			await harness.teardown()
		}
	})

	it("submits an AI intent through the same validated socket action", async () => {
		const received = new Map<PlayerId, CardId>()
		const harness = multiClient({
			clients: {
				AI: createBoundaryClient(true),
			},
			server: ({ silo, socket, userKey }) => {
				const provide = realtimeStateProvider({
					consumer: userKey,
					socket,
					store: silo.store,
				})
				const disposePublic = provide(publicGameViewAtom, publicView(userKey))
				const disposePrivate = provide(
					privatePlayerViewAtom,
					privateView(userKey, "ai"),
				)
				socket.on("playCard", (cardId) => {
					const payload = parsePlayCardPayload({ cardId })
					received.set(userKey, payload.cardId)
				})
				return () => {
					disposePrivate()
					disposePublic()
				}
			},
		})
		harness.clients.AI.init()
		try {
			await waitFor(() => {
				expect([...received.values()]).toEqual([aiCardId])
			})
		} finally {
			await harness.teardown()
		}
	})
})
