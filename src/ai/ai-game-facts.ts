import type {
	HeartsPrivatePlayerView,
	HeartsPublicGameView,
	GameKind,
	OhHellPrivatePlayerView,
	OhHellPublicGameView,
	PlayerId,
	PrivatePlayerView,
	PrivatePlayerViewFor,
	PublicGameView,
	PublicGameViewFor,
	Rank,
	Suit,
	VisibleCard,
} from "../game/game-types.ts"
import {
	assertMatchingGameKinds,
	registeredGameAdapter,
} from "../game/game-registry.ts"
import type { AiMemoryLedgerEntry, AiTurnObservation } from "./ai-types.ts"

type CommonAiGameContext = {
	memoryLedger: AiMemoryLedgerEntry[]
	observations: AiTurnObservation[]
	playerId: PlayerId
	previousPlan: string
}

export type AiGameContextFor<Kind extends GameKind> = CommonAiGameContext & {
	privateView: PrivatePlayerViewFor<Kind>
	publicView: PublicGameViewFor<Kind>
}

export type AiGameContext = {
	[Kind in GameKind]: AiGameContextFor<Kind>
}[GameKind]

type AiFactsAdapter<PublicView, PrivateView> = {
	gameDetails: (
		context: AiGameContext & {
			privateView: PrivateView
			publicView: PublicView
		},
	) => string
	handInstruction: (
		context: AiGameContext & {
			privateView: PrivateView
			publicView: PublicView
		},
	) => string
	title: string
}

const aiFactsAdapters = {
	hearts: {
		gameDetails: (context) =>
			`hearts ${
				context.publicView.heartsBroken ? "broken" : "intact"
			} | pass ${context.publicView.passDirection}`,
		handInstruction: () => "during passing choose any 3 IDs",
		title: "Hearts",
	} satisfies AiFactsAdapter<HeartsPublicGameView, HeartsPrivatePlayerView>,
	ohHell: {
		gameDetails: (context) => {
			const me = context.publicView.players.find(
				(player) => player.id === context.playerId,
			)
			return `trump ${context.publicView.trumpSuit ?? "none"} | bid ${
				me?.bid ?? "pending"
			} | tricks ${me?.tricksWon ?? 0}`
		},
		handInstruction: (context) =>
			context.publicView.phase === "bidding"
				? `legal bids: ${context.privateView.legalBids.join(", ")}`
				: "during play choose one card ID from a hand row labeled LEGAL",
		title: "Oh Hell",
	} satisfies AiFactsAdapter<OhHellPublicGameView, OhHellPrivatePlayerView>,
} satisfies {
	[Kind in GameKind]: AiFactsAdapter<
		Extract<PublicGameView, { gameKind: Kind }>,
		Extract<PrivatePlayerView, { gameKind: Kind }>
	>
}

function aiFactsAdapter(
	context: AiGameContext,
): AiFactsAdapter<PublicGameView, PrivatePlayerView> {
	assertMatchingGameKinds(
		context.privateView,
		context.publicView,
		"AI public and private views describe different games.",
	)
	return registeredGameAdapter<
		AiFactsAdapter<PublicGameView, PrivatePlayerView>
	>(context.publicView.gameKind, aiFactsAdapters)
}

const suitCodes: Record<Suit, string> = {
	clubs: "C",
	diamonds: "D",
	hearts: "H",
	spades: "S",
}

function rankCode(rank: Rank): string {
	switch (rank) {
		case 11:
			return "J"
		case 12:
			return "Q"
		case 13:
			return "K"
		case 14:
			return "A"
		case 10:
			return "T"
		default:
			return String(rank)
	}
}

export function renderVisibleCard(card: VisibleCard): string {
	return `${rankCode(card.rank)}${suitCodes[card.suit]} [${card.id}]`
}

function renderLedgerCard(card: VisibleCard): string {
	return `${rankCode(card.rank)}${suitCodes[card.suit]}`
}

function playerAlias(context: AiGameContext, playerId: PlayerId): string {
	const index = context.publicView.players.findIndex(
		(player) => player.id === playerId,
	)
	return index === -1 ? playerId : `P${index}`
}

