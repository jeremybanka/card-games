import { createReadStream, existsSync } from "node:fs"
import { createServer } from "node:http"
import { extname, join, resolve } from "node:path"
import { randomInt } from "node:crypto"

import { disposeState, findState, getState, setState } from "atom.io"
import type { UserKey } from "atom.io/realtime"
import type { UserServerConfig } from "atom.io/realtime-server"
import { realtime } from "atom.io/realtime-server"
import { realtimeStateProvider } from "atom.io/realtime-server"
import { Server } from "socket.io"
import type { Socket } from "socket.io"

import {
	createHeartsGame,
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

const SERVER_PORT = Number.parseInt(process.env.PORT ?? "8787", 10)
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"
const PLAYER_NAME_MAXIMUM_LENGTH = 18

type GameServerSocket = Socket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	{ playerId: PlayerId }
>

type Room = {
	connections: Map<PlayerId, { dispose: () => void; socket: GameServerSocket }>
}

const rooms = new Map<string, Room>()
const roomCodeByPlayer = new Map<PlayerId, string>()
const playerSecrets = new Map<string, string>()

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
			roomCode += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)]
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

function acknowledge(ack: ActionAck, action: () => string): void {
	try {
		const roomCode = action()
		ack({ ok: true, roomCode })
	} catch (thrown) {
		const message =
			thrown instanceof Error
				? thrown.message
				: "The table could not complete that action."
		ack({ ok: false, error: message })
	}
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
		rooms.delete(roomCode)
		disposeState(heartsStateAtoms, roomCode)
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
		joinHeartsGame(getRoomState(roomCode), playerId, playerName),
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
		acknowledge(ack, () => {
			const playerName = normalizePlayerName(playerNameInput)
			const roomCode = createRoomCode()
			const room: Room = { connections: new Map() }
			setRoomState(roomCode, createHeartsGame(roomCode, playerId, playerName))
			rooms.set(roomCode, room)
			connectPlayerToRoom(room, roomCode, socket, playerId, playerName)
			return roomCode
		})
	})

	socket.on("joinRoom", (roomCodeInput, playerNameInput, ack) => {
		acknowledge(ack, () => {
			const roomCode = normalizeRoomCode(roomCodeInput)
			const playerName = normalizePlayerName(playerNameInput)
			const room = rooms.get(roomCode)
			if (room === undefined) {
				throw new HeartsRuleError("No active table has that room code.")
			}
			connectPlayerToRoom(room, roomCode, socket, playerId, playerName)
			return roomCode
		})
	})

	socket.on("leaveRoom", (ack) => {
		const roomCode = roomCodeByPlayer.get(playerId) ?? ""
		acknowledge(ack, () => {
			leaveCurrentRoom(playerId)
			return roomCode
		})
	})

	socket.on("startGame", (ack) => {
		const [roomCode] = roomForPlayer(playerId)
		acknowledge(ack, () => {
			setRoomState(roomCode, startGame(getRoomState(roomCode), playerId))
			return roomCode
		})
	})

	socket.on("passCards", (cardIds, ack) => {
		const [roomCode] = roomForPlayer(playerId)
		acknowledge(ack, () => {
			if (
				!Array.isArray(cardIds) ||
				cardIds.some((id) => typeof id !== "string")
			) {
				throw new HeartsRuleError("The submitted pass is invalid.")
			}
			setRoomState(
				roomCode,
				submitPass(getRoomState(roomCode), playerId, cardIds as CardId[]),
			)
			return roomCode
		})
	})

	socket.on("playCard", (cardId, ack) => {
		const [roomCode] = roomForPlayer(playerId)
		acknowledge(ack, () => {
			if (typeof cardId !== "string" || !cardId.startsWith("card::")) {
				throw new HeartsRuleError("That card identifier is invalid.")
			}
			setRoomState(roomCode, playCard(getRoomState(roomCode), playerId, cardId))
			return roomCode
		})
	})

	socket.on("startNextRound", (ack) => {
		const [roomCode] = roomForPlayer(playerId)
		acknowledge(ack, () => {
			setRoomState(roomCode, startNextRound(getRoomState(roomCode), playerId))
			return roomCode
		})
	})

	socket.on("restartGame", (ack) => {
		const [roomCode] = roomForPlayer(playerId)
		acknowledge(ack, () => {
			setRoomState(roomCode, restartGame(getRoomState(roomCode), playerId))
			return roomCode
		})
	})

	return () => leaveCurrentRoom(playerId, socket)
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
			return new Error("A valid player identity is required.")
		}
		const knownSecret = playerSecrets.get(playerId)
		if (knownSecret !== undefined && knownSecret !== playerSecret) {
			return new Error("That player identity is already claimed.")
		}
		playerSecrets.set(playerId, playerSecret)
		return `user::${playerId}` satisfies UserKey
	},
	serveSocket,
)

httpServer.listen(SERVER_PORT, "0.0.0.0", () => {
	console.log(`Wayfarer Hearts listening on http://127.0.0.1:${SERVER_PORT}`)
})
