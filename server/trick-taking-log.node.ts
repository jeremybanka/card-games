import type { HeartsState } from "../src/game/hearts-engine.ts"
import type {
	CardId,
	CardValue,
	PlayerController,
	PlayerId,
} from "../src/game/game-types.ts"
import type { OhHellState } from "../src/game/oh-hell-engine.ts"

type CardValueState = {
	cardValues: Partial<Record<CardId, CardValue>>
}

type CommonLoggedPlayer = PlayerController & {
	connected: boolean
	hand: CardId[]
	id: PlayerId
	name: string
	roundPoints: number
	score: number
}

export function cardForLog(state: CardValueState, cardId: CardId): unknown {
	return {
		id: cardId,
		value: state.cardValues[cardId] ?? null,
	}
}

function commonStateSummaryForLog(
	state: HeartsState | OhHellState,
): Record<string, unknown> {
	return {
		currentPlayerId: state.currentPlayerId,
		gameKind: state.gameKind,
		hostId: state.hostId,
		lastTrickWinnerId: state.lastTrickWinnerId,
		phase: state.phase,
		roomCode: state.roomCode,
		roundNumber: state.roundNumber,
		statusMessage: state.statusMessage,
		trickLeaderId: state.trickLeaderId,
		trickNumber: state.trickNumber,
		winnerIds: state.winnerIds,
	}
}

function commonPlayerSummaryForLog(player: CommonLoggedPlayer) {
	return {
		aiModel: player.aiModel,
		connected: player.connected,
		handSize: player.hand.length,
		id: player.id,
		kind: player.kind,
		name: player.name,
		roundPoints: player.roundPoints,
		score: player.score,
	}
}

export function heartsStateSummaryForLog(state: HeartsState): unknown {
	return {
		...commonStateSummaryForLog(state),
		heartsBroken: state.heartsBroken,
		passDirection: state.passDirection,
		players: state.players.map((player) => ({
			...commonPlayerSummaryForLog(player),
			passSubmitted: player.passSelection !== null,
			takenSize: player.taken.length,
		})),
	}
}

export function ohHellStateSummaryForLog(state: OhHellState): unknown {
	return {
		...commonStateSummaryForLog(state),
		trumpSuit: state.trumpSuit,
		players: state.players.map((player) => ({
			...commonPlayerSummaryForLog(player),
			bid: player.bid,
			tricksWon: player.tricksWon,
		})),
	}
}

function commonStateSnapshotForLog(
	state: HeartsState | OhHellState,
): Record<string, unknown> {
	const {
		cardValues: _cardValues,
		currentTrick,
		physicalCardIds: _physicalCardIds,
		players: _players,
		...table
	} = state
	return {
		...table,
		currentTrick: currentTrick.map((play) => ({
			card: cardForLog(state, play.cardId),
			playerId: play.playerId,
		})),
	}
}

export function heartsStateSnapshotForLog(state: HeartsState): unknown {
	return {
		...commonStateSnapshotForLog(state),
		players: state.players.map((player) => ({
			...player,
			hand: player.hand.map((cardId) => cardForLog(state, cardId)),
			passSelection: player.passSelection?.map((cardId) =>
				cardForLog(state, cardId),
			),
			taken: player.taken.map((cardId) => cardForLog(state, cardId)),
		})),
	}
}

export function ohHellStateSnapshotForLog(state: OhHellState): unknown {
	return {
		...commonStateSnapshotForLog(state),
		players: state.players.map((player) => ({
			...player,
			hand: player.hand.map((cardId) => cardForLog(state, cardId)),
		})),
	}
}
