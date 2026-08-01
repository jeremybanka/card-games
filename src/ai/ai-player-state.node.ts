import type {
	Loadable,
	ReadonlyPureSelectorToken,
	RegularAtomToken,
	Silo,
} from "atom.io"

import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "../game/game-state-atoms.ts"
import { assertMatchingGameKinds } from "../game/game-registry.ts"
import type { AiStrategyReviewTurn, PlayerId } from "../game/game-types.ts"
import { aiGameStrategy } from "./ai-game-strategy.ts"
import { renderAiGameFacts, type AiGameContext } from "./ai-game-facts.ts"
import { fallbackAiDecision, type AiTurnGenerator } from "./ai-strategy.ts"
import type {
	AiMemoryLedgerEntry,
	AiNextAction,
	SummonersAiTurnLedgerEntry,
	AiTurnDecision,
} from "./ai-types.ts"

export type AiPlayerSiloState = {
	aiCurrentPlanAtom: RegularAtomToken<string>
	aiGeneratedCurrentPlanSelector: ReadonlyPureSelectorToken<Loadable<string>>
	aiGeneratedNextActionSelector: ReadonlyPureSelectorToken<
		Loadable<AiNextAction>
	>
	aiNextActionAtom: RegularAtomToken<AiNextAction | null>
	aiMemoryLedgerAtom: RegularAtomToken<AiMemoryLedgerEntry[]>
	aiRenderedGameFactsSelector: ReadonlyPureSelectorToken<string>
	aiStrategicTurnSelector: ReadonlyPureSelectorToken<Loadable<AiTurnDecision>>
	aiStrategyReviewTurnsAtom: RegularAtomToken<AiStrategyReviewTurn[]>
	aiSummonersTurnLedgerAtom: RegularAtomToken<SummonersAiTurnLedgerEntry[]>
}

export function createAiPlayerSiloState(
	silo: Silo,
	playerId: PlayerId,
	generateTurn: AiTurnGenerator,
): AiPlayerSiloState {
	silo.install([publicGameViewAtom, privatePlayerViewAtom])

	const aiCurrentPlanAtom = silo.atom<string>({
		key: "aiCurrentPlan",
		default: "",
	})
	const aiNextActionAtom = silo.atom<AiNextAction | null>({
		key: "aiNextAction",
		default: null,
	})
	const aiMemoryLedgerAtom = silo.atom<AiMemoryLedgerEntry[]>({
		key: "aiMemoryLedger",
		default: [],
	})
	const aiStrategyReviewTurnsAtom = silo.atom<AiStrategyReviewTurn[]>({
		key: "aiStrategyReviewTurns",
		default: [],
	})
	const aiSummonersTurnLedgerAtom = silo.atom<SummonersAiTurnLedgerEntry[]>({
		key: "aiSummonersTurnLedger",
		default: [],
	})

	const contextFromState = (get: {
		<T>(token: RegularAtomToken<T>): T
	}): AiGameContext => {
		const publicView = get(publicGameViewAtom)
		const privateView = get(privatePlayerViewAtom)
		assertMatchingGameKinds(
			publicView,
			privateView,
			"AI public and private views describe different games.",
		)
		const views = {
			privateView,
			publicView,
		} as Pick<AiGameContext, "privateView" | "publicView">
		const strategy = aiGameStrategy(views.publicView.gameKind)
		const strategicPrivateView = strategy.privateViewForStrategy(
			views.privateView as never,
		)
		assertMatchingGameKinds(
			views.publicView,
			strategicPrivateView,
			"AI strategy changed the private view game kind.",
		)
		return {
			memoryLedger: get(aiMemoryLedgerAtom),
			playerId,
			previousPlan: get(aiCurrentPlanAtom),
			privateView: strategicPrivateView,
			publicView: views.publicView,
			summonersTurnLedger: get(aiSummonersTurnLedgerAtom),
		} as AiGameContext
	}

	const aiRenderedGameFactsSelector = silo.selector<string>({
		key: "aiRenderedGameFacts",
		get: ({ get }) => renderAiGameFacts(contextFromState(get)),
	})
	const aiStrategicTurnSelector = silo.selector<Loadable<AiTurnDecision>>({
		key: "aiStrategicTurn",
		get: ({ get }) => {
			get(aiRenderedGameFactsSelector)
			const context = contextFromState(get)
			return aiGameStrategy(context.publicView.gameKind).usesTurnGenerator(
				context,
			)
				? generateTurn(context)
				: fallbackAiDecision(context)
		},
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
		aiMemoryLedgerAtom,
		aiNextActionAtom,
		aiRenderedGameFactsSelector,
		aiStrategicTurnSelector,
		aiStrategyReviewTurnsAtom,
		aiSummonersTurnLedgerAtom,
	}
}
