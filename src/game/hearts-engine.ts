import type { AiModelId } from "../ai/ai-models.ts"
import {
	cardValue as sharedCardValue,
	createDeck,
	createPhysicalCardIds,
	secureRandom,
	shuffled,
	sortedHand as sharedSortedHand,
	visibleCard as sharedVisibleCard,
} from "./card-domain.ts"
import type {
	CardId,
	CardValue,
	HeartsPhase,
	HeartsPrivatePlayerView,
	HeartsPublicGameView,
	PassDirection,
	PlayerId,
	Rank,
	TrickPlay,
	VisibleCard,
} from "./game-types.ts"
import { passRecipientSeatIndex } from "./seat-order.ts"
import {
	advanceIncompleteTrick,
	beginCardPlay,
	completeTrick,
	copyGameState,
	disconnectTablePlayer,
	joinTablePlayer,
	playerIndex as sharedPlayerIndex,
	projectPublicPlayer,
	projectVisibleTrick,
	requireHostAction,
} from "./trick-taking-domain.ts"

export const HEARTS_PLAYER_MINIMUM = 2
export const HEARTS_PLAYER_MAXIMUM = 4
export const HEARTS_GAME_END_SCORE = 100
export const PASS_CARD_COUNT = 3

export type HeartsPlayer = {
	aiModel: AiModelId | null
	connected: boolean
	hand: CardId[]
	id: PlayerId
	kind: "ai" | "human"
	name: string
	passSelection: CardId[] | null
	roundPoints: number
	score: number
	taken: CardId[]
}

export type HeartsState = {
	cardValues: Partial<Record<CardId, CardValue>>
	completedTricks: Array<{
		leftoverAward: {
			cardId: CardId
			recipientId: PlayerId
		} | null
		plays: Array<{ cardId: CardId; playerId: PlayerId }>
		winnerId: PlayerId
	}>
	currentPlayerId: PlayerId | null
	currentTrick: Array<{ cardId: CardId; playerId: PlayerId }>
	gameKind: "hearts"
	heartsBroken: boolean
	hostId: PlayerId | null
	lastTrickWinnerId: PlayerId | null
	leftoverCardId: CardId | null
	passDirection: PassDirection
	phase: HeartsPhase
	physicalCardIds: CardId[]
	players: HeartsPlayer[]
	roomCode: string
	roundNumber: number
	statusMessage: string
	trickLeaderId: PlayerId | null
	trickNumber: number
	winnerIds: PlayerId[]
}

export class HeartsRuleError extends Error {}

function cardValue(state: HeartsState, cardId: CardId): CardValue {
	return sharedCardValue(
		state,
		cardId,
		() => new HeartsRuleError("That card is not active in this round."),
	)
}

function visibleCard(state: HeartsState, cardId: CardId): VisibleCard {
	return sharedVisibleCard(
		state,
		cardId,
		() => new HeartsRuleError("That card is not active in this round."),
	)
}

function playerIndex(state: HeartsState, playerId: PlayerId): number {
	return sharedPlayerIndex(
		state,
		playerId,
		() => new HeartsRuleError("That player is not at the table."),
	)
}

function isPointCard(value: CardValue): boolean {
	return (
		value.suit === "hearts" || (value.suit === "spades" && value.rank === 12)
	)
}

function sortedHand(state: HeartsState, hand: readonly CardId[]): CardId[] {
	return sharedSortedHand(
		state,
		hand,
		() => new HeartsRuleError("That card is not active in this round."),
	)
}

function passDirectionFor(
	roundNumber: number,
	playerCount: number,
): PassDirection {
	if (playerCount === 2) {
		return ["across", "hold"][(roundNumber - 1) % 2] as PassDirection
	}
	if (playerCount === 3) {
		return ["left", "right", "hold"][(roundNumber - 1) % 3] as PassDirection
	}
	return ["left", "right", "across", "hold"][
		(roundNumber - 1) % 4
	] as PassDirection
}

