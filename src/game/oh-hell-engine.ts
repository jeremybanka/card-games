import type { AiModelId } from "../ai/ai-models.ts"
import {
	cardValue,
	createDeck,
	createPhysicalCardIds,
	secureRandom,
	shuffled,
	sortedHand,
	visibleCard,
} from "./standard-deck-domain.ts"
import type {
	CardId,
	CardValue,
	OhHellPrivatePlayerView,
	OhHellPublicGameView,
	PlayerId,
	Suit,
	VisibleCard,
} from "./game-types.ts"
import {
	advanceIncompleteTrick,
	beginCardPlay,
	completeTrick,
	copyGameState,
	disconnectTablePlayer,
	joinTablePlayer,
	nextPlayerId as sharedNextPlayerId,
	playerIndex as sharedPlayerIndex,
	projectPublicPlayer,
	projectVisibleTrick,
	requireHostAction,
} from "./trick-taking-domain.ts"

export const OH_HELL_PLAYER_MINIMUM = 3
export const OH_HELL_PLAYER_MAXIMUM = 4
export const OH_HELL_HAND_SCHEDULE = [5, 4, 3, 2, 1] as const

export type OhHellPlayer = {
	aiModel: AiModelId | null
	bid: number | null
	connected: boolean
	hand: CardId[]
	id: PlayerId
	kind: "ai" | "human"
	name: string
	roundPoints: number
	score: number
	tricksWon: number
}

export type OhHellState = {
	cardValues: Partial<Record<CardId, CardValue>>
	completedTricks: Array<{
		leftoverAward: null
		plays: Array<{ cardId: CardId; playerId: PlayerId }>
		winnerId: PlayerId
	}>
	currentPlayerId: PlayerId | null
	currentTrick: Array<{ cardId: CardId; playerId: PlayerId }>
	dealerId: PlayerId | null
	gameKind: "ohHell"
	hostId: PlayerId | null
	lastTrickWinnerId: PlayerId | null
	phase: "lobby" | "bidding" | "playing" | "roundComplete" | "gameComplete"
	physicalCardIds: CardId[]
	players: OhHellPlayer[]
	roomCode: string
	roundHandSize: number
	roundNumber: number
	statusMessage: string
	trickLeaderId: PlayerId | null
	trickNumber: number
	trumpCardId: CardId | null
	trumpSuit: Suit | null
	winnerIds: PlayerId[]
}

export class OhHellRuleError extends Error {}

function playerIndex(state: OhHellState, id: PlayerId): number {
	return sharedPlayerIndex(
		state,
		id,
		() => new OhHellRuleError("That player is not at the table."),
	)
}

function nextPlayerId(state: OhHellState, id: PlayerId): PlayerId {
	return sharedNextPlayerId(
		state,
		id,
		() => new OhHellRuleError("That player is not at the table."),
	)
}

function value(state: OhHellState, id: CardId): CardValue {
	return cardValue(
		state,
		id,
		() => new OhHellRuleError("That card is not active."),
	)
}

function visible(state: OhHellState, id: CardId): VisibleCard {
	return visibleCard(
		state,
		id,
		() => new OhHellRuleError("That card is not active."),
	)
}

function sortHand(state: OhHellState, hand: CardId[]): CardId[] {
	return sortedHand(
		state,
		hand,
		() => new OhHellRuleError("That card is not active."),
	)
}

export function createOhHellGame(
	roomCode: string,
	hostId: PlayerId,
	hostName: string,
	physicalCardIds = createPhysicalCardIds(),
): OhHellState {
	return {
		cardValues: {},
		completedTricks: [],
		currentPlayerId: null,
		currentTrick: [],
		dealerId: null,
		gameKind: "ohHell",
		hostId,
		lastTrickWinnerId: null,
		phase: "lobby",
		physicalCardIds,
		players: [
			{
				aiModel: null,
				bid: null,
				connected: true,
				hand: [],
				id: hostId,
				kind: "human",
				name: hostName,
				roundPoints: 0,
				score: 0,
				tricksWon: 0,
			},
		],
		roomCode,
		roundHandSize: 0,
		roundNumber: 0,
		statusMessage: "Invite two or three more players.",
		trickLeaderId: null,
		trickNumber: 0,
		trumpCardId: null,
		trumpSuit: null,
		winnerIds: [],
	}
}

