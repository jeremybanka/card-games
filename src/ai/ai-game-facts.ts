import type {
	HeartsPrivatePlayerView,
	HeartsPublicGameView,
	OhHellPrivatePlayerView,
	OhHellPublicGameView,
	PlayerId,
	PrivatePlayerView,
	PrivatePlayerViewFor,
	PublicGameView,
	PublicGameViewFor,
	Rank,
	Suit,
	VisibleCard,
} from "../game/game-types.ts"
import {
	assertMatchingGameKinds,
	registeredGameAdapter,
} from "../game/game-registry.ts"
import {
	passRecipientSeatIndex,
	passSenderSeatIndex,
} from "../game/seat-order.ts"
import {
	SUMMONERS_BATTLEFIELD_LIMIT,
	SUMMONERS_STARTING_HEALTH,
} from "../summoners/summoners-engine.ts"
import {
	SUMMONERS_KEYWORD_GLOSSARY,
	summonersKeywordLink,
} from "../summoners/summoners-glossary.ts"
import type { SummonersKeyword } from "../summoners/summoners-types.ts"
import { aiCardValue } from "./ai-card-value.ts"
import type {
	AiGameKind,
	AiMemoryLedgerEntry,
	SummonersAiAction,
	SummonersAiTurnLedgerEntry,
} from "./ai-types.ts"
import {
	summonersLegalActionLines,
	summonersTargetReference,
} from "./summoners-ai-strategy.ts"

type CommonAiGameContext = {
	memoryLedger: AiMemoryLedgerEntry[]
	playerId: PlayerId
	previousPlan: string
	summonersTurnLedger?: SummonersAiTurnLedgerEntry[]
}

export type AiGameContextFor<Kind extends AiGameKind> = CommonAiGameContext & {
	privateView: PrivatePlayerViewFor<Kind>
	publicView: PublicGameViewFor<Kind>
}

export type AiGameContext = {
	[Kind in AiGameKind]: AiGameContextFor<Kind>
}[AiGameKind]

type TrickTakingAiGameContext =
	| AiGameContextFor<"hearts">
	| AiGameContextFor<"ohHell">

type AiFactsAdapter<PublicView, PrivateView> = {
	gameDetails: (
		context: AiGameContext & {
			privateView: PrivateView
			publicView: PublicView
		},
	) => string
	handInstruction: (
		context: AiGameContext & {
			privateView: PrivateView
			publicView: PublicView
		},
	) => string
	title: string
}

const aiFactsAdapters = {
	hearts: {
		gameDetails: (context) =>
			`hearts ${
				context.publicView.heartsBroken ? "broken" : "intact"
			} | pass ${context.publicView.passDirection}`,
		handInstruction: (context) =>
			context.publicView.phase === "passing"
				? "choose exactly three card values"
				: "choose one listed legal card value",
		title: "Hearts",
	} satisfies AiFactsAdapter<HeartsPublicGameView, HeartsPrivatePlayerView>,
	ohHell: {
		gameDetails: (context) => {
			const me = context.publicView.players.find(
				(player) => player.id === context.playerId,
			)
			return `trump ${context.publicView.trumpSuit ?? "none"} | bid ${
				me?.bid ?? "pending"
			} | tricks ${me?.tricksWon ?? 0}`
		},
		handInstruction: (context) =>
			context.publicView.phase === "bidding"
				? `legal bids: ${context.privateView.legalBids.join(", ")}`
				: "choose one listed legal card value",
		title: "Oh Hell",
	} satisfies AiFactsAdapter<OhHellPublicGameView, OhHellPrivatePlayerView>,
} satisfies {
	[Kind in "hearts" | "ohHell"]: AiFactsAdapter<
		Extract<PublicGameView, { gameKind: Kind }>,
		Extract<PrivatePlayerView, { gameKind: Kind }>
	>
}

function aiFactsAdapter(
	context: Extract<
		AiGameContext,
		{ publicView: { gameKind: "hearts" | "ohHell" } }
	>,
): AiFactsAdapter<PublicGameView, PrivatePlayerView> {
	assertMatchingGameKinds(
		context.privateView,
		context.publicView,
		"AI public and private views describe different games.",
	)
	return registeredGameAdapter<
		AiFactsAdapter<PublicGameView, PrivatePlayerView>
	>(context.publicView.gameKind, aiFactsAdapters)
}

