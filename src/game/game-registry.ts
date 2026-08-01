import type {
	AnyPrivatePlayerView,
	AnyPublicGameView,
	GameKind,
	PrivatePlayerViewFor,
	PublicGameViewFor,
} from "./game-types.ts"

type GameTagged = {
	gameKind: GameKind
}

export function assertMatchingGameKinds(
	left: GameTagged,
	right: GameTagged,
	message: string,
): void {
	if (!matchingGameKinds(left, right)) throw new Error(message)
}

export function matchingGameKinds(
	left: GameTagged,
	right: GameTagged,
): boolean {
	return left.gameKind === right.gameKind
}

export type CorrelatedGameViews = {
	[Kind in GameKind]: {
		privateView: PrivatePlayerViewFor<Kind>
		publicView: PublicGameViewFor<Kind>
	}
}[GameKind]

export function correlateGameViews(
	publicView: AnyPublicGameView,
	privateView: AnyPrivatePlayerView,
	message: string,
): CorrelatedGameViews {
	assertMatchingGameKinds(publicView, privateView, message)
	return { privateView, publicView } as CorrelatedGameViews
}

/**
 * Erases the concrete entry type only after a total registry has been checked
 * at its declaration site.
 */
export function registeredGameAdapter<Adapter>(
	gameKind: string,
	registry: Readonly<Record<string, unknown>>,
): Adapter {
	return registry[gameKind] as Adapter
}

/**
 * Looks up an explicitly optional game capability. Absence means that the
 * concrete game does not implement that capability.
 */
export function registeredGameCapability<Capability>(
	gameKind: string,
	registry: Readonly<Partial<Record<string, unknown>>>,
): Capability | null {
	return (registry[gameKind] as Capability | undefined) ?? null
}
