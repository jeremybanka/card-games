import { useO } from "atom.io/react"
import { useMemo, useState } from "preact/hooks"

import {
	deriveOhHellHandSchedule,
	maximumOhHellHandSize,
	ohHellRulesErrorForPlayers,
	type OhHellRules,
	type OhHellScheduleStyle,
} from "./game/oh-hell-rules.ts"
import {
	deleteOhHellRuleProfile,
	ohHellRuleProfilesAtom,
	saveOhHellRuleProfile,
} from "./oh-hell-rule-profiles.ts"
import css from "./OhHellRulesPanel.module.css"

type OhHellRulesPanelProps = {
	editable: boolean
	onConfigure: (rules: OhHellRules) => void
	playerCount: number
	rules: OhHellRules
}

function sameRules(left: OhHellRules, right: OhHellRules): boolean {
	return JSON.stringify(left) === JSON.stringify(right)
}

function scheduleLabel(style: OhHellScheduleStyle): string {
	switch (style) {
		case "flat":
			return "Flat"
		case "descending":
			return "Descending"
		case "ascending":
			return "Ascending"
		case "valley":
			return "Valley"
		case "mountain":
			return "Mountain"
	}
}

function withScheduleStyle(
	rules: OhHellRules,
	style: OhHellScheduleStyle,
): OhHellRules {
	if (style === "flat") {
		const handSize =
			rules.schedule.style === "flat"
				? rules.schedule.handSize
				: (rules.schedule.maximumHandSize ?? 5)
		return {
			...rules,
			schedule: { handSize, roundCount: 10, style },
		}
	}
	const maximumHandSize =
		rules.schedule.style === "flat"
			? rules.schedule.handSize
			: rules.schedule.maximumHandSize
	return {
		...rules,
		schedule: { maximumHandSize, minimumHandSize: 1, style },
	}
}

function updateFlatSchedule(
	rules: OhHellRules,
	update: Partial<{ handSize: number; roundCount: number }>,
): OhHellRules {
	if (rules.schedule.style !== "flat") return rules
	return { ...rules, schedule: { ...rules.schedule, ...update } }
}

function updateRangeSchedule(
	rules: OhHellRules,
	update: Partial<{ maximumHandSize: number | null; minimumHandSize: number }>,
): OhHellRules {
	if (rules.schedule.style === "flat") return rules
	return { ...rules, schedule: { ...rules.schedule, ...update } }
}

