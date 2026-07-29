import { isAiModelId } from "../src/ai/ai-models.ts"
import type { AiSeatClientEvents, PlayerId } from "../src/game/game-types.ts"
import { serverLogger } from "../src/observability/span-logger.node.ts"
import {
	bindGameEvent,
	combineDisposers,
	type GameActionBindingContext,
	type GameEventSocket,
} from "./game-controller.node.ts"
import type { WayfarerGameResources } from "./wayfarer-game-resources.node.ts"

function actionErrorMessage(thrown: unknown): string {
	return thrown instanceof Error
		? thrown.message
		: "The table could not complete that action."
}

type AiSeatState = {
	hostId: PlayerId | null
	players: Array<{
		id: PlayerId
		kind: "ai" | "human"
		name: string
	}>
	roundNumber: number
}

type AiSeatActionOptions<State extends AiSeatState> = {
	canManageSeats: (state: State) => boolean
	canReviewStrategy: (state: State) => boolean
	maximumPlayers: number
}

function strategyTextForReview(text: string): string {
	return text.replace(/card::[^\s,)\]}]+/g, "[private card]")
}

export function bindAiSeatActions<
	State extends AiSeatState,
	Actions extends AiSeatClientEvents,
>(
	context: GameActionBindingContext<State, Actions, WayfarerGameResources>,
	options: AiSeatActionOptions<State>,
): () => void {
	const { acknowledge, controller, playerId, socket } = context
	const aiSeatSocket: GameEventSocket<AiSeatClientEvents> = socket
	return combineDisposers([
		bindGameEvent(aiSeatSocket, "assignAiSeat", (modelId, ack) => {
			acknowledge(
				ack,
				"realtime.action.assign_ai_seat",
				{ modelId, playerId },
				async (span) => {
					const state = controller.getState()
					if (state.hostId !== playerId) {
						throw new Error("Only the host can assign AI seats.")
					}
					if (!options.canManageSeats(state)) {
						throw new Error(
							"AI seats can only be assigned before the game starts.",
						)
					}
					if (state.players.length >= options.maximumPlayers) {
						throw new Error(
							`This table already has ${options.maximumPlayers} players.`,
						)
					}
					if (!isAiModelId(modelId)) {
						throw new Error("Choose a supported OpenAI model.")
					}
					const assignment = await controller.resources.assignAiSeat(
						modelId,
						state.players.map((player) => player.name),
					)
					span.event("room.ai_seat_assigned", {
						...assignment,
						modelId,
						room: controller.stateSummaryForLog(),
					})
				},
			)
		}),
		bindGameEvent(aiSeatSocket, "removeAiSeat", (aiPlayerId, ack) => {
			acknowledge(
				ack,
				"realtime.action.remove_ai_seat",
				{ aiPlayerId, playerId },
				(span) => {
					const state = controller.getState()
					if (state.hostId !== playerId) {
						throw new Error("Only the host can remove AI seats.")
					}
					if (!options.canManageSeats(state)) {
						throw new Error(
							"AI seats can only be removed before the game starts.",
						)
					}
					const aiPlayer = state.players.find(
						(candidate) =>
							candidate.id === aiPlayerId && candidate.kind === "ai",
					)
					if (aiPlayer === undefined) {
						throw new Error("That AI seat is not at this table.")
					}
					controller.resources.removeAiSeat(aiPlayerId)
					span.event("room.ai_seat_removed", {
						aiPlayerId,
						name: aiPlayer.name,
					})
				},
			)
		}),
		bindGameEvent(
			aiSeatSocket,
			"requestAiStrategyReview",
			(aiPlayerId, ack) => {
				void serverLogger.withRootSpan(
					"realtime.action.request_ai_strategy_review",
					{ aiPlayerId, playerId },
					(span) => {
						try {
							const state = controller.getState()
							if (!options.canReviewStrategy(state)) {
								throw new Error("Strategy review is available after the round.")
							}
							const aiPlayer = state.players.find(
								(candidate) =>
									candidate.id === aiPlayerId && candidate.kind === "ai",
							)
							const runtime = controller.resources.aiPlayers.get(aiPlayerId)
							if (aiPlayer === undefined || runtime === undefined) {
								throw new Error("That AI seat is not at this table.")
							}
							const turns = runtime.silo
								.getState(runtime.state.aiStrategyReviewTurnsAtom)
								.map((turn) => ({
									...turn,
									plan: strategyTextForReview(turn.plan),
								}))
							const review = {
								modelId: runtime.modelId,
								playerId: aiPlayer.id,
								playerName: aiPlayer.name,
								roundNumber: state.roundNumber,
								turns,
							}
							ack({ ok: true, review })
							span.setAttributes({
								roomCode: controller.roomCode,
								roundNumber: review.roundNumber,
								turnCount: review.turns.length,
							})
							span.event("ai.strategy_review.provided")
						} catch (thrown) {
							const message = actionErrorMessage(thrown)
							span.setOutcome("error")
							span.event(
								"ai.strategy_review.rejected",
								{ error: thrown, message },
								"warn",
							)
							ack({ ok: false, error: message })
						}
					},
				)
			},
		),
	])
}
