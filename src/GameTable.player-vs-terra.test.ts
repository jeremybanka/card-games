// @vitest-environment happy-dom

import { createServer } from "node:http"
import { readdir } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { resolve } from "node:path"

import {
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react"
import { disposeState, findState, getState, setState, Silo } from "atom.io"
import { IMPLICIT } from "atom.io/internal"
import { StoreProvider } from "atom.io/react"
import type { UserKey } from "atom.io/realtime"
import type { UserServerConfig } from "atom.io/realtime-server"
import { realtime, realtimeStateProvider } from "atom.io/realtime-server"
import { RealtimeProvider } from "atom.io/realtime-react"
import { createElement, type FunctionComponent, type ReactNode } from "react"
import { Server, type Socket as ServerSocket } from "socket.io"
import { io } from "socket.io-client"
import { Squirrel } from "varmint"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { createAiPlayer, type AiPlayerRuntime } from "./ai/ai-player.node.ts"
import { wrapAiGeneratorWithVarmint } from "./ai/ai-generator.node.ts"
import type { AiTurnGenerator } from "./ai/ai-strategy.ts"
import { GameTable } from "./GameTable.tsx"
import type { GameSocket } from "./game-socket.ts"
import {
	parsePassCardsPayload,
	parsePlayCardPayload,
} from "./game/hearts-actions.ts"
import {
	createHeartsGame,
	createPhysicalCardIds,
	joinHeartsGame,
	playCard,
	startGame,
	submitPass,
} from "./game/hearts-engine.ts"
import { createSeededRandom } from "./game/seeded-random.ts"
import {
	heartsStateAtoms,
	privatePlayerViewAtom,
	privatePlayerViewProjectionSelectors,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "./game/hearts-state.ts"
import type {
	ActionAck,
	ClientToServerEvents,
	PlayerId,
	ServerToClientEvents,
} from "./game/hearts-types.ts"
import { serverLogger } from "./observability/span-logger.node.ts"

vi.mock("preact/hooks", async () => {
	const react = await vi.importActual<typeof import("react")>("react")
	return {
		useEffect: react.useEffect,
		useMemo: react.useMemo,
		useRef: react.useRef,
		useState: react.useState,
	}
})

vi.mock("preact/jsx-runtime", async () => {
	const runtime = await vi.importActual<object>("react/jsx-runtime")
	const developmentRuntime = await vi.importActual<object>(
		"react/jsx-dev-runtime",
	)
	return { ...runtime, ...developmentRuntime }
})

vi.mock("./client-state.ts", async () => {
	const { atom } = await vi.importActual<typeof import("atom.io")>("atom.io")
	return {
		actionErrorAtom: atom<string | null>({
			key: "playerVsTerraActionError",
			default: null,
		}),
	}
})

const roomCode = "ZVHB"
const seed = "player-vs-terra-browser-v1"
const humanId = "user::81957b70-e9f6-484f-b47e-03c6b325b18e" satisfies PlayerId
const terraId = "user::a3e10227-a65a-4666-8db1-f511c8a8c567" satisfies PlayerId
const cacheDirectory = resolve("test-fixtures/player-vs-terra-v1/cache")
const terraCacheKey = "hearts-compact-v2-gpt-5.6-terra"

const recordedHumanPlays = [
	"2 of clubs",
	"4 of clubs",
	"7 of clubs",
	"J of clubs",
	"Q of clubs",
	"2 of diamonds",
	"3 of diamonds",
	"4 of diamonds",
	"5 of diamonds",
	"7 of diamonds",
	"2 of spades",
	"4 of spades",
	"5 of spades",
	"10 of diamonds",
	"6 of spades",
	"8 of spades",
	"9 of spades",
	"J of spades",
	"2 of hearts",
	"3 of hearts",
	"4 of hearts",
	"5 of hearts",
	"6 of hearts",
	"Q of spades",
	"K of spades",
	"A of spades",
] as const

type HeartsServerSocket = ServerSocket<
	ClientToServerEvents,
	ServerToClientEvents,
	Record<string, never>,
	Record<string, never>
>

type RealtimeTable = {
	aiRuntime: AiPlayerRuntime | null
	cacheMisses: unknown[]
	clientSilo: Silo
	humanSocket: GameSocket
	server: Server
	serverUrl: string
	terraDecisions: number
}

function actionFailure(ack: ActionAck, error: unknown): void {
	ack({
		error: error instanceof Error ? error.message : "Action failed.",
		ok: false,
	})
}

async function startRealtimeTable(): Promise<RealtimeTable> {
	const dealRandom = createSeededRandom(`deal:${roomCode}:${seed}`)
	const identityRandom = createSeededRandom(`identity:${roomCode}:${seed}`)
	const initial = createHeartsGame(
		roomCode,
		humanId,
		"Player",
		createPhysicalCardIds(identityRandom.uuid),
	)
	setState(heartsStateAtoms, roomCode, initial)

	const httpServer = createServer()
	const socketServer = new Server<
		ClientToServerEvents,
		ServerToClientEvents,
		Record<string, never>,
		Record<string, never>
	>(httpServer)
	const cacheMisses: unknown[] = []
	let terraDecisions = 0
	let aiRuntime: AiPlayerRuntime | null = null
	let serverUrl = ""

	const provideState = (
		socket: HeartsServerSocket,
		playerId: PlayerId,
	): (() => void) => {
		const provide = realtimeStateProvider({
			consumer: playerId,
			socket: socket as unknown as UserServerConfig["socket"],
		})
		const disposePublic = provide(
			publicGameViewAtom,
			findState(publicGameViewProjectionSelectors, roomCode),
		)
		const disposePrivate = provide(
			privatePlayerViewAtom,
			findState(privatePlayerViewProjectionSelectors, [roomCode, playerId]),
		)
		return () => {
			disposePrivate()
			disposePublic()
		}
	}

	realtime(
		socketServer as unknown as Server,
		(handshake) => {
			const playerId = `user::${String(handshake.auth.playerId)}`
			return playerId === humanId || playerId === terraId
				? (playerId satisfies UserKey)
				: new Error("Unknown deterministic player.")
		},
		(socketInput: UserServerConfig) => {
			const playerId = socketInput.consumer as PlayerId
			const socket = socketInput.socket as unknown as HeartsServerSocket
			let disposeProjection =
				playerId === humanId ? provideState(socket, playerId) : () => {}

			socket.on("joinRoom", (requestedRoom, playerName, ack) => {
				try {
					if (requestedRoom !== roomCode || playerId !== terraId) {
						throw new Error("Unknown deterministic table.")
					}
					setState(
						heartsStateAtoms,
						roomCode,
						joinHeartsGame(
							getState(heartsStateAtoms, roomCode),
							playerId,
							playerName,
							{ aiModel: "gpt-5.6-terra", kind: "ai" },
						),
					)
					disposeProjection()
					disposeProjection = provideState(socket, playerId)
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			socket.on("assignAiSeat", (modelId, ack) => {
				void (async () => {
					try {
						if (playerId !== humanId || modelId !== "gpt-5.6-terra") {
							throw new Error("Only the host can assign Terra.")
						}
						const generatedTerraId =
							`user::${identityRandom.uuid()}` satisfies PlayerId
						if (generatedTerraId !== terraId) {
							throw new Error(
								`Seeded Terra identity changed to ${generatedTerraId}.`,
							)
						}

						const squirrel = new Squirrel("read", cacheDirectory)
						const cachedGenerator = wrapAiGeneratorWithVarmint(
							terraCacheKey,
							async (context) => {
								cacheMisses.push(structuredClone(context))
								throw new Error("Terra cache miss.")
							},
							squirrel,
						)
						const generateTurn: AiTurnGenerator = async (context) => {
							terraDecisions += 1
							try {
								return await cachedGenerator(context)
							} catch (error) {
								cacheMisses.push(error)
								throw error
							}
						}
						aiRuntime = await createAiPlayer({
							generateTurn,
							modelId,
							name: "Terra AI 1",
							playerId: terraId,
							playerSecret: "terra-cache-replay",
							roomCode,
							serverUrl,
						})
						ack({ ok: true, roomCode })
					} catch (error) {
						actionFailure(ack, error)
					}
				})()
			})

			socket.on("startGame", (ack) => {
				try {
					setState(
						heartsStateAtoms,
						roomCode,
						startGame(
							getState(heartsStateAtoms, roomCode),
							playerId,
							dealRandom.next,
						),
					)
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			socket.on("passCards", (cardIds, ack) => {
				try {
					const payload = parsePassCardsPayload({ cardIds })
					setState(
						heartsStateAtoms,
						roomCode,
						submitPass(
							getState(heartsStateAtoms, roomCode),
							playerId,
							payload.cardIds,
						),
					)
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			socket.on("playCard", (cardId, ack) => {
				try {
					const payload = parsePlayCardPayload({ cardId })
					setState(
						heartsStateAtoms,
						roomCode,
						playCard(
							getState(heartsStateAtoms, roomCode),
							playerId,
							payload.cardId,
						),
					)
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			return () => {
				disposeProjection()
			}
		},
	)

	await new Promise<void>((resolveListen, reject) => {
		httpServer.once("error", reject)
		httpServer.listen(0, "127.0.0.1", resolveListen)
	})
	const address = httpServer.address() as AddressInfo
	serverUrl = `http://127.0.0.1:${address.port}`
	const humanSocket = io(serverUrl, {
		auth: {
			playerId: humanId.replace(/^user::/, ""),
			playerSecret: "recorded-browser-player",
		},
	}) as GameSocket
	const clientSilo = new Silo(
		{
			isProduction: false,
			lifespan: "ephemeral",
			name: "Player-vs-Terra-Testing-Library",
		},
		IMPLICIT.STORE,
	)

	return {
		get aiRuntime() {
			return aiRuntime
		},
		cacheMisses,
		clientSilo,
		humanSocket,
		server: socketServer,
		serverUrl,
		get terraDecisions() {
			return terraDecisions
		},
	}
}

async function stopRealtimeTable(table: RealtimeTable): Promise<void> {
	table.aiRuntime?.dispose()
	table.humanSocket.disconnect()
	await new Promise<void>((resolveClose) => {
		table.server.close(() => resolveClose())
	})
	disposeState(heartsStateAtoms, roomCode)
}

const GameTableCompat = GameTable as unknown as FunctionComponent<{
	onLeave: () => void
	socket: GameSocket
}>
const StoreProviderCompat = StoreProvider as unknown as FunctionComponent<{
	children?: ReactNode
	store: Silo["store"]
}>
const RealtimeProviderCompat =
	RealtimeProvider as unknown as FunctionComponent<{
		children?: ReactNode
		socket: GameSocket
	}>

describe("recorded player versus Terra table", () => {
	const originalLogLevel = serverLogger.getMinimumLevel()

	beforeAll(() => {
		serverLogger.setMinimumLevel("error")
	})

	afterAll(() => {
		serverLogger.setMinimumLevel(originalLogLevel)
	})

	it("replays every browser action and hits every Terra cache entry", async () => {
		const cacheFiles = await readdir(cacheDirectory, { recursive: true })
		const cacheInputCount = cacheFiles.filter((file) =>
			file.endsWith(".input.json"),
		).length
		const cacheOutputCount = cacheFiles.filter((file) =>
			file.endsWith(".output.json"),
		).length
		expect(cacheInputCount).toBe(27)
		expect(cacheOutputCount).toBe(27)

		const table = await startRealtimeTable()
		const view = render(
			createElement(
				StoreProviderCompat,
				{ store: table.clientSilo.store },
				createElement(
					RealtimeProviderCompat,
					{ socket: table.humanSocket },
					createElement(GameTableCompat, {
						onLeave: () => {},
						socket: table.humanSocket,
					}),
				),
			),
		)

		try {
			await screen.findByRole("heading", { name: roomCode })

			fireEvent.change(
				screen.getByRole("combobox", { name: "OpenAI opponent" }),
				{ target: { value: "gpt-5.6-terra" } },
			)
			fireEvent.click(screen.getByRole("button", { name: "Fill AI seat" }))
			await screen.findByRole("button", { name: "Remove Terra AI 1" })
			expect(screen.getAllByLabelText("AI player")).toHaveLength(2)

			fireEvent.click(screen.getByRole("button", { name: "Deal the cards" }))
			await screen.findByRole("button", { name: "A of clubs" })

			fireEvent.click(screen.getByRole("button", { name: "A of clubs" }))
			fireEvent.click(screen.getByRole("button", { name: "A of diamonds" }))
			fireEvent.click(screen.getByRole("button", { name: "K of hearts" }))
			fireEvent.click(screen.getByRole("button", { name: "Pass across" }))
			await screen.findByText("Your play")

			const tableCenter = document.querySelector("table-center")
			const trickCenter = document.querySelector("trick-center")
			const gameTable = document.querySelector("game-table")
			if (tableCenter === null || trickCenter === null || gameTable === null) {
				throw new Error("Expected the playing surface to be rendered.")
			}
			vi.spyOn(tableCenter, "getBoundingClientRect").mockReturnValue({
				bottom: 200,
				height: 300,
				left: 10,
				right: 400,
				toJSON: () => ({}),
				top: -100,
				width: 390,
				x: 10,
				y: -100,
			})
			vi.spyOn(trickCenter, "getBoundingClientRect").mockReturnValue({
				bottom: 150,
				height: 200,
				left: 100,
				right: 300,
				toJSON: () => ({}),
				top: -50,
				width: 200,
				x: 100,
				y: -50,
			})

			for (const cardName of recordedHumanPlays) {
				const continueButton = screen.queryByRole("button", {
					name: "Continue to next trick",
				})
				if (continueButton !== null) {
					fireEvent.click(continueButton)
				}
				const cardButton = await waitFor(() => {
					const button = screen.getByRole("button", {
						name: cardName,
					}) as HTMLButtonElement
					expect(button.disabled).toBe(false)
					return button
				})
				if (cardName === "2 of clubs") {
					fireEvent.pointerDown(cardButton, {
						clientX: 0,
						clientY: 100,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("picking")
					fireEvent.pointerMove(cardButton, {
						clientX: 30,
						clientY: 80,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("picking")
					expect(
						gameTable
							?.querySelector("playing-card[data-picking]")
							?.getAttribute("data-card-id"),
					).toBe(
						(cardButton.closest("playing-card") as HTMLElement | null)?.dataset
							.cardId,
					)
					fireEvent.pointerMove(cardButton, {
						clientX: 35,
						clientY: 0,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("dragging")
					fireEvent.pointerUp(cardButton, {
						// This point is inside table-center but outside trick-center.
						clientX: 20,
						clientY: 0,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("pending")
					await waitFor(() => {
						expect(gameTable?.getAttribute("data-card-gesture")).toBeNull()
					})
				} else if (cardName === "4 of clubs") {
					fireEvent.pointerDown(cardButton, {
						clientX: 0,
						clientY: 100,
						pointerId: 2,
					})
					fireEvent.pointerMove(cardButton, {
						clientX: 35,
						clientY: 0,
						pointerId: 2,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("dragging")
					fireEvent.pointerUp(cardButton, {
						clientX: 500,
						clientY: 300,
						pointerId: 2,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBeNull()
					expect(
						screen
							.getByRole("button", { name: cardName })
							.getAttribute("aria-pressed"),
					).toBe("true")
					fireEvent.click(
						screen.getByRole("button", {
							name: "Play selected card",
						}),
					)
				} else {
					fireEvent.click(cardButton)
					fireEvent.click(
						screen.getByRole("button", {
							name: "Play selected card",
						}),
					)
				}
				await waitFor(() => {
					const hand = screen.getByLabelText(/^Your hand:/)
					expect(
						within(hand).queryByRole("button", { name: cardName }),
					).toBeNull()
				})
			}

			const finalContinueButton = screen.queryByRole("button", {
				name: "Continue to next trick",
			})
			if (finalContinueButton !== null) {
				fireEvent.click(finalContinueButton)
			}
			const scores = await screen.findByRole("heading", {
				name: "Scores",
			})
			const scoreSheet = scores.closest("score-sheet")
			if (scoreSheet === null) {
				throw new Error("Expected the completed round score sheet.")
			}
			const scoreRows = within(scoreSheet as HTMLElement).getAllByRole(
				"listitem",
			)
			expect(
				scoreRows.map((row) => ({
					aiTag:
						row.querySelector("[aria-label='AI player']")?.textContent ?? null,
					avatar: row.querySelector("player-avatar")?.textContent,
					delta: row.querySelector(":scope > small")?.textContent,
					name: row.querySelector("nameplate-line > strong")?.textContent,
					score: row.querySelector(":scope > strong")?.textContent,
				})),
			).toEqual([
				{
					aiTag: "AI",
					avatar: "TA",
					delta: "+0",
					name: "Terra AI 1",
					score: "0",
				},
				{
					aiTag: null,
					avatar: "P",
					delta: "+26",
					name: "Player",
					score: "26",
				},
			])
			const finalState = getState(heartsStateAtoms, roomCode)
			const terra = finalState.players.find((player) => player.id === terraId)
			const terraRawPoints = terra?.taken.reduce((points, cardId) => {
				const card = finalState.cardValues[cardId]
				if (card?.suit === "hearts") return points + 1
				if (card?.suit === "spades" && card.rank === 12) {
					return points + 13
				}
				return points
			}, 0)
			expect(finalState.trickNumber).toBe(26)
			expect(terra?.taken).toHaveLength(46)
			expect(terraRawPoints).toBe(26)
			expect(terra?.roundPoints).toBe(0)
			expect(table.terraDecisions).toBe(cacheOutputCount)
			expect(table.cacheMisses).toEqual([])
		} finally {
			view.unmount()
			await stopRealtimeTable(table)
		}
	}, 30_000)
})
