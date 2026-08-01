import { describe, expect, it, vi } from "vitest"

import { prepareRoomConnection } from "../server/room-connection.node.ts"

describe("room connection handoff", () => {
	it("replaces a same-room socket without removing the player's seat", () => {
		const playerId = "user::ada"
		const dispose = vi.fn()
		const leaveCurrentRoom = vi.fn()
		const connections = new Map([[playerId, { dispose }]])

		prepareRoomConnection({
			connections,
			currentRoomCode: "WIND",
			leaveCurrentRoom,
			nextRoomCode: "WIND",
			playerId,
		})

		expect(dispose).toHaveBeenCalledOnce()
		expect(connections.has(playerId)).toBe(false)
		expect(leaveCurrentRoom).not.toHaveBeenCalled()
	})

	it("leaves the old room before connecting to a different room", () => {
		const playerId = "user::ada"
		const dispose = vi.fn()
		const leaveCurrentRoom = vi.fn()
		const connections = new Map([[playerId, { dispose }]])

		prepareRoomConnection({
			connections,
			currentRoomCode: "FIRE",
			leaveCurrentRoom,
			nextRoomCode: "WIND",
			playerId,
		})

		expect(leaveCurrentRoom).toHaveBeenCalledOnce()
		expect(dispose).not.toHaveBeenCalled()
		expect(connections.has(playerId)).toBe(true)
	})
})
