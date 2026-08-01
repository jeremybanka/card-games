// @vitest-environment happy-dom

import { describe, expect, it } from "vitest"

import { summonersTargetFromElements } from "./summoners-target-interaction.ts"

describe("Summoners target interaction", () => {
	it("resolves Being and Summoner drop targets from their descendants", () => {
		const being = document.createElement("battlefield-being")
		being.dataset.summonersTargetKind = "being"
		being.dataset.summonersTargetPlayerId = "user::rival"
		being.dataset.summonersTargetCardId = "card::guard"
		const card = document.createElement("summoners-card")
		being.append(card)

		expect(summonersTargetFromElements([card])).toEqual({
			cardId: "card::guard",
			kind: "being",
			playerId: "user::rival",
		})

		const summoner = document.createElement("opponent-summoner")
		summoner.dataset.summonersTargetKind = "summoner"
		summoner.dataset.summonersTargetPlayerId = "user::rival"
		expect(summonersTargetFromElements([summoner])).toEqual({
			kind: "summoner",
			playerId: "user::rival",
		})
	})

	it("looks beneath the dragged attacker for the actual drop target", () => {
		const dragged = document.createElement("battlefield-being")
		dragged.dataset.attackerDragging = "true"
		dragged.dataset.summonersTargetKind = "being"
		dragged.dataset.summonersTargetPlayerId = "user::me"
		dragged.dataset.summonersTargetCardId = "card::attacker"

		const rival = document.createElement("opponent-summoner")
		rival.dataset.summonersTargetKind = "summoner"
		rival.dataset.summonersTargetPlayerId = "user::rival"

		expect(summonersTargetFromElements([dragged, rival])).toEqual({
			kind: "summoner",
			playerId: "user::rival",
		})
	})
})
