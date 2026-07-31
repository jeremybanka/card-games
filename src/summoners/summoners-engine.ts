import { shuffled } from "../game/standard-deck-domain.ts"
import type { CardId, PlayerController, PlayerId } from "../game/game-types.ts"
import {
	isSummonersDeckId,
	summonersCardDefinition,
	summonersStarterDecks,
} from "./summoners-cards.ts"
import type {
	SummonersCardDefinition,
	SummonersDeckId,
	SummonersEffect,
	SummonersKeyword,
	SummonersPrivatePlayerView,
	SummonersPublicBeing,
	SummonersPublicGameView,
	SummonersPublicPlayerView,
	SummonersTarget,
	SummonersTargeting,
	SummonersVisibleCard,
} from "./summoners-types.ts"

export const SUMMONERS_PLAYER_MINIMUM = 2
export const SUMMONERS_PLAYER_MAXIMUM = 4
export const SUMMONERS_STARTING_HEALTH = 24
export const SUMMONERS_STARTING_HAND_SIZE = 5
export const SUMMONERS_HAND_LIMIT = 9
export const SUMMONERS_BATTLEFIELD_LIMIT = 5
export const SUMMONERS_MAXIMUM_SPARK = 10
export const SUMMONERS_DECK_SIZE = 24
export const SUMMONERS_PHYSICAL_CARD_COUNT =
	SUMMONERS_DECK_SIZE * SUMMONERS_PLAYER_MAXIMUM

type SummonersBeing = {
	attackBonus: number
	cardId: CardId
	damage: number
	energyBonus: number
	itemCardId: CardId | null
	ready: boolean
	triggeredKeywords: SummonersKeyword[]
}

export type SummonersPlayer = {
	aiModel: PlayerController["aiModel"]
	battlefield: SummonersBeing[]
	connected: boolean
	deck: CardId[]
	deckId: SummonersDeckId | null
	discard: CardId[]
	eliminated: boolean
	fatigue: number
	hand: CardId[]
	health: number
	id: PlayerId
	kind: PlayerController["kind"]
	maxSpark: number
	name: string
	powerUsed: boolean
	spark: number
}

export type SummonersState = {
	cardBlueprintById: Partial<Record<CardId, string>>
	currentPlayerId: PlayerId | null
	gameKind: "summoners"
	hostId: PlayerId | null
	phase: "gameComplete" | "lobby" | "playing"
	physicalCardIds: CardId[]
	players: SummonersPlayer[]
	recentHistory: string[]
	revision: number
	roomCode: string
	statusMessage: string
	turnNumber: number
	winnerIds: PlayerId[]
}

export class SummonersRuleError extends Error {}

function copyState(state: SummonersState): SummonersState {
	const next = structuredClone(state)
	next.revision += 1
	return next
}

function setStatus(state: SummonersState, message: string): void {
	state.statusMessage = message
	state.recentHistory = [...state.recentHistory.slice(-7), message]
}

function playerFor(state: SummonersState, playerId: PlayerId): SummonersPlayer {
	const player = state.players.find((candidate) => candidate.id === playerId)
	if (player === undefined) {
		throw new SummonersRuleError("That Summoner is not seated here.")
	}
	return player
}

function blueprintIdFor(state: SummonersState, cardId: CardId): string {
	const blueprintId = state.cardBlueprintById[cardId]
	if (blueprintId === undefined) {
		throw new SummonersRuleError("That card is not part of this match.")
	}
	return blueprintId
}

function definitionFor(
	state: SummonersState,
	cardId: CardId,
): SummonersCardDefinition {
	return summonersCardDefinition(blueprintIdFor(state, cardId))
}

function visibleCard(
	state: SummonersState,
	cardId: CardId,
): SummonersVisibleCard {
	return {
		...definitionFor(state, cardId),
		physicalId: cardId,
	}
}

