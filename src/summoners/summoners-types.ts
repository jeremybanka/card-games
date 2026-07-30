import type { CardId, PlayerId } from "../game/game-types.ts"

export type SummonersDeckId =
	| "emberReliquary"
	| "outlandChorus"
	| "tidemarkMenagerie"
	| "verdantCompact"

export type SummonersCardType = "being" | "item" | "spell"
export type SummonersElement =
	| "air"
	| "bone"
	| "ether"
	| "fire"
	| "ice"
	| "iron"
	| "leaf"
	| "slime"
	| "water"
	| "wood"

export type SummonersKeyword = "guard" | "leech" | "rush"

export type SummonersTarget =
	| {
			cardId: CardId
			kind: "being"
			playerId: PlayerId
	  }
	| {
			kind: "summoner"
			playerId: PlayerId
	  }

export type SummonersTargeting =
	| "anyEnemy"
	| "enemyBeing"
	| "enemySummoner"
	| "friendlyBeing"
	| "friendlyCharacter"
	| "none"

export type SummonersEffect =
	| {
			amount: number
			kind: "damage"
			recipient: "ownSummoner" | "target"
	  }
	| {
			amount: number
			kind: "damageAllEnemyBeings"
	  }
	| {
			attack: number
			energy: number
			kind: "buff"
			recipient: "target"
	  }
	| {
			count: number
			kind: "draw"
	  }
	| {
			amount: number
			kind: "heal"
			recipient: "ownSummoner" | "target"
	  }
	| {
			kind: "ready"
			recipient: "target"
	  }
	| {
			kind: "returnToHand"
			recipient: "target"
	  }

export type SummonersCardDefinition = {
	art: string
	attack?: number
	cost: number
	effects?: SummonersEffect[]
	element: SummonersElement
	energy?: number
	flavor: string
	grantedKeywords?: SummonersKeyword[]
	id: string
	keywords?: SummonersKeyword[]
	name: string
	rules: string
	targeting: SummonersTargeting
	type: SummonersCardType
}

export type SummonersSummonerDefinition = {
	art: string
	element: SummonersElement
	name: string
	power: {
		cost: number
		effects: SummonersEffect[]
		name: string
		rules: string
		targeting: SummonersTargeting
	}
	title: string
}

export type SummonersStarterDeckDefinition = {
	accent: string
	cardIds: string[]
	elementLabel: string
	id: SummonersDeckId
	name: string
	philosophy: string
	summoner: SummonersSummonerDefinition
}

export type SummonersVisibleCard = SummonersCardDefinition & {
	physicalId: CardId
}

export type SummonersPublicBeing = {
	attack: number
	card: SummonersVisibleCard
	damage: number
	energy: number
	item: SummonersVisibleCard | null
	keywords: SummonersKeyword[]
	ready: boolean
}

export type SummonersPhase = "gameComplete" | "lobby" | "playing"

export type SummonersPublicPlayerView = {
	connected: boolean
	deck: SummonersStarterDeckDefinition | null
	deckCount: number
	discardCount: number
	eliminated: boolean
	fatigue: number
	handCardIds: CardId[]
	handCount: number
	health: number
	id: PlayerId
	kind: "human"
	maxSpark: number
	name: string
	powerUsed: boolean
	spark: number
	summoner: SummonersSummonerDefinition | null
	battlefield: SummonersPublicBeing[]
}

export type SummonersPublicGameView = {
	currentPlayerId: PlayerId | null
	gameKind: "summoners"
	hostId: PlayerId | null
	phase: SummonersPhase
	players: SummonersPublicPlayerView[]
	roomCode: string
	statusMessage: string
	turnNumber: number
	winnerIds: PlayerId[]
}

export type SummonersPrivatePlayerView = {
	gameKind: "summoners"
	hand: SummonersVisibleCard[]
	playableCardIds: CardId[]
	playerId: PlayerId | null
}

export type SelectSummonersDeckClientEvents = {
	selectSummonersDeck: (
		deckId: SummonersDeckId,
		ack: import("../game/game-types.ts").ActionAck,
	) => void
}

export type PlaySummonersCardClientEvents = {
	playSummonersCard: (
		cardId: CardId,
		target: SummonersTarget | null,
		ack: import("../game/game-types.ts").ActionAck,
	) => void
}

export type AttackSummonersClientEvents = {
	attackSummoners: (
		attackerId: CardId,
		target: SummonersTarget,
		ack: import("../game/game-types.ts").ActionAck,
	) => void
}

export type SummonerPowerClientEvents = {
	useSummonerPower: (
		target: SummonersTarget | null,
		ack: import("../game/game-types.ts").ActionAck,
	) => void
}

export type EndSummonersTurnClientEvents = {
	endSummonersTurn: (ack: import("../game/game-types.ts").ActionAck) => void
}

export type SummonersClientEvents = AttackSummonersClientEvents &
	EndSummonersTurnClientEvents &
	PlaySummonersCardClientEvents &
	SelectSummonersDeckClientEvents &
	SummonerPowerClientEvents & {
		restartGame: (ack: import("../game/game-types.ts").ActionAck) => void
		startGame: (ack: import("../game/game-types.ts").ActionAck) => void
	}
