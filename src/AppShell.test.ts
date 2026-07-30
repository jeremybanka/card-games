// @vitest-environment happy-dom

import { cleanup, render, waitFor } from "@testing-library/react"
import { setState } from "atom.io"
import { createElement, type FunctionComponent } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AppShell } from "./AppShell.tsx"
import { roomSessionAtom } from "./client-state.ts"

const realtimeMocks = vi.hoisted(() => ({
	usePullAtom: vi.fn(() => ({ gameKind: "hearts" })),
}))

vi.mock("preact/jsx-runtime", async () => {
	const runtime = await vi.importActual<object>("react/jsx-runtime")
	const developmentRuntime = await vi.importActual<object>(
		"react/jsx-dev-runtime",
	)
	return { ...runtime, ...developmentRuntime }
})

vi.mock("atom.io/realtime-react", () => realtimeMocks)

vi.mock("./client-state.ts", async () => {
	const { atom, setState: setAtomState } =
		await vi.importActual<typeof import("atom.io")>("atom.io")
	const appShellTestRoomSessionAtom = atom<{
		generation: number
		playerName: string
		roomCode: string
	} | null>({
		key: "appShellTestRoomSession",
		default: null,
	})
	return {
		actionErrorAtom: atom<string | null>({
			key: "appShellTestActionError",
			default: null,
		}),
		clearRoomSession: () => setAtomState(appShellTestRoomSessionAtom, null),
		connectionStateAtom: atom<
			| "connected"
			| "connecting"
			| "disconnected"
			| "reconnected"
			| "reconnecting"
		>({
			key: "appShellTestConnectionState",
			default: "connected",
		}),
		gameKindInputAtom: atom<"hearts" | "ohHell" | "summoners">({
			key: "appShellTestGameKindInput",
			default: "hearts",
		}),
		playerNameInputAtom: atom<string>({
			key: "appShellTestPlayerNameInput",
			default: "",
		}),
		roomCodeInputAtom: atom<string>({
			key: "appShellTestRoomCodeInput",
			default: "",
		}),
		roomSessionAtom: appShellTestRoomSessionAtom,
		saveRoomSession: vi.fn(),
	}
})

vi.mock("./game-socket.ts", () => ({
	gameSocket: {
		emit: vi.fn(),
	},
}))

vi.mock("./GameTable.tsx", () => ({
	GameTable: () => null,
}))

vi.mock("./SummonersTable.tsx", () => ({
	SummonersTable: () => null,
}))

afterEach(() => {
	cleanup()
	realtimeMocks.usePullAtom.mockClear()
	setState(roomSessionAtom, null)
})

describe("AppShell realtime room handoff", () => {
	it("starts pulling the game projection only after taking a seat", async () => {
		setState(roomSessionAtom, null)
		const AppShellCompat = AppShell as unknown as FunctionComponent
		render(createElement(AppShellCompat))

		expect(realtimeMocks.usePullAtom).not.toHaveBeenCalled()

		setState(roomSessionAtom, {
			generation: 1,
			playerName: "Ada",
			roomCode: "WIND",
		})

		await waitFor(() => {
			expect(realtimeMocks.usePullAtom).toHaveBeenCalledTimes(1)
		})
	})
})