function directionLabel(direction: PassDirection): string {
	switch (direction) {
		case "left":
			return "Choose three cards to pass left."
		case "right":
			return "Choose three cards to pass right."
		case "across":
			return "Choose three cards to pass across."
		case "hold":
			return "Hold round. No passing."
	}
}

function lowestClubOwner(state: HeartsState): PlayerId {
	let lowest: { playerId: PlayerId; rank: Rank } | null = null
	for (const player of state.players) {
		for (const cardId of player.hand) {
			const value = cardValue(state, cardId)
			if (value.suit !== "clubs") continue
			if (lowest === null || value.rank < lowest.rank) {
				lowest = { playerId: player.id, rank: value.rank }
			}
		}
	}
	if (lowest === null) throw new HeartsRuleError("The deal contains no clubs.")
	return lowest.playerId
}

export function createHeartsGame(
	roomCode: string,
	hostId: PlayerId,
	hostName: string,
	physicalCardIds = createPhysicalCardIds(),
): HeartsState {
	return {
		cardValues: {},
		completedTricks: [],
		currentPlayerId: null,
		currentTrick: [],
		gameKind: "hearts",
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
				connected: true,
				hand: [],
				id: hostId,
				kind: "human",
				name: hostName,
				passSelection: null,
				roundPoints: 0,
				score: 0,
				taken: [],
			},
		],
		roomCode,
		roundNumber: 0,
		statusMessage: "Invite at least one more player.",
		trickLeaderId: null,
		trickNumber: 0,
		winnerIds: [],
	}
}

export function joinHeartsGame(
	state: HeartsState,
	playerId: PlayerId,
	playerName: string,
	controller: Pick<HeartsPlayer, "aiModel" | "kind"> = {
		aiModel: null,
		kind: "human",
	},
): HeartsState {
	return joinTablePlayer(state, playerId, playerName, controller, {
		createPlayer: ({
			controller: nextController,
			playerId: id,
			playerName: name,
		}): HeartsPlayer => ({
			...nextController,
			connected: true,
			hand: [],
			id,
			name,
			passSelection: null,
			roundPoints: 0,
			score: 0,
			taken: [],
		}),
		fullTableError: () =>
			new HeartsRuleError("This table already has four players."),
		inProgressError: () =>
			new HeartsRuleError("This game is already in progress."),
		maximumPlayers: HEARTS_PLAYER_MAXIMUM,
		minimumPlayers: HEARTS_PLAYER_MINIMUM,
		waitingStatus: "Invite at least one more player.",
	})
}

export function disconnectHeartsPlayer(
	state: HeartsState,
	playerId: PlayerId,
): HeartsState {
	return disconnectTablePlayer(state, playerId)
}

export function dealHeartsRound(
	state: HeartsState,
	random: () => number = secureRandom,
): HeartsState {
	const next = copyGameState(state)
	if (
		next.players.length < HEARTS_PLAYER_MINIMUM ||
		next.players.length > HEARTS_PLAYER_MAXIMUM
	) {
		throw new HeartsRuleError("Hearts needs between two and four players.")
	}
	if (next.players.some((player) => !player.connected)) {
		throw new HeartsRuleError("Every player must be connected before dealing.")
	}

	next.roundNumber += 1
	next.cardValues = {}
	next.completedTricks = []
	next.currentTrick = []
	next.heartsBroken = false
	next.lastTrickWinnerId = null
	next.leftoverCardId = null
	next.trickNumber = 0
	next.winnerIds = []

	for (const player of next.players) {
		player.hand = []
		player.taken = []
		player.roundPoints = 0
		player.passSelection = null
	}

	const values = shuffled(createDeck(), random)
	const activeIds = shuffled(next.physicalCardIds, random).slice(
		0,
		values.length,
	)
	for (const [index, cardId] of activeIds.entries()) {
		next.cardValues[cardId] = values[index] as CardValue
		if (next.players.length === 3 && index === activeIds.length - 1) {
			next.leftoverCardId = cardId
			continue
		}
		const player = next.players[index % next.players.length] as HeartsPlayer
		player.hand.push(cardId)
	}
	for (const player of next.players) {
		player.hand = sortedHand(next, player.hand)
	}

	next.passDirection = passDirectionFor(next.roundNumber, next.players.length)
	next.phase = next.passDirection === "hold" ? "playing" : "passing"
	if (next.phase === "playing") {
		next.currentPlayerId = lowestClubOwner(next)
		next.trickLeaderId = next.currentPlayerId
		next.statusMessage = `${next.players.find((player) => player.id === next.currentPlayerId)?.name} leads the lowest club.`
	} else {
		next.currentPlayerId = null
		next.trickLeaderId = null
		next.statusMessage = directionLabel(next.passDirection)
	}
	return next
}

