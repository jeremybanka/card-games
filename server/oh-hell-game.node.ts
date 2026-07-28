import { bindAiSeatActions } from "./ai-seat-actions.node.ts"
import {
	bindGameEvent,
	combineDisposers,
	type Game,
} from "./game-controller.node.ts"
import {
	cardForLog,
	trickTakingStateSnapshotForLog,
	trickTakingStateSummaryForLog,
} from "./trick-taking-log.node.ts"
import type { WayfarerGameResources } from "./wayfarer-game-resources.node.ts"

import { createPhysicalCardIds } from "../src/game/card-domain.ts"
import { parsePlayCardPayload } from "../src/game/game-actions.ts"
import type {
	OhHellClientEvents,
	OhHellPrivatePlayerView,
	OhHellPublicGameView,
} from "../src/game/game-types.ts"
import {
	createOhHellGame,
	disconnectOhHellPlayer,
	type OhHellState,
	joinOhHellGame,
	OH_HELL_PLAYER_MAXIMUM,
	playOhHellCard,
	restartOhHellGame,
	startNextOhHellRound,
	startOhHellGame,
	submitOhHellBid,
	toOhHellPrivatePlayerView,
	toOhHellPublicGameView,
} from "../src/game/oh-hell-engine.ts"

export const ohHellGame: Game<
	"ohHell",
	OhHellState,
	OhHellPublicGameView,
	OhHellPrivatePlayerView,
	OhHellClientEvents,
	WayfarerGameResources
> = {
	bindActions: (context) => {
		const { acknowledge, controller, playerId, socket } = context
		return combineDisposers([
			bindAiSeatActions(context, {
				canManageSeats: (state) => state.phase === "lobby",
				canReviewStrategy: (state) =>
					state.phase === "roundComplete" || state.phase === "gameComplete",
				maximumPlayers: OH_HELL_PLAYER_MAXIMUM,
			}),
			bindGameEvent(socket, "startGame", (ack) => {
				acknowledge(ack, "realtime.action.start_game", { playerId }, (span) => {
					controller.setState(
						startOhHellGame(
							controller.getState(),
							playerId,
							controller.resources.dealRandom.next,
						),
					)
					span.event("game.dealt", {
						room: controller.stateSnapshotForLog(),
					})
				})
			}),
			bindGameEvent(socket, "playCard", (cardId, ack) => {
				acknowledge(
					ack,
					"realtime.action.play_card",
					{ cardId, playerId },
					(span) => {
						const state = controller.getState()
						const payload = parsePlayCardPayload({ cardId })
						const player = state.players.find(
							(candidate) => candidate.id === playerId,
						)
						controller.setState(playOhHellCard(state, playerId, payload.cardId))
						const nextState = controller.getState()
						span.event("game.card_played", {
							card: cardForLog(state, payload.cardId),
							currentTrickBefore: state.currentTrick.map((play) => ({
								card: cardForLog(state, play.cardId),
								playerId: play.playerId,
							})),
							handSizeBefore: player?.hand.length,
							playerId,
							state: controller.stateSummaryForLog(),
						})
						if (
							nextState.lastTrickWinnerId !== state.lastTrickWinnerId ||
							nextState.phase === "roundComplete" ||
							nextState.phase === "gameComplete"
						) {
							span.event("game.trick_resolved", {
								lastTrickWinnerId: nextState.lastTrickWinnerId,
								state: controller.stateSummaryForLog(),
							})
						}
					},
				)
			}),
			bindGameEvent(socket, "submitBid", (bid, ack) => {
				acknowledge(
					ack,
					"realtime.action.submit_bid",
					{ bid, playerId },
					(span) => {
						controller.setState(
							submitOhHellBid(controller.getState(), playerId, bid),
						)
						span.event("game.bid_submitted", {
							bid,
							playerId,
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "startNextRound", (ack) => {
				acknowledge(
					ack,
					"realtime.action.start_next_round",
					{ playerId },
					(span) => {
						controller.setState(
							startNextOhHellRound(
								controller.getState(),
								playerId,
								controller.resources.dealRandom.next,
							),
						)
						span.event("game.dealt", {
							room: controller.stateSnapshotForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "restartGame", (ack) => {
				acknowledge(
					ack,
					"realtime.action.restart_game",
					{ playerId },
					(span) => {
						controller.setState(
							restartOhHellGame(controller.getState(), playerId),
						)
						span.event("game.restarted", {
							room: controller.stateSnapshotForLog(),
						})
					},
				)
			}),
		])
	},
	connectPlayer: (state, player) =>
		joinOhHellGame(state, player.id, player.name, player.controller),
	create: ({ host, resources, roomCode }) =>
		createOhHellGame(
			roomCode,
			host.id,
			host.name,
			createPhysicalCardIds(resources.identityRandom.uuid),
		),
	disconnectPlayer: disconnectOhHellPlayer,
	dispose: (resources) => {
		for (const aiPlayer of resources.aiPlayers.values()) aiPlayer.dispose()
	},
	isVacant: (state) => state.players.length === 0,
	kind: "ohHell",
	privateView: toOhHellPrivatePlayerView,
	publicView: toOhHellPublicGameView,
	stateSnapshotForLog: trickTakingStateSnapshotForLog,
	stateSummaryForLog: trickTakingStateSummaryForLog,
}