function renderSummonersFacts(context: AiGameContextFor<"summoners">): string {
	const me = context.publicView.players.find(
		(player) => player.id === context.playerId,
	)
	const usedKeywords = new Set<SummonersKeyword>()
	for (const player of context.publicView.players) {
		for (const being of player.battlefield) {
			for (const keyword of being.keywords) usedKeywords.add(keyword)
			for (const keyword of being.triggeredKeywords) usedKeywords.add(keyword)
		}
	}
	for (const card of context.privateView.hand) {
		for (const keyword of card.keywords ?? []) usedKeywords.add(keyword)
		for (const keyword of card.grantedKeywords ?? []) usedKeywords.add(keyword)
		for (const keyword of Object.keys(
			SUMMONERS_KEYWORD_GLOSSARY,
		) as SummonersKeyword[]) {
			if (new RegExp(`\\b${keyword}\\b`, "i").test(card.rules)) {
				usedKeywords.add(keyword)
			}
		}
	}
	const linkKeywords = (text: string): string => {
		let linked = text
		for (const keyword of usedKeywords) {
			linked = linked.replace(
				new RegExp(`\\b${keyword}\\b`, "gi"),
				summonersKeywordLink(keyword),
			)
		}
		return linked
	}
	const seats = context.publicView.players.flatMap((player, playerIndex) => {
		const playerLines = [
			`### P${playerIndex}${
				player.id === context.playerId ? " (you)" : ""
			} — ${player.name}`,
			"",
			`- Deck: ${player.deck?.name ?? "unchosen"}`,
			`- Life: ${player.health}/${SUMMONERS_STARTING_HEALTH}`,
			`- Spark: ${player.spark}/${player.maxSpark}`,
			`- Hand: ${player.handCount} cards`,
			`- Deck: ${player.deckCount} cards`,
			`- Discard: ${player.discardCount} cards`,
			`- Status: ${player.eliminated ? "eliminated" : "active"}`,
			`- Battlefield capacity: ${player.battlefield.length}/${SUMMONERS_BATTLEFIELD_LIMIT}`,
			`- Summoner: ${
				player.summoner === null
					? "unchosen"
					: `${player.summoner.name}, ${player.summoner.title}`
			}`,
			...(player.summoner === null
				? []
				: [
						`- Power: ${player.summoner.power.name} — ${player.summoner.power.cost} Spark; ${linkKeywords(player.summoner.power.rules)}`,
						`- Power status: ${
							player.powerUsed ? "used this turn" : "unused this turn"
						}`,
					]),
			"",
			"Battlefield:",
		]
		const beings = player.battlefield.map(
			(being, beingIndex) =>
				`- **P${playerIndex}:B${beingIndex} — ${being.card.name}**: ${
					being.attack
				} Attack, ${being.energy - being.damage}/${being.energy} Energy, ${being.growth} growth, ${
					being.ready ? "ready" : "weary"
				}${
					being.keywords.length === 0
						? ""
						: `, ${being.keywords
								.map((keyword) => summonersKeywordLink(keyword))
								.join(", ")}`
				}${being.item === null ? "" : `, equipped ${being.item.name}`}${
					being.triggeredKeywords.length === 0
						? ""
						: `, ${being.triggeredKeywords
								.map((keyword) => summonersKeywordLink(keyword))
								.join(", ")} already triggered this turn`
				}.`,
		)
		return [
			...playerLines,
			...(beings.length === 0 ? ["- no Beings"] : beings),
			"",
		]
	})
	const hand =
		context.privateView.hand.length === 0
			? ["- empty"]
			: context.privateView.hand.map(
					(card) =>
						`- **${card.name}** — ${card.cost} Spark, ${card.type}, target ${
							card.targeting
						}. ${linkKeywords(card.rules)}`,
				)
	const myIndex = context.publicView.players.findIndex(
		(player) => player.id === context.playerId,
	)
	const targetLegend = context.publicView.players.flatMap((player) => [
		`P${context.publicView.players.indexOf(player)} = ${player.name}'s Summoner`,
		...player.battlefield.map((being) => {
			const target = {
				cardId: being.card.physicalId,
				kind: "being" as const,
				playerId: player.id,
			}
			return `${summonersTargetReference(context, target)} = ${being.card.name}`
		}),
	])
	const renderTurnAction = (action: SummonersAiAction): string => {
		switch (action.action) {
			case "attack":
				return `Attack with ${action.attacker} targeting ${action.target}`
			case "endTurn":
				return "End the turn"
			case "playCard":
				return `Play ${action.card}${
					action.target === null ? "" : ` targeting ${action.target}`
				}`
			case "selectDeck":
				return `Select deck ${action.deck}`
			case "tend":
				return `Tend with ${action.tender} targeting ${action.target}`
			case "usePower":
				return `Use the Summoner power${
					action.target === null ? "" : ` targeting ${action.target}`
				}`
		}
	}
	const turnLedger = context.summonersTurnLedger ?? []
	const resolvedActions =
		turnLedger.length === 0
			? ["- none yet"]
			: turnLedger.map(
					(entry, index) =>
						`- ${index + 1}. ${renderTurnAction(entry.action)} — ${entry.actionReason}`,
				)
	const playableCards = context.privateView.hand.filter((card) =>
		context.privateView.playableCardIds.includes(card.physicalId),
	)
	const readyAttackers = me?.battlefield.filter((being) => being.ready) ?? []
	const readyTenders = readyAttackers.filter((being) =>
		being.keywords.includes("tend"),
	)
	const rootedRecovery = readyAttackers.filter(
		(being) => being.damage > 0 && being.keywords.includes("rooted"),
	)
	const affordablePower =
		me?.summoner !== null &&
		me?.summoner !== undefined &&
		!me.powerUsed &&
		me.spark >= me.summoner.power.cost
			? me.summoner.power
			: null
	const endTurnAudit = [
		`- Unspent Spark: ${me?.spark ?? 0}; it does not carry forward.`,
		`- Ready attackers: ${
			readyAttackers.length === 0
				? "none"
				: readyAttackers.map((being) => being.card.name).join(", ")
		}.`,
		`- Playable cards: ${
			playableCards.length === 0
				? "none"
				: playableCards.map((card) => card.name).join(", ")
		}.`,
		`- Ready Tend actions: ${
			readyTenders.length === 0
				? "none"
				: readyTenders.map((being) => being.card.name).join(", ")
		}.`,
		`- Unused affordable power: ${affordablePower?.name ?? "none"}.`,
		`- Ready damaged Rooted Beings that can recover by ending ready: ${
			rootedRecovery.length === 0
				? "none"
				: rootedRecovery.map((being) => being.card.name).join(", ")
		}.`,
	]
	const phaseInstruction =
		context.publicView.phase === "lobby"
			? ["## Task", "", `Choose one starter deck for seat P${myIndex}.`]
			: [
					"## Task",
					"",
					context.previousPlan.length === 0
						? "Establish one concise turn objective, explain the immediate choice, and choose exactly one listed legal action now."
						: `Repeat the existing turn objective exactly as \`turnObjective\`: ${JSON.stringify(
								context.previousPlan,
							)}. Explain the immediate choice and choose exactly one listed legal action now.`,
					"The server will resolve that action authoritatively. If your turn continues, you will receive the updated Spark, readiness, damage, battlefield, targets, Guard restrictions, and trigger state before choosing again.",
					"If choosing `endTurn`, the action reason must address the relevant opportunities in the end-turn audit.",
				]
	const glossary = [...usedKeywords]
		.sort()
		.flatMap((keyword) => [
			`### ${keyword[0]?.toUpperCase()}${keyword.slice(1)}`,
			"",
			SUMMONERS_KEYWORD_GLOSSARY[keyword],
			"",
		])
	const keywordStrategy = [...usedKeywords].flatMap((keyword) => {
		const advice: Partial<Record<SummonersKeyword, string>> = {
			blaze:
				"To gain a second attack from Blaze, attack with the ready Being first, spend your last Spark to ready it, then attack with it again. Spending the last Spark before its first attack wastes that extra readiness.",
			current:
				"To gain a second attack from Current, attack with the ready Being first, cause a bonus draw to ready it, then attack with it again. Do not use the bonus draw first while the Being is already ready.",
			molt:
				"Molt rewards combat with a Being this attacker will survive. It can trigger only once this turn and now grants Attack, not Energy, so recheck the return damage before committing.",
			rooted:
				"A damaged Rooted Being repairs only if it remains ready when you end the turn. Attacking with it trades away that repair for immediate pressure.",
			tend:
				"Tending trades this Being's attack and Rooted recovery for permanent growth on another Being. Tend before growth-threshold payoffs, and concentrate only when the opponent cannot efficiently return that investment to hand.",
			breakthrough:
				"Breakthrough converts excess damage against a smaller Being into Summoner damage. Compare the defender's remaining Energy, not just its printed Energy.",
		}
		const text = advice[keyword]
		return text === undefined
			? []
			: [`- ${summonersKeywordLink(keyword)}: ${text}`]
	})

	return [
		`# Summoners — Turn ${context.publicView.turnNumber}`,
		"",
		`You are **P${myIndex}, ${me?.name ?? context.playerId}**. ${
			context.publicView.currentPlayerId === context.playerId
				? "It is your turn."
				: `Current player: ${
						context.publicView.currentPlayerId === null
							? "none"
							: `P${context.publicView.players.findIndex(
									(player) => player.id === context.publicView.currentPlayerId,
								)}`
					}.`
		}`,
		"",
		"## Public table",
		"",
		...seats,
		"## Your hand",
		"",
		...hand,
		"",
		"## Stable character references",
		"",
		"These references identify characters in this current state only. Re-read them after every resolved action.",
		"",
		...targetLegend,
		"",
		"## Recent public history",
		"",
		...context.publicView.recentHistory.map((event) => `- ${event}`),
		"",
		"## Turn objective",
		"",
		context.previousPlan || "None yet; establish it with this decision.",
		"",
		"## Resolved actions this turn",
		"",
		...resolvedActions,
		...(keywordStrategy.length === 0
			? []
			: ["", "## Keyword strategy", "", ...keywordStrategy]),
		"",
		"## Legal actions now",
		"",
		...summonersLegalActionLines(context),
		...(context.publicView.phase === "playing"
			? ["", "## End-turn audit", "", ...endTurnAudit]
			: []),
		"",
		"Hidden-information boundary: opponent card values are unknown. Never name or infer them.",
		"",
		...phaseInstruction,
		...(glossary.length === 0 ? [] : ["", "## Glossary", "", ...glossary]),
	].join("\n")
}

