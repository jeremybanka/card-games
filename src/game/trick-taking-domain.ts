import type { AiModelId } from "../ai/ai-models.ts"
import type {
	CardId,
	PlayerId,
	PublicPlayerView,
	TrickPlay,
	VisibleCard,
} from "./game-types.ts"

export type PlayerController = {
	aiModel: AiModelId | null
	kind: "ai" | "human"
}

export type TrickTakingPlayer = PlayerController & {
	connected: boolean
	hand: CardId[]
	id: PlayerId
	name: string
	roundPoints: number
	score: number
}

type MembershipState<Player extends TrickTakingPlayer> = {
	hostId: PlayerId | null
	phase: string
	players: Player[]
	statusMessage: string
}

type ActiveTrickState<Player extends TrickTakingPlayer> = {
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
	lastTrickWinnerId: PlayerId | null
	players: Player[]
	statusMessage: string
	trickLeaderId: PlayerId | null
	trickNumber: number
}

export function copyGameState<State>(state: State): State {
	return structuredClone(state)
}

export function playerIndex<Player extends TrickTakingPlayer>(
	state: { players: Player[] },
	playerId: PlayerId,
	error: () => Error,
): number {
	const index = state.players.findIndex((player) => player.id === playerId)
	if (index === -1) throw error()
	return index
}

export function nextPlayerId<Player extends TrickTakingPlayer>(
	state: { players: Player[] },
	playerId: PlayerId,
	error: () => Error,
): PlayerId {
	const index = playerIndex(state, playerId, error)
	return (state.players[(index + 1) % state.players.length] as Player).id
}

export function joinTablePlayer<
	Player extends TrickTakingPlayer,
	State extends MembershipState<Player>,
>(
	state: State,
	playerId: PlayerId,
	playerName: string,
	controller: PlayerController,
	options: {
		createPlayer: (details: {
			controller: PlayerController
			playerId: PlayerId
			playerName: string
		}) => Player
		fullTableError: () => Error
		inProgressError: () => Error
		maximumPlayers: number
		minimumPlayers: number
		waitingStatus: string
	},
): State {
	const next = copyGameState(state)
	const existing = next.players.find((player) => player.id === playerId)
	if (existing !== undefined) {
		existing.connected = true
		existing.name = playerName
		return next
	}
	if (next.phase !== "lobby") throw options.inProgressError()
	if (next.players.length >= options.maximumPlayers) {
		throw options.fullTableError()
	}
	next.players.push(options.createPlayer({ controller, playerId, playerName }))
	next.statusMessage =
		next.players.length < options.minimumPlayers
			? options.waitingStatus
			: "The host can start the game."
	return next
}

export function disconnectTablePlayer<
	Player extends TrickTakingPlayer,
	State extends MembershipState<Player>,
>(state: State, playerId: PlayerId): State {
	const next = copyGameState(state)
	const player = next.players.find((candidate) => candidate.id === playerId)
	if (player === undefined) return next
	if (next.phase === "lobby") {
		next.players = next.players.filter((candidate) => candidate.id !== playerId)
		if (next.hostId === playerId) next.hostId = next.players[0]?.id ?? null
	} else {
		player.connected = false
		next.statusMessage = `${player.name} disconnected. Waiting for them to return.`
	}
	return next
}

export function beginCardPlay<
	Player extends TrickTakingPlayer,
	State extends ActiveTrickState<Player> & { phase: string },
>(
	state: State,
	playerId: PlayerId,
	cardId: CardId,
	options: {
		illegalCardError: () => Error
		inactiveRoundError: () => Error
		notInHandError: () => Error
		notPlayersTurnError: () => Error
		playableCardIds: (state: State, playerId: PlayerId) => CardId[]
		playerError: () => Error
	},
): { next: State; player: Player } {
	const next = copyGameState(state)
	if (next.phase !== "playing") throw options.inactiveRoundError()
	if (next.currentPlayerId !== playerId) throw options.notPlayersTurnError()
	const player = next.players[
		playerIndex(next, playerId, options.playerError)
	] as Player
	if (!player.hand.includes(cardId)) throw options.notInHandError()
	if (!options.playableCardIds(next, playerId).includes(cardId)) {
		throw options.illegalCardError()
	}
	player.hand = player.hand.filter((candidate) => candidate !== cardId)
	next.currentTrick.push({ cardId, playerId })
	return { next, player }
}

export function advanceIncompleteTrick<
	Player extends TrickTakingPlayer,
	State extends ActiveTrickState<Player>,
>(state: State, playerId: PlayerId, playerError: () => Error): boolean {
	if (state.currentTrick.length >= state.players.length) return false
	state.currentPlayerId = nextPlayerId(state, playerId, playerError)
	state.statusMessage = `${
		state.players[playerIndex(state, state.currentPlayerId, playerError)]?.name
	} to play.`
	return true
}

export function completeTrick<
	Player extends TrickTakingPlayer,
	State extends ActiveTrickState<Player>,
>(
	state: State,
	winnerId: PlayerId,
	leftoverAward: {
		cardId: CardId
		recipientId: PlayerId
	} | null,
	playerError: () => Error,
): { handsEmpty: boolean; winner: Player } {
	const winner = state.players[
		playerIndex(state, winnerId, playerError)
	] as Player
	state.completedTricks.push({
		leftoverAward,
		plays: state.currentTrick.map((play) => ({ ...play })),
		winnerId,
	})
	state.lastTrickWinnerId = winnerId
	state.currentTrick = []
	state.trickNumber += 1
	const handsEmpty = state.players.every(
		(candidate) => candidate.hand.length === 0,
	)
	if (!handsEmpty) {
		state.currentPlayerId = winnerId
		state.trickLeaderId = winnerId
		state.statusMessage = `${winner.name} takes the trick and leads.`
	}
	return { handsEmpty, winner }
}

export function requireHostAction(
	state: { hostId: PlayerId | null; phase: string },
	hostId: PlayerId,
	requiredPhase: string,
	hostError: () => Error,
	phaseError: () => Error,
): void {
	if (state.hostId !== hostId) throw hostError()
	if (state.phase !== requiredPhase) throw phaseError()
}

export function projectVisibleTrick(
	plays: ReadonlyArray<{ cardId: CardId; playerId: PlayerId }>,
	visibleCard: (cardId: CardId) => VisibleCard,
): TrickPlay[] {
	return plays.map((play) => ({
		card: visibleCard(play.cardId),
		playerId: play.playerId,
	}))
}

export function projectPublicPlayer(
	player: TrickTakingPlayer,
): Omit<PublicPlayerView, "capturedCardIds" | "bid" | "tricksWon"> {
	return {
		aiModel: player.aiModel,
		connected: player.connected,
		handCardIds: [...player.hand],
		id: player.id,
		kind: player.kind,
		name: player.name,
		roundPoints: player.roundPoints,
		score: player.score,
	}
}