export function submitPass(
	state: HeartsState,
	playerId: PlayerId,
	cardIds: readonly CardId[],
): HeartsState {
	const next = copyGameState(state)
	if (next.phase !== "passing") {
		throw new HeartsRuleError("Cards are not being passed right now.")
	}
	const player = next.players[playerIndex(next, playerId)] as HeartsPlayer
	if (player.passSelection !== null) {
		throw new HeartsRuleError("You have already submitted your pass.")
	}
	const uniqueIds = new Set(cardIds)
	if (uniqueIds.size !== PASS_CARD_COUNT) {
		throw new HeartsRuleError("Choose exactly three different cards.")
	}
	if ([...uniqueIds].some((cardId) => !player.hand.includes(cardId))) {
		throw new HeartsRuleError("You can only pass cards from your own hand.")
	}
	player.passSelection = [...uniqueIds]
	next.statusMessage = "Waiting for every player to choose three cards."

	if (next.players.some((candidate) => candidate.passSelection === null)) {
		return next
	}

	const originalHands = next.players.map((candidate) => [...candidate.hand])
	for (const candidate of next.players) {
		const selected = candidate.passSelection as CardId[]
		candidate.hand = candidate.hand.filter(
			(cardId) => !selected.includes(cardId),
		)
	}
	for (const [index, candidate] of next.players.entries()) {
		const targetIndex = passRecipientSeatIndex(
			index,
			next.players.length,
			next.passDirection,
		)
		const target = next.players[targetIndex] as HeartsPlayer
		target.hand.push(...(candidate.passSelection as CardId[]))
	}
	for (const [index, candidate] of next.players.entries()) {
		if (candidate.hand.length !== originalHands[index]?.length) {
			throw new HeartsRuleError("The pass did not preserve hand sizes.")
		}
		candidate.hand = sortedHand(next, candidate.hand)
	}
	next.phase = "playing"
	next.currentPlayerId = lowestClubOwner(next)
	next.trickLeaderId = next.currentPlayerId
	next.statusMessage = `${next.players.find((candidate) => candidate.id === next.currentPlayerId)?.name} leads the lowest club.`
	return next
}

export function playableHeartsCardIdsFor(
	state: HeartsState,
	playerId: PlayerId,
): CardId[] {
	if (state.phase !== "playing" || state.currentPlayerId !== playerId) return []
	const player = state.players[playerIndex(state, playerId)] as HeartsPlayer
	const hand = [...player.hand]
	if (hand.length === 0) return []

	if (state.trickNumber === 0 && state.currentTrick.length === 0) {
		const clubs = hand.filter(
			(cardId) => cardValue(state, cardId).suit === "clubs",
		)
		const lowestClub = clubs.sort(
			(left, right) =>
				cardValue(state, left).rank - cardValue(state, right).rank,
		)[0]
		return lowestClub === undefined ? [] : [lowestClub]
	}

	const lead = state.currentTrick[0]
	if (lead !== undefined) {
		const leadSuit = cardValue(state, lead.cardId).suit
		const following = hand.filter(
			(cardId) => cardValue(state, cardId).suit === leadSuit,
		)
		if (following.length > 0) return following
		if (state.trickNumber === 0) {
			const nonPoints = hand.filter(
				(cardId) => !isPointCard(cardValue(state, cardId)),
			)
			if (nonPoints.length > 0) return nonPoints
		}
		return hand
	}

	if (!state.heartsBroken) {
		const nonHearts = hand.filter(
			(cardId) => cardValue(state, cardId).suit !== "hearts",
		)
		if (nonHearts.length > 0) return nonHearts
	}
	return hand
}

