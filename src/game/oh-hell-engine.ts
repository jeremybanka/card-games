import type { AiModelId } from "../ai/ai-models.ts"
import { createDeck, createPhysicalCardIds } from "./hearts-engine.ts"
import type {
	CardId,
	CardValue,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	Suit,
	VisibleCard,
} from "./hearts-types.ts"

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
	passSelection: CardId[] | null
	taken: CardId[]
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
	heartsBroken: boolean
	hostId: PlayerId | null
	lastTrickWinnerId: PlayerId | null
	leftoverCardId: CardId | null
	passDirection: "hold"
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

const copy = (state: OhHellState): OhHellState => structuredClone(state)
const secureRandom = (): number =>
	(crypto.getRandomValues(new Uint32Array(1))[0] as number) / 4_294_967_296

function shuffled<T>(input: readonly T[], random: () => number): T[] {
	const result = [...input]
	for (let index = result.length - 1; index > 0; index -= 1) {
		const swap = Math.floor(random() * (index + 1))
		;[result[index], result[swap]] = [result[swap] as T, result[index] as T]
	}
	return result
}

function playerIndex(state: OhHellState, id: PlayerId): number {
	const index = state.players.findIndex((player) => player.id === id)
	if (index < 0) throw new OhHellRuleError("That player is not at the table.")
	return index
}

function nextPlayerId(state: OhHellState, id: PlayerId): PlayerId {
	return (
		state.players[
			(playerIndex(state, id) + 1) % state.players.length
		] as OhHellPlayer
	).id
}

function value(state: OhHellState, id: CardId): CardValue {
	const card = state.cardValues[id]
	if (card === undefined) throw new OhHellRuleError("That card is not active.")
	return card
}

function visible(state: OhHellState, id: CardId): VisibleCard {
	return { id, ...value(state, id) }
}

function sortHand(state: OhHellState, hand: CardId[]): CardId[] {
	const suitOrder: Record<Suit, number> = {
		clubs: 0,
		diamonds: 1,
		spades: 2,
		hearts: 3,
	}
	return [...hand].sort((a, b) => {
		const left = value(state, a)
		const right = value(state, b)
		return (
			suitOrder[left.suit] - suitOrder[right.suit] || left.rank - right.rank
		)
	})
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
		heartsBroken: false,
		hostId,
		lastTrickWinnerId: null,
		leftoverCardId: null,
		passDirection: "hold",
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
				passSelection: null,
				taken: [],
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
	const next = copy(state)
	const existing = next.players.find((player) => player.id === id)
	if (existing) {
		existing.connected = true
		existing.name = name
		return next
	}
	if (next.phase !== "lobby")
		throw new OhHellRuleError("This game is already in progress.")
	if (next.players.length >= OH_HELL_PLAYER_MAXIMUM)
		throw new OhHellRuleError("This table already has four players.")
	next.players.push({
		...controller,
		bid: null,
		connected: true,
		hand: [],
		id,
		name,
		roundPoints: 0,
		score: 0,
		tricksWon: 0,
		passSelection: null,
		taken: [],
	})
	next.statusMessage =
		next.players.length < 3
			? "Invite one more player."
			: "The host can start the game."
	return next
}

export function disconnectOhHellPlayer(
	state: OhHellState,
	id: PlayerId,
): OhHellState {
	const next = copy(state)
	const player = next.players.find((candidate) => candidate.id === id)
	if (!player) return next
	if (next.phase === "lobby") {
		next.players = next.players.filter((candidate) => candidate.id !== id)
		if (next.hostId === id) next.hostId = next.players[0]?.id ?? null
	} else {
		player.connected = false
		next.statusMessage = `${player.name} disconnected. Waiting for them to return.`
	}
	return next
}

