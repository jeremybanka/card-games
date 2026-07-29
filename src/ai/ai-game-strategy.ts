import { chooseHeartsAutoPlayCard } from "../game/hearts-auto-play.ts"
import type {
	CardId,
	GameKind,
	OhHellPublicGameView,
	VisibleCard,
} from "../game/game-types.ts"
import type { AiGameContext } from "./ai-game-facts.ts"

type AiGameStrategy = {
	choosePlay: (context: AiGameContext) => CardId
	outputDescription: string
	outputName: string
	playPlan: string
	systemPrompt: string
}

function chooseOhHellPlay(context: AiGameContext): CardId {
	const publicView = context.publicView as OhHellPublicGameView
	const legalCards = context.privateView.cards.filter((card) =>
		context.privateView.playableCardIds.includes(card.id),
	)
	if (legalCards.length === 0) throw new Error("The AI has no legal card.")
	const me = publicView.players.find((player) => player.id === context.playerId)
	const needsTrick = (me?.tricksWon ?? 0) < (me?.bid ?? 0)
	const cardStrength = (card: VisibleCard): number => {
		const trumpBonus = card.suit === publicView.trumpSuit ? 100 : 0
		return trumpBonus + card.rank
	}
	const selected = [...legalCards].sort((left, right) =>
		needsTrick
			? cardStrength(right) - cardStrength(left)
			: cardStrength(left) - cardStrength(right),
	)[0]
	if (selected === undefined) throw new Error("The AI has no legal card.")
	return selected.id
}

const commonPrompt = [
	"Choose exactly one legal next action using an opaque card ID from the supplied hand.",
	"Compact cards use rank then suit: T/J/Q/K/A and C/D/H/S. Completed tricks encode Tn>winner followed by plays in order.",
	"Card values uniquely identify deck cards, so history omits opaque IDs without losing strategic identity.",
	"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
	"For play, copy exactly the card:: ID inside brackets on a hand row labeled LEGAL; do not include brackets or the label.",
	"Keep observation and plan terse; refer to cards by compact code and never repeat opaque IDs outside nextAction.",
]

const strategies: Record<GameKind, AiGameStrategy> = {
	hearts: {
		choosePlay: (context) =>
			chooseHeartsAutoPlayCard(
				context.privateView.cards,
				context.privateView.playableCardIds,
				context.publicView.currentTrick,
			),
		outputDescription:
			"A legal Hearts action plus a private observation and strategic plan.",
		outputName: "hearts_turn_decision",
		playPlan:
			"Avoid taking point-heavy tricks when possible and discard dangerous cards when void.",
		systemPrompt: [
			"You are a strategic Hearts player seated at a private multiplayer table.",
			"Choose exactly one legal next action using an opaque card ID from the supplied hand.",
			"Success means: obey the current phase, follow suit, minimize expected points, track exposed cards, and return a concise observation and reusable plan.",
			"Compact cards use rank then suit: T/J/Q/K/A and C/D/H/S. Completed tricks encode Tn>winner followed by plays in order.",
			"Use private pass memory and completed tricks as exact memory. Cards you passed remain known to be with their recipient until publicly played.",
			"Card values uniquely identify deck cards, so history omits opaque IDs without losing strategic identity.",
			"Never infer or claim values for hidden opponent cards. Opponent hand counts are known; opponent card values are not.",
			"For passing, return exactly three different card IDs from your private hand.",
			"For play, copy exactly the card:: ID inside brackets on a hand row labeled LEGAL; do not include brackets or the label.",
			"Keep observation and plan terse; refer to cards by compact code and never repeat opaque IDs outside nextAction.",
		].join("\n"),
	},
	ohHell: {
		choosePlay: chooseOhHellPlay,
		outputDescription:
			"A legal Oh Hell action plus a private observation and strategic plan.",
		outputName: "oh_hell_turn_decision",
		playPlan:
			"Target the exact bid: take tricks still needed, then shed strength and avoid extra tricks.",
		systemPrompt: [
			"You are a strategic Oh Hell player seated at a private multiplayer table.",
			"Success means: bid and win exactly the predicted number of tricks, obey turn order and follow-suit rules, account for trump, and return a concise observation and reusable plan.",
			"For bidding, return one number listed among the legal bids.",
			...commonPrompt,
		].join("\n"),
	},
}

export function aiGameStrategy(gameKind: GameKind | undefined): AiGameStrategy {
	// Recorded Hearts fixtures predate the game discriminator. Oh Hell recordings
	// always include it, so a missing value unambiguously means legacy Hearts.
	return strategies[gameKind ?? "hearts"]
}
