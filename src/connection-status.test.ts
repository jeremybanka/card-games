// @vitest-environment happy-dom

import { getState, setState } from "atom.io"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.hoisted(() => {
	const values = new Map<string, string>()
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			clear: () => values.clear(),
			getItem: (key: string) => values.get(key) ?? null,
			removeItem: (key: string) => values.delete(key),
			setItem: (key: string, value: string) => values.set(key, value),
		},
	})
})

import {
	connectionActionsEnabled,
	connectionStatusMessage,
	trackConnectionStatus,
} from "./connection-status.ts"
import { actionErrorAtom, connectionStateAtom } from "./client-state.ts"

type ConnectionEvent =
	| "connect"
	| "connectError"
	| "disconnect"
	| "reconnectAttempt"

function connectionHarness(): {
	emit: (event: ConnectionEvent) => void
	schedule: ReturnType<typeof vi.fn>
} {
	const listeners = new Map<ConnectionEvent, () => void>()
	const schedule = vi.fn()
	trackConnectionStatus(
		{
			onConnect: (listener) => listeners.set("connect", listener),
			onConnectError: (listener) => listeners.set("connectError", listener),
			onDisconnect: (listener) => listeners.set("disconnect", listener),
			onReconnectAttempt: (listener) =>
				listeners.set("reconnectAttempt", listener),
		},
		schedule,
	)
	return {
		emit: (event) => {
			const listener = listeners.get(event)
			if (listener === undefined) throw new Error(`Missing ${event} listener`)
			listener()
		},
		schedule,
	}
}

describe("connection status", () => {
	beforeEach(() => {
		setState(connectionStateAtom, "connecting")
		setState(actionErrorAtom, null)
	})

	it("presents initial connection without enabling actions", () => {
		expect(connectionStatusMessage(getState(connectionStateAtom))).toBe(
			"Connecting to the table…",
		)
		expect(connectionActionsEnabled(getState(connectionStateAtom))).toBe(false)
	})

	it("never copies connect_error transport details into the action error", () => {
		const connection = connectionHarness()
		setState(actionErrorAtom, "You must follow suit.")

		connection.emit("connectError")

		expect(getState(connectionStateAtom)).toBe("disconnected")
		expect(connectionStatusMessage(getState(connectionStateAtom))).toBe(
			"Connection lost. Waiting to reconnect…",
		)
		expect(getState(actionErrorAtom)).toBe("You must follow suit.")
	})

	it("distinguishes connection loss from an active retry", () => {
		const connection = connectionHarness()
		connection.emit("connect")
		connection.emit("disconnect")

		expect(getState(connectionStateAtom)).toBe("disconnected")

		connection.emit("reconnectAttempt")

		expect(getState(connectionStateAtom)).toBe("reconnecting")
		expect(connectionStatusMessage(getState(connectionStateAtom))).toBe(
			"Connection lost. Reconnecting…",
		)
		expect(connectionActionsEnabled(getState(connectionStateAtom))).toBe(false)
	})

	it("confirms recovery, enables actions, and then clears stale status", () => {
		const connection = connectionHarness()
		connection.emit("connect")
		connection.emit("disconnect")
		connection.emit("reconnectAttempt")
		connection.emit("connect")

		expect(getState(connectionStateAtom)).toBe("reconnected")
		expect(connectionStatusMessage(getState(connectionStateAtom))).toBe(
			"Connection restored.",
		)
		expect(connectionActionsEnabled(getState(connectionStateAtom))).toBe(true)
		expect(connection.schedule).toHaveBeenCalledOnce()

		const clearRecovery = connection.schedule.mock.calls[0]?.[0] as
			| (() => void)
			| undefined
		expect(clearRecovery).toBeTypeOf("function")
		clearRecovery?.()

		expect(getState(connectionStateAtom)).toBe("connected")
		expect(connectionStatusMessage(getState(connectionStateAtom))).toBeNull()
	})

	it("does not let an old recovery timer override a later disconnect", () => {
		const connection = connectionHarness()
		connection.emit("connect")
		connection.emit("disconnect")
		connection.emit("connect")
		connection.emit("disconnect")

		const clearRecovery = connection.schedule.mock.calls[0]?.[0] as () => void
		clearRecovery()

		expect(getState(connectionStateAtom)).toBe("disconnected")
	})
})