function trickWinner(state: HeartsState): PlayerId {
	const leadPlay = state.currentTrick[0]
	if (leadPlay === undefined) throw new HeartsRuleError("The trick is empty.")
	const leadSuit = cardValue(state, leadPlay.cardId).suit
	let winner = leadPlay
	for (const play of state.currentTrick.slice(1)) {
		const value = cardValue(state, play.cardId)
		const winningValue = cardValue(state, winner.cardId)
		if (value.suit === leadSuit && value.rank > winningValue.rank) winner = play
	}
	return winner.playerId
}

function scoreRound(state: HeartsState): void {
	const capturedPoints = state.players.map((player) =>
		player.taken.reduce((points, cardId) => {
			const value = cardValue(state, cardId)
			if (value.suit === "hearts") return points + 1
			if (value.suit === "spades" && value.rank === 12) return points + 13
			return points
		}, 0),
	)
	const moonShooterIndex = capturedPoints.findIndex((points) => points === 26)
	for (const [index, player] of state.players.entries()) {
		const roundPoints =
			moonShooterIndex === -1
				? (capturedPoints[index] as number)
				: index === moonShooterIndex
					? 0
					: 26
		player.roundPoints = roundPoints
		player.score += roundPoints
	}
	const gameEnded = state.players.some(
		(player) => player.score >= HEARTS_GAME_END_SCORE,
	)
	if (gameEnded) {
		const lowestScore = Math.min(...state.players.map((player) => player.score))
		state.winnerIds = state.players
			.filter((player) => player.score === lowestScore)
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

export function playHeartsCard(
	state: HeartsState,
	playerId: PlayerId,
	cardId: CardId,
): HeartsState {
	const { next } = beginCardPlay(state, playerId, cardId, {
		illegalCardError: () =>
			new HeartsRuleError("That card cannot be played right now."),
		inactiveRoundError: () =>
			new HeartsRuleError("The round is not ready for play."),
		notInHandError: () => new HeartsRuleError("That card is not in your hand."),
		notPlayersTurnError: () => new HeartsRuleError("It is not your turn."),
		playableCardIds: playableHeartsCardIdsFor,
		playerError: () => new HeartsRuleError("That player is not at the table."),
	})
	if (cardValue(next, cardId).suit === "hearts") next.heartsBroken = true

	if (
		advanceIncompleteTrick(
			next,
			playerId,
			() => new HeartsRuleError("That player is not at the table."),
		)
	) {
		return next
	}

	const winnerId = trickWinner(next)
	const winner = next.players[playerIndex(next, winnerId)] as HeartsPlayer
	const leftoverAward =
		next.leftoverCardId !== null &&
		next.currentTrick.some((play) => isPointCard(cardValue(next, play.cardId)))
			? { cardId: next.leftoverCardId, recipientId: winnerId }
			: null
	winner.taken.push(...next.currentTrick.map((play) => play.cardId))
	if (leftoverAward !== null) {
		winner.taken.push(leftoverAward.cardId)
		next.leftoverCardId = null
	}
	const completed = completeTrick(
		next,
		winnerId,
		leftoverAward,
		() => new HeartsRuleError("That player is not at the table."),
	)
	if (completed.handsEmpty) {
		scoreRound(next)
	}
	return next
}

export function restartHeartsGame(state: HeartsState, hostId: PlayerId): HeartsState {
	if (state.hostId !== hostId)
		throw new HeartsRuleError("Only the host can restart the game.")
	const next = copyGameState(state)
	next.phase = "lobby"
	next.roundNumber = 0
	next.cardValues = {}
	next.completedTricks = []
	next.currentPlayerId = null
	next.currentTrick = []
	next.heartsBroken = false
	next.lastTrickWinnerId = null
	next.leftoverCardId = null
	next.passDirection = "hold"
	next.statusMessage = "The host can start a new game."
	next.trickLeaderId = null
	next.trickNumber = 0
	next.winnerIds = []
	for (const player of next.players) {
		player.hand = []
		player.passSelection = null
		player.roundPoints = 0
		player.score = 0
		player.taken = []
	}
	return next
}

export function startHeartsGame(
	state: HeartsState,
	hostId: PlayerId,
	random: () => number = secureRandom,
): HeartsState {
	requireHostAction(
		state,
		hostId,
		"lobby",
		() => new HeartsRuleError("Only the host can start the game."),
		() => new HeartsRuleError("The game has already started."),
	)
	return dealHeartsRound(state, random)
}

export function startNextHeartsRound(
	state: HeartsState,
	hostId: PlayerId,
	random: () => number = secureRandom,
): HeartsState {
	requireHostAction(
		state,
		hostId,
		"roundComplete",
		() => new HeartsRuleError("Only the host can deal the next round."),
		() => new HeartsRuleError("The current round is not complete."),
	)
	return dealHeartsRound(state, random)
}

function publicTrick(state: HeartsState): TrickPlay[] {
	return projectVisibleTrick(state.currentTrick, (cardId) =>
		visibleCard(state, cardId),
	)
}

export function toHeartsPublicGameView(state: HeartsState): HeartsPublicGameView {
	return {
		completedTricks: state.completedTricks.map((trick) => ({
			leftoverAward:
				trick.leftoverAward === null ? null : { ...trick.leftoverAward },
			plays: trick.plays.map((play) => ({
				card: visibleCard(state, play.cardId),
				playerId: play.playerId,
			})),
			winnerId: trick.winnerId,
		})),
		currentPlayerId: state.currentPlayerId,
		currentTrick: publicTrick(state),
		deckCardIds: state.leftoverCardId === null ? [] : [state.leftoverCardId],
		gameKind: "hearts",
		heartsBroken: state.heartsBroken,
		hostId: state.hostId,
		lastTrickWinnerId: state.lastTrickWinnerId,
		passDirection: state.passDirection,
		passSubmittedPlayerIds: state.players
			.filter((player) => player.passSelection !== null)
			.map((player) => player.id),
		phase: state.phase,
		players: state.players.map((player) => ({
			...projectPublicPlayer(player),
			capturedCardIds: [...player.taken],
		})),
		roomCode: state.roomCode,
		roundNumber: state.roundNumber,
		statusMessage: state.statusMessage,
		trickLeaderId: state.trickLeaderId,
		trickNumber: state.trickNumber,
		winnerIds: [...state.winnerIds],
	}
}

export function toHeartsPrivatePlayerView(
	state: HeartsState,
	playerId: PlayerId,
): HeartsPrivatePlayerView {
	const player = state.players.find((candidate) => candidate.id === playerId)
	if (player === undefined) {
		return {
			awardedLeftoverCard: null,
			cards: [],
			gameKind: "hearts",
			passReceipt: null,
			passSubmitted: false,
			playableCardIds: [],
			playerId: null,
		}
	}
	const awardedLeftoverCardId = state.completedTricks.find(
		(trick) => trick.leftoverAward?.recipientId === playerId,
	)?.leftoverAward?.cardId
	const playerPosition = state.players.findIndex(
		(candidate) => candidate.id === playerId,
	)
	const passSender =
		state.passDirection === "hold" || state.phase === "passing"
			? undefined
			: state.players.find(
					(candidate, index) =>
						passRecipientSeatIndex(
							index,
							state.players.length,
							state.passDirection,
						) === playerPosition,
				)
	const receivedCardIds = passSender?.passSelection ?? []
	return {
		awardedLeftoverCard:
			awardedLeftoverCardId === undefined
				? null
				: visibleCard(state, awardedLeftoverCardId),
		cards: player.hand.map((cardId) => visibleCard(state, cardId)),
		gameKind: "hearts",
		passReceipt:
			passSender === undefined
				? null
				: {
						cards: receivedCardIds.map((cardId) => visibleCard(state, cardId)),
						roundNumber: state.roundNumber,
						senderId: passSender.id,
					},
		passSubmitted: player.passSelection !== null,
		playableCardIds: playableHeartsCardIdsFor(state, playerId),
		playerId,
	}
}
