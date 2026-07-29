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
import { autoPlayEnabledAtom } from "./client-state.ts"
import { GameTable } from "./GameTable.tsx"
import type { GameSocket } from "./game-socket.ts"
import { parsePlayCardPayload } from "./game/game-actions.ts"
import { parsePassCardsPayload } from "./game/hearts-actions.ts"
import { createPhysicalCardIds } from "./game/standard-deck-domain.ts"
import {
	createHeartsGame,
	joinHeartsGame,
	playHeartsCard,
	startHeartsGame,
	submitPass,
	type HeartsState,
} from "./game/hearts-engine.ts"
import { createSeededRandom } from "./game/seeded-random.ts"
import {
	gameStateAtoms,
	privatePlayerViewAtom,
	privatePlayerViewProjectionSelectors,
	publicGameViewAtom,
	publicGameViewProjectionSelectors,
} from "./game/game-state-atoms.ts"
import type {
	ActionAck,
	ClientToServerEvents,
	PlayerId,
	ServerToClientEvents,
} from "./game/game-types.ts"
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
		autoPlayEnabledAtom: atom<boolean>({
			key: "playerVsTerraAutoPlayEnabled",
			default: false,
		}),
	}
})

const roomCode = "ZVHB"
const seed = "player-vs-terra-browser-v1"
const humanId = "user::81957b70-e9f6-484f-b47e-03c6b325b18e" satisfies PlayerId
const terraId = "user::a3e10227-a65a-4666-8db1-f511c8a8c567" satisfies PlayerId
const cacheDirectory = resolve(
	".varmint/hearts-games/player-vs-terra-v1/cache",
)
const terraCacheKey = "ai-natural-v5-hearts-gpt-5.6-terra"

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

