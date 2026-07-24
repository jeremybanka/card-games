export function playerInitials(name: string): string {
	return name
		.split(/\s+/)
		.filter(Boolean)
		.map((part) => part[0]?.toUpperCase())
		.join("")
		.slice(0, 2)
}
