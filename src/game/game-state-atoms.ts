import { atom, atomFamily, selectorFamily } from "atom.io"

import {
	EMPTY_HEARTS_PRIVATE_PLAYER_VIEW,
	EMPTY_HEARTS_PUBLIC_GAME_VIEW,
	type AnyPrivatePlayerView,
	type AnyPublicGameView,
	type PlayerId,
} from "./game-types.ts"
import {
	gameCatalog,
	privatePlayerView,
	publicGameView,
} from "./game-catalog.ts"
import type { GameState } from "./game-state.ts"

const emptyPlayerId = "user::empty" satisfies PlayerId

export const gameStateAtoms = atomFamily<GameState, string>({
	key: "gameState",
	default: (roomCode) =>
		gameCatalog.hearts.createInitialState(roomCode, emptyPlayerId, ""),
})

export const publicGameViewProjectionSelectors = selectorFamily<
	AnyPublicGameView,
	string
>({
	key: "publicGameViewProjection",
	get:
		(roomCode) =>
		({ get }) => {
			const state = get(gameStateAtoms, roomCode)
			return publicGameView(state)
		},
})

export const privatePlayerViewProjectionSelectors = selectorFamily<
	AnyPrivatePlayerView,
	[roomCode: string, playerId: PlayerId]
>({
	key: "privatePlayerViewProjection",
	get:
		([roomCode, playerId]) =>
		({ get }) => {
			const state = get(gameStateAtoms, roomCode)
			return privatePlayerView(state, playerId)
		},
})

export const publicGameViewAtom = atom<AnyPublicGameView>({
	key: "publicGameView",
	default: EMPTY_HEARTS_PUBLIC_GAME_VIEW,
})

export const privatePlayerViewAtom = atom<AnyPrivatePlayerView>({
	key: "privatePlayerView",
	default: EMPTY_HEARTS_PRIVATE_PLAYER_VIEW,
})