export function dealOhHellRound(
	state: OhHellState,
	random: () => number = secureRandom,
): OhHellState {
	const next = copy(state)
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
		player.passSelection = null
		player.taken = []
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
	const next = copy(state)
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
	const next = copy(state)
	if (next.phase !== "playing")
		throw new OhHellRuleError("The round is not ready for play.")
	if (next.currentPlayerId !== id)
		throw new OhHellRuleError("It is not your turn.")
	const player = next.players[playerIndex(next, id)] as OhHellPlayer
	if (!player.hand.includes(cardId))
		throw new OhHellRuleError("That card is not in your hand.")
	if (!playableOhHellCardIdsFor(next, id).includes(cardId))
		throw new OhHellRuleError("You must follow suit.")
	player.hand = player.hand.filter((candidate) => candidate !== cardId)
	next.currentTrick.push({ cardId, playerId: id })
	if (next.currentTrick.length < next.players.length) {
		next.currentPlayerId = nextPlayerId(next, id)
		next.statusMessage = `${next.players[playerIndex(next, next.currentPlayerId)]?.name} to play.`
		return next
	}
	const winnerId = trickWinner(next)
	const winner = next.players[playerIndex(next, winnerId)] as OhHellPlayer
	winner.tricksWon += 1
	next.completedTricks.push({
		leftoverAward: null,
		plays: next.currentTrick.map((play) => ({ ...play })),
		winnerId,
	})
	next.lastTrickWinnerId = winnerId
	next.currentTrick = []
	next.trickNumber += 1
	if (next.players.every((candidate) => candidate.hand.length === 0))
		scoreRound(next)
	else {
		next.currentPlayerId = winnerId
		next.trickLeaderId = winnerId
		next.statusMessage = `${winner.name} takes the trick and leads.`
	}
	return next
}

export function startOhHellGame(
	state: OhHellState,
	hostId: PlayerId,
	random?: () => number,
): OhHellState {
	if (state.hostId !== hostId)
		throw new OhHellRuleError("Only the host can start the game.")
	if (state.phase !== "lobby")
		throw new OhHellRuleError("The game has already started.")
	return dealOhHellRound(state, random)
}

export function startNextOhHellRound(
	state: OhHellState,
	hostId: PlayerId,
	random?: () => number,
): OhHellState {
	if (state.hostId !== hostId)
		throw new OhHellRuleError("Only the host can deal the next round.")
	if (state.phase !== "roundComplete")
		throw new OhHellRuleError("The current round is not complete.")
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

export function toOhHellPublicGameView(state: OhHellState): PublicGameView {
	const publicCard = (id: CardId) => visible(state, id)
	return {
		bidPlayerId: state.phase === "bidding" ? state.currentPlayerId : null,
		bidsSubmitted: state.players.filter((player) => player.bid !== null).length,
		completedTricks: state.completedTricks.map((trick) => ({
			leftoverAward: null,
			plays: trick.plays.map((play) => ({
				card: publicCard(play.cardId),
				playerId: play.playerId,
			})),
			winnerId: trick.winnerId,
		})),
		currentPlayerId: state.currentPlayerId,
		currentTrick: state.currentTrick.map((play) => ({
			card: publicCard(play.cardId),
			playerId: play.playerId,
		})),
		dealerId: state.dealerId,
		deckCardIds: state.trumpCardId === null ? [] : [state.trumpCardId],
		gameKind: "ohHell",
		heartsBroken: false,
		hostId: state.hostId,
		lastTrickWinnerId: state.lastTrickWinnerId,
		maximumRounds: OH_HELL_HAND_SCHEDULE.length,
		passDirection: "hold",
		passSubmittedPlayerIds: [],
		phase: state.phase,
		players: state.players.map((player) => ({
			aiModel: player.aiModel,
			bid: player.bid,
			capturedCardIds: [],
			connected: player.connected,
			handCardIds: [...player.hand],
			id: player.id,
			kind: player.kind,
			name: player.name,
			roundPoints: player.roundPoints,
			score: player.score,
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
): PrivatePlayerView {
	const player = state.players.find((candidate) => candidate.id === id)
	if (!player)
		return {
			awardedLeftoverCard: null,
			cards: [],
			legalBids: [],
			passSubmitted: false,
			playableCardIds: [],
			playerId: null,
		}
	return {
		awardedLeftoverCard: null,
		cards: player.hand.map((cardId) => visible(state, cardId)),
		legalBids: legalBidsFor(state, id),
		passSubmitted: false,
		playableCardIds: playableOhHellCardIdsFor(state, id),
		playerId: id,
	}
}
