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
import {
	passRecipientSeatIndex,
	passSenderSeatIndex,
} from "../game/seat-order.ts"
import { aiCardValue } from "./ai-card-value.ts"
import type { AiMemoryLedgerEntry } from "./ai-types.ts"

type CommonAiGameContext = {
	memoryLedger: AiMemoryLedgerEntry[]
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
		handInstruction: (context) =>
			context.publicView.phase === "passing"
				? "choose exactly three card values"
				: "choose one listed legal card value",
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
				: "choose one listed legal card value",
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
	return aiCardValue(card)
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

function playLine(
	context: AiGameContext,
	trick: {
		plays: { card: VisibleCard; playerId: PlayerId }[]
		winnerId: PlayerId
	},
	index: number,
): string {
	const plays = trick.plays
		.map(
			(play) =>
				`${playerAlias(context, play.playerId)} ${renderLedgerCard(play.card)}`,
		)
		.join(", ")
	return `${index + 1}. ${plays}. ${playerAlias(context, trick.winnerId)} won.`
}

function knownVoids(context: AiGameContextFor<"hearts">): string[] {
	const voids = new Map<PlayerId, Set<Suit>>()
	const remember = (
		plays: { card: VisibleCard; playerId: PlayerId }[],
	): void => {
		const leadSuit = plays[0]?.card.suit
		if (leadSuit === undefined) return
		for (const play of plays.slice(1)) {
			if (play.card.suit === leadSuit) continue
			const playerVoids = voids.get(play.playerId) ?? new Set<Suit>()
			playerVoids.add(leadSuit)
			voids.set(play.playerId, playerVoids)
		}
	}
	for (const trick of context.publicView.completedTricks) remember(trick.plays)
	remember(context.publicView.currentTrick)
	return context.publicView.players.flatMap((player) => {
		const suits = [...(voids.get(player.id) ?? [])]
		return suits.length === 0
			? []
			: `${playerAlias(context, player.id)} is void in ${suits.join(", ")}.`
	})
}

function heartsPoints(card: Pick<VisibleCard, "rank" | "suit">): number {
	if (card.suit === "hearts") return 1
	return card.suit === "spades" && card.rank === 12 ? 13 : 0
}

function legalPlayMeaning(
	context: AiGameContextFor<"hearts">,
	card: VisibleCard,
): string {
	const trick = context.publicView.currentTrick
	if (trick.length === 0) return "leads"
	const leadSuit = trick[0]?.card.suit
	if (card.suit !== leadSuit) {
		const points = heartsPoints(card)
		return points === 0
			? "discards; cannot win"
			: `discards ${points} point${points === 1 ? "" : "s"}; cannot win`
	}
	const currentLeader = trick.reduce((leader, play) =>
		play.card.suit === leadSuit && play.card.rank > leader.card.rank
			? play
			: leader,
	)
	if (card.rank < currentLeader.card.rank) {
		return `ducks ${aiCardValue(currentLeader.card)}`
	}
	const playerCount = context.publicView.players.length
	const playPosition = trick.length + 1
	if (playPosition === playerCount) {
		const points =
			trick.reduce((total, play) => total + heartsPoints(play.card), 0) +
			heartsPoints(card)
		return `takes the trick; ${points} point${points === 1 ? "" : "s"}`
	}
	const remaining = playerCount - playPosition
	return `overtakes ${aiCardValue(currentLeader.card)}; ${remaining} player${
		remaining === 1 ? "" : "s"
	} ${remaining === 1 ? "remains" : "remain"}`
}

function renderHeartsFacts(context: AiGameContextFor<"hearts">): string {
	const me = playerAlias(context, context.playerId)
	const playerCount = context.publicView.players.length
	const playPosition = context.publicView.currentTrick.length + 1
	const playerIndex = context.publicView.players.findIndex(
		(player) => player.id === context.playerId,
	)
	const passRecipient =
		context.publicView.players[
			passRecipientSeatIndex(
				playerIndex,
				playerCount,
				context.publicView.passDirection,
			)
		]
	const passSender =
		context.publicView.players[
			passSenderSeatIndex(
				playerIndex,
				playerCount,
				context.publicView.passDirection,
			)
		]
	const phaseLine =
		context.publicView.phase === "passing"
			? `Hearts, round ${context.publicView.roundNumber}. Pass ${
					context.publicView.passDirection
				}. You are ${me}. You pass to ${
					passRecipient === undefined
						? "an unknown player"
						: playerAlias(context, passRecipient.id)
				} and receive from ${
					passSender === undefined
						? "an unknown player"
						: playerAlias(context, passSender.id)
				}.`
			: `Hearts, round ${context.publicView.roundNumber}, trick ${
					context.publicView.trickNumber + 1
				}. Hearts are ${
					context.publicView.heartsBroken ? "broken" : "intact"
				}. You are ${me}, playing ${playPosition} of ${playerCount}.`
	const players = context.publicView.players.map(
		(player) =>
			`${playerAlias(context, player.id)}${
				player.id === context.playerId ? " (you)" : ""
			}, ${player.name}: score ${player.score}, round points ${
				player.roundPoints
			}, ${player.handCardIds.length} cards.`,
	)
	const hand = context.privateView.cards.map(aiCardValue).join(", ") || "empty"
	const legal = context.privateView.cards
		.filter((card) => context.privateView.playableCardIds.includes(card.id))
		.map((card) => `${aiCardValue(card)} (${legalPlayMeaning(context, card)})`)
		.join(", ")
	const currentTrick =
		context.publicView.currentTrick.length === 0
			? "You lead."
			: context.publicView.currentTrick
					.map(
						(play) =>
							`${playerAlias(context, play.playerId)} ${aiCardValue(play.card)}`,
					)
					.join(", ")
	const completed =
		context.publicView.completedTricks.length === 0
			? ["None."]
			: context.publicView.completedTricks.map((trick, index) =>
					playLine(context, trick, index),
				)
	const passMemory =
		context.memoryLedger.length === 0
			? ["None."]
			: context.memoryLedger.map((entry) => {
					const cards = entry.cards.map(aiCardValue).join(", ")
					return entry.kind === "cardsPassed"
						? `Gave ${playerAlias(context, entry.recipientId)} ${cards}.`
						: `Received ${cards} from ${playerAlias(context, entry.senderId)}.`
				})
	const voids = knownVoids(context)
	const instruction =
		context.publicView.phase === "passing"
			? "Choose exactly three different card values from your hand."
			: `Legal plays: ${legal}. Choose one legal card value.`

	return [
		phaseLine,
		"",
		"Players:",
		...players,
		"",
		`Your hand: ${hand}.`,
		instruction,
		"",
		...(context.publicView.phase === "playing"
			? [
					"Current trick:",
					currentTrick,
					"",
					"Completed play:",
					...completed,
					"",
				]
			: []),
		`Pass ${context.publicView.passDirection}:`,
		...passMemory,
		...(voids.length === 0 ? [] : ["", "Known voids:", ...voids]),
		"",
		"Current plan:",
		context.previousPlan || "None.",
	].join("\n")
}

function renderLegacyGameFacts(context: AiGameContext): string {
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
		"Information boundary: exact values appear only in your hand/pass memory and public tricks; opponent hands expose counts only. Deck values are unique, so compact card codes preserve card identity after IDs are omitted from history.",
	].join("\n")
}

export function renderAiGameFacts(context: AiGameContext): string {
	assertMatchingGameKinds(
		context.privateView,
		context.publicView,
		"AI public and private views describe different games.",
	)
	return context.publicView.gameKind === "hearts"
		? renderHeartsFacts(context as AiGameContextFor<"hearts">)
		: renderLegacyGameFacts(context)
}