export function joinOhHellGame(
	state: OhHellState,
	id: PlayerId,
	name: string,
	controller: Pick<OhHellPlayer, "aiModel" | "kind"> = {
		aiModel: null,
		kind: "human",
	},
): OhHellState {
	return joinTablePlayer(state, id, name, controller, {
		createPlayer: ({
			controller: nextController,
			playerId,
			playerName,
		}): OhHellPlayer => ({
			...nextController,
			bid: null,
			connected: true,
			hand: [],
			id: playerId,
			name: playerName,
			roundPoints: 0,
			score: 0,
			tricksWon: 0,
		}),
		fullTableError: () =>
			new OhHellRuleError("This table already has four players."),
		inProgressError: () =>
			new OhHellRuleError("This game is already in progress."),
		maximumPlayers: OH_HELL_PLAYER_MAXIMUM,
		minimumPlayers: OH_HELL_PLAYER_MINIMUM,
		waitingStatus: "Invite one more player.",
	})
}

export function disconnectOhHellPlayer(
	state: OhHellState,
	id: PlayerId,
): OhHellState {
	return disconnectTablePlayer(state, id)
}

export function dealOhHellRound(
	state: OhHellState,
	random: () => number = secureRandom,
): OhHellState {
	const next = copyGameState(state)
	if (next.players.length < 3 || next.players.length > 4)
		throw new OhHellRuleError("Oh Hell needs three or four players.")
	if (next.players.some((player) => !player.connected))
		throw new OhHellRuleError("Every player must be connected before dealing.")
	const handSize = OH_HELL_HAND_SCHEDULE[next.roundNumber]
	if (handSize === undefined) throw new OhHellRuleError("The game is complete.")
	next.roundNumber += 1
	next.roundHandSize = handSize
	next.cardValues = {}
	next.completedTricks = []
	next.currentTrick = []
	next.currentPlayerId = null
	next.lastTrickWinnerId = null
	next.trickLeaderId = null
	next.trickNumber = 0
	next.trumpCardId = null
	next.trumpSuit = null
	next.winnerIds = []
	for (const player of next.players) {
		player.bid = null
		player.hand = []
		player.roundPoints = 0
		player.tricksWon = 0
	}
	const deck = shuffled(createDeck(), random)
	const ids = shuffled(next.physicalCardIds, random)
	for (const [index, card] of deck.entries())
		next.cardValues[ids[index] as CardId] = card
	next.dealerId =
		next.players[(next.roundNumber - 1) % next.players.length]?.id ?? null
	const first = nextPlayerId(next, next.dealerId as PlayerId)
	let deckIndex = 0
	for (let card = 0; card < handSize; card += 1) {
		for (let seat = 0; seat < next.players.length; seat += 1) {
			const recipient = next.players[
				(playerIndex(next, first) + seat) % next.players.length
			] as OhHellPlayer
			recipient.hand.push(ids[deckIndex++] as CardId)
		}
	}
	for (const player of next.players) player.hand = sortHand(next, player.hand)
	next.trumpCardId = ids[deckIndex] ?? null
	next.trumpSuit =
		next.trumpCardId === null ? null : value(next, next.trumpCardId).suit
	next.phase = "bidding"
	next.currentPlayerId = first
	next.statusMessage = `${next.players[playerIndex(next, first)]?.name} bids first.`
	return next
}

export function legalBidsFor(state: OhHellState, id: PlayerId): number[] {
	if (state.phase !== "bidding" || state.currentPlayerId !== id) return []
	const bids = Array.from({ length: state.roundHandSize + 1 }, (_, bid) => bid)
	if (id !== state.dealerId) return bids
	const total = state.players.reduce(
		(sum, player) => sum + (player.bid ?? 0),
		0,
	)
	return bids.filter((bid) => total + bid !== state.roundHandSize)
}