export function OhHellRulesPanel({
	editable,
	onConfigure,
	playerCount,
	rules,
}: OhHellRulesPanelProps) {
	const profiles = useO(ohHellRuleProfilesAtom)
	const matchingProfile = profiles.find((profile) =>
		sameRules(profile.rules, rules),
	)
	const [editingProfileId, setEditingProfileId] = useState<string | null>(
		matchingProfile?.id ?? null,
	)
	const [profileName, setProfileName] = useState(
		matchingProfile?.name ?? "My Oh Hell rules",
	)
	const [profileError, setProfileError] = useState<string | null>(null)
	const validationError = ohHellRulesErrorForPlayers(rules, playerCount)
	const schedule = useMemo(
		() =>
			validationError === null
				? deriveOhHellHandSchedule(rules, playerCount)
				: [],
		[validationError, playerCount, rules],
	)
	const handMaximum = maximumOhHellHandSize(Math.max(3, playerCount))
	const editingProfile = profiles.find(
		(profile) => profile.id === editingProfileId,
	)

	const configure = (next: OhHellRules): void => {
		setProfileError(null)
		onConfigure(next)
	}

	return (
		<oh-hell-rules-panel
			className={css.class}
			data-editable={editable || undefined}
		>
			<details open={editable}>
				<summary>
					<span>Table rules</span>
					<strong>{matchingProfile?.name ?? "Custom"}</strong>
				</summary>

				{editable ? (
					<profile-controls>
						<label>
							<span>Local profile</span>
							<select
								value={matchingProfile?.id ?? "custom"}
								onInput={(event) => {
									const profile = profiles.find(
										(candidate) => candidate.id === event.currentTarget.value,
									)
									if (profile === undefined) return
									setEditingProfileId(profile.id)
									setProfileName(profile.name)
									configure(profile.rules)
								}}
							>
								{matchingProfile === undefined ? (
									<option value="custom">Unsaved custom rules</option>
								) : null}
								{profiles.map((profile) => (
									<option key={profile.id} value={profile.id}>
										{profile.name}
									</option>
								))}
							</select>
						</label>
						<profile-save-row>
							<input
								aria-label="Profile name"
								maxlength={60}
								onInput={(event) => setProfileName(event.currentTarget.value)}
								value={profileName}
							/>
							<button
								type="button"
								onClick={() => {
									try {
										const id = saveOhHellRuleProfile(
											profileName,
											rules,
											editingProfile?.builtIn ? undefined : editingProfile?.id,
										)
										setEditingProfileId(id)
										setProfileError(null)
									} catch (error) {
										setProfileError(
											error instanceof Error
												? error.message
												: "Profile not saved.",
										)
									}
								}}
							>
								{editingProfile?.builtIn || editingProfile === undefined
									? "Save copy"
									: "Update"}
							</button>
							{editingProfile !== undefined && !editingProfile.builtIn ? (
								<button
									type="button"
									onClick={() => {
										deleteOhHellRuleProfile(editingProfile.id)
										setEditingProfileId(null)
										setProfileName("My Oh Hell rules")
									}}
								>
									Delete
								</button>
							) : null}
						</profile-save-row>
						{profileError === null ? null : <p>{profileError}</p>}
					</profile-controls>
				) : null}

				<rule-switches>
					<label>
						<input
							checked={rules.requireTrumpBreak}
							disabled={!editable}
							onChange={(event) =>
								configure({
									...rules,
									requireTrumpBreak: event.currentTarget.checked,
								})
							}
							type="checkbox"
						/>
						<span>Trump must be broken</span>
					</label>
					<label>
						<input
							checked={rules.requireUnsatisfiableBids}
							disabled={!editable}
							onChange={(event) =>
								configure({
									...rules,
									requireUnsatisfiableBids: event.currentTarget.checked,
								})
							}
							type="checkbox"
						/>
						<span>Hot-seat bidding</span>
					</label>
					<label>
						<input
							checked={rules.awardPittancePoints}
							disabled={!editable}
							onChange={(event) =>
								configure({
									...rules,
									awardPittancePoints: event.currentTarget.checked,
								})
							}
							type="checkbox"
						/>
						<span>Pittance points on a miss</span>
					</label>
				</rule-switches>

				<schedule-controls>
					<label>
						<span>Round shape</span>
						<select
							disabled={!editable}
							onInput={(event) =>
								configure(
									withScheduleStyle(
										rules,
										event.currentTarget.value as OhHellScheduleStyle,
									),
								)
							}
							value={rules.schedule.style}
						>
							{(
								[
									"flat",
									"descending",
									"ascending",
									"valley",
									"mountain",
								] as const
							).map((style) => (
								<option key={style} value={style}>
									{scheduleLabel(style)}
								</option>
							))}
						</select>
					</label>
					{rules.schedule.style === "flat" ? (
						<>
							<label>
								<span>Cards each round</span>
								<input
									disabled={!editable}
									max={17}
									min={1}
									onInput={(event) =>
										configure(
											updateFlatSchedule(rules, {
												handSize: event.currentTarget.valueAsNumber,
											}),
										)
									}
									type="number"
									value={rules.schedule.handSize}
								/>
							</label>
							<label>
								<span>Rounds</span>
								<input
									disabled={!editable}
									max={100}
									min={1}
									onInput={(event) =>
										configure(
											updateFlatSchedule(rules, {
												roundCount: event.currentTarget.valueAsNumber,
											}),
										)
									}
									type="number"
									value={rules.schedule.roundCount}
								/>
							</label>
						</>
					) : (
						<>
							<label>
								<span>Minimum cards</span>
								<input
									disabled={!editable}
									max={17}
									min={1}
									onInput={(event) =>
										configure(
											updateRangeSchedule(rules, {
												minimumHandSize: event.currentTarget.valueAsNumber,
											}),
										)
									}
									type="number"
									value={rules.schedule.minimumHandSize}
								/>
							</label>
							<label>
								<span>Maximum cards</span>
								<select
									disabled={!editable}
									onInput={(event) =>
										configure(
											updateRangeSchedule(rules, {
												maximumHandSize:
													event.currentTarget.value === "auto"
														? null
														: Number(event.currentTarget.value),
											}),
										)
									}
									value={rules.schedule.maximumHandSize ?? "auto"}
								>
									<option value="auto">Pagat automatic</option>
									{Array.from({ length: 17 }, (_, index) => index + 1).map(
										(value) => (
											<option key={value} value={value}>
												{value}
											</option>
										),
									)}
								</select>
							</label>
						</>
					)}
				</schedule-controls>

				<schedule-preview data-invalid={validationError !== null || undefined}>
					{validationError ??
						`${schedule.length} rounds · ${schedule.join("–")} · up to ${handMaximum} cards each with this table`}
				</schedule-preview>
			</details>
		</oh-hell-rules-panel>
	)
}
