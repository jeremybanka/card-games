type FillRandomBytes = (bytes: Uint8Array<ArrayBuffer>) => void

const fillRandomBytes: FillRandomBytes = (bytes) => {
	crypto.getRandomValues(bytes)
}

export function createRandomUuid(
	fillBytes: FillRandomBytes = fillRandomBytes,
): string {
	const bytes = new Uint8Array(16)
	fillBytes(bytes)
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

	const hexadecimal = Array.from(bytes, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("")
	return [
		hexadecimal.slice(0, 8),
		hexadecimal.slice(8, 12),
		hexadecimal.slice(12, 16),
		hexadecimal.slice(16, 20),
		hexadecimal.slice(20),
	].join("-")
}
