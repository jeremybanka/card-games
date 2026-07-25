import { getState, setState } from "atom.io"

import { connectionStateAtom } from "./client-state.ts"
import type { ConnectionState } from "./client-state.ts"

const recoveryConfirmationDurationMs = 4_000

export type ConnectionStatusSource = {
	onConnect: (listener: () => void) => void
	onConnectError: (listener: () => void) => void
	onDisconnect: (listener: () => void) => void
	onReconnectAttempt: (listener: () => void) => void
}

type Schedule = (callback: () => void, delay: number) => void

export function connectionActionsEnabled(state: ConnectionState): boolean {
	return state === "connected" || state === "reconnected"
}

export function connectionStatusMessage(state: ConnectionState): string | null {
	switch (state) {
		case "connected":
			return null
		case "connecting":
			return "Connecting to the table…"
		case "disconnected":
			return "Connection lost. Waiting to reconnect…"
		case "reconnecting":
			return "Connection lost. Reconnecting…"
		case "reconnected":
			return "Connection restored."
	}
}

export function trackConnectionStatus(
	source: ConnectionStatusSource,
	schedule: Schedule = (callback, delay) => {
		window.setTimeout(callback, delay)
	},
): void {
	let hasConnected = false

	source.onConnect(() => {
		const nextState = hasConnected ? "reconnected" : "connected"
		hasConnected = true
		setState(connectionStateAtom, nextState)
		if (nextState === "connected") return
		schedule(() => {
			if (getState(connectionStateAtom) === "reconnected") {
				setState(connectionStateAtom, "connected")
			}
		}, recoveryConfirmationDurationMs)
	})
	source.onDisconnect(() => {
		setState(connectionStateAtom, "disconnected")
	})
	source.onReconnectAttempt(() => {
		setState(connectionStateAtom, "reconnecting")
	})
	source.onConnectError(() => {
		setState(connectionStateAtom, "disconnected")
	})
}
