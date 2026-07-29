import { bindAiSeatActions } from "./ai-seat-actions.node.ts"
import {
	bindGameEvent,
	combineDisposers,
	type GameDefinition,
} from "./game-controller.node.ts"
import {
	cardForLog,
	heartsStateSnapshotForLog,
	heartsStateSummaryForLog,
} from "./trick-taking-log.node.ts"
import type { WayfarerGameResources } from "./wayfarer-game-resources.node.ts"

import { createPhysicalCardIds } from "../src/game/standard-deck-domain.ts"
import { parsePlayCardPayload } from "../src/game/game-actions.ts"
import { parsePassCardsPayload } from "../src/game/hearts-actions.ts"
import {
	createHeartsGame,
	disconnectHeartsPlayer,
	type HeartsState,
	joinHeartsGame,
	HEARTS_PLAYER_MAXIMUM,
	playHeartsCard,
	restartHeartsGame,
	startHeartsGame,
	startNextHeartsRound,
	submitPass,
} from "../src/game/hearts-engine.ts"
import type { HeartsClientEvents } from "../src/game/game-types.ts"

export const heartsGame: GameDefinition<
	"hearts",
	HeartsState,
	HeartsClientEvents,
	WayfarerGameResources
> = {
	bindActions: (context) => {
		const { acknowledge, controller, playerId, socket } = context
		return combineDisposers([
			bindAiSeatActions(context, {
				canManageSeats: (state) => state.phase === "lobby",
				canReviewStrategy: (state) =>
					state.phase === "roundComplete" || state.phase === "gameComplete",
				maximumPlayers: HEARTS_PLAYER_MAXIMUM,
			}),
			bindGameEvent(socket, "startGame", (ack) => {
				acknowledge(ack, "realtime.action.start_game", { playerId }, (span) => {
					controller.setState(
						startHeartsGame(
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
			bindGameEvent(socket, "passCards", (cardIds, ack) => {
				acknowledge(
					ack,
					"realtime.action.pass_cards",
					{ cardIds, playerId },
					(span) => {
						const state = controller.getState()
						const payload = parsePassCardsPayload({ cardIds })
						controller.setState(submitPass(state, playerId, payload.cardIds))
						const nextState = controller.getState()
						span.event("game.cards_passed", {
							direction: state.passDirection,
							playerId,
							selectedCards: payload.cardIds.map((cardId) =>
								cardForLog(state, cardId),
							),
							state: controller.stateSummaryForLog(),
						})
						if (nextState.phase === "playing") {
							span.event("game.pass_completed", {
								room: controller.stateSnapshotForLog(),
							})
						}
					},
				)
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
						controller.setState(playHeartsCard(state, playerId, payload.cardId))
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
							const winner = nextState.players.find(
								(candidate) => candidate.id === nextState.lastTrickWinnerId,
							)
							span.event("game.trick_resolved", {
								lastTrickWinnerId: nextState.lastTrickWinnerId,
								state: controller.stateSummaryForLog(),
								winnerTakenCards: winner?.taken.map((takenCardId) =>
									cardForLog(nextState, takenCardId),
								),
							})
						}
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
							startNextHeartsRound(
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
							restartHeartsGame(controller.getState(), playerId),
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
		joinHeartsGame(state, player.id, player.name, player.controller),
	create: ({ host, resources, roomCode }) =>
		createHeartsGame(
			roomCode,
			host.id,
			host.name,
			createPhysicalCardIds(resources.identityRandom.uuid),
		),
	disconnectPlayer: disconnectHeartsPlayer,
	dispose: (resources) => {
		for (const aiPlayer of resources.aiPlayers.values()) aiPlayer.dispose()
	},
	isVacant: (state) => state.players.length === 0,
	kind: "hearts",
	stateSnapshotForLog: heartsStateSnapshotForLog,
	stateSummaryForLog: heartsStateSummaryForLog,
}
