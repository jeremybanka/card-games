import type { HeartsState } from "./hearts-engine.ts"
import type { OhHellState } from "./oh-hell-engine.ts"

export type GameState = HeartsState | OhHellState

export function isOhHellState(state: GameState): state is OhHellState {
	return state.gameKind === "ohHell"
}
