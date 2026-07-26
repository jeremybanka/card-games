import { describe, expect, it } from "vitest"

import { createRandomUuid } from "./random-uuid.ts"

describe("createRandomUuid", () => {
	it("creates an RFC 4122 version 4 UUID from secure random bytes", () => {
		const uuid = createRandomUuid((bytes) => {
			bytes.set(Array.from({ length: 16 }, (_, index) => index))
		})

		expect(uuid).toBe("00010203-0405-4607-8809-0a0b0c0d0e0f")
	})
})