function currentHeartsState(): HeartsState {
	const state = getState(gameStateAtoms, roomCode)
	if (state.gameKind !== "hearts") throw new Error("Expected a Hearts table.")
	return state
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
	setState(gameStateAtoms, roomCode, initial)

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
						gameStateAtoms,
						roomCode,
						joinHeartsGame(currentHeartsState(), playerId, playerName, {
							aiModel: "gpt-5.6-terra",
							kind: "ai",
						}),
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
							"gpt-5.6-terra",
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
						gameStateAtoms,
						roomCode,
						startHeartsGame(currentHeartsState(), playerId, dealRandom.next),
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
						gameStateAtoms,
						roomCode,
						submitPass(currentHeartsState(), playerId, payload.cardIds),
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
						gameStateAtoms,
						roomCode,
						playHeartsCard(currentHeartsState(), playerId, payload.cardId),
					)
					ack({ ok: true, roomCode })
				} catch (error) {
					actionFailure(ack, error)
				}
			})

			socket.on("requestAiStrategyReview", (aiPlayerId, ack) => {
				const state = currentHeartsState()
				if (
					playerId !== humanId ||
					aiPlayerId !== terraId ||
					(state.phase !== "roundComplete" && state.phase !== "gameComplete") ||
					aiRuntime === null
				) {
					ack({ ok: false, error: "Strategy review is unavailable." })
					return
				}
				ack({
					ok: true,
					review: {
						modelId: aiRuntime.modelId,
						playerId: terraId,
						playerName: "Terra AI 1",
						roundNumber: state.roundNumber,
						turns: [
							...aiRuntime.silo.getState(
								aiRuntime.state.aiStrategyReviewTurnsAtom,
							),
						],
					},
				})
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
	disposeState(gameStateAtoms, roomCode)
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
		// Exercise the reduced-motion presentation path so the full 26-trick replay
		// keeps every cognitive settle beat without depending on 26 animation dwells.
		vi.stubGlobal("matchMedia", () => ({ matches: true }))
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

			expect(
				(
					screen.getByRole("combobox", {
						name: "OpenAI opponent",
					}) as HTMLSelectElement
				).value,
			).toBe("gpt-5.6-luna")
			fireEvent.input(
				screen.getByRole("combobox", { name: "OpenAI opponent" }),
				{ target: { value: "gpt-5.6-terra" } },
			)
			fireEvent.click(screen.getByRole("button", { name: "Fill AI seat" }))
			await screen.findByRole("button", { name: "Remove Terra AI 1" })
			expect(screen.getAllByLabelText("AI player")).toHaveLength(2)

			fireEvent.click(screen.getByRole("button", { name: "Deal the cards" }))
			await screen.findByRole("button", { name: "A of clubs" })
			const autoPlaySwitch = screen.getByRole("switch", {
				name: "Auto-play off",
			}) as HTMLInputElement
			expect(autoPlaySwitch.checked).toBe(false)
			fireEvent.change(autoPlaySwitch, { target: { checked: true } })
			table.clientSilo.setState(autoPlayEnabledAtom, true)
			await screen.findByRole("switch", { name: "Auto-play on" })
			expect(
				(
					screen.getByRole("button", {
						name: "A of clubs",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false)
			fireEvent.change(
				screen.getByRole("switch", {
					name: "Auto-play on",
				}),
				{ target: { checked: false } },
			)
			table.clientSilo.setState(autoPlayEnabledAtom, false)
			await waitFor(() => {
				const terraPlayer = currentHeartsState().players.find(
					(player) => player.id === terraId,
				)
				expect(terraPlayer?.passSelection).toHaveLength(3)
			})
			const localHand = screen.getByLabelText("Your hand: 26 cards")
			const handHitSurface =
				localHand.querySelector<HTMLElement>("hand-hit-surface")
			expect(handHitSurface).not.toBeNull()
			expect(
				within(localHand).getByLabelText("26 cards in your hand"),
			).toHaveProperty("textContent", "26")
			const terraHand = screen.getByLabelText("26 cards in Terra AI 1's hand")
			expect(within(terraHand).getByLabelText("26 cards")).toHaveProperty(
				"textContent",
				"26",
			)
			const hoveredCardButton = screen.getByRole("button", {
				name: "A of clubs",
			})
			const hoveredCard = hoveredCardButton.closest("playing-card")
			const hoveredCardWrapper = hoveredCardButton.closest("hand-card")
			const restingLeft = (hoveredCardWrapper as HTMLElement | null)?.style.left
			const restingTransform = (hoveredCardWrapper as HTMLElement | null)?.style
				.transform
			const centeredHoverRect = vi
				.spyOn(hoveredCardWrapper as HTMLElement, "getBoundingClientRect")
				.mockReturnValue({
					bottom: 200,
					height: 100,
					left: 460,
					right: 540,
					toJSON: () => ({}),
					top: 100,
					width: 80,
					x: 460,
					y: 100,
				})
			fireEvent.pointerMove(handHitSurface!, {
				clientX: 500,
				clientY: 150,
				pointerId: 39,
				pointerType: "mouse",
			})
			expect(hoveredCard?.hasAttribute("data-hovered")).toBe(true)
			expect(localHand.hasAttribute("data-hover-active")).toBe(true)
			expect(
				(hoveredCard as HTMLElement | null)?.style.getPropertyValue(
					"--hover-delta-x",
				),
			).toMatch(/^-?[\d.]+px$/)
			expect(
				(hoveredCard as HTMLElement | null)?.style.getPropertyValue(
					"--hover-delta-y",
				),
			).toContain("var(--hand-card-width) * -0.82")
			expect((hoveredCardWrapper as HTMLElement | null)?.style.left).toBe(
				restingLeft,
			)
			expect((hoveredCardWrapper as HTMLElement | null)?.style.transform).toBe(
				restingTransform,
			)
			fireEvent.pointerLeave(handHitSurface!, {
				pointerId: 39,
				pointerType: "mouse",
			})
			expect(hoveredCard?.hasAttribute("data-hovered")).toBe(false)
			expect(localHand.hasAttribute("data-hover-active")).toBe(false)
			const passZone = screen.getByLabelText(
				"0 of 3 cards to pass to Terra AI 1",
			)
			const gestureTable = document.querySelector("game-table")
			expect(
				(
					screen.getByRole("button", {
						name: "Pass across to Terra AI 1",
					}) as HTMLButtonElement
				).disabled,
			).toBe(true)
			fireEvent.pointerDown(handHitSurface!, {
				clientX: 500,
				clientY: 150,
				pointerId: 40,
			})
			expect(hoveredCard?.hasAttribute("data-hovered")).toBe(true)
			expect(localHand.hasAttribute("data-card-active")).toBe(true)
			expect(passZone.getAttribute("aria-label")).toBe(
				"0 of 3 cards to pass to Terra AI 1",
			)
			fireEvent.pointerUp(handHitSurface!, {
				clientX: 500,
				clientY: 150,
				pointerId: 40,
			})
			expect(hoveredCard?.hasAttribute("data-hovered")).toBe(false)
			expect(localHand.hasAttribute("data-card-active")).toBe(false)
			expect(passZone.getAttribute("aria-label")).toBe(
				"0 of 3 cards to pass to Terra AI 1",
			)
			centeredHoverRect.mockRestore()

			const scrubButtons = within(localHand).getAllByRole("button")
			const scrubWrappers = Array.from(
				localHand.querySelectorAll<HTMLElement>("hand-card"),
			)
			const scrubRectSpies = scrubWrappers.map((wrapper, index) =>
				vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue({
					bottom: 200,
					height: 100,
					left: index * 100,
					right: index * 100 + 80,
					toJSON: () => ({}),
					top: 100,
					width: 80,
					x: index * 100,
					y: 100,
				}),
			)
			fireEvent.pointerMove(handHitSurface!, {
				clientX: 40,
				clientY: 150,
				pointerId: 45,
				pointerType: "mouse",
			})
			fireEvent.pointerMove(handHitSurface!, {
				clientX: 140,
				clientY: 150,
				pointerId: 45,
				pointerType: "mouse",
			})
			expect(
				scrubButtons[0]?.closest("playing-card")?.hasAttribute("data-hovered"),
			).toBe(false)
			expect(
				scrubButtons[1]?.closest("playing-card")?.hasAttribute("data-hovered"),
			).toBe(true)
			fireEvent.pointerLeave(handHitSurface!, {
				pointerId: 45,
				pointerType: "mouse",
			})
			expect(localHand.querySelector("playing-card[data-hovered]")).toBeNull()

			fireEvent.pointerDown(handHitSurface!, {
				clientX: 40,
				clientY: 150,
				pointerId: 44,
			})
			expect(
				scrubButtons[0]?.closest("playing-card")?.hasAttribute("data-hovered"),
			).toBe(true)
			fireEvent.pointerMove(handHitSurface!, {
				clientX: 140,
				clientY: 150,
				pointerId: 44,
			})
			expect(gestureTable?.getAttribute("data-card-gesture")).toBe("picking")
			expect(
				scrubButtons[0]?.closest("playing-card")?.hasAttribute("data-hovered"),
			).toBe(false)
			expect(
				scrubButtons[1]?.closest("playing-card")?.hasAttribute("data-hovered"),
			).toBe(true)
			fireEvent.pointerUp(handHitSurface!, {
				clientX: 140,
				clientY: 150,
				pointerId: 44,
			})
			expect(localHand.querySelector("playing-card[data-hovered]")).toBeNull()
			await new Promise((resolve) => window.setTimeout(resolve, 0))

			const hoveredScrubRect = (
				hoveredCardWrapper as HTMLElement
			).getBoundingClientRect()
			const hoveredScrubX = (hoveredScrubRect.left + hoveredScrubRect.right) / 2
			fireEvent.pointerDown(handHitSurface!, {
				clientX: hoveredScrubX,
				clientY: 150,
				pointerId: 41,
			})
			expect(hoveredCard?.hasAttribute("data-hovered")).toBe(true)
			fireEvent.pointerMove(handHitSurface!, {
				clientX: hoveredScrubX,
				clientY: 90,
				pointerId: 41,
			})
			expect(gestureTable?.getAttribute("data-card-gesture")).toBe("dragging")
			expect(localHand.querySelector("playing-card[data-hovered]")).toBeNull()
			expect(localHand.hasAttribute("data-hover-active")).toBe(false)
			expect(localHand.hasAttribute("data-card-active")).toBe(true)
			fireEvent.pointerUp(handHitSurface!, {
				clientX: 500,
				clientY: 300,
				pointerId: 41,
			})
			expect(passZone.getAttribute("aria-label")).toBe(
				"0 of 3 cards to pass to Terra AI 1",
			)
			expect(gestureTable?.getAttribute("data-card-gesture")).toBeNull()
			expect(localHand.hasAttribute("data-card-active")).toBe(false)

			vi.spyOn(passZone, "getBoundingClientRect").mockReturnValue({
				bottom: 120,
				height: 120,
				left: 50,
				right: 350,
				toJSON: () => ({}),
				top: 0,
				width: 300,
				x: 50,
				y: 0,
			})
			vi.spyOn(handHitSurface!, "getBoundingClientRect").mockReturnValue({
				bottom: 400,
				height: 200,
				left: 0,
				right: 400,
				toJSON: () => ({}),
				top: 200,
				width: 400,
				x: 0,
				y: 200,
			})
			fireEvent.pointerDown(handHitSurface!, {
				clientX: hoveredScrubX,
				clientY: 150,
				pointerId: 42,
			})
			fireEvent.pointerMove(handHitSurface!, {
				clientX: 150,
				clientY: 40,
				pointerId: 42,
			})
			expect(localHand.hasAttribute("data-card-active")).toBe(true)
			fireEvent.pointerUp(handHitSurface!, {
				clientX: 150,
				clientY: 40,
				pointerId: 42,
			})
			expect(passZone.getAttribute("aria-label")).toBe(
				"1 of 3 cards to pass to Terra AI 1",
			)
			expect(localHand.hasAttribute("data-card-active")).toBe(false)
			for (const spy of scrubRectSpies) spy.mockRestore()
			const passCardButton = within(passZone).getByRole("button", {
				name: "A of clubs",
			})
			fireEvent.pointerDown(passCardButton, {
				clientX: 150,
				clientY: 40,
				pointerId: 43,
			})
			expect(passZone.hasAttribute("data-card-active")).toBe(true)
			fireEvent.pointerMove(passCardButton, {
				clientX: 150,
				clientY: 250,
				pointerId: 43,
			})
			expect(passZone.hasAttribute("data-card-active")).toBe(true)
			fireEvent.pointerUp(passCardButton, {
				clientX: 150,
				clientY: 250,
				pointerId: 43,
			})
			expect(passZone.getAttribute("aria-label")).toBe(
				"0 of 3 cards to pass to Terra AI 1",
			)
			expect(passZone.hasAttribute("data-card-active")).toBe(false)
			expect(
				within(localHand).getByRole("button", { name: "A of clubs" }),
			).toBeTruthy()
			await new Promise((resolve) => window.setTimeout(resolve, 0))

			fireEvent.click(screen.getByRole("button", { name: "A of clubs" }))
			fireEvent.click(screen.getByRole("button", { name: "A of diamonds" }))
			fireEvent.click(screen.getByRole("button", { name: "K of hearts" }))
			const updatedPassZone = screen.getByLabelText(
				"3 of 3 cards to pass to Terra AI 1",
			)
			const passCards = updatedPassZone.querySelectorAll(
				"pass-card playing-card[data-selected]",
			)
			expect(passCards).toHaveLength(3)
			expect(screen.getByLabelText("Your hand: 23 cards")).toBeTruthy()
			expect(
				(
					screen.getByRole("button", {
						name: "Pass across to Terra AI 1",
					}) as HTMLButtonElement
				).disabled,
			).toBe(false)
			fireEvent.click(
				screen.getByRole("button", { name: "Pass across to Terra AI 1" }),
			)
			const receiptDialog = await screen.findByRole("dialog", {
				name: "Cards received from Terra AI 1",
			})
			const receivedCardIds = Array.from(
				receiptDialog.querySelectorAll<HTMLElement>(
					"receipt-card[data-card-id]",
				),
				(card) => card.dataset.cardId,
			)
			expect(receivedCardIds).toHaveLength(3)
			expect(screen.getByLabelText("Your hand: 23 cards")).toBeTruthy()
			fireEvent.click(
				screen.getByRole("button", { name: "Add cards to my hand" }),
			)
			await waitFor(() => {
				expect(screen.getByLabelText("Your hand: 26 cards")).toBeTruthy()
				for (const cardId of receivedCardIds) {
					expect(
						document.querySelector(
							`player-hand playing-card[data-card-id="${cardId}"]`,
						),
					).not.toBeNull()
				}
			})
			await screen.findByText("Your play")
			await waitFor(() => {
				expect(document.activeElement?.closest("player-hand")).not.toBeNull()
			})

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

			for (const [playIndex, cardName] of recordedHumanPlays.entries()) {
				const continueButton =
					playIndex === 0
						? null
						: await waitFor(
								() => {
									const reviewButton = screen.queryByRole("button", {
										name: "Continue to next trick",
									})
									const nextCard = screen.queryByRole("button", {
										name: cardName,
									}) as HTMLButtonElement | null
									expect(
										reviewButton !== null ||
											(nextCard !== null && !nextCard.disabled),
									).toBe(true)
									return reviewButton
								},
								{ timeout: 2_000 },
							)
				if (continueButton !== null) {
					fireEvent.click(continueButton)
				}
				const cardButton = await waitFor(() => {
					const button = screen.getByRole("button", {
						name: cardName,
					}) as HTMLButtonElement
					const delayedContinueButton = screen.queryByRole("button", {
						name: "Continue to next trick",
					})
					if (button.disabled && delayedContinueButton !== null) {
						fireEvent.click(delayedContinueButton)
					}
					expect(button.disabled).toBe(false)
					return button
				})
				if (playIndex === recordedHumanPlays.length - 1) {
					fireEvent.change(
						screen.getByRole("switch", {
							name: "Auto-play off",
						}),
						{ target: { checked: true } },
					)
					table.clientSilo.setState(autoPlayEnabledAtom, true)
					await waitFor(() => {
						expect(cardButton.disabled).toBe(true)
						expect(
							(
								screen.getByRole("button", {
									name: "Drag a card here",
								}) as HTMLButtonElement
							).disabled,
						).toBe(true)
					})
				} else if (cardName === "2 of clubs") {
					const playingHand = cardButton.closest("player-hand")
					const playingSurface =
						playingHand?.querySelector<HTMLElement>("hand-hit-surface")
					const playingCard = cardButton.closest("playing-card")
					const playableWrapper = cardButton.closest<HTMLElement>("hand-card")
					const disabledWrapper = [
						playableWrapper?.previousElementSibling,
						playableWrapper?.nextElementSibling,
					].find(
						(element): element is HTMLElement =>
							element instanceof HTMLElement &&
							element.matches("hand-card[data-disabled]"),
					)
					const disabledNeighbor =
						disabledWrapper?.querySelector("playing-card")
					expect(tableCenter.getAttribute("data-dropzone")).toBe("trick")
					expect(playingHand).not.toBeNull()
					expect(playingSurface).not.toBeNull()
					expect(playableWrapper?.hasAttribute("data-disabled")).toBe(false)
					expect(cardButton.disabled).toBe(false)
					expect(disabledWrapper).not.toBeNull()
					expect(
						(
							disabledWrapper?.querySelector(
								"button",
							) as HTMLButtonElement | null
						)?.disabled,
					).toBe(true)
					expect(disabledNeighbor).not.toBeNull()
					const seamClientX = 170
					const handRect = vi
						.spyOn(playingSurface!, "getBoundingClientRect")
						.mockReturnValue({
							bottom: 210,
							height: 120,
							left: 0,
							right: 220,
							toJSON: () => ({}),
							top: 90,
							width: 220,
							x: 0,
							y: 90,
						})
					const playableRect = vi
						.spyOn(playableWrapper!, "getBoundingClientRect")
						.mockReturnValue({
							bottom: 200,
							height: 100,
							left: 60,
							right: 140,
							toJSON: () => ({}),
							top: 100,
							width: 80,
							x: 60,
							y: 100,
						})
					const disabledRect = vi
						.spyOn(disabledWrapper!, "getBoundingClientRect")
						.mockReturnValue({
							bottom: 200,
							height: 100,
							left: 130,
							right: 210,
							toJSON: () => ({}),
							top: 100,
							width: 80,
							x: 130,
							y: 100,
						})
					expect(seamClientX).toBeGreaterThan(150)
					expect(seamClientX).toBeLessThan(210)
					fireEvent.pointerMove(playingSurface!, {
						clientX: 100,
						clientY: 180,
						pointerId: 50,
						pointerType: "mouse",
					})
					expect(playingCard?.hasAttribute("data-hovered")).toBe(true)
					expect(disabledNeighbor?.hasAttribute("data-hovered")).toBe(false)
					fireEvent.pointerLeave(playingSurface!)
					expect(playingCard?.hasAttribute("data-hovered")).toBe(false)
					fireEvent.pointerMove(playingSurface!, {
						clientX: seamClientX,
						clientY: 190,
						pointerId: 50,
						pointerType: "mouse",
					})
					expect(playingCard?.hasAttribute("data-hovered")).toBe(true)
					expect(disabledNeighbor?.hasAttribute("data-hovered")).toBe(false)
					fireEvent.pointerDown(playingSurface!, {
						clientX: 100,
						clientY: 150,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("picking")
					fireEvent.pointerMove(playingSurface!, {
						clientX: 130,
						clientY: 130,
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
					fireEvent.pointerMove(playingSurface!, {
						clientX: 135,
						clientY: 50,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("dragging")
					fireEvent.pointerUp(playingSurface!, {
						// This point is inside table-center but outside trick-center.
						clientX: 20,
						clientY: 0,
						pointerId: 1,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("pending")
					await waitFor(() => {
						expect(gameTable?.getAttribute("data-card-gesture")).toBeNull()
					})
					handRect.mockRestore()
					playableRect.mockRestore()
					disabledRect.mockRestore()
				} else if (cardName === "4 of clubs") {
					const playingHand = cardButton.closest("player-hand")
					const playingSurface =
						playingHand?.querySelector<HTMLElement>("hand-hit-surface")
					const playingWrapper = cardButton.closest<HTMLElement>("hand-card")
					expect(playingSurface).not.toBeNull()
					const playingRect = vi
						.spyOn(playingWrapper!, "getBoundingClientRect")
						.mockReturnValue({
							bottom: 200,
							height: 100,
							left: 60,
							right: 140,
							toJSON: () => ({}),
							top: 100,
							width: 80,
							x: 60,
							y: 100,
						})
					fireEvent.pointerDown(playingSurface!, {
						clientX: 100,
						clientY: 150,
						pointerId: 2,
					})
					fireEvent.pointerMove(playingSurface!, {
						clientX: 135,
						clientY: 50,
						pointerId: 2,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBe("dragging")
					fireEvent.pointerUp(playingSurface!, {
						clientX: 500,
						clientY: 300,
						pointerId: 2,
					})
					expect(gameTable?.getAttribute("data-card-gesture")).toBeNull()
					playingRect.mockRestore()
					expect(
						screen
							.getByRole("button", { name: cardName })
							.getAttribute("aria-pressed"),
					).toBe("false")
					await new Promise((resolve) => window.setTimeout(resolve, 0))
					fireEvent.click(screen.getByRole("button", { name: cardName }))
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
					const remainingCardCount = 25 - playIndex
					const hand = screen.getByLabelText(
						`Your hand: ${remainingCardCount} cards`,
					)
					expect(
						within(hand).queryByRole("button", { name: cardName }),
					).toBeNull()
					expect(
						within(hand).getByLabelText(
							`${remainingCardCount} cards in your hand`,
						),
					).toHaveProperty("textContent", String(remainingCardCount))
				})
			}

			const finalContinueButton = await screen.findByRole(
				"button",
				{ name: "Continue to next trick" },
				{ timeout: 2_000 },
			)
			fireEvent.click(finalContinueButton)
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
			fireEvent.click(
				within(scoreSheet as HTMLElement).getByRole("button", {
					name: "Review Terra AI 1's strategy",
				}),
			)
			const strategyLog = await screen.findByRole("dialog", {
				name: "Terra AI 1 strategy log",
			})
			expect(within(strategyLog).getAllByRole("article")).toHaveLength(27)
			expect(within(strategyLog).getByText("PASS")).not.toBeNull()
			expect(within(strategyLog).getByText("TRICK 26")).not.toBeNull()
			expect(within(strategyLog).queryByText("Saw")).toBeNull()
			expect(within(strategyLog).getAllByText("Thought")).toHaveLength(27)
			expect(within(strategyLog).getAllByText("Did")).toHaveLength(27)
			expect(strategyLog.textContent).not.toContain("card::")
			fireEvent.click(
				within(strategyLog).getByRole("button", {
					name: "Close strategy log",
				}),
			)
			expect(
				screen.queryByRole("dialog", {
					name: "Terra AI 1 strategy log",
				}),
			).toBeNull()
			const finalState = currentHeartsState()
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
			vi.unstubAllGlobals()
		}
	}, 30_000)
})