function beingStats(
	state: SummonersState,
	being: SummonersBeing,
): {
	attack: number
	energy: number
	keywords: SummonersPublicBeing["keywords"]
} {
	const card = definitionFor(state, being.cardId)
	const item =
		being.itemCardId === null ? null : definitionFor(state, being.itemCardId)
	return {
		attack: (card.attack ?? 0) + being.attackBonus + (item?.attack ?? 0),
		energy: (card.energy ?? 0) + being.energyBonus + (item?.energy ?? 0),
		keywords: [
			...new Set([...(card.keywords ?? []), ...(item?.grantedKeywords ?? [])]),
		],
	}
}

function publicBeing(
	state: SummonersState,
	being: SummonersBeing,
): SummonersPublicBeing {
	const stats = beingStats(state, being)
	return {
		...stats,
		card: visibleCard(state, being.cardId),
		damage: being.damage,
		item:
			being.itemCardId === null ? null : visibleCard(state, being.itemCardId),
		ready: being.ready,
		triggeredKeywords: [...being.triggeredKeywords],
	}
}

function publicPlayer(
	state: SummonersState,
	player: SummonersPlayer,
): SummonersPublicPlayerView {
	const deck =
		player.deckId === null ? null : summonersStarterDecks[player.deckId]
	return {
		aiModel: player.aiModel,
		battlefield: player.battlefield.map((being) => publicBeing(state, being)),
		connected: player.connected,
		deck,
		deckCount: player.deck.length,
		discardCount: player.discard.length,
		eliminated: player.eliminated,
		fatigue: player.fatigue,
		handCardIds: [...player.hand],
		handCount: player.hand.length,
		health: player.health,
		id: player.id,
		kind: player.kind,
		maxSpark: player.maxSpark,
		name: player.name,
		powerUsed: player.powerUsed,
		spark: player.spark,
		summoner: deck?.summoner ?? null,
	}
}

function playerCanPlayCard(
	state: SummonersState,
	player: SummonersPlayer,
	cardId: CardId,
): boolean {
	if (
		state.phase !== "playing" ||
		state.currentPlayerId !== player.id ||
		player.eliminated ||
		!player.hand.includes(cardId)
	) {
		return false
	}
	const card = definitionFor(state, cardId)
	if (card.cost > player.spark) return false
	if (
		card.type === "being" &&
		player.battlefield.length >= SUMMONERS_BATTLEFIELD_LIMIT
	) {
		return false
	}
	if (
		(card.type === "item" || card.targeting === "friendlyBeing") &&
		player.battlefield.length === 0
	) {
		return false
	}
	return true
}

export function toSummonersPublicGameView(
	state: SummonersState,
): SummonersPublicGameView {
	return {
		currentPlayerId: state.currentPlayerId,
		gameKind: "summoners",
		hostId: state.hostId,
		phase: state.phase,
		players: state.players.map((player) => publicPlayer(state, player)),
		recentHistory: [...state.recentHistory],
		revision: state.revision,
		roomCode: state.roomCode,
		statusMessage: state.statusMessage,
		turnNumber: state.turnNumber,
		winnerIds: [...state.winnerIds],
	}
}

export function toSummonersPrivatePlayerView(
	state: SummonersState,
	playerId: PlayerId,
): SummonersPrivatePlayerView {
	const player = state.players.find((candidate) => candidate.id === playerId)
	if (player === undefined) {
		return {
			gameKind: "summoners",
			hand: [],
			playableCardIds: [],
			playerId: null,
			revision: state.revision,
		}
	}
	return {
		gameKind: "summoners",
		hand: player.hand.map((cardId) => visibleCard(state, cardId)),
		playableCardIds: player.hand.filter((cardId) =>
			playerCanPlayCard(state, player, cardId),
		),
		playerId,
		revision: state.revision,
	}
}

export function createSummonersPhysicalCardIds(
	createId: () => string = () => crypto.randomUUID(),
): CardId[] {
	return Array.from(
		{ length: SUMMONERS_PHYSICAL_CARD_COUNT },
		() => `card::${createId()}` satisfies CardId,
	)
}

