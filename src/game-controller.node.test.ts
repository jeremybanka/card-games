import { describe, expect, expectTypeOf, it } from "vitest"

import type {
	HeartsClientEvents,
	OhHellClientEvents,
	PlayerId,
} from "./game/game-types.ts"
import {
	bindGameEvent,
	createGameController,
	type GameActionsOf,
	type GameDefinition,
	type GameEventSocket,
} from "../server/game-controller.node.ts"

type SummonEvents = {
	summon: (monster: string) => void
}

type SummonerState = {
	connectedPlayerIds: PlayerId[]
	summons: string[]
}

type SummonerResources = {
	summonLimit: number
}

const summonersGame: GameDefinition<
	"summoners",
	SummonerState,
	SummonEvents,
	SummonerResources
> = {
	bindActions: ({ controller, socket }) =>
		bindGameEvent(socket, "summon", (monster) => {
			const state = controller.getState()
			if (state.summons.length >= controller.resources.summonLimit) return
			controller.setState({
				...state,
				summons: [...state.summons, monster],
			})
		}),
	connectPlayer: (state, player) => ({
		...state,
		connectedPlayerIds: [...state.connectedPlayerIds, player.id],
	}),
	create: () => ({ connectedPlayerIds: [], summons: [] }),
	disconnectPlayer: (state, playerId) => ({
		...state,
		connectedPlayerIds: state.connectedPlayerIds.filter(
			(candidate) => candidate !== playerId,
		),
	}),
	dispose: () => {},
	isVacant: (state) => state.connectedPlayerIds.length === 0,
	kind: "summoners",
	stateSnapshotForLog: (state) => state,
	stateSummaryForLog: (state) => ({ summonCount: state.summons.length }),
}

describe("generic game controller", () => {
	it("preserves an unrelated game's exact action surface and listener lifecycle", () => {
		expectTypeOf<
			GameActionsOf<typeof summonersGame>
		>().toEqualTypeOf<SummonEvents>()
		expectTypeOf<
			"passCards" extends keyof HeartsClientEvents ? true : false
		>().toEqualTypeOf<true>()
		expectTypeOf<
			"submitBid" extends keyof HeartsClientEvents ? true : false
		>().toEqualTypeOf<false>()
		expectTypeOf<
			"submitBid" extends keyof OhHellClientEvents ? true : false
		>().toEqualTypeOf<true>()
		expectTypeOf<
			"passCards" extends keyof OhHellClientEvents ? true : false
		>().toEqualTypeOf<false>()

		let state = summonersGame.create({
			host: { id: "user::host", name: "Host" },
			resources: { summonLimit: 1 },
			roomCode: "TEST",
		})
		const listeners = new Map<string, (monster: string) => void>()
		const socket: GameEventSocket<SummonEvents> = {
			off: (event, listener) => {
				if (listeners.get(event) === listener) listeners.delete(event)
			},
			on: (event, listener) => {
				listeners.set(event, listener)
			},
		}
		const controller = createGameController(
			summonersGame,
			"TEST",
			{ summonLimit: 1 },
			{
				get: () => state,
				set: (nextState) => {
					state = nextState
				},
			},
		)
		expectTypeOf<
			"passCards" extends keyof typeof controller ? true : false
		>().toEqualTypeOf<false>()
		expectTypeOf<
			"summon" extends keyof typeof controller ? true : false
		>().toEqualTypeOf<false>()

		const dispose = controller.bindActions(socket, "user::host", () => {})
		expect([...listeners.keys()]).toEqual(["summon"])

		listeners.get("summon")?.("moss golem")
		listeners.get("summon")?.("ember fox")
		expect(controller.getState().summons).toEqual(["moss golem"])

		dispose()
		expect(listeners.size).toBe(0)
	})
})