export function submitOhHellBid(
	state: OhHellState,
	id: PlayerId,
	bid: number,
): OhHellState {
	const next = copyGameState(state)
	if (next.phase !== "bidding")
		throw new OhHellRuleError("Bidding is not open.")
	if (next.currentPlayerId !== id)
		throw new OhHellRuleError("It is not your turn to bid.")
	if (!Number.isInteger(bid) || !legalBidsFor(next, id).includes(bid))
		throw new OhHellRuleError("That bid is not allowed.")
	const player = next.players[playerIndex(next, id)] as OhHellPlayer
	player.bid = bid
	if (next.players.every((candidate) => candidate.bid !== null)) {
		const leader = nextPlayerId(next, next.dealerId as PlayerId)
		next.phase = "playing"
		next.currentPlayerId = leader
		next.trickLeaderId = leader
		next.statusMessage = `${next.players[playerIndex(next, leader)]?.name} leads.`
	} else {
		next.currentPlayerId = nextPlayerId(next, id)
		next.statusMessage = `${next.players[playerIndex(next, next.currentPlayerId)]?.name} to bid.`
	}
	return next
}

export function playableOhHellCardIdsFor(
	state: OhHellState,
	id: PlayerId,
): CardId[] {
	if (state.phase !== "playing" || state.currentPlayerId !== id) return []
	const hand = state.players[playerIndex(state, id)]?.hand ?? []
	const lead = state.currentTrick[0]
	if (!lead) return [...hand]
	const suit = value(state, lead.cardId).suit
	const following = hand.filter((cardId) => value(state, cardId).suit === suit)
	return following.length > 0 ? following : [...hand]
}

function trickWinner(state: OhHellState): PlayerId {
	const first = state.currentTrick[0]
	if (!first) throw new OhHellRuleError("The trick is empty.")
	const leadSuit = value(state, first.cardId).suit
	let winner = first
	for (const play of state.currentTrick.slice(1)) {
		const card = value(state, play.cardId)
		const winning = value(state, winner.cardId)
		const cardTrump = card.suit === state.trumpSuit
		const winningTrump = winning.suit === state.trumpSuit
		if (
			(cardTrump && !winningTrump) ||
			(cardTrump === winningTrump &&
				card.suit === winning.suit &&
				card.rank > winning.rank) ||
			(!winningTrump && card.suit === leadSuit && winning.suit !== leadSuit)
		)
			winner = play
	}
	return winner.playerId
}

function scoreRound(state: OhHellState): void {
	for (const player of state.players) {
		player.roundPoints =
			player.bid === player.tricksWon ? 10 + player.tricksWon : player.tricksWon
		player.score += player.roundPoints
	}
	if (state.roundNumber >= OH_HELL_HAND_SCHEDULE.length) {
		const best = Math.max(...state.players.map((player) => player.score))
		state.winnerIds = state.players
			.filter((player) => player.score === best)
			.map((player) => player.id)
		state.phase = "gameComplete"
		state.statusMessage =
			state.winnerIds.length === 1
				? `${state.players.find((player) => player.id === state.winnerIds[0])?.name} wins the game.`
				: "The game ends in a tie."
	} else {
		state.phase = "roundComplete"
		state.statusMessage = "Round complete. Review the scores."
	}
	state.currentPlayerId = null
	state.trickLeaderId = null
}

export function playOhHellCard(
	state: OhHellState,
	id: PlayerId,
	cardId: CardId,
): OhHellState {
	const { next } = beginCardPlay(state, id, cardId, {
		illegalCardError: () => new OhHellRuleError("You must follow suit."),
		inactiveRoundError: () =>
			new OhHellRuleError("The round is not ready for play."),
		notInHandError: () => new OhHellRuleError("That card is not in your hand."),
		notPlayersTurnError: () => new OhHellRuleError("It is not your turn."),
		playableCardIds: playableOhHellCardIdsFor,
		playerError: () => new OhHellRuleError("That player is not at the table."),
	})
	if (
		advanceIncompleteTrick(
			next,
			id,
			() => new OhHellRuleError("That player is not at the table."),
		)
	) {
		return next
	}
	const winnerId = trickWinner(next)
	const winner = next.players[playerIndex(next, winnerId)] as OhHellPlayer
	winner.tricksWon += 1
	const completed = completeTrick(
		next,
		winnerId,
		null,
		() => new OhHellRuleError("That player is not at the table."),
	)
	if (completed.handsEmpty) {
		scoreRound(next)
	}
	return next
}