function emptyPlayer(
	player: { id: PlayerId; name: string },
	controller: PlayerController = { aiModel: null, kind: "human" },
): SummonersPlayer {
	return {
		aiModel: controller.aiModel,
		battlefield: [],
		connected: true,
		deck: [],
		deckId: null,
		discard: [],
		eliminated: false,
		fatigue: 0,
		hand: [],
		health: SUMMONERS_STARTING_HEALTH,
		id: player.id,
		kind: controller.kind,
		maxSpark: 0,
		name: player.name,
		powerUsed: false,
		spark: 0,
	}
}

export function createSummonersGame(
	roomCode: string,
	hostId: PlayerId,
	hostName: string,
	physicalCardIds = createSummonersPhysicalCardIds(),
): SummonersState {
	if (physicalCardIds.length < SUMMONERS_PHYSICAL_CARD_COUNT) {
		throw new SummonersRuleError(
			`Summoners needs ${SUMMONERS_PHYSICAL_CARD_COUNT} physical card IDs.`,
		)
	}
	return {
		cardBlueprintById: {},
		currentPlayerId: null,
		gameKind: "summoners",
		hostId,
		phase: "lobby",
		physicalCardIds,
		players: [emptyPlayer({ id: hostId, name: hostName })],
		recentHistory: ["Invite another Summoner and choose a starter deck."],
		revision: 0,
		roomCode,
		statusMessage: "Invite another Summoner and choose a starter deck.",
		turnNumber: 0,
		winnerIds: [],
	}
}

export function joinSummonersGame(
	state: SummonersState,
	playerId: PlayerId,
	playerName: string,
	controller: PlayerController = { aiModel: null, kind: "human" },
): SummonersState {
	const next = copyState(state)
	const existing = next.players.find((player) => player.id === playerId)
	if (existing !== undefined) {
		existing.aiModel = controller.aiModel
		existing.connected = true
		existing.kind = controller.kind
		existing.name = playerName
		return next
	}
	if (next.phase !== "lobby") {
		throw new SummonersRuleError("This Conclave is already in progress.")
	}
	if (next.players.length >= SUMMONERS_PLAYER_MAXIMUM) {
		throw new SummonersRuleError("This Conclave already has four Summoners.")
	}
	next.players.push(emptyPlayer({ id: playerId, name: playerName }, controller))
	setStatus(
		next,
		next.players.length < SUMMONERS_PLAYER_MINIMUM
			? "Invite another Summoner and choose a starter deck."
			: "Choose starter decks. The host begins when everyone is ready.",
	)
	return next
}

export function disconnectSummonersPlayer(
	state: SummonersState,
	playerId: PlayerId,
): SummonersState {
	const next = copyState(state)
	const player = next.players.find((candidate) => candidate.id === playerId)
	if (player === undefined) return next
	if (next.phase === "lobby") {
		next.players = next.players.filter((candidate) => candidate.id !== playerId)
		if (next.hostId === playerId) next.hostId = next.players[0]?.id ?? null
	} else {
		player.connected = false
		setStatus(
			next,
			`${player.name} slipped beyond the veil. Waiting for their return.`,
		)
	}
	return next
}

export function selectSummonersDeck(
	state: SummonersState,
	playerId: PlayerId,
	deckId: SummonersDeckId,
): SummonersState {
	if (state.phase !== "lobby") {
		throw new SummonersRuleError(
			"Starter decks can only be chosen before the Conclave begins.",
		)
	}
	if (!isSummonersDeckId(deckId)) {
		throw new SummonersRuleError("Choose a known starter deck.")
	}
	const next = copyState(state)
	playerFor(next, playerId).deckId = deckId
	setStatus(
		next,
		`${playerFor(next, playerId).name} chose ${
			summonersStarterDecks[deckId].name
		}.`,
	)
	return next
}