const suitCodes: Record<Suit, string> = {
	clubs: "C",
	diamonds: "D",
	hearts: "H",
	spades: "S",
}

function rankCode(rank: Rank): string {
	switch (rank) {
		case 11:
			return "J"
		case 12:
			return "Q"
		case 13:
			return "K"
		case 14:
			return "A"
		case 10:
			return "T"
		default:
			return String(rank)
	}
}

export function renderVisibleCard(card: VisibleCard): string {
	return aiCardValue(card)
}

function renderLedgerCard(card: VisibleCard): string {
	return `${rankCode(card.rank)}${suitCodes[card.suit]}`
}

function playerAlias(context: AiGameContext, playerId: PlayerId): string {
	const index = context.publicView.players.findIndex(
		(player) => player.id === playerId,
	)
	return index === -1 ? playerId : `P${index}`
}

function renderPlayers(context: TrickTakingAiGameContext): string[] {
	return context.publicView.players.map((player, index) => {
		const perspective = player.id === context.playerId ? " YOU" : ""
		const controller =
			player.kind === "ai" ? `AI:${player.aiModel ?? "unspecified"}` : "human"
		return `- P${index}${perspective} ${player.name} (${controller}): score=${
			player.score
		} hand=${player.handCardIds.length} captured=${
			player.capturedCardIds?.length ?? 0
		} ${player.connected ? "connected" : "disconnected"}`
	})
}

