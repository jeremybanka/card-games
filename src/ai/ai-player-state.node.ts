import type {
	Loadable,
	ReadonlyPureSelectorToken,
	RegularAtomToken,
	Silo,
} from "atom.io"

import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "../game/hearts-state.ts"
import type { PlayerId } from "../game/hearts-types.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import type { AiTurnGenerator } from "./ai-strategy.ts"
import type {
	AiNextAction,
	AiTurnDecision,
	AiTurnObservation,
} from "./ai-types.ts"

export type AiPlayerSiloState = {
	aiCurrentPlanAtom: RegularAtomToken<string>
	aiGeneratedCurrentPlanSelector: ReadonlyPureSelectorToken<Loadable<string>>
	aiGeneratedNextActionSelector: ReadonlyPureSelectorToken<
		Loadable<AiNextAction>
	>
	aiNextActionAtom: RegularAtomToken<AiNextAction | null>
	aiRenderedGameFactsSelector: ReadonlyPureSelectorToken<string>
	aiStrategicTurnSelector: ReadonlyPureSelectorToken<Loadable<AiTurnDecision>>
	aiTurnObservationSelector: ReadonlyPureSelectorToken<Loadable<string>>
	aiTurnObservationsAtom: RegularAtomToken<AiTurnObservation[]>
}

export function createAiPlayerSiloState(
	silo: Silo,
	playerId: PlayerId,
	generateTurn: AiTurnGenerator,
): AiPlayerSiloState {
	silo.install([publicGameViewAtom, privatePlayerViewAtom])

	const aiTurnObservationsAtom = silo.atom<AiTurnObservation[]>({
		key: "aiTurnObservations",
		default: [],
	})
	const aiCurrentPlanAtom = silo.atom<string>({
		key: "aiCurrentPlan",
		default: "",
	})
	const aiNextActionAtom = silo.atom<AiNextAction | null>({
		key: "aiNextAction",
		default: null,
	})

	const contextFromState = (get: {
		<T>(token: RegularAtomToken<T>): T
	}): AiGameContext => ({
		observations: get(aiTurnObservationsAtom),
		playerId,
		previousPlan: get(aiCurrentPlanAtom),
		privateView: get(privatePlayerViewAtom),
		publicView: get(publicGameViewAtom),
	})

	const aiRenderedGameFactsSelector = silo.selector<string>({
		key: "aiRenderedGameFacts",
		get: ({ get }) => renderAiGameFacts(contextFromState(get)),
	})
	const aiStrategicTurnSelector = silo.selector<Loadable<AiTurnDecision>>({
		key: "aiStrategicTurn",
		get: ({ get }) => {
			get(aiRenderedGameFactsSelector)
			return generateTurn(contextFromState(get))
		},
	})
	const aiTurnObservationSelector = silo.selector<Loadable<string>>({
		key: "aiTurnObservation",
		get: ({ get }) =>
			Promise.resolve(get(aiStrategicTurnSelector)).then(
				(decision) => decision.observation,
			),
	})
	const aiGeneratedCurrentPlanSelector = silo.selector<Loadable<string>>({
		key: "aiGeneratedCurrentPlan",
		get: ({ get }) =>
			Promise.resolve(get(aiStrategicTurnSelector)).then(
				(decision) => decision.currentPlan,
			),
	})
	const aiGeneratedNextActionSelector = silo.selector<Loadable<AiNextAction>>({
		key: "aiGeneratedNextAction",
		get: ({ get }) =>
			Promise.resolve(get(aiStrategicTurnSelector)).then(
				(decision) => decision.nextAction,
			),
	})

	return {
		aiCurrentPlanAtom,
		aiGeneratedCurrentPlanSelector,
		aiGeneratedNextActionSelector,
		aiNextActionAtom,
		aiRenderedGameFactsSelector,
		aiStrategicTurnSelector,
		aiTurnObservationSelector,
		aiTurnObservationsAtom,
	}
}
