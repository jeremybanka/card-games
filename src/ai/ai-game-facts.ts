import type {
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	Rank,
	Suit,
	VisibleCard,
} from "../game/hearts-types.ts"
import type { AiTurnObservation } from "./ai-types.ts"

export type AiGameContext = {
	observations: AiTurnObservation[]
	playerId: PlayerId
	previousPlan: string
	privateView: PrivatePlayerView
	publicView: PublicGameView
}

const suitNames: Record<Suit, string> = {
	clubs: "clubs",
	diamonds: "diamonds",
	hearts: "hearts",
	spades: "spades",
}

function rankName(rank: Rank): string {
	switch (rank) {
		case 11:
			return "jack"
		case 12:
			return "queen"
		case 13:
			return "king"
		case 14:
			return "ace"
		default:
			return String(rank)
	}
}

export function renderVisibleCard(card: VisibleCard): string {
	return `${rankName(card.rank)} of ${suitNames[card.suit]} [${card.id}]`
}

function renderPlayers(context: AiGameContext): string[] {
	return context.publicView.players.map((player, index) => {
		const perspective =
			player.id === context.playerId ? "you" : `opponent ${index + 1}`
		const controller =
			player.kind === "ai"
				? `AI using ${player.aiModel ?? "an unspecified model"}`
				: "human"
		return [
			`- ${perspective}: ${player.name} (${controller})`,
			`score ${player.score}`,
			`${player.handCardIds.length} cards in hand`,
			`${player.capturedCardIds.length} captured cards`,
			player.connected ? "connected" : "disconnected",
		].join("; ")
	})
}

function renderCurrentTrick(context: AiGameContext): string[] {
	if (context.publicView.currentTrick.length === 0)
		return ["- No cards played."]
	return context.publicView.currentTrick.map((play, index) => {
		const player =
			context.publicView.players.find(
				(candidate) => candidate.id === play.playerId,
			)?.name ?? "Unknown player"
		return `- Play ${index + 1}: ${player} played ${renderVisibleCard(play.card)}.`
	})
}

export function renderAiGameFacts(context: AiGameContext): string {
	const me = context.publicView.players.find(
		(player) => player.id === context.playerId,
	)
	const currentPlayer =
		context.publicView.players.find(
			(player) => player.id === context.publicView.currentPlayerId,
		)?.name ?? "none"
	const hand =
		context.privateView.cards.length === 0
			? ["- Your hand is empty."]
			: context.privateView.cards.map(
					(card) =>
						`- ${renderVisibleCard(card)}${
							context.privateView.playableCardIds.includes(card.id)
								? " — legal now"
								: ""
						}`,
				)
	const observations =
		context.observations.length === 0
			? ["- No prior observations."]
			: context.observations
					.slice(-12)
					.map((entry) => `- ${entry.turnKey}: ${entry.observation}`)

	return [
		"# Hearts table facts",
		`Room: ${context.publicView.roomCode}`,
		`You are: ${me?.name ?? context.playerId}`,
		`Phase: ${context.publicView.phase}`,
		`Round: ${context.publicView.roundNumber}`,
		`Trick: ${context.publicView.trickNumber + 1}`,
		`Current player: ${currentPlayer}`,
		`Hearts broken: ${context.publicView.heartsBroken ? "yes" : "no"}`,
		`Pass direction: ${context.publicView.passDirection}`,
		"",
		"## Seats",
		...renderPlayers(context),
		"",
		"## Current trick (public information)",
		...renderCurrentTrick(context),
		"",
		"## Your private hand",
		...hand,
		"",
		"## Legal opaque card IDs",
		context.privateView.playableCardIds.length === 0
			? "- None."
			: `- ${context.privateView.playableCardIds.join(", ")}`,
		"",
		"## Previous plan",
		context.previousPlan || "No plan yet.",
		"",
		"## Recent private observation journal",
		...observations,
		"",
		"Only the values listed in your private hand and current public trick are visible. Opponent hands are represented only by counts.",
	].join("\n")
}