function renderCurrentTrick(context: TrickTakingAiGameContext): string[] {
	if (context.publicView.currentTrick.length === 0) return ["- empty"]
	return [
		`- ${context.publicView.currentTrick
			.map(
				(play) =>
					`${playerAlias(context, play.playerId)} ${renderLedgerCard(
						play.card,
					)}`,
			)
			.join(" | ")}`,
	]
}

function renderCompletedTricks(context: TrickTakingAiGameContext): string[] {
	if (context.publicView.completedTricks.length === 0) {
		return ["- none"]
	}
	return context.publicView.completedTricks.map((trick, index) => {
		const plays = trick.plays
			.map(
				(play) =>
					`${playerAlias(context, play.playerId)} ${renderLedgerCard(
						play.card,
					)}`,
			)
			.join(" | ")
		return `- T${index + 1}>${playerAlias(context, trick.winnerId)}: ${plays}`
	})
}

function renderMemoryLedger(
	context: TrickTakingAiGameContext,
	entry: AiMemoryLedgerEntry,
): string {
	const cards = entry.cards.map(renderLedgerCard).join(" ")
	return entry.kind === "cardsPassed"
		? `- R${entry.roundNumber} pass ${entry.direction} -> ${playerAlias(
				context,
				entry.recipientId,
			)}: ${cards}`
		: `- R${entry.roundNumber} receive ${entry.direction} <- ${playerAlias(
				context,
				entry.senderId,
			)}: ${cards}`
}

function playLine(
	context: AiGameContext,
	trick: {
		plays: { card: VisibleCard; playerId: PlayerId }[]
		winnerId: PlayerId
	},
	index: number,
): string {
	const plays = trick.plays
		.map(
			(play) =>
				`${playerAlias(context, play.playerId)} ${renderLedgerCard(play.card)}`,
		)
		.join(", ")
	return `${index + 1}. ${plays}. ${playerAlias(context, trick.winnerId)} won.`
}

function knownVoids(context: AiGameContextFor<"hearts">): string[] {
	const voids = new Map<PlayerId, Set<Suit>>()
	const remember = (
		plays: { card: VisibleCard; playerId: PlayerId }[],
	): void => {
		const leadSuit = plays[0]?.card.suit
		if (leadSuit === undefined) return
		for (const play of plays.slice(1)) {
			if (play.card.suit === leadSuit) continue
			const playerVoids = voids.get(play.playerId) ?? new Set<Suit>()
			playerVoids.add(leadSuit)
			voids.set(play.playerId, playerVoids)
		}
	}
	for (const trick of context.publicView.completedTricks) remember(trick.plays)
	remember(context.publicView.currentTrick)
	return context.publicView.players.flatMap((player) => {
		const suits = [...(voids.get(player.id) ?? [])]
		return suits.length === 0
			? []
			: `${playerAlias(context, player.id)} is void in ${suits.join(", ")}.`
	})
}

