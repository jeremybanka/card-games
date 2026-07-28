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
import type { AiModelId } from "../src/ai/ai-models.ts"
import type { GameState } from "../src/game/game-state.ts"
import { createSeededRandom } from "../src/game/seeded-random.ts"
import {
	gameStateAtoms,
	privatePlayerViewProjectionSelectors,
	privatePlayerViewAtom,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "../src/game/game-state-atoms.ts"
import type {
	ActionAck,
	ClientToServerEvents,
	GameKind,
	PlayerId,
	ServerToClientEvents,
} from "../src/game/game-types.ts"
import {
	type ActiveSpan,
	serverLogger,
} from "../src/observability/span-logger.node.ts"
import { generateAiPlayerName } from "./ai-player-name.node.ts"
import {
	createGameController,
	type Dispose,
	type GameActionAcknowledger,
	type GameActionsOf,
	type GameController,
	type GameEventSocket,
	type GameStateOf,
	type GameStateStore,
	type PlayerController,
} from "./game-controller.node.ts"
import { heartsGame } from "./hearts-game.node.ts"
import { ohHellGame } from "./oh-hell-game.node.ts"
import type { WayfarerGameResources } from "./wayfarer-game-resources.node.ts"

const SERVER_PORT = Number.parseInt(process.env.PORT ?? "8787", 10)
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const PLAYER_NAME_MAXIMUM_LENGTH = 18
const GAME_SEED = process.env.GAME_SEED?.trim() || randomUUID()
const roomCodeRandom = createSeededRandom(`room-code:${GAME_SEED}`)

class RoomError extends Error {}

type GameServerSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	{ playerId: PlayerId }
>

type Room<Game> = {
	connections: Map<PlayerId, { dispose: () => void; socket: GameServerSocket }>
	controller: GameController<Game>
}

type HeartsRoom = Room<typeof heartsGame>
type OhHellRoom = Room<typeof ohHellGame>

type StoredRoom = {
	bindActions: (
		socket: GameServerSocket,
		playerId: PlayerId,
		acknowledge: GameActionAcknowledger,
	) => Dispose
	connectPlayer: (
		playerId: PlayerId,
		playerName: string,
		controller: PlayerController,
	) => void
	connections: Map<PlayerId, { dispose: Dispose; socket: GameServerSocket }>
	disconnectPlayer: (playerId: PlayerId) => void
	dispose: Dispose
	isVacant: () => boolean
	stateSnapshotForLog: () => unknown
	stateSummaryForLog: () => unknown
}

function storeRoom<Game>(room: Room<Game>): StoredRoom {
	return {
		bindActions: (socket, playerId, acknowledge) =>
			room.controller.bindActions(
				socket as unknown as GameEventSocket<GameActionsOf<Game>>,
				playerId,
				acknowledge,
			),
		connectPlayer: room.controller.connectPlayer,
		connections: room.connections,
		disconnectPlayer: room.controller.disconnectPlayer,
		dispose: room.controller.dispose,
		isVacant: room.controller.isVacant,
		stateSnapshotForLog: room.controller.stateSnapshotForLog,
		stateSummaryForLog: room.controller.stateSummaryForLog,
	}
}

const rooms = new Map<string, StoredRoom>()
const roomCodeByPlayer = new Map<PlayerId, string>()
const playerSecrets = new Map<string, string>()
const aiModelsByPlayer = new Map<PlayerId, AiModelId>()

function normalizePlayerName(input: string): string {
	const name = input.trim().replace(/\s+/g, " ")
	if (name.length < 1 || name.length > PLAYER_NAME_MAXIMUM_LENGTH) {
		throw new RoomError(
			`Names must be between 1 and ${PLAYER_NAME_MAXIMUM_LENGTH} characters.`,
		)
	}
	return name
}

function normalizeRoomCode(input: string): string {
	const roomCode = input.trim().toUpperCase()
	if (!/^[A-Z]{4}$/.test(roomCode)) {
		throw new RoomError("Room codes contain four letters.")
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

function gameStateStore<State extends GameState>(
	roomCode: string,
	gameKind: State["gameKind"],
): GameStateStore<State> {
	return {
		get: () => {
			const state = getState(gameStateAtoms, roomCode)
			if (state.gameKind !== gameKind) {
				throw new Error(
					`Room ${roomCode} contains ${state.gameKind}, expected ${gameKind}.`,
				)
			}
			return state as State
		},
		set: (state) => setState(gameStateAtoms, roomCode, state),
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
					state: rooms.get(roomCode)?.stateSummaryForLog() ?? null,
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
								? rooms.get(roomCode)?.stateSnapshotForLog()
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
	room.disconnectPlayer(playerId)

	if (room.isVacant()) {
		room.dispose()
		const state = room.stateSummaryForLog()
		rooms.delete(roomCode)
		disposeState(gameStateAtoms, roomCode)
		serverLogger.info("room.disposed", {
			playerId,
			roomCode,
			state,
		})
	}
}

function connectPlayerToRoom(
	room: StoredRoom,
	roomCode: string,
	socket: GameServerSocket,
	playerId: PlayerId,
	playerName: string,
): void {
	leaveCurrentRoom(playerId)
	const playerController = aiModelsByPlayer.has(playerId)
		? {
				aiModel: aiModelsByPlayer.get(playerId) as AiModelId,
				kind: "ai" as const,
			}
		: { aiModel: null, kind: "human" as const }
	room.connectPlayer(playerId, playerName, playerController)

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
	const disposeActions = room.bindActions(
		socket,
		playerId,
		(ack, spanName, attributes, action) => {
			acknowledgeAction(ack, spanName, attributes, async (span) => {
				await action(span)
				return roomCode
			})
		},
	)
	const dispose = () => {
		disposeActions()
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
		state: room.stateSummaryForLog(),
	})
}

function createWayfarerGameResources(roomCode: string): WayfarerGameResources {
	const aiNameRandom = createSeededRandom(`ai-name:${roomCode}:${GAME_SEED}`)
	const aiPlayers = new Map<PlayerId, AiPlayerRuntime>()
	const identityRandom = createSeededRandom(`identity:${roomCode}:${GAME_SEED}`)
	return {
		aiNameRandom,
		aiPlayers,
		assignAiSeat: async (modelId, existingPlayerNames) => {
			const rawPlayerId = identityRandom.uuid()
			const aiPlayerId = `user::${rawPlayerId}` satisfies PlayerId
			const playerSecret = randomUUID()
			const name = generateAiPlayerName(aiNameRandom, existingPlayerNames)
			aiModelsByPlayer.set(aiPlayerId, modelId)
			try {
				const runtime = await createAiPlayer({
					modelId,
					name,
					playerId: aiPlayerId,
					playerSecret,
					roomCode,
					serverUrl: `http://127.0.0.1:${SERVER_PORT}`,
				})
				aiPlayers.set(aiPlayerId, runtime)
			} catch (error) {
				aiModelsByPlayer.delete(aiPlayerId)
				playerSecrets.delete(rawPlayerId)
				throw error
			}
			return { aiPlayerId, name }
		},
		dealRandom: createSeededRandom(`deal:${roomCode}:${GAME_SEED}`),
		identityRandom,
		removeAiSeat: (aiPlayerId) => {
			aiPlayers.get(aiPlayerId)?.dispose()
			aiPlayers.delete(aiPlayerId)
			aiModelsByPlayer.delete(aiPlayerId)
			playerSecrets.delete(aiPlayerId.replace(/^user::/, ""))
			leaveCurrentRoom(aiPlayerId)
		},
	}
}

function createHeartsRoom(
	roomCode: string,
	hostId: PlayerId,
	hostName: string,
): StoredRoom {
	const resources = createWayfarerGameResources(roomCode)
	const state = heartsGame.create({
		host: { id: hostId, name: hostName },
		resources,
		roomCode,
	})
	setState(gameStateAtoms, roomCode, state)
	const room: HeartsRoom = {
		connections: new Map(),
		controller: createGameController(
			heartsGame,
			roomCode,
			resources,
			gameStateStore<GameStateOf<typeof heartsGame>>(roomCode, "hearts"),
		),
	}
	return storeRoom(room)
}

function createOhHellRoom(
	roomCode: string,
	hostId: PlayerId,
	hostName: string,
): StoredRoom {
	const resources = createWayfarerGameResources(roomCode)
	const state = ohHellGame.create({
		host: { id: hostId, name: hostName },
		resources,
		roomCode,
	})
	setState(gameStateAtoms, roomCode, state)
	const room: OhHellRoom = {
		connections: new Map(),
		controller: createGameController(
			ohHellGame,
			roomCode,
			resources,
			gameStateStore<GameStateOf<typeof ohHellGame>>(roomCode, "ohHell"),
		),
	}
	return storeRoom(room)
}

const createGameRoom = {
	hearts: createHeartsRoom,
	ohHell: createOhHellRoom,
} satisfies Record<
	GameKind,
	(roomCode: string, hostId: PlayerId, hostName: string) => StoredRoom
>

function serveSocket(socketInput: UserServerConfig): () => void {
	const playerId = socketInput.consumer as PlayerId
	const socket = socketInput.socket as unknown as GameServerSocket
	socket.data.playerId = playerId

	socket.on("createRoom", (playerNameInput, gameKindInput, ack) => {
		acknowledgeAction(
			ack,
			"realtime.action.create_room",
			{ gameKindInput, playerId, playerNameInput },
			(span) => {
				const playerName = normalizePlayerName(playerNameInput)
				const gameKind: GameKind =
					gameKindInput === "ohHell" ? "ohHell" : "hearts"
				const roomCode = createRoomCode()
				const room = createGameRoom[gameKind](roomCode, playerId, playerName)
				rooms.set(roomCode, room)
				connectPlayerToRoom(room, roomCode, socket, playerId, playerName)
				span.event("room.created", {
					room: room.stateSummaryForLog(),
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
					throw new RoomError("No active table has that room code.")
				}
				connectPlayerToRoom(room, roomCode, socket, playerId, playerName)
				span.event("room.player_joined", {
					playerId,
					playerName,
					room: room.stateSummaryForLog(),
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
