import type { HeartsState } from "./hearts-engine.ts"
import type { OhHellState } from "./oh-hell-engine.ts"
import type { SummonersState } from "../summoners/summoners-engine.ts"

export type GameState = HeartsState | OhHellState | SummonersState