function heartsPoints(card: Pick<VisibleCard, "rank" | "suit">): number {
	if (card.suit === "hearts") return 1
	return card.suit === "spades" && card.rank === 12 ? 13 : 0
}

function legalPlayMeaning(
	context: AiGameContextFor<"hearts">,
	card: VisibleCard,
): string {
	const trick = context.publicView.currentTrick
	if (trick.length === 0) return "leads"
	const leadSuit = trick[0]?.card.suit
	if (card.suit !== leadSuit) {
		const points = heartsPoints(card)
		return points === 0
			? "discards; cannot win"
			: `discards ${points} point${points === 1 ? "" : "s"}; cannot win`
	}
	const currentLeader = trick.reduce((leader, play) =>
		play.card.suit === leadSuit && play.card.rank > leader.card.rank
			? play
			: leader,
	)
	if (card.rank < currentLeader.card.rank) {
		return `ducks ${aiCardValue(currentLeader.card)}`
	}
	const playerCount = context.publicView.players.length
	const playPosition = trick.length + 1
	if (playPosition === playerCount) {
		const points =
			trick.reduce((total, play) => total + heartsPoints(play.card), 0) +
			heartsPoints(card)
		return `takes the trick; ${points} point${points === 1 ? "" : "s"}`
	}
	const remaining = playerCount - playPosition
	return `overtakes ${aiCardValue(currentLeader.card)}; ${remaining} player${
		remaining === 1 ? "" : "s"
	} ${remaining === 1 ? "remains" : "remain"}`
}

function renderHeartsFacts(context: AiGameContextFor<"hearts">): string {
	const me = playerAlias(context, context.playerId)
	const playerCount = context.publicView.players.length
	const playPosition = context.publicView.currentTrick.length + 1
	const playerIndex = context.publicView.players.findIndex(
		(player) => player.id === context.playerId,
	)
	const passRecipient =
		context.publicView.players[
			passRecipientSeatIndex(
				playerIndex,
				playerCount,
				context.publicView.passDirection,
			)
		]
	const passSender =
		context.publicView.players[
			passSenderSeatIndex(
				playerIndex,
				playerCount,
				context.publicView.passDirection,
			)
		]
	const phaseLine =
		context.publicView.phase === "passing"
			? `Hearts, round ${context.publicView.roundNumber}. Pass ${
					context.publicView.passDirection
				}. You are ${me}. You pass to ${
					passRecipient === undefined
						? "an unknown player"
						: playerAlias(context, passRecipient.id)
				} and receive from ${
					passSender === undefined
						? "an unknown player"
						: playerAlias(context, passSender.id)
				}.`
			: `Hearts, round ${context.publicView.roundNumber}, trick ${
					context.publicView.trickNumber + 1
				}. Hearts are ${
					context.publicView.heartsBroken ? "broken" : "intact"
				}. You are ${me}, playing ${playPosition} of ${playerCount}.`
	const players = context.publicView.players.map(
		(player) =>
			`${playerAlias(context, player.id)}${
				player.id === context.playerId ? " (you)" : ""
			}, ${player.name}: score ${player.score}, round points ${
				player.roundPoints
			}, ${player.handCardIds.length} cards.`,
	)
	const hand = context.privateView.cards.map(aiCardValue).join(", ") || "empty"
	const legal = context.privateView.cards
		.filter((card) => context.privateView.playableCardIds.includes(card.id))
		.map((card) => `${aiCardValue(card)} (${legalPlayMeaning(context, card)})`)
		.join(", ")
	const currentTrick =
		context.publicView.currentTrick.length === 0
			? "You lead."
			: context.publicView.currentTrick
					.map(
						(play) =>
							`${playerAlias(context, play.playerId)} ${aiCardValue(play.card)}`,
					)
					.join(", ")
	const completed =
		context.publicView.completedTricks.length === 0
			? ["None."]
			: context.publicView.completedTricks.map((trick, index) =>
					playLine(context, trick, index),
				)
	const passMemory =
		context.memoryLedger.length === 0
			? ["None."]
			: context.memoryLedger.map((entry) => {
					const cards = entry.cards.map(aiCardValue).join(", ")
					return entry.kind === "cardsPassed"
						? `Gave ${playerAlias(context, entry.recipientId)} ${cards}.`
						: `Received ${cards} from ${playerAlias(context, entry.senderId)}.`
				})
	const voids = knownVoids(context)
	const instruction =
		context.publicView.phase === "passing"
			? "Choose exactly three different card values from your hand."
			: `Legal plays: ${legal}. Choose one legal card value.`

	return [
		phaseLine,
		"",
		"Players:",
		...players,
		"",
		`Your hand: ${hand}.`,
		instruction,
		"",
		...(context.publicView.phase === "playing"
			? [
					"Current trick:",
					currentTrick,
					"",
					"Completed play:",
					...completed,
					"",
				]
			: []),
		`Pass ${context.publicView.passDirection}:`,
		...passMemory,
		...(voids.length === 0 ? [] : ["", "Known voids:", ...voids]),
		"",
		"Current plan:",
		context.previousPlan || "None.",
	].join("\n")
}

