import { createReadStream, existsSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { randomUUID } from "node:crypto"

import { disposeState, findState, getState, setState } from "atom.io"
import type { UserKey } from "atom.io/realtime"
import type { UserServerConfig } from "atom.io/realtime-server"
import { realtime } from "atom.io/realtime-server"
import { realtimeStateProvider } from "atom.io/realtime-server"
import { Server } from "socket.io"
import type { Socket } from "socket.io"

import {
	createAiPlayer,
	type AiPlayerRuntime,
} from "../src/ai/ai-player.node.ts"
import { isAiModelId, type AiModelId } from "../src/ai/ai-models.ts"
import {
	parsePassCardsPayload,
	parsePlayCardPayload,
} from "../src/game/hearts-actions.ts"
import {
	createHeartsGame,
	createPhysicalCardIds,
	disconnectPlayer,
	HeartsRuleError,
	joinHeartsGame,
	playCard,
	restartGame,
	startGame,
	startNextRound,
	submitPass,
	type HeartsState,
} from "../src/game/hearts-engine.ts"
import {
	createSeededRandom,
	type SeededRandom,
} from "../src/game/seeded-random.ts"
import {
	heartsStateAtoms,
	privatePlayerViewProjectionSelectors,
	privatePlayerViewAtom,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "../src/game/hearts-state.ts"
import type {
	ActionAck,
	CardId,
	ClientToServerEvents,
	PlayerId,
	ServerToClientEvents,
} from "../src/game/hearts-types.ts"
import {
	type ActiveSpan,
	serverLogger,
} from "../src/observability/span-logger.node.ts"
import { generateAiPlayerName } from "./ai-player-name.node.ts"

const SERVER_PORT = Number.parseInt(process.env.PORT ?? "8787", 10)
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const PLAYER_NAME_MAXIMUM_LENGTH = 18
const GAME_SEED = process.env.GAME_SEED?.trim() || randomUUID()
const roomCodeRandom = createSeededRandom(`room-code:${GAME_SEED}`)

type GameServerSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	{ playerId: PlayerId }
>

type Room = {
	aiNameRandom: SeededRandom
	aiPlayers: Map<PlayerId, AiPlayerRuntime>
	connections: Map<PlayerId, { dispose: () => void; socket: GameServerSocket }>
	dealRandom: SeededRandom
	identityRandom: SeededRandom
}

const rooms = new Map<string, Room>()
const roomCodeByPlayer = new Map<PlayerId, string>()
const playerSecrets = new Map<string, string>()
const aiModelsByPlayer = new Map<PlayerId, AiModelId>()

function normalizePlayerName(input: string): string {
	const name = input.trim().replace(/\s+/g, " ")
	if (name.length < 1 || name.length > PLAYER_NAME_MAXIMUM_LENGTH) {
		throw new HeartsRuleError(
			`Names must be between 1 and ${PLAYER_NAME_MAXIMUM_LENGTH} characters.`,
		)
	}
	return name
}

function normalizeRoomCode(input: string): string {
	const roomCode = input.trim().toUpperCase()
	if (!/^[A-Z]{4}$/.test(roomCode)) {
		throw new HeartsRuleError("Room codes contain four letters.")
	}
	return roomCode
}

function createRoomCode(): string {
	for (let attempt = 0; attempt < 100; attempt += 1) {
		let roomCode = ""
		for (let index = 0; index < 4; index += 1) {
			roomCode +=
				ROOM_CODE_ALPHABET[roomCodeRandom.integer(ROOM_CODE_ALPHABET.length)]
		}
		if (!rooms.has(roomCode)) return roomCode
	}
	throw new Error("Could not allocate a room code.")
}

function getRoomState(roomCode: string): HeartsState {
	return getState(heartsStateAtoms, roomCode)
}

function setRoomState(roomCode: string, state: HeartsState): void {
	setState(heartsStateAtoms, roomCode, state)
}

function cardForLog(state: HeartsState, cardId: CardId): unknown {
	return {
		id: cardId,
		value: state.cardValues[cardId] ?? null,
	}
}

function stateSummaryForLog(state: HeartsState): unknown {
	return {
		currentPlayerId: state.currentPlayerId,
		heartsBroken: state.heartsBroken,
		hostId: state.hostId,
		lastTrickWinnerId: state.lastTrickWinnerId,
		passDirection: state.passDirection,
		phase: state.phase,
		players: state.players.map((player) => ({
			aiModel: player.aiModel,
			connected: player.connected,
			handSize: player.hand.length,
			id: player.id,
			kind: player.kind,
			name: player.name,
			passSubmitted: player.passSelection !== null,
			roundPoints: player.roundPoints,
			score: player.score,
			takenSize: player.taken.length,
		})),
		roomCode: state.roomCode,
		roundNumber: state.roundNumber,
		statusMessage: state.statusMessage,
		trickLeaderId: state.trickLeaderId,
		trickNumber: state.trickNumber,
		winnerIds: state.winnerIds,
	}
}

function stateSnapshotForLog(state: HeartsState): unknown {
	const {
		cardValues: _cardValues,
		currentTrick,
		physicalCardIds: _physicalCardIds,
		players,
		...table
	} = state
	return {
		...table,
		currentTrick: currentTrick.map((play) => ({
			card: cardForLog(state, play.cardId),
			playerId: play.playerId,
		})),
		players: players.map((player) => ({
			...player,
			hand: player.hand.map((cardId) => cardForLog(state, cardId)),
			passSelection: player.passSelection?.map((cardId) =>
				cardForLog(state, cardId),
			),
			taken: player.taken.map((cardId) => cardForLog(state, cardId)),
		})),
	}
}

function actionErrorMessage(thrown: unknown): string {
	return thrown instanceof Error
		? thrown.message
		: "The table could not complete that action."
}

function acknowledgeAction(
	ack: ActionAck,
	spanName: string,
	attributes: Record<string, unknown>,
	action: (span: ActiveSpan) => Promise<string> | string,
): void {
	void serverLogger
		.withRootSpan(spanName, attributes, async (span) => {
			try {
				const roomCode = await action(span)
				span.setAttributes({ roomCode })
				span.event("action.accepted", {
					roomCode,
					state: rooms.has(roomCode)
						? stateSummaryForLog(getRoomState(roomCode))
						: null,
				})
				ack({ ok: true, roomCode })
			} catch (thrown) {
				const message = actionErrorMessage(thrown)
				const roomCode =
					typeof attributes.roomCode === "string"
						? attributes.roomCode
						: typeof attributes.playerId === "string"
							? roomCodeByPlayer.get(attributes.playerId as PlayerId)
							: undefined
				span.setOutcome("error")
				span.event(
					"action.rejected",
					{
						error: thrown,
						message,
						room:
							roomCode !== undefined && rooms.has(roomCode)
								? stateSnapshotForLog(getRoomState(roomCode))
								: null,
						roomCode,
					},
					"warn",
				)
				ack({ ok: false, error: message })
			}
		})
		.catch((error: unknown) => {
			serverLogger.error("action.acknowledgement_failed", {
				error,
				spanName,
			})
		})
}

function leaveCurrentRoom(
	playerId: PlayerId,
	expectedSocket?: GameServerSocket,
): void {
	const roomCode = roomCodeByPlayer.get(playerId)
	if (roomCode === undefined) return
	const room = rooms.get(roomCode)
	if (
		expectedSocket !== undefined &&
		room?.connections.get(playerId)?.socket !== expectedSocket
	) {
		return
	}
	roomCodeByPlayer.delete(playerId)
	if (room === undefined) return

	const connection = room.connections.get(playerId)
	connection?.dispose()
	room.connections.delete(playerId)
	setRoomState(roomCode, disconnectPlayer(getRoomState(roomCode), playerId))

	const state = getRoomState(roomCode)
	if (state.players.length === 0) {
		for (const aiPlayer of room.aiPlayers.values()) aiPlayer.dispose()
		rooms.delete(roomCode)
		disposeState(heartsStateAtoms, roomCode)
		serverLogger.info("room.disposed", {
			playerId,
			roomCode,
			state: stateSummaryForLog(state),
		})
		return
	}
	if (state.hostId === null && state.players[0] !== undefined) {
		state.hostId = state.players[0].id
		setRoomState(roomCode, state)
	}
}

function connectPlayerToRoom(
	room: Room,
	roomCode: string,
	socket: GameServerSocket,
	playerId: PlayerId,
	playerName: string,
): void {
	leaveCurrentRoom(playerId)
	setRoomState(
		roomCode,
		joinHeartsGame(
			getRoomState(roomCode),
			playerId,
			playerName,
			aiModelsByPlayer.has(playerId)
				? {
						aiModel: aiModelsByPlayer.get(playerId) as AiModelId,
						kind: "ai",
					}
				: { aiModel: null, kind: "human" },
		),
	)

	const provideState = realtimeStateProvider({
		consumer: playerId,
		socket: socket as unknown as UserServerConfig["socket"],
	})
	const publicGameView = findState(publicGameViewProjectionSelectors, roomCode)
	const privatePlayerView = findState(privatePlayerViewProjectionSelectors, [
		roomCode,
		playerId,
	])
	const disposePublic = provideState(publicGameViewAtom, publicGameView)
	const disposePrivate = provideState(privatePlayerViewAtom, privatePlayerView)
	const dispose = () => {
		disposePrivate()
		disposePublic()
	}

	room.connections.set(playerId, { dispose, socket })
	roomCodeByPlayer.set(playerId, roomCode)
	serverLogger.info("realtime.projections_provided", {
		playerId,
		privateProjection: privatePlayerView.key,
		publicProjection: publicGameView.key,
		roomCode,
		state: stateSummaryForLog(getRoomState(roomCode)),
	})
}

function roomForPlayer(playerId: PlayerId): [string, Room] {
	const roomCode = roomCodeByPlayer.get(playerId)
	if (roomCode === undefined) {
		throw new HeartsRuleError("Join a room before playing.")
	}
	const room = rooms.get(roomCode)
	if (room === undefined) {
		throw new HeartsRuleError("That room no longer exists.")
	}
	return [roomCode, room]
}

function serveSocket(socketInput: UserServerConfig): () => void {
	const playerId = socketInput.consumer as PlayerId
	const socket = socketInput.socket as unknown as GameServerSocket
	socket.data.playerId = playerId

	socket.on("createRoom", (playerNameInput, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.create_room",
			{ playerId, playerNameInput },
			(span) => {
				const playerName = normalizePlayerName(playerNameInput)
				const roomCode = createRoomCode()
				const room: Room = {
					aiNameRandom: createSeededRandom(`ai-name:${roomCode}:${GAME_SEED}`),
					aiPlayers: new Map(),
					connections: new Map(),
					dealRandom: createSeededRandom(`deal:${roomCode}:${GAME_SEED}`),
					identityRandom: createSeededRandom(
						`identity:${roomCode}:${GAME_SEED}`,
					),
				}
				setRoomState(
					roomCode,
					createHeartsGame(
						roomCode,
						playerId,
						playerName,
						createPhysicalCardIds(room.identityRandom.uuid),
					),
				)
				rooms.set(roomCode, room)
				connectPlayerToRoom(room, roomCode, socket, playerId, playerName)
				span.event("room.created", {
					room: stateSummaryForLog(getRoomState(roomCode)),
				})
				return roomCode
			},
		)
	})

	socket.on("joinRoom", (roomCodeInput, playerNameInput, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.join_room",
			{ playerId, playerNameInput, roomCodeInput },
			(span) => {
				const roomCode = normalizeRoomCode(roomCodeInput)
				const playerName = normalizePlayerName(playerNameInput)
				const room = rooms.get(roomCode)
				if (room === undefined) {
					throw new HeartsRuleError("No active table has that room code.")
				}
				connectPlayerToRoom(room, roomCode, socket, playerId, playerName)
				span.event("room.player_joined", {
					playerId,
					playerName,
					room: stateSummaryForLog(getRoomState(roomCode)),
				})
				return roomCode
			},
		)
	})

	socket.on("leaveRoom", (ack) => {
		const roomCode = roomCodeByPlayer.get(playerId) ?? ""
		acknowledgeAction(
			ack,
			"realtime.action.leave_room",
			{ playerId, roomCode },
			(span) => {
				leaveCurrentRoom(playerId)
				span.event("room.player_left", { playerId, roomCode })
				return roomCode
			},
		)
	})

	socket.on("assignAiSeat", (modelIdInput, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.assign_ai_seat",
			{ modelId: modelIdInput, playerId },
			async (span) => {
				const [roomCode, room] = roomForPlayer(playerId)
				const state = getRoomState(roomCode)
				if (state.hostId !== playerId) {
					throw new HeartsRuleError("Only the host can assign AI seats.")
				}
				if (state.phase !== "lobby") {
					throw new HeartsRuleError(
						"AI seats can only be assigned before the game starts.",
					)
				}
				if (state.players.length >= 4) {
					throw new HeartsRuleError("This table already has four players.")
				}
				if (!isAiModelId(modelIdInput)) {
					throw new HeartsRuleError("Choose a supported OpenAI model.")
				}

				const rawPlayerId = room.identityRandom.uuid()
				const aiPlayerId = `user::${rawPlayerId}` satisfies PlayerId
				const playerSecret = randomUUID()
				const name = generateAiPlayerName(
					room.aiNameRandom,
					state.players.map((player) => player.name),
				)
				aiModelsByPlayer.set(aiPlayerId, modelIdInput)
				try {
					const runtime = await createAiPlayer({
						modelId: modelIdInput,
						name,
						playerId: aiPlayerId,
						playerSecret,
						roomCode,
						serverUrl: `http://127.0.0.1:${SERVER_PORT}`,
					})
					room.aiPlayers.set(aiPlayerId, runtime)
				} catch (error) {
					aiModelsByPlayer.delete(aiPlayerId)
					playerSecrets.delete(rawPlayerId)
					throw error
				}
				span.event("room.ai_seat_assigned", {
					aiPlayerId,
					modelId: modelIdInput,
					name,
					room: stateSummaryForLog(getRoomState(roomCode)),
				})
				return roomCode
			},
		)
	})

	socket.on("removeAiSeat", (aiPlayerId, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.remove_ai_seat",
			{ aiPlayerId, playerId },
			(span) => {
				const [roomCode, room] = roomForPlayer(playerId)
				const state = getRoomState(roomCode)
				if (state.hostId !== playerId) {
					throw new HeartsRuleError("Only the host can remove AI seats.")
				}
				if (state.phase !== "lobby") {
					throw new HeartsRuleError(
						"AI seats can only be removed before the game starts.",
					)
				}
				const aiPlayer = state.players.find(
					(candidate) => candidate.id === aiPlayerId && candidate.kind === "ai",
				)
				if (aiPlayer === undefined) {
					throw new HeartsRuleError("That AI seat is not at this table.")
				}
				room.aiPlayers.get(aiPlayerId)?.dispose()
				room.aiPlayers.delete(aiPlayerId)
				aiModelsByPlayer.delete(aiPlayerId)
				playerSecrets.delete(aiPlayerId.replace(/^user::/, ""))
				leaveCurrentRoom(aiPlayerId)
				span.event("room.ai_seat_removed", {
					aiPlayer,
					roomCode,
				})
				return roomCode
			},
		)
	})

	socket.on("startGame", (ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.start_game",
			{ playerId },
			(span) => {
				const [roomCode, room] = roomForPlayer(playerId)
				const nextState = startGame(
					getRoomState(roomCode),
					playerId,
					room.dealRandom.next,
				)
				setRoomState(roomCode, nextState)
				span.event("game.dealt", {
					room: stateSnapshotForLog(nextState),
				})
				return roomCode
			},
		)
	})

	socket.on("passCards", (cardIds, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.pass_cards",
			{ cardIds, playerId },
			(span) => {
				const [roomCode] = roomForPlayer(playerId)
				const state = getRoomState(roomCode)
				const payload = parsePassCardsPayload({ cardIds })
				const nextState = submitPass(state, playerId, payload.cardIds)
				setRoomState(roomCode, nextState)
				span.event("game.cards_passed", {
					direction: state.passDirection,
					playerId,
					selectedCards: payload.cardIds.map((cardId) =>
						cardForLog(state, cardId),
					),
					state: stateSummaryForLog(nextState),
				})
				if (nextState.phase === "playing") {
					span.event("game.pass_completed", {
						room: stateSnapshotForLog(nextState),
					})
				}
				return roomCode
			},
		)
	})

	socket.on("playCard", (cardId, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.play_card",
			{ cardId, playerId },
			(span) => {
				const [roomCode] = roomForPlayer(playerId)
				const state = getRoomState(roomCode)
				const payload = parsePlayCardPayload({ cardId })
				const player = state.players.find(
					(candidate) => candidate.id === playerId,
				)
				const nextState = playCard(state, playerId, payload.cardId)
				setRoomState(roomCode, nextState)
				span.event("game.card_played", {
					card: cardForLog(state, payload.cardId),
					currentTrickBefore: state.currentTrick.map((play) => ({
						card: cardForLog(state, play.cardId),
						playerId: play.playerId,
					})),
					handSizeBefore: player?.hand.length,
					playerId,
					state: stateSummaryForLog(nextState),
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
						state: stateSummaryForLog(nextState),
						winnerTakenCards: winner?.taken.map((takenCardId) =>
							cardForLog(nextState, takenCardId),
						),
					})
				}
				return roomCode
			},
		)
	})

	socket.on("startNextRound", (ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.start_next_round",
			{ playerId },
			(span) => {
				const [roomCode, room] = roomForPlayer(playerId)
				const nextState = startNextRound(
					getRoomState(roomCode),
					playerId,
					room.dealRandom.next,
				)
				setRoomState(roomCode, nextState)
				span.event("game.dealt", {
					room: stateSnapshotForLog(nextState),
				})
				return roomCode
			},
		)
	})

	socket.on("restartGame", (ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.restart_game",
			{ playerId },
			(span) => {
				const [roomCode] = roomForPlayer(playerId)
				const nextState = restartGame(getRoomState(roomCode), playerId)
				setRoomState(roomCode, nextState)
				span.event("game.restarted", {
					room: stateSnapshotForLog(nextState),
				})
				return roomCode
			},
		)
	})

	return () => {
		const roomCode = roomCodeByPlayer.get(playerId)
		void serverLogger.withRootSpan(
			"realtime.disconnect",
			{ playerId, roomCode },
			(span) => {
				leaveCurrentRoom(playerId, socket)
				span.event("room.player_disconnected", { playerId, roomCode })
			},
		)
	}
}

