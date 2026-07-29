import type {
	ActionAck,
	PlayerController,
	PlayerId,
} from "../src/game/game-types.ts"
import type { ActiveSpan } from "../src/observability/span-logger.node.ts"

export type Dispose = () => void

export type GameEventSocket<Events extends object> = {
	off<Event extends Extract<keyof Events, string>>(
		event: Event,
		listener: Events[Event] extends (...arguments_: never[]) => unknown
			? Events[Event]
			: never,
	): void
	on<Event extends Extract<keyof Events, string>>(
		event: Event,
		listener: Events[Event] extends (...arguments_: never[]) => unknown
			? Events[Event]
			: never,
	): void
}

export type GameActionAcknowledger = (
	ack: ActionAck,
	spanName: string,
	attributes: Record<string, unknown>,
	action: (span: ActiveSpan) => Promise<void> | void,
) => void

export type GameDefinition<
	Kind extends string,
	State,
	Actions extends object,
	Resources,
> = {
	bindActions: (
		context: GameActionBindingContext<State, Actions, Resources>,
	) => Dispose
	connectPlayer: (
		state: State,
		player: {
			controller: PlayerController
			id: PlayerId
			name: string
		},
	) => State
	create: (context: {
		host: { id: PlayerId; name: string }
		resources: Resources
		roomCode: string
	}) => State
	disconnectPlayer: (state: State, playerId: PlayerId) => State
	dispose: (resources: Resources) => void
	isVacant: (state: State) => boolean
	kind: Kind
	stateSnapshotForLog: (state: State) => unknown
	stateSummaryForLog: (state: State) => unknown
}

export type GameStateOf<Game> =
	Game extends GameDefinition<
		infer _Kind,
		infer State,
		infer _Actions,
		infer _Resources
	>
		? State
		: never

export type GameActionsOf<Game> =
	Game extends GameDefinition<
		infer _Kind,
		infer _State,
		infer Actions,
		infer _Resources
	>
		? Actions
		: never

export type GameResourcesOf<Game> =
	Game extends GameDefinition<
		infer _Kind,
		infer _State,
		infer _Actions,
		infer Resources
	>
		? Resources
		: never

export type GameController<Game> = {
	bindActions: (
		socket: GameEventSocket<GameActionsOf<Game>>,
		playerId: PlayerId,
		acknowledge: GameActionAcknowledger,
	) => Dispose
	connectPlayer: (
		playerId: PlayerId,
		playerName: string,
		controller: PlayerController,
	) => void
	disconnectPlayer: (playerId: PlayerId) => void
	dispose: () => void
	getState: () => GameStateOf<Game>
	isVacant: () => boolean
	resources: GameResourcesOf<Game>
	roomCode: string
	setState: (state: GameStateOf<Game>) => void
	stateSnapshotForLog: () => unknown
	stateSummaryForLog: () => unknown
}

export type GameActionBindingContext<
	State,
	Actions extends object,
	Resources,
> = {
	acknowledge: GameActionAcknowledger
	controller: GameController<GameDefinition<string, State, Actions, Resources>>
	playerId: PlayerId
	socket: GameEventSocket<Actions>
}

export type GameStateStore<State> = {
	get: () => State
	set: (state: State) => void
}

export function createGameController<
	const Kind extends string,
	State,
	Actions extends object,
	Resources,
>(
	game: GameDefinition<Kind, State, Actions, Resources>,
	roomCode: string,
	resources: Resources,
	store: GameStateStore<State>,
): GameController<GameDefinition<Kind, State, Actions, Resources>> {
	const controller: GameController<
		GameDefinition<Kind, State, Actions, Resources>
	> = {
		bindActions: (socket, playerId, acknowledge) =>
			game.bindActions({
				acknowledge,
				controller,
				playerId,
				socket,
			}),
		connectPlayer: (playerId, playerName, playerController) => {
			store.set(
				game.connectPlayer(store.get(), {
					controller: playerController,
					id: playerId,
					name: playerName,
				}),
			)
		},
		disconnectPlayer: (playerId) => {
			store.set(game.disconnectPlayer(store.get(), playerId))
		},
		dispose: () => game.dispose(resources),
		getState: store.get,
		isVacant: () => game.isVacant(store.get()),
		resources,
		roomCode,
		setState: store.set,
		stateSnapshotForLog: () => game.stateSnapshotForLog(store.get()),
		stateSummaryForLog: () => game.stateSummaryForLog(store.get()),
	}
	return controller
}

export function bindGameEvent<
	Events extends object,
	Event extends Extract<keyof Events, string>,
>(
	socket: GameEventSocket<Events>,
	event: Event,
	listener: Events[Event] extends (...arguments_: never[]) => unknown
		? Events[Event]
		: never,
): Dispose {
	socket.on(event, listener)
	return () => socket.off(event, listener)
}

export function combineDisposers(disposers: readonly Dispose[]): Dispose {
	return () => {
		for (const dispose of disposers) dispose()
	}
}
