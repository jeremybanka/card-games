import { atom } from "atom.io"

export const questCountAtom = atom<number>({
	key: "questCount",
	default: 1,
})
