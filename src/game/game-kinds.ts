export const GAME_KINDS = ["hearts", "ohHell", "summoners"] as const

export type GameKind = (typeof GAME_KINDS)[number]
