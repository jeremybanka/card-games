import {
	createHeartsGame,
	PLAYER_MAXIMUM,
	PLAYER_MINIMUM,
	toPrivatePlayerView,
	toPublicGameView,
	type HeartsState,
} from "./hearts-engine.ts"
import { registeredGameAdapter } from "./game-registry.ts"
import type { GameState } from "./game-state.ts"
import type {
	CardId,
	GameKind,
	HeartsPrivatePlayerView,
	HeartsPublicGameView,
	OhHellPrivatePlayerView,
	OhHellPublicGameView,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
} from "./game-types.ts"
import {
	createOhHellGame,
	OH_HELL_PLAYER_MAXIMUM,
	OH_HELL_PLAYER_MINIMUM,
	toOhHellPrivatePlayerView,
	toOhHellPublicGameView,
	type OhHellState,
} from "./oh-hell-engine.ts"

type GameCatalogEntry<
	Kind extends GameKind,
	State extends { gameKind: Kind },
	PublicView extends { gameKind: Kind },
	PrivateView extends { gameKind: Kind },
> = {
	createInitialState: (
		roomCode: string,
		hostId: PlayerId,
		hostName: string,
		physicalCardIds?: CardId[],
	) => State
	kind: Kind
	label: string
	maximumPlayers: number
	minimumPlayers: number
	privateView: (state: State, playerId: PlayerId) => PrivateView
	publicView: (state: State) => PublicView
}

function defineGameCatalog<const Catalog extends Record<GameKind, unknown>>(
	catalog: Catalog,
): Catalog {
	return catalog
}

export const gameCatalog = defineGameCatalog({
	hearts: {
		createInitialState: createHeartsGame,
		kind: "hearts",
		label: "Hearts",
		maximumPlayers: PLAYER_MAXIMUM,
		minimumPlayers: PLAYER_MINIMUM,
		privateView: toPrivatePlayerView,
		publicView: toPublicGameView,
	} satisfies GameCatalogEntry<
		"hearts",
		HeartsState,
		HeartsPublicGameView,
		HeartsPrivatePlayerView
	>,
	ohHell: {
		createInitialState: createOhHellGame,
		kind: "ohHell",
		label: "Oh Hell!",
		maximumPlayers: OH_HELL_PLAYER_MAXIMUM,
		minimumPlayers: OH_HELL_PLAYER_MINIMUM,
		privateView: toOhHellPrivatePlayerView,
		publicView: toOhHellPublicGameView,
	} satisfies GameCatalogEntry<
		"ohHell",
		OhHellState,
		OhHellPublicGameView,
		OhHellPrivatePlayerView
	>,
} as const)

export function isGameKind(input: unknown): input is GameKind {
	return typeof input === "string" && Object.hasOwn(gameCatalog, input)
}

export function parseGameKind(input: unknown): GameKind {
	if (isGameKind(input)) return input
	throw new Error("Choose a supported card game.")
}

export function publicGameView(state: GameState): PublicGameView {
	const game = registeredGameAdapter<{
		publicView: (state: GameState) => PublicGameView
	}>(state.gameKind, gameCatalog)
	return game.publicView(state)
}

export function privatePlayerView(
	state: GameState,
	playerId: PlayerId,
): PrivatePlayerView {
	const game = registeredGameAdapter<{
		privateView: (state: GameState, playerId: PlayerId) => PrivatePlayerView
	}>(state.gameKind, gameCatalog)
	return game.privateView(state, playerId)
}