function drawCard(state: SummonersState, player: SummonersPlayer): boolean {
	if (player.eliminated) return false
	const cardId = player.deck.shift()
	if (cardId === undefined) {
		player.fatigue += 1
		player.health -= player.fatigue
		setStatus(
			state,
			`${player.name} has no cards left and suffers ${player.fatigue} fatigue.`,
		)
		return false
	}
	if (player.hand.length >= SUMMONERS_HAND_LIMIT) {
		player.discard.push(cardId)
		setStatus(
			state,
			`${player.name}'s full hand lets a card slip into the discard.`,
		)
		return true
	}
	player.hand.push(cardId)
	return true
}

function beingHasKeyword(
	state: SummonersState,
	being: SummonersBeing,
	keyword: SummonersKeyword,
): boolean {
	return beingStats(state, being).keywords.includes(keyword)
}

function triggerReadyKeyword(
	state: SummonersState,
	player: SummonersPlayer,
	keyword: "blaze" | "current",
): void {
	const triggered: string[] = []
	for (const being of player.battlefield) {
		if (
			!beingHasKeyword(state, being, keyword) ||
			being.triggeredKeywords.includes(keyword)
		) {
			continue
		}
		being.triggeredKeywords.push(keyword)
		being.ready = true
		triggered.push(definitionFor(state, being.cardId).name)
	}
	if (triggered.length > 0) {
		setStatus(
			state,
			`${triggered.join(" and ")} ${
				triggered.length === 1 ? "readies" : "ready"
			} with ${keyword === "blaze" ? "Blaze" : "the Current"}.`,
		)
	}
}

function triggerMolt(state: SummonersState, being: SummonersBeing): void {
	if (
		!beingHasKeyword(state, being, "molt") ||
		being.triggeredKeywords.includes("molt") ||
		being.damage >= beingStats(state, being).energy
	) {
		return
	}
	being.triggeredKeywords.push("molt")
	being.attackBonus += 1
	being.energyBonus += 1
	setStatus(
		state,
		`${definitionFor(state, being.cardId).name} Molts into a stronger shape.`,
	)
}

function restoreRootedBeings(
	state: SummonersState,
	player: SummonersPlayer,
): void {
	const restored: string[] = []
	for (const being of player.battlefield) {
		if (
			!being.ready ||
			being.damage === 0 ||
			!beingHasKeyword(state, being, "rooted")
		) {
			continue
		}
		being.damage = Math.max(0, being.damage - 2)
		restored.push(definitionFor(state, being.cardId).name)
	}
	if (restored.length > 0) {
		setStatus(
			state,
			`${restored.join(" and ")} ${
				restored.length === 1 ? "restores" : "restore"
			} 2 Energy while Rooted.`,
		)
	}
}

function activePlayers(state: SummonersState): SummonersPlayer[] {
	return state.players.filter((player) => !player.eliminated)
}

function eliminateSpentSummoners(state: SummonersState): void {
	for (const player of state.players) {
		if (player.eliminated || player.health > 0) continue
		player.health = 0
		player.eliminated = true
		for (const being of player.battlefield) {
			player.discard.push(being.cardId)
			if (being.itemCardId !== null) player.discard.push(being.itemCardId)
		}
		player.discard.push(...player.hand, ...player.deck)
		player.battlefield = []
		player.hand = []
		player.deck = []
		setStatus(state, `${player.name} is unbound from the Conclave.`)
	}
	const survivors = activePlayers(state)
	if (state.phase === "playing" && survivors.length <= 1) {
		state.phase = "gameComplete"
		state.currentPlayerId = null
		state.winnerIds = survivors.map((player) => player.id)
		setStatus(
			state,
			survivors.length === 1
				? `${survivors[0]?.name} stands as the last Summoner.`
				: "The Conclave collapses with no Summoner standing.",
		)
	}
}

function discardSpentBeings(state: SummonersState): void {
	for (const player of state.players) {
		const survivors: SummonersBeing[] = []
		for (const being of player.battlefield) {
			if (being.damage < beingStats(state, being).energy) {
				survivors.push(being)
				continue
			}
			player.discard.push(being.cardId)
			if (being.itemCardId !== null) player.discard.push(being.itemCardId)
		}
		player.battlefield = survivors
	}
}

