import { atom, getState, setState } from "atom.io"

import {
	HALFWAY_STYLE_OH_HELL_RULES,
	parseOhHellRules,
	STANDARD_PAGAT_OH_HELL_RULES,
	type OhHellRules,
} from "./game/oh-hell-rules.ts"
import { createRandomUuid } from "./random-uuid.ts"

const STORAGE_KEY = "wayfarer.ohHellRuleProfiles"

export type OhHellRuleProfile = {
	builtIn: boolean
	id: string
	name: string
	rules: OhHellRules
}

export const STANDARD_PAGAT_PROFILE_ID = "standard-pagat"
export const HALFWAY_STYLE_PROFILE_ID = "halfway-style"

const BUILT_IN_PROFILES: OhHellRuleProfile[] = [
	{
		builtIn: true,
		id: STANDARD_PAGAT_PROFILE_ID,
		name: "Standard Pagat",
		rules: structuredClone(STANDARD_PAGAT_OH_HELL_RULES),
	},
	{
		builtIn: true,
		id: HALFWAY_STYLE_PROFILE_ID,
		name: "Halfway-style",
		rules: structuredClone(HALFWAY_STYLE_OH_HELL_RULES),
	},
]

function parseStoredProfiles(input: string | null): OhHellRuleProfile[] {
	if (input === null) return []
	try {
		const candidates: unknown = JSON.parse(input)
		if (!Array.isArray(candidates)) return []
		return candidates.flatMap((candidate): OhHellRuleProfile[] => {
			if (
				typeof candidate !== "object" ||
				candidate === null ||
				!("id" in candidate) ||
				!("name" in candidate) ||
				!("rules" in candidate) ||
				typeof candidate.id !== "string" ||
				typeof candidate.name !== "string" ||
				candidate.name.trim() === ""
			) {
				return []
			}
			try {
				return [
					{
						builtIn: false,
						id: candidate.id,
						name: candidate.name.trim().slice(0, 60),
						rules: parseOhHellRules(candidate.rules),
					},
				]
			} catch {
				return []
			}
		})
	} catch {
		return []
	}
}

function storedProfiles(): OhHellRuleProfile[] {
	try {
		return parseStoredProfiles(
			window.localStorage?.getItem(STORAGE_KEY) ?? null,
		)
	} catch {
		return []
	}
}

function persistProfiles(profiles: OhHellRuleProfile[]): void {
	try {
		window.localStorage?.setItem(
			STORAGE_KEY,
			JSON.stringify(profiles.filter((profile) => !profile.builtIn)),
		)
	} catch {
		// Profiles remain usable for this session when storage is unavailable.
	}
}

export const ohHellRuleProfilesAtom = atom<OhHellRuleProfile[]>({
	key: "ohHellRuleProfiles",
	default: [...BUILT_IN_PROFILES, ...storedProfiles()],
})

export function saveOhHellRuleProfile(
	name: string,
	rules: OhHellRules,
	id?: string,
): string {
	const profileName = name.trim().slice(0, 60)
	if (profileName === "") throw new Error("Give this profile a name.")
	const profileId = id ?? `custom-${createRandomUuid()}`
	const profiles = getState(ohHellRuleProfilesAtom)
	const existing = profiles.find((profile) => profile.id === profileId)
	if (existing?.builtIn)
		throw new Error("Built-in profiles cannot be replaced.")
	const profile: OhHellRuleProfile = {
		builtIn: false,
		id: profileId,
		name: profileName,
		rules: parseOhHellRules(rules),
	}
	const next = existing
		? profiles.map((candidate) =>
				candidate.id === profileId ? profile : candidate,
			)
		: [...profiles, profile]
	persistProfiles(next)
	setState(ohHellRuleProfilesAtom, next)
	return profileId
}

export function deleteOhHellRuleProfile(id: string): void {
	const profiles = getState(ohHellRuleProfilesAtom)
	const target = profiles.find((profile) => profile.id === id)
	if (target === undefined || target.builtIn) return
	const next = profiles.filter((profile) => profile.id !== id)
	persistProfiles(next)
	setState(ohHellRuleProfilesAtom, next)
}
