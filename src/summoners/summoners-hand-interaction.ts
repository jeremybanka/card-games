export function summonersHandCardCandidates(
	element: HTMLElement,
): HTMLElement[] {
	const hand = element.closest("player-hand")
	return Array.from(
		hand?.querySelectorAll<HTMLElement>(
			"summoners-hand-card:not([data-disabled])",
		) ?? [],
	)
}

export function closestSummonersHandCard(
	candidates: readonly HTMLElement[],
	clientX: number,
): HTMLElement | null {
	return (
		candidates.reduce<{ distance: number; element: HTMLElement } | null>(
			(nearest, candidate) => {
				const rect = candidate.getBoundingClientRect()
				const distance = Math.abs(rect.left + rect.width / 2 - clientX)
				return nearest === null || distance < nearest.distance
					? { distance, element: candidate }
					: nearest
			},
			null,
		)?.element ?? null
	)
}

export function summonersHandCardAtPoint(
	candidates: readonly HTMLElement[],
	clientX: number,
	clientY: number,
): HTMLElement | null {
	return closestSummonersHandCard(
		candidates.filter((candidate) => {
			const rect = candidate.getBoundingClientRect()
			return (
				clientX >= rect.left &&
				clientX <= rect.right &&
				clientY >= rect.top &&
				clientY <= rect.bottom
			)
		}),
		clientX,
	)
}