function ordinal(value: number): string {
	const remainder100 = value % 100
	if (remainder100 >= 11 && remainder100 <= 13) return `${value}th`
	switch (value % 10) {
		case 1:
			return `${value}st`
		case 2:
			return `${value}nd`
		case 3:
			return `${value}rd`
		default:
			return `${value}th`
	}
}

function renderOhHellBiddingFacts(context: AiGameContextFor<"ohHell">): string {
	const playerCount = context.publicView.players.length
	const dealerIndex = context.publicView.players.findIndex(
		(player) => player.id === context.publicView.dealerId,
	)
	const openingLeader =
		dealerIndex === -1
			? undefined
			: context.publicView.players[(dealerIndex + 1) % playerCount]
	const dealer =
		dealerIndex === -1 ? undefined : context.publicView.players[dealerIndex]
	const me = playerAlias(context, context.playerId)
	const biddingPosition = context.publicView.bidsSubmitted + 1
	const hand = context.privateView.cards.map(aiCardValue).join(", ") || "empty"
	const scores = context.publicView.players.map(
		(player) =>
			`- ${playerAlias(context, player.id)}${
				player.id === context.playerId ? " (you)" : ""
			}: ${player.score}`,
	)
	const bids = context.publicView.players.map(
		(player) =>
			`- ${playerAlias(context, player.id)}${
				player.id === context.playerId ? " (you)" : ""
			}: ${player.bid ?? "pending"}`,
	)
	const dealerConstraint =
		context.publicView.rules.requireUnsatisfiableBids &&
		context.publicView.dealerId === context.playerId
			? [
					"",
					`There are ${context.publicView.roundHandSize} tricks. As dealer, your bid may not make the table's total bids equal ${context.publicView.roundHandSize}.`,
				]
			: []

	return [
		`Oh Hell, round ${context.publicView.roundNumber} of ${context.publicView.maximumRounds}. ${context.publicView.roundHandSize} cards each. Trump is ${context.publicView.trumpSuit ?? "none"}.`,
		"",
		`You are ${me}, bidding ${ordinal(biddingPosition)} of ${playerCount}. ${
			dealer === undefined
				? "The dealer is unknown."
				: `${playerAlias(context, dealer.id)} is the dealer and bids last.`
		} ${
			openingLeader === undefined
				? "The opening leader is unknown."
				: `${playerAlias(context, openingLeader.id)} leads the first trick.`
		}`,
		"",
		"Scores:",
		...scores,
		"",
		"Bids so far:",
		...bids,
		"",
		`Your hand: ${hand}.`,
		...dealerConstraint,
		"",
		`Legal bids: ${context.privateView.legalBids.join(", ")}.`,
		"Choose your bid.",
	].join("\n")
}

function ohHellTrickWinner(
	context: AiGameContextFor<"ohHell">,
	plays: { card: VisibleCard; playerId: PlayerId }[],
): { card: VisibleCard; playerId: PlayerId } | undefined {
	const first = plays[0]
	if (first === undefined) return undefined
	const leadSuit = first.card.suit
	return plays.slice(1).reduce((winner, play) => {
		const cardIsTrump = play.card.suit === context.publicView.trumpSuit
		const winnerIsTrump = winner.card.suit === context.publicView.trumpSuit
		if (cardIsTrump !== winnerIsTrump) return cardIsTrump ? play : winner
		if (play.card.suit !== winner.card.suit) {
			return play.card.suit === leadSuit ? play : winner
		}
		return play.card.rank > winner.card.rank ? play : winner
	}, first)
}

function ohHellTargetStatus(bid: number, tricksWon: number): string {
	const tricksNeeded = bid - tricksWon
	if (tricksNeeded > 0) return `needs exactly ${tricksNeeded}`
	if (tricksNeeded === 0) return "on target; needs 0 more"
	return `over target by ${-tricksNeeded}`
}

function ohHellWinningConsequence(context: AiGameContextFor<"ohHell">): string {
	const me = context.publicView.players.find(
		(player) => player.id === context.playerId,
	)
	if (me?.bid === null || me?.bid === undefined) return "would win this trick"
	const tricksAfterWinning = me.tricksWon + 1
	if (tricksAfterWinning === me.bid) return "would reach your bid exactly"
	if (tricksAfterWinning < me.bid) {
		return `would still need ${me.bid - tricksAfterWinning}`
	}
	return `would exceed your bid by ${tricksAfterWinning - me.bid}`
}