function beginTurn(
	state: SummonersState,
	player: SummonersPlayer,
	drawAtStart: boolean,
): void {
	for (const seatedPlayer of state.players) {
		for (const being of seatedPlayer.battlefield) {
			being.triggeredKeywords = []
		}
	}
	player.maxSpark = Math.min(SUMMONERS_MAXIMUM_SPARK, player.maxSpark + 1)
	player.spark = player.maxSpark
	player.powerUsed = false
	for (const being of player.battlefield) being.ready = true
	if (drawAtStart) drawCard(state, player)
	eliminateSpentSummoners(state)
	if (state.phase === "playing") {
		setStatus(
			state,
			`${player.name}'s turn — ${player.spark} Spark burns bright.`,
		)
	}
}

function nextActivePlayerAfter(
	state: SummonersState,
	playerId: PlayerId,
): SummonersPlayer {
	const start = state.players.findIndex((player) => player.id === playerId)
	for (let offset = 1; offset <= state.players.length; offset += 1) {
		const candidate = state.players[
			(start + offset) % state.players.length
		] as SummonersPlayer
		if (!candidate.eliminated) return candidate
	}
	throw new SummonersRuleError("No active Summoner remains.")
}

function advanceTurn(state: SummonersState, playerId: PlayerId): void {
	if (state.phase !== "playing") return
	const nextPlayer = nextActivePlayerAfter(state, playerId)
	state.currentPlayerId = nextPlayer.id
	state.turnNumber += 1
	beginTurn(state, nextPlayer, true)
	if (
		state.phase === "playing" &&
		nextPlayer.eliminated &&
		activePlayers(state).length > 1
	) {
		advanceTurn(state, nextPlayer.id)
	}
}

export function startSummonersGame(
	state: SummonersState,
	playerId: PlayerId,
	random: () => number = Math.random,
): SummonersState {
	if (state.hostId !== playerId) {
		throw new SummonersRuleError("Only the host may begin the Conclave.")
	}
	if (state.phase !== "lobby") {
		throw new SummonersRuleError("The Conclave has already begun.")
	}
	if (
		state.players.length < SUMMONERS_PLAYER_MINIMUM ||
		state.players.length > SUMMONERS_PLAYER_MAXIMUM
	) {
		throw new SummonersRuleError("Summoners needs two to four players.")
	}
	if (state.players.some((player) => !player.connected)) {
		throw new SummonersRuleError("Every Summoner must be connected.")
	}
	if (state.players.some((player) => player.deckId === null)) {
		throw new SummonersRuleError("Every Summoner must choose a starter deck.")
	}

	const next = copyState(state)
	next.cardBlueprintById = {}
	next.phase = "playing"
	next.recentHistory = []
	next.turnNumber = 1
	next.winnerIds = []
	const physicalCardIds = shuffled(next.physicalCardIds, random)
	let physicalIndex = 0

	for (const player of next.players) {
		player.battlefield = []
		player.deck = []
		player.discard = []
		player.eliminated = false
		player.fatigue = 0
		player.hand = []
		player.health = SUMMONERS_STARTING_HEALTH
		player.maxSpark = 0
		player.powerUsed = false
		player.spark = 0
		const deckId = player.deckId as SummonersDeckId
		const blueprints = shuffled(summonersStarterDecks[deckId].cardIds, random)
		for (const blueprintId of blueprints) {
			const physicalCardId = physicalCardIds[physicalIndex] as CardId
			physicalIndex += 1
			next.cardBlueprintById[physicalCardId] = blueprintId
			player.deck.push(physicalCardId)
		}
		player.deck = shuffled(player.deck, random)
		for (let count = 0; count < SUMMONERS_STARTING_HAND_SIZE; count += 1) {
			drawCard(next, player)
		}
	}

	const firstPlayer = next.players[0] as SummonersPlayer
	next.currentPlayerId = firstPlayer.id
	beginTurn(next, firstPlayer, false)
	return next
}

