import { atom, atomFamily, selectorFamily } from "atom.io"

import {
	EMPTY_PRIVATE_PLAYER_VIEW,
	EMPTY_PUBLIC_GAME_VIEW,
	type PlayerId,
	type PrivatePlayerView,
	type PublicGameView,
} from "./hearts-types.ts"
import {
	createHeartsGame,
	type HeartsState,
	toPrivatePlayerView,
	toPublicGameView,
} from "./hearts-engine.ts"

const emptyPlayerId = "user::empty" satisfies PlayerId

export const heartsStateAtoms = atomFamily<HeartsState, string>({
	key: "heartsState",
	default: (roomCode) => createHeartsGame(roomCode, emptyPlayerId, ""),
})

export const publicGameViewProjectionSelectors = selectorFamily<
	PublicGameView,
	string
>({
	key: "publicGameViewProjection",
	get:
		(roomCode) =>
		({ get }) =>
			toPublicGameView(get(heartsStateAtoms, roomCode)),
})

export const privatePlayerViewProjectionSelectors = selectorFamily<
	PrivatePlayerView,
	[roomCode: string, playerId: PlayerId]
>({
	key: "privatePlayerViewProjection",
	get:
		([roomCode, playerId]) =>
		({ get }) =>
			toPrivatePlayerView(get(heartsStateAtoms, roomCode), playerId),
})

export const publicGameViewAtom = atom<PublicGameView>({
	key: "publicGameView",
	default: EMPTY_PUBLIC_GAME_VIEW,
})

export const privatePlayerViewAtom = atom<PrivatePlayerView>({
	key: "privatePlayerView",
	default: EMPTY_PRIVATE_PLAYER_VIEW,
})
