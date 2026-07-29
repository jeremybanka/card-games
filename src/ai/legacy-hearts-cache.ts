import type { AiGameContext } from "./ai-game-facts.ts"
import {
	assertMatchingGameKinds,
	registeredGameAdapter,
} from "../game/game-registry.ts"
import type {
	GameKind,
	HeartsPrivatePlayerView,
	HeartsPublicGameView,
	OhHellPrivatePlayerView,
	OhHellPublicGameView,
	PrivatePlayerView,
	PublicGameView,
} from "../game/game-types.ts"

/**
 * Preserves the cache keys recorded before gameKind and pass-receipt fields
 * existed. Keep this compatibility transform out of current game dispatch.
 */
type LegacyCacheAdapter<PublicView, PrivateView> = {
	privateView: (view: PrivateView) => unknown
	publicView: (view: PublicView) => unknown
}

const legacyCacheAdapters = {
	hearts: {
		privateView: ({
			awardedLeftoverCard: _awardedLeftoverCard,
			gameKind: _gameKind,
			passReceipt: _passReceipt,
			...view
		}) => view,
		publicView: (view) => {
			const {
				deckCardIds: _deckCardIds,
				gameKind: _gameKind,
				...publicViewWithoutDeckOrGameKind
			} = view
			return {
				...publicViewWithoutDeckOrGameKind,
				completedTricks: publicViewWithoutDeckOrGameKind.completedTricks.map(
					({ leftoverAward: _leftoverAward, ...trick }) => trick,
				),
				players: view.players.map((player) => ({
					aiModel: player.aiModel,
					capturedCardIds: player.capturedCardIds,
					connected: player.connected,
					handCardIds: player.handCardIds,
					id: player.id,
					kind: player.kind,
					name: player.name,
					roundPoints: player.roundPoints,
					score: player.score,
				})),
			}
		},
	} satisfies LegacyCacheAdapter<HeartsPublicGameView, HeartsPrivatePlayerView>,
	ohHell: {
		privateView: (view) => view,
		publicView: ({ deckCardIds: _deckCardIds, ...view }) => ({
			...view,
			completedTricks: view.completedTricks.map(
				({ leftoverAward: _leftoverAward, ...trick }) => trick,
			),
			players: view.players,
		}),
	} satisfies LegacyCacheAdapter<OhHellPublicGameView, OhHellPrivatePlayerView>,
} satisfies {
	[Kind in GameKind]: LegacyCacheAdapter<
		Extract<PublicGameView, { gameKind: Kind }>,
		Extract<PrivatePlayerView, { gameKind: Kind }>
	>
}

export function legacyCompatibleCacheViews(context: AiGameContext): {
	privateView: AiGameContext["privateView"]
	publicView: AiGameContext["publicView"]
} {
	assertMatchingGameKinds(
		context.privateView,
		context.publicView,
		"AI public and private views describe different games.",
	)
	const adapter = registeredGameAdapter<
		LegacyCacheAdapter<PublicGameView, PrivatePlayerView>
	>(context.publicView.gameKind, legacyCacheAdapters)
	return {
		privateView: adapter.privateView(
			context.privateView,
		) as AiGameContext["privateView"],
		publicView: adapter.publicView(
			context.publicView,
		) as AiGameContext["publicView"],
	}
}