function locateBeing(
	state: SummonersState,
	target: Extract<SummonersTarget, { kind: "being" }>,
): { being: SummonersBeing; owner: SummonersPlayer } {
	const owner = playerFor(state, target.playerId)
	const being = owner.battlefield.find(
		(candidate) => candidate.cardId === target.cardId,
	)
	if (being === undefined) {
		throw new SummonersRuleError("That Being is no longer on the battlefield.")
	}
	return { being, owner }
}

function validateTarget(
	state: SummonersState,
	actingPlayer: SummonersPlayer,
	targeting: SummonersTargeting,
	target: SummonersTarget | null,
): void {
	if (targeting === "none") {
		if (target !== null) {
			throw new SummonersRuleError("That action does not take a target.")
		}
		return
	}
	if (target === null) {
		throw new SummonersRuleError("Choose a legal target.")
	}
	const targetPlayer = playerFor(state, target.playerId)
	if (targetPlayer.eliminated) {
		throw new SummonersRuleError("That Summoner has already been unbound.")
	}
	if (target.kind === "being") locateBeing(state, target)
	const friendly = target.playerId === actingPlayer.id
	const valid =
		(targeting === "anyEnemy" && !friendly) ||
		(targeting === "enemyBeing" && !friendly && target.kind === "being") ||
		(targeting === "enemySummoner" &&
			!friendly &&
			target.kind === "summoner") ||
		(targeting === "friendlyBeing" && friendly && target.kind === "being") ||
		(targeting === "friendlyCharacter" && friendly)
	if (!valid) throw new SummonersRuleError("That is not a legal target.")
}

function damageTarget(
	state: SummonersState,
	target: SummonersTarget,
	amount: number,
): void {
	if (target.kind === "summoner") {
		playerFor(state, target.playerId).health -= amount
		return
	}
	locateBeing(state, target).being.damage += amount
}

function healTarget(
	state: SummonersState,
	target: SummonersTarget,
	amount: number,
): void {
	if (target.kind === "summoner") {
		const player = playerFor(state, target.playerId)
		player.health = Math.min(SUMMONERS_STARTING_HEALTH, player.health + amount)
		return
	}
	const { being } = locateBeing(state, target)
	being.damage = Math.max(0, being.damage - amount)
}

function resolveEffect(
	state: SummonersState,
	actingPlayer: SummonersPlayer,
	effect: SummonersEffect,
	target: SummonersTarget | null,
): void {
	switch (effect.kind) {
		case "damage": {
			if (effect.recipient === "ownSummoner") {
				actingPlayer.health -= effect.amount
			} else if (target !== null) {
				damageTarget(state, target, effect.amount)
			}
			break
		}
		case "damageAllEnemyBeings": {
			for (const player of state.players) {
				if (player.id === actingPlayer.id || player.eliminated) continue
				for (const being of player.battlefield) being.damage += effect.amount
			}
			break
		}
		case "buff": {
			if (target?.kind !== "being") {
				throw new SummonersRuleError("That boon needs a friendly Being.")
			}
			const { being } = locateBeing(state, target)
			being.attackBonus += effect.attack
			being.energyBonus += effect.energy
			break
		}
		case "draw": {
			for (let count = 0; count < effect.count; count += 1) {
				if (drawCard(state, actingPlayer)) {
					triggerReadyKeyword(state, actingPlayer, "current")
				}
			}
			break
		}
		case "heal": {
			if (effect.recipient === "ownSummoner") {
				actingPlayer.health = Math.min(
					SUMMONERS_STARTING_HEALTH,
					actingPlayer.health + effect.amount,
				)
			} else if (target !== null) {
				healTarget(state, target, effect.amount)
			}
			break
		}
		case "ready": {
			if (target?.kind === "being") {
				locateBeing(state, target).being.ready = true
			}
			break
		}
		case "returnToHand": {
			if (target?.kind !== "being") {
				throw new SummonersRuleError("Choose a Being to return.")
			}
			const { being, owner } = locateBeing(state, target)
			if (being.itemCardId !== null) owner.discard.push(being.itemCardId)
			owner.battlefield = owner.battlefield.filter(
				(candidate) => candidate.cardId !== being.cardId,
			)
			if (owner.hand.length < SUMMONERS_HAND_LIMIT) {
				owner.hand.push(being.cardId)
			} else {
				owner.discard.push(being.cardId)
			}
			break
		}
	}
	discardSpentBeings(state)
	eliminateSpentSummoners(state)
}

