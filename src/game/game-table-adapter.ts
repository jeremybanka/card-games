import { gameCatalog } from "./game-catalog.ts"
import {
	registeredGameAdapter,
	registeredGameCapability,
} from "./game-registry.ts"
import { passRecipientSeatIndex } from "./seat-order.ts"
import type {
	GameKind,
	HeartsPublicGameView,
	OhHellPublicGameView,
	PassDirection,
	PublicGameView,
	PublicPlayerView,
} from "./game-types.ts"

type PublicGameViewFor<Kind extends GameKind> = Extract<
	PublicGameView,
	{ gameKind: Kind }
>

type GameTableAdapter<View extends PublicGameView> = {
	compareScores: (left: PublicPlayerView, right: PublicPlayerView) => number
	headerStatus: (view: View, passRecipientName: string | null) => string
	lobbyDescription: (view: View) => string
	scoreDetail: (player: PublicPlayerView) => string
	trickDetail: (view: View) => string
}

type PassingTableAdapter<View extends PublicGameView> = {
	actionLabel: (view: View, passRecipientName: string | null) => string
	recipient: (view: View, playerIndex: number) => PublicPlayerView | null
}

function passLabel(direction: PassDirection): string {
	switch (direction) {
		case "left":
			return "Pass left"
		case "right":
			return "Pass right"
		case "across":
			return "Pass across"
		case "hold":
			return "Hold"
	}
}

function heartsPassActionLabel(
	view: HeartsPublicGameView,
	recipientName: string | null,
): string {
	const directionLabel = passLabel(view.passDirection)
	return recipientName === null
		? directionLabel
		: `${directionLabel} to ${recipientName}`
}

const gameTableAdapters = {
	hearts: {
		compareScores: (left, right) => left.score - right.score,
		headerStatus: (view, passRecipientName) =>
			view.phase === "passing"
				? heartsPassActionLabel(view, passRecipientName)
				: view.heartsBroken
					? "♥ broken"
					: "♥ whole",
		lobbyDescription: (view) =>
			`${gameCatalog.hearts.label} · ${view.players.length} of ${gameCatalog.hearts.maximumPlayers} players seated`,
		scoreDetail: (player) => `+${player.roundPoints}`,
		trickDetail: (view) =>
			`Trick ${Math.min(view.trickNumber + 1, 26)}${
				view.heartsBroken ? " · hearts broken" : ""
			}`,
	} satisfies GameTableAdapter<HeartsPublicGameView>,
	ohHell: {
		compareScores: (left, right) => right.score - left.score,
		headerStatus: (view) =>
			view.phase === "lobby"
				? gameCatalog.ohHell.label.toUpperCase()
				: `${view.trumpSuit ?? "no"} trump`,
		lobbyDescription: (view) =>
			`${gameCatalog.ohHell.label} · ${view.players.length} of ${gameCatalog.ohHell.maximumPlayers} players seated`,
		scoreDetail: (player) =>
			`${player.tricksWon ?? 0}/${player.bid ?? "—"} · +${player.roundPoints}`,
		trickDetail: (view) =>
			`Trick ${Math.min(view.trickNumber + 1, view.roundHandSize)} · ${
				view.trumpSuit ?? "no"
			} trump`,
	} satisfies GameTableAdapter<OhHellPublicGameView>,
} as const satisfies {
	[Kind in GameKind]: GameTableAdapter<PublicGameViewFor<Kind>>
}

const passingTableAdapters = {
	hearts: {
		actionLabel: heartsPassActionLabel,
		recipient: (view, playerIndex) => {
			if (playerIndex === -1 || view.passDirection === "hold") return null
			return (
				view.players[
					passRecipientSeatIndex(
						playerIndex,
						view.players.length,
						view.passDirection,
					)
				] ?? null
			)
		},
	} satisfies PassingTableAdapter<HeartsPublicGameView>,
} satisfies Partial<Record<GameKind, unknown>>

const autoPlayTableGames = new Set<GameKind>(["hearts"])

export function gameTableAdapter(
	view: PublicGameView,
): GameTableAdapter<PublicGameView> {
	return registeredGameAdapter<GameTableAdapter<PublicGameView>>(
		view.gameKind,
		gameTableAdapters,
	)
}

export function passingTableAdapter(
	view: PublicGameView,
): PassingTableAdapter<PublicGameView> | null {
	return registeredGameCapability<PassingTableAdapter<PublicGameView>>(
		view.gameKind,
		passingTableAdapters,
	)
}

export function supportsTableAutoPlay(view: PublicGameView): boolean {
	return autoPlayTableGames.has(view.gameKind)
}