function ohHellLegalPlayMeaning(
	context: AiGameContextFor<"ohHell">,
	card: VisibleCard,
): string {
	const trick = context.publicView.currentTrick
	if (trick.length === 0) {
		return card.suit === context.publicView.trumpSuit
			? "leads trump"
			: `leads ${card.suit}`
	}
	const currentWinner = ohHellTrickWinner(context, trick)
	if (currentWinner === undefined) return "plays"
	const candidate = { card, playerId: context.playerId }
	const winnerAfterPlay = ohHellTrickWinner(context, [...trick, candidate])
	if (winnerAfterPlay !== candidate) {
		const leadSuit = trick[0]?.card.suit
		if (
			card.suit === context.publicView.trumpSuit &&
			currentWinner.card.suit === context.publicView.trumpSuit &&
			leadSuit !== context.publicView.trumpSuit
		) {
			return `undertrumps ${aiCardValue(currentWinner.card)}; cannot win`
		}
		if (card.suit !== leadSuit) return "discards; cannot win"
		return `ducks ${aiCardValue(currentWinner.card)}; cannot win`
	}
	const leadSuit = trick[0]?.card.suit
	const cardIsTrump = card.suit === context.publicView.trumpSuit
	const winnerIsTrump = currentWinner.card.suit === context.publicView.trumpSuit
	const action =
		cardIsTrump && !winnerIsTrump && card.suit !== leadSuit
			? `ruffs ${aiCardValue(currentWinner.card)}`
			: cardIsTrump && winnerIsTrump
				? `overtrumps ${aiCardValue(currentWinner.card)}`
				: `overtakes ${aiCardValue(currentWinner.card)}`
	const playersRemaining =
		context.publicView.players.length -
		(context.publicView.currentTrick.length + 1)
	const unbeatable =
		card.suit === context.publicView.trumpSuit && card.rank === 14
	if (playersRemaining === 0) {
		return `${action}; takes the trick; ${ohHellWinningConsequence(context)}`
	}
	if (unbeatable) {
		return `${action}; unbeatable; ${ohHellWinningConsequence(context)}`
	}
	return `${action}; currently winning; ${playersRemaining} player${
		playersRemaining === 1 ? "" : "s"
	} ${playersRemaining === 1 ? "remains" : "remain"}`
}

function ohHellKnownVoids(context: AiGameContextFor<"ohHell">): string[] {
	const voids = new Map<PlayerId, Set<Suit>>()
	const remember = (
		plays: { card: VisibleCard; playerId: PlayerId }[],
	): void => {
		const leadSuit = plays[0]?.card.suit
		if (leadSuit === undefined) return
		for (const play of plays.slice(1)) {
			if (play.card.suit === leadSuit) continue
			const playerVoids = voids.get(play.playerId) ?? new Set<Suit>()
			playerVoids.add(leadSuit)
			voids.set(play.playerId, playerVoids)
		}
	}
	for (const trick of context.publicView.completedTricks) remember(trick.plays)
	remember(context.publicView.currentTrick)
	return context.publicView.players.flatMap((player) => {
		const suits = [...(voids.get(player.id) ?? [])]
		return suits.length === 0
			? []
			: `${playerAlias(context, player.id)} is void in ${suits.join(", ")}.`
	})
}

function renderOhHellCurrentTrick(context: AiGameContextFor<"ohHell">): string {
	const trick = context.publicView.currentTrick
	if (trick.length === 0) return "You lead."
	const winner = ohHellTrickWinner(context, trick)
	const plays = trick
		.map((play, index) =>
			index === 0
				? `${playerAlias(context, play.playerId)} led ${aiCardValue(play.card)}`
				: `${playerAlias(context, play.playerId)} played ${aiCardValue(play.card)}`,
		)
		.join(". ")
	const currentWinner =
		winner === undefined
			? ""
			: ` ${playerAlias(context, winner.playerId)} is currently winning with ${aiCardValue(winner.card)}.`
	const playerIndex = context.publicView.players.findIndex(
		(player) => player.id === context.playerId,
	)
	const playersRemaining =
		context.publicView.players.length -
		(context.publicView.currentTrick.length + 1)
	const laterPlayers = Array.from({ length: playersRemaining }, (_, offset) => {
		const player =
			context.publicView.players[
				(playerIndex + offset + 1) % context.publicView.players.length
			]
		return player === undefined ? "unknown" : playerAlias(context, player.id)
	})
	const laterPlay =
		laterPlayers.length === 0
			? ""
			: ` ${laterPlayers.join(" and ")} ${
					laterPlayers.length === 1 ? "plays" : "play"
				} after you.`
	return `${plays}.${currentWinner}${laterPlay}`
}