function resolveEffects(
	state: SummonersState,
	actingPlayer: SummonersPlayer,
	effects: readonly SummonersEffect[],
	target: SummonersTarget | null,
): void {
	for (const effect of effects) {
		resolveEffect(state, actingPlayer, effect, target)
		if (state.phase === "gameComplete") return
	}
}

function requireTurn(
	state: SummonersState,
	playerId: PlayerId,
): SummonersPlayer {
	if (state.phase !== "playing") {
		throw new SummonersRuleError("The Conclave is not accepting actions.")
	}
	if (state.currentPlayerId !== playerId) {
		throw new SummonersRuleError("Wait for your turn.")
	}
	const player = playerFor(state, playerId)
	if (player.eliminated) {
		throw new SummonersRuleError("Your Summoner has been unbound.")
	}
	return player
}

export function playSummonersCard(
	state: SummonersState,
	playerId: PlayerId,
	cardId: CardId,
	target: SummonersTarget | null,
): SummonersState {
	const next = copyState(state)
	const player = requireTurn(next, playerId)
	if (!playerCanPlayCard(next, player, cardId)) {
		throw new SummonersRuleError(
			"That card cannot be played with the Spark and space available.",
		)
	}
	const card = definitionFor(next, cardId)
	validateTarget(next, player, card.targeting, target)
	player.spark -= card.cost
	player.hand = player.hand.filter((candidate) => candidate !== cardId)

	if (card.type === "being") {
		player.battlefield.push({
			attackBonus: 0,
			cardId,
			damage: 0,
			energyBonus: 0,
			itemCardId: null,
			ready: card.keywords?.includes("rush") ?? false,
			triggeredKeywords: [],
		})
	} else if (card.type === "item") {
		if (target?.kind !== "being") {
			throw new SummonersRuleError("Choose a Being to equip.")
		}
		const { being, owner } = locateBeing(next, target)
		if (owner.id !== playerId) {
			throw new SummonersRuleError("Items may only equip your own Beings.")
		}
		if (being.itemCardId !== null) player.discard.push(being.itemCardId)
		being.itemCardId = cardId
	} else {
		player.discard.push(cardId)
	}

	resolveEffects(next, player, card.effects ?? [], target)
	if (next.phase === "playing") {
		if (card.cost > 0 && player.spark === 0) {
			triggerReadyKeyword(next, player, "blaze")
		}
		setStatus(next, `${player.name} played ${card.name}.`)
		if (player.eliminated) advanceTurn(next, playerId)
	}
	return next
}

