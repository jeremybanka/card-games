// @vitest-environment happy-dom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react"
import { createElement, type FunctionComponent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BiddingConsole } from "./BiddingConsole.tsx"
import type { OhHellPublicGameView, PlayerId } from "./game/game-types.ts"

vi.mock("preact/jsx-runtime", async () => {
	const runtime = await vi.importActual<object>("react/jsx-runtime")
	const developmentRuntime = await vi.importActual<object>(
		"react/jsx-dev-runtime",
	)
	return { ...runtime, ...developmentRuntime }
})

vi.mock("preact/hooks", async () => {
	const react = await vi.importActual<typeof import("react")>("react")
	return {
		useEffect: react.useEffect,
		useMemo: react.useMemo,
		useState: react.useState,
	}
})

afterEach(cleanup)

const BiddingConsoleCompat = BiddingConsole as unknown as FunctionComponent<
	Parameters<typeof BiddingConsole>[0]
>
const ADA = "user::ada" satisfies PlayerId
const BEA = "user::bea" satisfies PlayerId
const CAL = "user::cal" satisfies PlayerId

function biddingView(): OhHellPublicGameView {
	return {
		bidPlayerId: ADA,
		bidsSubmitted: 2,
		completedTricks: [],
		currentPlayerId: ADA,
		currentTrick: [],
		dealerId: ADA,
		deckCardIds: [],
		gameKind: "ohHell",
		hostId: ADA,
		lastTrickWinnerId: null,
		maximumRounds: 5,
		phase: "bidding",
		players: [
			{
				aiModel: null,
				bid: null,
				connected: true,
				handCardIds: [],
				id: ADA,
				kind: "human",
				name: "Ada",
				roundPoints: 0,
				score: 14,
				tricksWon: 0,
			},
			{
				aiModel: null,
				bid: 1,
				connected: true,
				handCardIds: [],
				id: BEA,
				kind: "human",
				name: "Bea",
				roundPoints: 0,
				score: 11,
				tricksWon: 0,
			},
			{
				aiModel: null,
				bid: 1,
				connected: true,
				handCardIds: [],
				id: CAL,
				kind: "human",
				name: "Cal",
				roundPoints: 0,
				score: 2,
				tricksWon: 0,
			},
		],
		roomCode: "WIND",
		roundHandSize: 5,
		roundNumber: 1,
		statusMessage: "Ada to bid.",
		trickLeaderId: null,
		trickNumber: 0,
		trumpSuit: "hearts",
		winnerIds: [],
	}
}

describe("BiddingConsole", () => {
	it("shows table bids and explains the disabled dealer-hook chip", () => {
		render(
			createElement(BiddingConsoleCompat, {
				game: biddingView(),
				legalBids: [0, 1, 2, 4, 5],
				myPlayerId: ADA,
				onSubmitBid: vi.fn(),
			}),
		)

		expect(
			screen.getByRole("heading", { name: "Place your bid" }),
		).not.toBeNull()
		expect(screen.getByLabelText("hearts trump")).not.toBeNull()
		expect(
			screen.getByText("Bea").closest("player-bid")?.textContent,
		).toContain("1")
		const forbidden = screen.getByRole("radio", { name: "3 tricks" })
		expect((forbidden as HTMLInputElement).disabled).toBe(true)
		expect(
			screen.getByText(
				"Dealer hook: 3 is blocked so total bids cannot match 5 tricks.",
			),
		).not.toBeNull()
	})

	it("requires a chip selection and submits the selected legal bid", () => {
		const onSubmitBid = vi.fn()
		render(
			createElement(BiddingConsoleCompat, {
				game: biddingView(),
				legalBids: [0, 1, 2, 4, 5],
				myPlayerId: ADA,
				onSubmitBid,
			}),
		)

		const console = screen.getByLabelText("Oh Hell bidding")
		const submit = within(console).getByRole("button", {
			name: "Choose a chip",
		})
		expect((submit as HTMLButtonElement).disabled).toBe(true)

		fireEvent.click(within(console).getByRole("radio", { name: "2 tricks" }))
		const committed = within(console).getByRole("button", {
			name: "Bid 2 tricks",
		})
		expect((committed as HTMLButtonElement).disabled).toBe(false)
		fireEvent.click(committed)
		expect(onSubmitBid).toHaveBeenCalledWith(2)
	})
})
