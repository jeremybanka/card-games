export const GAME_KINDS = ["hearts", "ohHell"] as const

export type GameKind = (typeof GAME_KINDS)[number]
