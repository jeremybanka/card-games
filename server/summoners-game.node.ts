import {
	attackSummoners,
	createSummonersGame,
	createSummonersPhysicalCardIds,
	disconnectSummonersPlayer,
	endSummonersTurn,
	joinSummonersGame,
	playSummonersCard,
	restartSummonersGame,
	selectSummonersDeck,
	startSummonersGame,
	type SummonersState,
	useSummonerPower,
} from "../src/summoners/summoners-engine.ts"
import { parsePlayCardPayload } from "../src/game/game-actions.ts"
import {
	isSummonersDeckId,
	summonersCardDefinition,
} from "../src/summoners/summoners-cards.ts"
import { parseSummonersTarget } from "../src/summoners/summoners-actions.ts"
import type { SummonersClientEvents } from "../src/summoners/summoners-types.ts"
import type { WayfarerGameResources } from "./wayfarer-game-resources.node.ts"
import { bindAiSeatActions } from "./ai-seat-actions.node.ts"
import {
	bindGameEvent,
	combineDisposers,
	type GameDefinition,
} from "./game-controller.node.ts"

function summonersStateSummaryForLog(state: SummonersState) {
	return {
		currentPlayerId: state.currentPlayerId,
		gameKind: state.gameKind,
		phase: state.phase,
		players: state.players.map((player) => ({
			battlefield: player.battlefield.length,
			connected: player.connected,
			deck: player.deck.length,
			deckId: player.deckId,
			discard: player.discard.length,
			eliminated: player.eliminated,
			hand: player.hand.length,
			health: player.health,
			id: player.id,
			maxSpark: player.maxSpark,
			name: player.name,
			spark: player.spark,
		})),
		roomCode: state.roomCode,
		turnNumber: state.turnNumber,
		winnerIds: state.winnerIds,
	}
}

function summonersStateSnapshotForLog(state: SummonersState): unknown {
	const cardName = (cardId: keyof typeof state.cardBlueprintById): string => {
		const blueprintId = state.cardBlueprintById[cardId]
		return blueprintId === undefined
			? "unknown"
			: summonersCardDefinition(blueprintId).name
	}
	return {
		...summonersStateSummaryForLog(state),
		players: state.players.map((player) => ({
			...player,
			battlefield: player.battlefield.map((being) => ({
				...being,
				card: cardName(being.cardId),
				item: being.itemCardId === null ? null : cardName(being.itemCardId),
			})),
			deck: player.deck.map(cardName),
			discard: player.discard.map(cardName),
			hand: player.hand.map(cardName),
		})),
	}
}

export const summonersGame: GameDefinition<
	"summoners",
	SummonersState,
	SummonersClientEvents,
	WayfarerGameResources
> = {
	bindActions: (context) => {
		const { acknowledge, controller, playerId, socket } = context
		return combineDisposers([
			bindAiSeatActions(context, {
				canManageSeats: (state) => state.phase === "lobby",
				canReviewStrategy: () => false,
				maximumPlayers: 4,
			}),
			bindGameEvent(socket, "selectSummonersDeck", (deckId, ack) => {
				acknowledge(
					ack,
					"realtime.action.select_summoners_deck",
					{ deckId, playerId },
					(span) => {
						if (!isSummonersDeckId(deckId)) {
							throw new Error("Choose a known starter deck.")
						}
						controller.setState(
							selectSummonersDeck(controller.getState(), playerId, deckId),
						)
						span.event("summoners.deck_selected", {
							deckId,
							playerId,
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "startGame", (ack) => {
				acknowledge(
					ack,
					"realtime.action.start_summoners_game",
					{ playerId },
					(span) => {
						controller.setState(
							startSummonersGame(
								controller.getState(),
								playerId,
								controller.resources.dealRandom.next,
							),
						)
						span.event("summoners.conclave_started", {
							state: controller.stateSnapshotForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "playSummonersCard", (cardId, target, ack) => {
				acknowledge(
					ack,
					"realtime.action.play_summoners_card",
					{ cardId, playerId, target },
					(span) => {
						const parsedCardId = parsePlayCardPayload({ cardId }).cardId
						controller.setState(
							playSummonersCard(
								controller.getState(),
								playerId,
								parsedCardId,
								parseSummonersTarget(target),
							),
						)
						span.event("summoners.card_played", {
							cardId,
							playerId,
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "attackSummoners", (attackerId, target, ack) => {
				acknowledge(
					ack,
					"realtime.action.attack_summoners",
					{ attackerId, playerId, target },
					(span) => {
						const parsedAttackerId = parsePlayCardPayload({
							cardId: attackerId,
						}).cardId
						const parsedTarget = parseSummonersTarget(target)
						if (parsedTarget === null) {
							throw new Error("Choose a character to attack.")
						}
						controller.setState(
							attackSummoners(
								controller.getState(),
								playerId,
								parsedAttackerId,
								parsedTarget,
							),
						)
						span.event("summoners.attack_resolved", {
							attackerId,
							playerId,
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "useSummonerPower", (target, ack) => {
				acknowledge(
					ack,
					"realtime.action.use_summoner_power",
					{ playerId, target },
					(span) => {
						controller.setState(
							useSummonerPower(
								controller.getState(),
								playerId,
								parseSummonersTarget(target),
							),
						)
						span.event("summoners.power_used", {
							playerId,
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "endSummonersTurn", (ack) => {
				acknowledge(
					ack,
					"realtime.action.end_summoners_turn",
					{ playerId },
					(span) => {
						controller.setState(
							endSummonersTurn(controller.getState(), playerId),
						)
						span.event("summoners.turn_ended", {
							playerId,
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
			bindGameEvent(socket, "restartGame", (ack) => {
				acknowledge(
					ack,
					"realtime.action.restart_summoners_game",
					{ playerId },
					(span) => {
						controller.setState(
							restartSummonersGame(controller.getState(), playerId),
						)
						span.event("summoners.conclave_restarted", {
							state: controller.stateSummaryForLog(),
						})
					},
				)
			}),
		])
	},
	connectPlayer: (state, player) =>
		joinSummonersGame(state, player.id, player.name, player.controller),
	create: ({ host, resources, roomCode }) =>
		createSummonersGame(
			roomCode,
			host.id,
			host.name,
			createSummonersPhysicalCardIds(resources.identityRandom.uuid),
		),
	disconnectPlayer: disconnectSummonersPlayer,
	dispose: (resources) => {
		for (const aiPlayer of resources.aiPlayers.values()) aiPlayer.dispose()
	},
	isVacant: (state) => state.players.length === 0,
	kind: "summoners",
	stateSnapshotForLog: summonersStateSnapshotForLog,
	stateSummaryForLog: summonersStateSummaryForLog,
}