const contentTypes: Record<string, string> = {
	".css": "text/css; charset=utf-8",
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".svg": "image/svg+xml",
}

const distributionDirectory = resolve("dist")
const httpServer = createServer((request, response) => {
	if (request.url === "/health") {
		response.writeHead(200, { "content-type": "application/json" })
		response.end(JSON.stringify({ ok: true }))
		return
	}
	if (!existsSync(distributionDirectory)) {
		response.writeHead(200, { "content-type": "text/plain; charset=utf-8" })
		response.end("Wayfarer Hearts realtime server")
		return
	}
	const requestedPath =
		request.url === undefined
			? "/"
			: new URL(request.url, "http://localhost").pathname
	const normalizedPath = requestedPath === "/" ? "/index.html" : requestedPath
	const candidate = resolve(distributionDirectory, `.${normalizedPath}`)
	const safeCandidate = candidate.startsWith(`${distributionDirectory}/`)
	const filePath =
		safeCandidate && existsSync(candidate)
			? candidate
			: join(distributionDirectory, "index.html")
	response.writeHead(200, {
		"content-type":
			contentTypes[extname(filePath)] ?? "application/octet-stream",
	})
	createReadStream(filePath).pipe(response)
})

const socketServer = new Server<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	{ playerId: PlayerId }
>(httpServer, {
	cors: {
		origin: ["http://127.0.0.1:5173", "http://localhost:5173"],
	},
})