export function attackSummoners(
	state: SummonersState,
	playerId: PlayerId,
	attackerId: CardId,
	target: SummonersTarget,
): SummonersState {
	const next = copyState(state)
	const player = requireTurn(next, playerId)
	const attacker = player.battlefield.find(
		(being) => being.cardId === attackerId,
	)
	if (attacker === undefined) {
		throw new SummonersRuleError("Only your Beings can attack for you.")
	}
	if (!attacker.ready) {
		throw new SummonersRuleError("That Being is weary and cannot attack.")
	}
	if (target.playerId === playerId) {
		throw new SummonersRuleError("Choose an enemy character to attack.")
	}
	const defender = playerFor(next, target.playerId)
	if (defender.eliminated) {
		throw new SummonersRuleError("That Summoner has already been unbound.")
	}
	const guards = defender.battlefield.filter((being) =>
		beingStats(next, being).keywords.includes("guard"),
	)
	if (
		guards.length > 0 &&
		(target.kind === "summoner" ||
			!guards.some((guard) => guard.cardId === target.cardId))
	) {
		throw new SummonersRuleError("A Guard must be attacked first.")
	}

	attacker.ready = false
	const attackerStats = beingStats(next, attacker)
	if (target.kind === "summoner") {
		defender.health -= attackerStats.attack
		if (attackerStats.keywords.includes("leech")) {
			player.health = Math.min(
				SUMMONERS_STARTING_HEALTH,
				player.health + attackerStats.attack,
			)
		}
		setStatus(
			next,
			`${definitionFor(next, attackerId).name} struck ${defender.name} for ${attackerStats.attack}.`,
		)
	} else {
		const targetBeing = locateBeing(next, target).being
		const targetStats = beingStats(next, targetBeing)
		targetBeing.damage += attackerStats.attack
		attacker.damage += targetStats.attack
		if (attackerStats.keywords.includes("leech")) {
			player.health = Math.min(
				SUMMONERS_STARTING_HEALTH,
				player.health + attackerStats.attack,
			)
		}
		if (targetStats.keywords.includes("leech")) {
			defender.health = Math.min(
				SUMMONERS_STARTING_HEALTH,
				defender.health + targetStats.attack,
			)
		}
		setStatus(
			next,
			`${definitionFor(next, attackerId).name} battled ${definitionFor(next, targetBeing.cardId).name}.`,
		)
		triggerMolt(next, attacker)
		triggerMolt(next, targetBeing)
	}
	discardSpentBeings(next)
	eliminateSpentSummoners(next)
	return next
}

export function useSummonerPower(
	state: SummonersState,
	playerId: PlayerId,
	target: SummonersTarget | null,
): SummonersState {
	const next = copyState(state)
	const player = requireTurn(next, playerId)
	if (player.deckId === null) {
		throw new SummonersRuleError("Choose a Summoner first.")
	}
	const summoner = summonersStarterDecks[player.deckId].summoner
	if (player.powerUsed) {
		throw new SummonersRuleError(
			"Your Summoner has already used their power this turn.",
		)
	}
	if (player.spark < summoner.power.cost) {
		throw new SummonersRuleError("You do not have enough Spark.")
	}
	validateTarget(next, player, summoner.power.targeting, target)
	player.spark -= summoner.power.cost
	player.powerUsed = true
	resolveEffects(next, player, summoner.power.effects, target)
	if (next.phase === "playing") {
		if (player.spark === 0) triggerReadyKeyword(next, player, "blaze")
		setStatus(next, `${summoner.name} used ${summoner.power.name}.`)
		if (player.eliminated) advanceTurn(next, playerId)
	}
	return next
}

export function endSummonersTurn(
	state: SummonersState,
	playerId: PlayerId,
): SummonersState {
	const next = copyState(state)
	const player = requireTurn(next, playerId)
	restoreRootedBeings(next, player)
	advanceTurn(next, playerId)
	return next
}

export function restartSummonersGame(
	state: SummonersState,
	playerId: PlayerId,
): SummonersState {
	if (state.hostId !== playerId) {
		throw new SummonersRuleError("Only the host may gather the next Conclave.")
	}
	if (state.phase !== "gameComplete") {
		throw new SummonersRuleError("Finish this Conclave first.")
	}
	const next = copyState(state)
	next.cardBlueprintById = {}
	next.currentPlayerId = null
	next.phase = "lobby"
	setStatus(
		next,
		"Starter decks are remembered. The host may begin the rematch.",
	)
	next.recentHistory = [
		"Starter decks are remembered. The host may begin the rematch.",
	]
	next.turnNumber = 0
	next.winnerIds = []
	for (const player of next.players) {
		Object.assign(player, {
			battlefield: [],
			deck: [],
			discard: [],
			eliminated: false,
			fatigue: 0,
			hand: [],
			health: SUMMONERS_STARTING_HEALTH,
			maxSpark: 0,
			powerUsed: false,
			spark: 0,
		})
	}
	return next
}
