import type { CardId } from "../src/game/game-types.ts"
import { isOhHellState, type GameState } from "../src/game/game-state.ts"

export function cardForLog(state: GameState, cardId: CardId): unknown {
	return {
		id: cardId,
		value: state.cardValues[cardId] ?? null,
	}
}

export function trickTakingStateSummaryForLog(state: GameState): unknown {
	return {
		currentPlayerId: state.currentPlayerId,
		gameKind: state.gameKind,
		heartsBroken: isOhHellState(state) ? undefined : state.heartsBroken,
		trumpSuit: isOhHellState(state) ? state.trumpSuit : undefined,
		hostId: state.hostId,
		lastTrickWinnerId: state.lastTrickWinnerId,
		passDirection: isOhHellState(state) ? undefined : state.passDirection,
		phase: state.phase,
		players: state.players.map((player) => ({
			aiModel: player.aiModel,
			connected: player.connected,
			handSize: player.hand.length,
			id: player.id,
			kind: player.kind,
			name: player.name,
			passSubmitted:
				"passSelection" in player ? player.passSelection !== null : undefined,
			bid: "bid" in player ? player.bid : undefined,
			roundPoints: player.roundPoints,
			score: player.score,
			takenSize: "taken" in player ? player.taken.length : undefined,
			tricksWon: "tricksWon" in player ? player.tricksWon : undefined,
		})),
		roomCode: state.roomCode,
		roundNumber: state.roundNumber,
		statusMessage: state.statusMessage,
		trickLeaderId: state.trickLeaderId,
		trickNumber: state.trickNumber,
		winnerIds: state.winnerIds,
	}
}

export function trickTakingStateSnapshotForLog(state: GameState): unknown {
	const {
		cardValues: _cardValues,
		currentTrick,
		physicalCardIds: _physicalCardIds,
		players,
		...table
	} = state
	return {
		...table,
		currentTrick: currentTrick.map((play) => ({
			card: cardForLog(state, play.cardId),
			playerId: play.playerId,
		})),
		players: players.map((player) => {
			const base = {
				...player,
				hand: player.hand.map((cardId) => cardForLog(state, cardId)),
			}
			return "passSelection" in player
				? {
						...base,
						passSelection: player.passSelection?.map((cardId) =>
							cardForLog(state, cardId),
						),
						taken: player.taken.map((cardId) => cardForLog(state, cardId)),
					}
				: base
		}),
	}
}