function renderOhHellPlayingFacts(context: AiGameContextFor<"ohHell">): string {
	const playerCount = context.publicView.players.length
	const playPosition = context.publicView.currentTrick.length + 1
	const tricksRemaining =
		context.publicView.roundHandSize - context.publicView.completedTricks.length
	const targets = context.publicView.players.map(
		(player) =>
			`- ${playerAlias(context, player.id)}${
				player.id === context.playerId ? " (you)" : ""
			}: bid ${player.bid ?? "pending"}, won ${player.tricksWon} — ${
				player.bid === null
					? "target pending"
					: ohHellTargetStatus(player.bid, player.tricksWon)
			}. ${player.handCardIds.length} cards.`,
	)
	const scores = context.publicView.players
		.map((player) => `${playerAlias(context, player.id)} ${player.score}`)
		.join(", ")
	const hand = context.privateView.cards.map(aiCardValue).join(", ") || "empty"
	const legalPlays = context.privateView.cards
		.filter((card) => context.privateView.playableCardIds.includes(card.id))
		.map(
			(card) =>
				`- ${aiCardValue(card)} (${ohHellLegalPlayMeaning(context, card)})`,
		)
	const completed =
		context.publicView.completedTricks.length === 0
			? ["None."]
			: context.publicView.completedTricks.map((trick, index) =>
					playLine(context, trick, index),
				)
	const voids = ohHellKnownVoids(context)

	return [
		`Oh Hell, round ${context.publicView.roundNumber} of ${context.publicView.maximumRounds}, trick ${context.publicView.trickNumber + 1} of ${context.publicView.roundHandSize}. Trump is ${context.publicView.trumpSuit ?? "none"}.`,
		`You are ${playerAlias(context, context.playerId)}, playing ${ordinal(playPosition)} of ${playerCount}. ${tricksRemaining} trick${tricksRemaining === 1 ? "" : "s"} remain, including this one.`,
		"",
		"Targets:",
		...targets,
		"",
		`Scores: ${scores}.`,
		"",
		"Current trick:",
		renderOhHellCurrentTrick(context),
		"",
		`Your hand: ${hand}.`,
		"Legal plays:",
		...legalPlays,
		"",
		"Completed play:",
		...completed,
		...(voids.length === 0 ? [] : ["", "Known voids:", ...voids]),
		"",
		"Current plan:",
		context.previousPlan || "None.",
		"",
		"Choose one legal card value.",
	].join("\n")
}

function renderLegacyGameFacts(context: TrickTakingAiGameContext): string {
	const adapter = aiFactsAdapter(context)
	const me = context.publicView.players.find(
		(player) => player.id === context.playerId,
	)
	const currentPlayer =
		context.publicView.currentPlayerId === null
			? "none"
			: playerAlias(context, context.publicView.currentPlayerId)
	const hand =
		context.privateView.cards.length === 0
			? ["- empty"]
			: context.privateView.cards.map(
					(card) =>
						`- ${renderVisibleCard(card)}${
							context.privateView.playableCardIds.includes(card.id)
								? " — LEGAL"
								: ""
						}`,
				)
	const memoryLedger =
		context.memoryLedger.length === 0
			? ["- none"]
			: context.memoryLedger.map((entry) => renderMemoryLedger(context, entry))
	const gameDetails = adapter.gameDetails(context)

	return [
		`# ${adapter.title} facts (cards: T/J/Q/K/A; suits: C/D/H/S)`,
		`Table ${context.publicView.roomCode} | you ${playerAlias(
			context,
			context.playerId,
		)} ${me?.name ?? context.playerId} | phase ${
			context.publicView.phase
		} | round ${context.publicView.roundNumber} | trick ${
			context.publicView.trickNumber + 1
		} | turn ${currentPlayer} | ${gameDetails}`,
		"",
		"## Seats",
		...renderPlayers(context),
		"",
		"## Current trick (public, play order)",
		...renderCurrentTrick(context),
		"",
		"## Completed tricks (public, Tn>winner: plays in order)",
		...renderCompletedTricks(context),
		"",
		`## Hand (${adapter.handInstruction(context)})`,
		...hand,
		"",
		"## Plan",
		context.previousPlan || "none",
		"",
		"## Private pass memory",
		...memoryLedger,
		"",
		"Information boundary: exact values appear only in your hand/pass memory and public tricks; opponent hands expose counts only. Deck values are unique, so compact card codes preserve card identity after IDs are omitted from history.",
	].join("\n")
}

export function renderAiGameFacts(context: AiGameContext): string {
	assertMatchingGameKinds(
		context.privateView,
		context.publicView,
		"AI public and private views describe different games.",
	)
	return context.publicView.gameKind === "summoners"
		? renderSummonersFacts(context as AiGameContextFor<"summoners">)
		: context.publicView.gameKind === "hearts"
			? renderHeartsFacts(context as AiGameContextFor<"hearts">)
			: context.publicView.phase === "bidding"
				? renderOhHellBiddingFacts(context as AiGameContextFor<"ohHell">)
				: context.publicView.phase === "playing"
					? renderOhHellPlayingFacts(context as AiGameContextFor<"ohHell">)
					: renderLegacyGameFacts(context as TrickTakingAiGameContext)
}