export function startOhHellGame(
	state: OhHellState,
	hostId: PlayerId,
	random?: () => number,
): OhHellState {
	requireHostAction(
		state,
		hostId,
		"lobby",
		() => new OhHellRuleError("Only the host can start the game."),
		() => new OhHellRuleError("The game has already started."),
	)
	return dealOhHellRound(state, random)
}

export function startNextOhHellRound(
	state: OhHellState,
	hostId: PlayerId,
	random?: () => number,
): OhHellState {
	requireHostAction(
		state,
		hostId,
		"roundComplete",
		() => new OhHellRuleError("Only the host can deal the next round."),
		() => new OhHellRuleError("The current round is not complete."),
	)
	return dealOhHellRound(state, random)
}

export function restartOhHellGame(
	state: OhHellState,
	hostId: PlayerId,
): OhHellState {
	if (state.hostId !== hostId)
		throw new OhHellRuleError("Only the host can restart the game.")
	const next = createOhHellGame(
		state.roomCode,
		hostId,
		state.players[playerIndex(state, hostId)]?.name ?? "Host",
		state.physicalCardIds,
	)
	next.players = state.players.map((player) => ({
		...player,
		bid: null,
		hand: [],
		roundPoints: 0,
		score: 0,
		tricksWon: 0,
	}))
	next.statusMessage = "The host can start a new game."
	return next
}

export function toOhHellPublicGameView(
	state: OhHellState,
): OhHellPublicGameView {
	const publicCard = (id: CardId) => visible(state, id)
	return {
		bidPlayerId: state.phase === "bidding" ? state.currentPlayerId : null,
		bidsSubmitted: state.players.filter((player) => player.bid !== null).length,
		completedTricks: state.completedTricks.map((trick) => ({
			leftoverAward: null,
			plays: projectVisibleTrick(trick.plays, publicCard),
			winnerId: trick.winnerId,
		})),
		currentPlayerId: state.currentPlayerId,
		currentTrick: projectVisibleTrick(state.currentTrick, publicCard),
		dealerId: state.dealerId,
		deckCardIds: state.trumpCardId === null ? [] : [state.trumpCardId],
		gameKind: "ohHell",
		hostId: state.hostId,
		lastTrickWinnerId: state.lastTrickWinnerId,
		maximumRounds: OH_HELL_HAND_SCHEDULE.length,
		phase: state.phase,
		players: state.players.map((player) => ({
			...projectPublicPlayer(player),
			bid: player.bid,
			tricksWon: player.tricksWon,
		})),
		roomCode: state.roomCode,
		roundHandSize: state.roundHandSize,
		roundNumber: state.roundNumber,
		statusMessage: state.statusMessage,
		trickLeaderId: state.trickLeaderId,
		trickNumber: state.trickNumber,
		trumpSuit: state.trumpSuit,
		winnerIds: [...state.winnerIds],
	}
}

export function toOhHellPrivatePlayerView(
	state: OhHellState,
	id: PlayerId,
): OhHellPrivatePlayerView {
	const player = state.players.find((candidate) => candidate.id === id)
	if (!player)
		return {
			cards: [],
			gameKind: "ohHell",
			legalBids: [],
			playableCardIds: [],
			playerId: null,
		}
	return {
		cards: player.hand.map((cardId) => visible(state, cardId)),
		gameKind: "ohHell",
		legalBids: legalBidsFor(state, id),
		playableCardIds: playableOhHellCardIdsFor(state, id),
		playerId: id,
	}
}
