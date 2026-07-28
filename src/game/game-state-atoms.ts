import { atom, atomFamily, selectorFamily } from "atom.io"

import {
	EMPTY_PRIVATE_PLAYER_VIEW,
	EMPTY_PUBLIC_GAME_VIEW,
	type PlayerId,
	type PrivatePlayerView,
	type PublicGameView,
} from "./game-types.ts"
import {
	createHeartsGame,
	toPrivatePlayerView,
	toPublicGameView,
} from "./hearts-engine.ts"
import { isOhHellState, type GameState } from "./game-state.ts"
import {
	toOhHellPrivatePlayerView,
	toOhHellPublicGameView,
} from "./oh-hell-engine.ts"

const emptyPlayerId = "user::empty" satisfies PlayerId

export const gameStateAtoms = atomFamily<GameState, string>({
	key: "gameState",
	default: (roomCode) => createHeartsGame(roomCode, emptyPlayerId, ""),
})

export const publicGameViewProjectionSelectors = selectorFamily<
	PublicGameView,
	string
>({
	key: "publicGameViewProjection",
	get:
		(roomCode) =>
		({ get }) => {
			const state = get(gameStateAtoms, roomCode)
			return isOhHellState(state)
				? toOhHellPublicGameView(state)
				: toPublicGameView(state)
		},
})

export const privatePlayerViewProjectionSelectors = selectorFamily<
	PrivatePlayerView,
	[roomCode: string, playerId: PlayerId]
>({
	key: "privatePlayerViewProjection",
	get:
		([roomCode, playerId]) =>
		({ get }) => {
			const state = get(gameStateAtoms, roomCode)
			return isOhHellState(state)
				? toOhHellPrivatePlayerView(state, playerId)
				: toPrivatePlayerView(state, playerId)
		},
})

export const publicGameViewAtom = atom<PublicGameView>({
	key: "publicGameView",
	default: EMPTY_PUBLIC_GAME_VIEW,
})

export const privatePlayerViewAtom = atom<PrivatePlayerView>({
	key: "privatePlayerView",
	default: EMPTY_PRIVATE_PLAYER_VIEW,
})