function renderPlayers(context: AiGameContext): string[] {
	return context.publicView.players.map((player, index) => {
		const perspective = player.id === context.playerId ? " YOU" : ""
		const controller =
			player.kind === "ai" ? `AI:${player.aiModel ?? "unspecified"}` : "human"
		return `- P${index}${perspective} ${player.name} (${controller}): score=${
			player.score
		} hand=${player.handCardIds.length} captured=${
			player.capturedCardIds?.length ?? 0
		} ${player.connected ? "connected" : "disconnected"}`
	})
}

function renderCurrentTrick(context: AiGameContext): string[] {
	if (context.publicView.currentTrick.length === 0) return ["- empty"]
	return [
		`- ${context.publicView.currentTrick
			.map(
				(play) =>
					`${playerAlias(context, play.playerId)} ${renderLedgerCard(
						play.card,
					)}`,
			)
			.join(" | ")}`,
	]
}

function renderCompletedTricks(context: AiGameContext): string[] {
	if (context.publicView.completedTricks.length === 0) {
		return ["- none"]
	}
	return context.publicView.completedTricks.map((trick, index) => {
		const plays = trick.plays
			.map(
				(play) =>
					`${playerAlias(context, play.playerId)} ${renderLedgerCard(
						play.card,
					)}`,
			)
			.join(" | ")
		return `- T${index + 1}>${playerAlias(context, trick.winnerId)}: ${plays}`
	})
}

function renderMemoryLedger(
	context: AiGameContext,
	entry: AiMemoryLedgerEntry,
): string {
	const cards = entry.cards.map(renderLedgerCard).join(" ")
	return entry.kind === "cardsPassed"
		? `- R${entry.roundNumber} pass ${entry.direction} -> ${playerAlias(
				context,
				entry.recipientId,
			)}: ${cards}`
		: `- R${entry.roundNumber} receive ${entry.direction} <- ${playerAlias(
				context,
				entry.senderId,
			)}: ${cards}`
}

export function renderAiGameFacts(context: AiGameContext): string {
	const adapter = aiFactsAdapter(context)
	const me = context.publicView.players.find(
		(player) => player.id === context.playerId,
	)
	const currentPlayer =
		context.publicView.currentPlayerId === null
			? "none"
			: playerAlias(context, context.publicView.currentPlayerId)
	const hand =
		context.privateView.cards.length === 0
			? ["- empty"]
			: context.privateView.cards.map(
					(card) =>
						`- ${renderVisibleCard(card)}${
							context.privateView.playableCardIds.includes(card.id)
								? " — LEGAL"
								: ""
						}`,
				)
	const observations =
		context.observations.length === 0
			? ["- none"]
			: context.observations
					.slice(-12)
					.map((entry) => `- ${entry.turnKey}: ${entry.observation}`)
	const memoryLedger =
		context.memoryLedger.length === 0
			? ["- none"]
			: context.memoryLedger.map((entry) => renderMemoryLedger(context, entry))
	const gameDetails = adapter.gameDetails(context)

	return [
		`# ${adapter.title} facts (cards: T/J/Q/K/A; suits: C/D/H/S)`,
		`Table ${context.publicView.roomCode} | you ${playerAlias(
			context,
			context.playerId,
		)} ${me?.name ?? context.playerId} | phase ${
			context.publicView.phase
		} | round ${context.publicView.roundNumber} | trick ${
			context.publicView.trickNumber + 1
		} | turn ${currentPlayer} | ${gameDetails}`,
		"",
		"## Seats",
		...renderPlayers(context),
		"",
		"## Current trick (public, play order)",
		...renderCurrentTrick(context),
		"",
		"## Completed tricks (public, Tn>winner: plays in order)",
		...renderCompletedTricks(context),
		"",
		`## Hand (${adapter.handInstruction(context)})`,
		...hand,
		"",
		"## Plan",
		context.previousPlan || "none",
		"",
		"## Private pass memory",
		...memoryLedger,
		"",
		"## Recent private observations",
		...observations,
		"",
		"Information boundary: exact values appear only in your hand/pass memory and public tricks; opponent hands expose counts only. Deck values are unique, so compact card codes preserve card identity after IDs are omitted from history.",
	].join("\n")
}