realtime(
	socketServer as unknown as Server,
	(handshake) => {
		const playerId = handshake.auth.playerId
		const playerSecret = handshake.auth.playerSecret
		if (
			typeof playerId !== "string" ||
			typeof playerSecret !== "string" ||
			!/^[0-9a-f-]{36}$/i.test(playerId) ||
			!/^[0-9a-f-]{36}$/i.test(playerSecret)
		) {
			serverLogger.warn("realtime.auth.rejected", {
				playerId,
				reason: "invalid_identity_shape",
			})
			return new Error("A valid player identity is required.")
		}
		const knownSecret = playerSecrets.get(playerId)
		if (knownSecret !== undefined && knownSecret !== playerSecret) {
			serverLogger.warn("realtime.auth.rejected", {
				playerId,
				reason: "identity_already_claimed",
			})
			return new Error("That player identity is already claimed.")
		}
		playerSecrets.set(playerId, playerSecret)
		const userKey = `user::${playerId}` satisfies UserKey
		serverLogger.info("realtime.auth.accepted", {
			playerId: userKey,
			returningIdentity: knownSecret !== undefined,
		})
		return userKey
	},
	serveSocket,
)

httpServer.listen(SERVER_PORT, "0.0.0.0", () => {
	serverLogger.info("server.listening", {
		gameSeed: GAME_SEED,
		host: "0.0.0.0",
		logLevel: process.env.LOG_LEVEL ?? "info",
		nodeEnv: process.env.NODE_ENV ?? "development",
		openAiConfigured: Boolean(process.env.OPENAI_API_KEY),
		port: SERVER_PORT,
		publicUrl: `http://127.0.0.1:${SERVER_PORT}`,
		varmintCacheMode: process.env.VARMINT_CACHE_MODE ?? "off",
	})
})
