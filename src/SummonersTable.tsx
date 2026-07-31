import { setState } from "atom.io"
import { myUserKeyAtom } from "atom.io/realtime-client"
import { usePullAtom } from "atom.io/realtime-react"
import type { JSX, VNode } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"

import { actionErrorAtom } from "./client-state.ts"
import {
	DEFAULT_AI_MODEL_ID,
	isAiModelId,
	OPENAI_HEARTS_MODELS,
} from "./ai/ai-models.ts"
import type { GameSocket } from "./game-socket.ts"
import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "./game/game-state-atoms.ts"
import type { ActionResult, CardId, PlayerId } from "./game/game-types.ts"
import css from "./SummonersTable.module.css"
import {
	SUMMONERS_DECK_IDS,
	summonersCardCatalog,
	summonersStarterDecks,
} from "./summoners/summoners-cards.ts"
import {
	capturePendingSummonersCardMotion,
	useSummonersCardMotion,
} from "./summoners/summoners-card-motion.ts"
import { summonersHandCardLayout } from "./summoners/summoners-hand-layout.ts"
import {
	closestSummonersHandCard,
	summonersHandCardAtPoint,
	summonersHandCardCandidates,
} from "./summoners/summoners-hand-interaction.ts"
import {
	SUMMONERS_KEYWORD_GLOSSARY,
	summonersCardKeywords,
	summonersKeywordLabel,
} from "./summoners/summoners-glossary.ts"
import { summonersTargetFromElements } from "./summoners/summoners-target-interaction.ts"
import type {
	SummonersCardDefinition,
	SummonersPublicBeing,
	SummonersPublicGameView,
	SummonersPublicPlayerView,
	SummonersTarget,
	SummonersTargeting,
	SummonersVisibleCard,
} from "./summoners/summoners-types.ts"

type SummonersTableProps = {
	onLeave: () => void
	socket: GameSocket
}

type Selection =
	| { cardId: CardId; kind: "card"; targeting: SummonersTargeting }
	| { cardId: CardId; kind: "attacker"; targeting: "anyEnemy" }
	| { kind: "power"; targeting: SummonersTargeting }

type CardDragState = {
	cardId: CardId
	dragging: boolean
	x: number
	y: number
}

type PointerOrigin = {
	pointerId: number
	x: number
	y: number
}

const elementMarks: Record<SummonersCardDefinition["element"], string> = {
	air: "AIR",
	bone: "BONE",
	ether: "ETHER",
	fire: "FIRE",
	ice: "ICE",
	iron: "IRON",
	leaf: "LEAF",
	slime: "SLIME",
	water: "WATER",
	wood: "WOOD",
}

function handleResult(result: ActionResult, onSuccess?: () => void): void {
	setState(actionErrorAtom, result.ok ? null : result.error)
	if (result.ok) onSuccess?.()
}

function targetForSummoner(playerId: PlayerId): SummonersTarget {
	return { kind: "summoner", playerId }
}

function targetForBeing(playerId: PlayerId, cardId: CardId): SummonersTarget {
	return { cardId, kind: "being", playerId }
}

function targetMatchesSelection(
	selection: Selection | null,
	target: SummonersTarget,
	myPlayerId: PlayerId,
	owner: SummonersPublicPlayerView,
): boolean {
	if (selection === null || owner.eliminated) return false
	const friendly = target.playerId === myPlayerId
	if (selection.kind === "attacker") {
		if (friendly) return false
		const guards = owner.battlefield.filter((being) =>
			being.keywords.includes("guard"),
		)
		return (
			guards.length === 0 ||
			(target.kind === "being" &&
				guards.some((guard) => guard.card.physicalId === target.cardId))
		)
	}
	switch (selection.targeting) {
		case "anyEnemy":
			return !friendly
		case "enemyBeing":
			return !friendly && target.kind === "being"
		case "enemySummoner":
			return !friendly && target.kind === "summoner"
		case "friendlyBeing":
			return friendly && target.kind === "being"
		case "friendlyCharacter":
			return friendly
		case "none":
			return false
	}
}

function selectionInstruction(
	selection: Selection | null,
	card: SummonersVisibleCard | null,
): string {
	if (selection === null) return "Choose a card, a ready Being, or your power."
	if (selection.kind === "attacker") {
		return "Choose an enemy character. Guard Beings stand in the way."
	}
	if (selection.kind === "power") {
		return "Choose a character for your Summoner’s power."
	}
	switch (selection.targeting) {
		case "anyEnemy":
			return `Choose any enemy for ${card?.name ?? "this spell"}.`
		case "enemyBeing":
			return `Choose an enemy Being for ${card?.name ?? "this spell"}.`
		case "enemySummoner":
			return `Choose an enemy Summoner for ${card?.name ?? "this spell"}.`
		case "friendlyBeing":
			return `Choose one of your Beings for ${card?.name ?? "this card"}.`
		case "friendlyCharacter":
			return `Choose your Summoner or one of your Beings.`
		case "none":
			return `Play ${card?.name ?? "the selected card"}.`
	}
}

function cardTypeLabel(card: SummonersCardDefinition): string {
	return `${elementMarks[card.element]} ${card.type.toUpperCase()}`
}

function SummonersCard({
	card,
	compact = false,
	disabled = false,
	onClick,
	onPointerCancel,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	selected = false,
	tooltipSide = "right",
}: {
	card: SummonersVisibleCard
	compact?: boolean
	disabled?: boolean
	onClick: () => void
	onPointerCancel?:
		| ((event: JSX.TargetedPointerEvent<HTMLElement>) => void)
		| undefined
	onPointerDown?:
		| ((event: JSX.TargetedPointerEvent<HTMLElement>) => void)
		| undefined
	onPointerMove?:
		| ((event: JSX.TargetedPointerEvent<HTMLElement>) => void)
		| undefined
	onPointerUp?:
		| ((event: JSX.TargetedPointerEvent<HTMLElement>) => void)
		| undefined
	selected?: boolean
	tooltipSide?: "left" | "right" | undefined
}): VNode {
	const keywords = summonersCardKeywords(card)
	const tooltipId = `summoners-keywords-${card.physicalId}`
	return (
		<summoners-card
			data-card-id={card.physicalId}
			data-compact={compact || undefined}
			data-element={card.element}
			data-selected={selected || undefined}
			data-tooltip-side={tooltipSide}
			data-type={card.type}
		>
			<button
				type="button"
				aria-describedby={keywords.length === 0 ? undefined : tooltipId}
				aria-label={`${card.name}, ${card.cost} Spark, ${card.rules}`}
				aria-pressed={selected}
				disabled={disabled}
				onClick={onClick}
				onPointerCancel={onPointerCancel}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
			>
				<card-frame>
					<card-cost aria-label={`${card.cost} Spark`}>{card.cost}</card-cost>
					<card-art aria-hidden="true">{card.art}</card-art>
					<card-identity>
						<small>{cardTypeLabel(card)}</small>
						<strong>{card.name}</strong>
					</card-identity>
					<card-rules>
						<span>{card.rules}</span>
						<em>{card.flavor}</em>
					</card-rules>
					{card.type === "being" ? (
						<card-combat>
							<combat-stat data-kind="attack">
								<small>ATK</small>
								<strong aria-label={`${card.attack ?? 0} Attack`}>
									{card.attack ?? 0}
								</strong>
							</combat-stat>
							<combat-stat data-kind="energy">
								<small>NRG</small>
								<strong aria-label={`${card.energy ?? 0} Energy`}>
									{card.energy ?? 0}
								</strong>
							</combat-stat>
						</card-combat>
					) : card.type === "item" ? (
						<card-combat>
							<combat-stat data-kind="attack">
								<small>ATK</small>
								<strong aria-label={`${card.attack ?? 0} Attack bonus`}>
									+{card.attack ?? 0}
								</strong>
							</combat-stat>
							<combat-stat data-kind="energy">
								<small>NRG</small>
								<strong aria-label={`${card.energy ?? 0} Energy bonus`}>
									+{card.energy ?? 0}
								</strong>
							</combat-stat>
						</card-combat>
					) : null}
				</card-frame>
			</button>
			{keywords.length === 0 ? null : (
				<card-keyword-tooltip id={tooltipId} role="tooltip">
					{keywords.map((keyword) => (
						<p key={keyword}>
							<strong>{summonersKeywordLabel(keyword)}.</strong>{" "}
							<span>{SUMMONERS_KEYWORD_GLOSSARY[keyword]}</span>
						</p>
					))}
				</card-keyword-tooltip>
			)}
		</summoners-card>
	)
}

function BattlefieldBeing({
	being,
	drag,
	disabled,
	onClick,
	onPointerCancel,
	onPointerDown,
	onPointerMove,
	onPointerUp,
	ownerId,
	selected,
	targetable,
	tooltipSide,
}: {
	being: SummonersPublicBeing
	drag?: CardDragState | null
	disabled: boolean
	onClick: () => void
	onPointerCancel?: (event: JSX.TargetedPointerEvent<HTMLElement>) => void
	onPointerDown?: (event: JSX.TargetedPointerEvent<HTMLElement>) => void
	onPointerMove?: (event: JSX.TargetedPointerEvent<HTMLElement>) => void
	onPointerUp?: (event: JSX.TargetedPointerEvent<HTMLElement>) => void
	ownerId: PlayerId
	selected: boolean
	targetable: boolean
	tooltipSide?: "left" | "right"
}): VNode {
	return (
		<battlefield-being
			data-attacker-dragging={drag?.dragging || undefined}
			data-ready={being.ready || undefined}
			data-selected={selected || undefined}
			data-summoners-target-card-id={being.card.physicalId}
			data-summoners-target-kind="being"
			data-summoners-target-player-id={ownerId}
			data-targetable={targetable || undefined}
			style={{
				"--being-drag-x": `${drag?.x ?? 0}px`,
				"--being-drag-y": `${drag?.y ?? 0}px`,
			}}
		>
			<SummonersCard
				card={being.card}
				compact
				disabled={disabled}
				onClick={onClick}
				onPointerCancel={onPointerCancel}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={onPointerUp}
				selected={selected}
				tooltipSide={tooltipSide}
			/>
			<being-state
				key={`${being.card.physicalId}:${being.damage}:${being.ready}:${being.item?.physicalId ?? "bare"}`}
			>
				<being-vitals>
					<being-attack aria-label={`${being.attack} Attack`}>
						<small>ATK</small>
						<strong>{being.attack}</strong>
					</being-attack>
					<being-energy
						aria-label={`${being.energy - being.damage} of ${being.energy} Energy`}
						data-wounded={being.damage > 0 || undefined}
						style={{
							"--energy-fill": `${Math.max(
								0,
								((being.energy - being.damage) / being.energy) * 100,
							)}%`,
						}}
					>
						<small>ENERGY</small>
						<strong>
							{being.energy - being.damage}/{being.energy}
						</strong>
					</being-energy>
				</being-vitals>
				{being.item === null ? null : (
					<equipped-item
						data-card-id={being.item.physicalId}
						title={being.item.rules}
					>
						{being.item.art} {being.item.name}
					</equipped-item>
				)}
				{being.keywords.length === 0 ? null : (
					<keyword-row>{being.keywords.join(" · ")}</keyword-row>
				)}
			</being-state>
		</battlefield-being>
	)
}

function OpponentHand({
	cardIds,
	playerName,
}: {
	cardIds: CardId[]
	playerName: string
}): VNode {
	return (
		<opponent-hand aria-label={`${playerName}'s hand: ${cardIds.length} cards`}>
			{cardIds.map((cardId, index) => (
				<summoners-card-back
					aria-hidden="true"
					data-card-id={cardId}
					key={cardId}
					style={{
						"--back-angle": `${(index - (cardIds.length - 1) / 2) * 3}deg`,
						"--back-index": index,
					}}
				>
					<span>✦</span>
				</summoners-card-back>
			))}
		</opponent-hand>
	)
}

function ResourceMarks({
	cardMotionOrigin = false,
	player,
}: {
	cardMotionOrigin?: boolean
	player: SummonersPublicPlayerView
}): VNode {
	return (
		<resource-marks>
			<health-mark aria-label={`${player.health} life`}>
				<span>♥</span>
				<strong>{player.health}</strong>
			</health-mark>
			<spark-mark aria-label={`${player.spark} of ${player.maxSpark} Spark`}>
				<span>✦</span>
				<strong>
					{player.spark}/{player.maxSpark}
				</strong>
			</spark-mark>
			<library-mark
				aria-label={`${player.deckCount} cards in deck`}
				data-summoners-card-motion-origin={
					cardMotionOrigin ? "deck" : undefined
				}
			>
				<span>▤</span>
				<strong>{player.deckCount}</strong>
			</library-mark>
			<hand-mark aria-label={`${player.handCount} cards in hand`}>
				<span> fan </span>
				<strong>{player.handCount}</strong>
			</hand-mark>
		</resource-marks>
	)
}

function RulesCodex({ onClose }: { onClose: () => void }): VNode {
	return (
		<rules-codex
			aria-label="How to play Summoners"
			aria-modal="true"
			role="dialog"
		>
			<codex-scrim onClick={onClose} />
			<codex-page>
				<codex-heading>
					<small>CONCLAVE FIELD GUIDE · FIRST EDITION</small>
					<h2>How to summon</h2>
					<button type="button" aria-label="Close rules" onClick={onClose}>
						×
					</button>
				</codex-heading>
				<codex-columns>
					<section>
						<h3>The contest</h3>
						<p>
							Two to four Summoners enter with 24 life, a leader, and a 24-card
							starter deck. Be the last Summoner with life remaining.
						</p>
						<h3>Your turn</h3>
						<ol>
							<li>Gain one maximum Spark, up to 10, then refill it.</li>
							<li>Ready your Beings and draw a card.</li>
							<li>Play cards, use your power, and attack in any order.</li>
							<li>End your turn when you are finished.</li>
						</ol>
						<p>
							Your first turn begins with 1 Spark and no extra draw. Hands hold
							9 cards and battlefields hold 5 Beings.
						</p>
					</section>
					<section>
						<h3>Cards & combat</h3>
						<p>
							Beings enter weary unless they have Rush. A ready Being may attack
							once; Beings deal their Attack to each other simultaneously.
							Damage persists. Items equip one friendly Being, replacing its old
							Item.
						</p>
						<dl>
							<dt>Guard</dt>
							<dd>Enemies must attack a Guard before other characters.</dd>
							<dt>Rush</dt>
							<dd>This Being may attack on the turn it is summoned.</dd>
							<dt>Leech</dt>
							<dd>Its Summoner restores life equal to its combat damage.</dd>
							<dt>Fatigue</dt>
							<dd>
								Drawing from an empty deck deals 1, then 2, then 3 damage, and
								so on.
							</dd>
						</dl>
					</section>
				</codex-columns>
				<codex-decks>
					{SUMMONERS_DECK_IDS.map((deckId) => {
						const deck = summonersStarterDecks[deckId]
						return (
							<article key={deck.id} style={{ "--deck-accent": deck.accent }}>
								<strong>{deck.name}</strong>
								<span>
									{deck.summoner.name}, {deck.summoner.title}
								</span>
								<small>{deck.philosophy}</small>
							</article>
						)
					})}
				</codex-decks>
			</codex-page>
		</rules-codex>
	)
}

function SummonersLobby({
	game,
	myPlayer,
	myPlayerId,
	onOpenRules,
	socket,
}: {
	game: SummonersPublicGameView
	myPlayer: SummonersPublicPlayerView
	myPlayerId: PlayerId
	onOpenRules: () => void
	socket: GameSocket
}): VNode {
	const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL_ID)
	const readyToStart =
		game.players.length >= 2 &&
		game.players.every((player) => player.connected && player.deck !== null)
	return (
		<summoners-lobby>
			<lobby-intro>
				<small>ROOM {game.roomCode} · A LIVING CARD GAME</small>
				<h1>Choose your Summoner</h1>
				<p>
					Gather two to four rivals. Your starter deck is your philosophy; the
					last strange little legend standing wins.
				</p>
				<button type="button" onClick={onOpenRules}>
					Read the field guide
				</button>
			</lobby-intro>
			<deck-gallery aria-label="Starter decks">
				{SUMMONERS_DECK_IDS.map((deckId) => {
					const deck = summonersStarterDecks[deckId]
					const selected = myPlayer.deck?.id === deckId
					const distinctCards = [...new Set(deck.cardIds)].map(
						(cardId) =>
							summonersCardCatalog[cardId as keyof typeof summonersCardCatalog],
					)
					return (
						<starter-deck
							data-selected={selected || undefined}
							key={deckId}
							style={{ "--deck-accent": deck.accent }}
						>
							<button
								type="button"
								aria-pressed={selected}
								onClick={() => {
									socket.emit("selectSummonersDeck", deckId, handleResult)
								}}
							>
								<deck-sigil aria-hidden="true">{deck.summoner.art}</deck-sigil>
								<deck-heading>
									<small>{deck.elementLabel}</small>
									<h2>{deck.name}</h2>
									<strong>
										{deck.summoner.name}, {deck.summoner.title}
									</strong>
								</deck-heading>
								<p>{deck.philosophy}</p>
								<deck-power>
									<span>POWER · {deck.summoner.power.cost} ✦</span>
									<strong>{deck.summoner.power.name}</strong>
									<small>{deck.summoner.power.rules}</small>
								</deck-power>
								<deck-sample>
									{distinctCards.slice(0, 5).map((card) => (
										<span key={card.id}>{card.name}</span>
									))}
									<em>+ {distinctCards.length - 5} more</em>
								</deck-sample>
								<deck-choice>
									{selected ? "Deck chosen" : "Choose this deck"}
								</deck-choice>
							</button>
						</starter-deck>
					)
				})}
			</deck-gallery>
			<conclave-roster>
				<roster-heading>
					<small>THE CONCLAVE</small>
					<strong>{game.players.length} / 4 Summoners</strong>
				</roster-heading>
				<ol>
					{game.players.map((player) => (
						<li data-ready={player.deck !== null || undefined} key={player.id}>
							<span>{player.summoner?.art ?? "○"}</span>
							<strong>
								{player.name}
								{player.id === game.hostId ? " · host" : ""}
							</strong>
							<small>
								{player.deck?.name ?? "Choosing…"}
								{player.aiModel === null ? "" : ` · ${player.aiModel}`}
							</small>
							{player.kind === "ai" && game.hostId === myPlayerId ? (
								<button
									type="button"
									aria-label={`Remove ${player.name}`}
									onClick={() =>
										socket.emit("removeAiSeat", player.id, handleResult)
									}
								>
									×
								</button>
							) : null}
						</li>
					))}
				</ol>
				{game.hostId === myPlayerId ? (
					<>
						{game.players.length < 4 ? (
							<ai-seat-controls>
								<label>
									<span>OpenAI opponent</span>
									<select
										value={selectedAiModel}
										onInput={(event) => {
											const modelId = event.currentTarget.value
											if (isAiModelId(modelId)) setSelectedAiModel(modelId)
										}}
									>
										{OPENAI_HEARTS_MODELS.map((model) => (
											<option key={model.id} value={model.id}>
												{model.label}
											</option>
										))}
									</select>
								</label>
								<button
									type="button"
									onClick={() =>
										socket.emit("assignAiSeat", selectedAiModel, handleResult)
									}
								>
									Invite AI Summoner
								</button>
							</ai-seat-controls>
						) : null}
						<button
							type="button"
							disabled={!readyToStart}
							onClick={() => socket.emit("startGame", handleResult)}
						>
							Begin the Conclave
						</button>
					</>
				) : (
					<p>Waiting for the host to begin.</p>
				)}
			</conclave-roster>
		</summoners-lobby>
	)
}

export function SummonersTable({
	onLeave,
	socket,
}: SummonersTableProps): VNode {
	const pulledGame = usePullAtom(publicGameViewAtom)
	const pulledPrivateView = usePullAtom(privatePlayerViewAtom)
	const myPlayerId = usePullAtom(myUserKeyAtom) as PlayerId | null
	const [selection, setSelection] = useState<Selection | null>(null)
	const [handDrag, setHandDrag] = useState<CardDragState | null>(null)
	const [attackerDrag, setAttackerDrag] = useState<CardDragState | null>(null)
	const [hoveredHandCardId, setHoveredHandCardId] = useState<CardId | null>(
		null,
	)
	const [rulesOpen, setRulesOpen] = useState(false)
	const [tableRoot, setTableRoot] = useState<HTMLElement | null>(null)
	const handDragRef = useRef<CardDragState | null>(null)
	const attackerDragRef = useRef<CardDragState | null>(null)
	const pointerOrigin = useRef<PointerOrigin | null>(null)
	const attackerPointerOrigin = useRef<PointerOrigin | null>(null)
	const suppressBeingClick = useRef(new Set<CardId>())

	const game = pulledGame.gameKind === "summoners" ? pulledGame : null
	const privateView =
		pulledPrivateView.gameKind === "summoners" ? pulledPrivateView : null
	const myPlayer =
		game === null || myPlayerId === null
			? undefined
			: game.players.find((player) => player.id === myPlayerId)
	const selectedCard =
		selection?.kind === "card" && privateView !== null
			? (privateView.hand.find(
					(card) => card.physicalId === selection.cardId,
				) ?? null)
			: null

	useSummonersCardMotion(tableRoot)

	useEffect(() => {
		setSelection(null)
		setHandDrag(null)
		setAttackerDrag(null)
		handDragRef.current = null
		attackerDragRef.current = null
		setHoveredHandCardId(null)
		pointerOrigin.current = null
		attackerPointerOrigin.current = null
		suppressBeingClick.current.clear()
	}, [game?.currentPlayerId, game?.phase])

	useEffect(() => {
		if (
			selection?.kind === "card" &&
			privateView !== null &&
			!privateView.hand.some((card) => card.physicalId === selection.cardId)
		) {
			setSelection(null)
		}
	}, [privateView, selection])

	const playersById = useMemo(
		() => new Map((game?.players ?? []).map((player) => [player.id, player])),
		[game?.players],
	)

	if (
		game === null ||
		privateView === null ||
		myPlayerId === null ||
		myPlayer === undefined
	) {
		return (
			<summoners-table className={css.class} data-loading ref={setTableRoot}>
				<loading-conclave>
					<span>✦</span>
					<strong>Opening the Conclave…</strong>
				</loading-conclave>
			</summoners-table>
		)
	}

	const myTurn =
		game.phase === "playing" &&
		game.currentPlayerId === myPlayerId &&
		!myPlayer.eliminated
	const opponents = game.players.filter((player) => player.id !== myPlayerId)
	const currentPlayer = game.players.find(
		(player) => player.id === game.currentPlayerId,
	)
	const aiThinking =
		game.phase === "playing" && !myTurn && currentPlayer?.kind === "ai"
	const selectedCardIsPlayable =
		selectedCard !== null &&
		privateView.playableCardIds.includes(selectedCard.physicalId)

	const submitTarget = (target: SummonersTarget): void => {
		const owner = playersById.get(target.playerId)
		if (
			owner === undefined ||
			!targetMatchesSelection(selection, target, myPlayerId, owner)
		) {
			return
		}
		if (selection?.kind === "card") {
			if (tableRoot !== null) {
				capturePendingSummonersCardMotion(tableRoot, selection.cardId)
			}
			socket.emit("playSummonersCard", selection.cardId, target, (result) =>
				handleResult(result, () => setSelection(null)),
			)
		} else if (selection?.kind === "attacker") {
			socket.emit("attackSummoners", selection.cardId, target, (result) =>
				handleResult(result, () => setSelection(null)),
			)
		} else if (selection?.kind === "power") {
			socket.emit("useSummonerPower", target, (result) =>
				handleResult(result, () => setSelection(null)),
			)
		}
	}

	const chooseHandCard = (card: SummonersVisibleCard): void => {
		if (!myTurn || !privateView.playableCardIds.includes(card.physicalId)) {
			return
		}
		if (card.targeting === "none") {
			if (tableRoot !== null) {
				capturePendingSummonersCardMotion(tableRoot, card.physicalId)
			}
			socket.emit("playSummonersCard", card.physicalId, null, handleResult)
			setSelection(null)
			return
		}
		setSelection((current) =>
			current?.kind === "card" && current.cardId === card.physicalId
				? null
				: {
						cardId: card.physicalId,
						kind: "card",
						targeting: card.targeting,
					},
		)
	}

	const cardSelection = (card: SummonersVisibleCard): Selection => ({
		cardId: card.physicalId,
		kind: "card",
		targeting: card.targeting,
	})

	const selectedTargetAtPoint = (
		activeSelection: Selection,
		clientX: number,
		clientY: number,
	): SummonersTarget | undefined => {
		const targetElements = [
			...document.querySelectorAll<HTMLElement>("[data-summoners-target-kind]"),
		].filter((element) => {
			const rect = element.getBoundingClientRect()
			return (
				clientX >= rect.left &&
				clientX <= rect.right &&
				clientY >= rect.top &&
				clientY <= rect.bottom
			)
		})
		const target = summonersTargetFromElements(targetElements)
		if (target !== undefined) {
			const owner = playersById.get(target.playerId)
			return owner !== undefined &&
				targetMatchesSelection(activeSelection, target, myPlayerId, owner)
				? target
				: undefined
		}
		return undefined
	}

	const cardTargetAtPoint = (
		card: SummonersVisibleCard,
		clientX: number,
		clientY: number,
	): SummonersTarget | null | undefined => {
		const target = selectedTargetAtPoint(cardSelection(card), clientX, clientY)
		if (target !== undefined) return target
		if (card.targeting !== "none") return undefined
		const element = document.elementFromPoint(clientX, clientY)
		if (!(element instanceof Element)) return undefined
		if (card.type === "being") {
			return element.closest("player-battlefield") === null ? undefined : null
		}
		return element.closest("conclave-field") === null ? undefined : null
	}

	const finishHandDrag = (
		event: JSX.TargetedPointerEvent<HTMLElement>,
		cancelled = false,
	): void => {
		const origin = pointerOrigin.current
		const drag = handDragRef.current
		if (origin === null || origin.pointerId !== event.pointerId) return
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture?.(event.pointerId)
		}
		pointerOrigin.current = null
		const dragged =
			drag !== null &&
			(drag.dragging ||
				Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8)
		if (!cancelled && dragged && drag !== null) {
			const card = privateView.hand.find(
				(candidate) => candidate.physicalId === drag.cardId,
			)
			if (card !== undefined) {
				const target = cardTargetAtPoint(card, event.clientX, event.clientY)
				if (target !== undefined) {
					if (tableRoot !== null) {
						capturePendingSummonersCardMotion(tableRoot, card.physicalId)
					}
					socket.emit("playSummonersCard", card.physicalId, target, (result) =>
						handleResult(result, () => {
							setSelection(null)
						}),
					)
				}
			}
		}
		setHandDrag(null)
		handDragRef.current = null
		setHoveredHandCardId(null)
		if (cancelled || dragged) setSelection(null)
	}

	const startAttackerDrag = (
		being: SummonersPublicBeing,
		event: JSX.TargetedPointerEvent<HTMLElement>,
	): void => {
		if (!myTurn || !being.ready) return
		suppressBeingClick.current.delete(being.card.physicalId)
		attackerPointerOrigin.current = {
			pointerId: event.pointerId,
			x: event.clientX,
			y: event.clientY,
		}
		event.currentTarget.setPointerCapture?.(event.pointerId)
		const nextDrag = {
			cardId: being.card.physicalId,
			dragging: false,
			x: 0,
			y: 0,
		}
		attackerDragRef.current = nextDrag
		setAttackerDrag(nextDrag)
		setSelection({
			cardId: being.card.physicalId,
			kind: "attacker",
			targeting: "anyEnemy",
		})
	}

	const moveAttackerDrag = (
		event: JSX.TargetedPointerEvent<HTMLElement>,
	): void => {
		const origin = attackerPointerOrigin.current
		const drag = attackerDragRef.current
		if (
			origin === null ||
			drag === null ||
			origin.pointerId !== event.pointerId
		) {
			return
		}
		const x = event.clientX - origin.x
		const y = event.clientY - origin.y
		const dragging = drag.dragging || Math.hypot(x, y) > 8
		const nextDrag = { ...drag, dragging, x, y }
		attackerDragRef.current = nextDrag
		setAttackerDrag(nextDrag)
	}

	const finishAttackerDrag = (
		being: SummonersPublicBeing,
		event: JSX.TargetedPointerEvent<HTMLElement>,
		cancelled = false,
	): void => {
		const origin = attackerPointerOrigin.current
		const drag = attackerDragRef.current
		if (
			origin === null ||
			drag === null ||
			origin.pointerId !== event.pointerId
		) {
			return
		}
		if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
			event.currentTarget.releasePointerCapture?.(event.pointerId)
		}
		const dragged =
			drag.dragging ||
			Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 8
		if (dragged) {
			suppressBeingClick.current.add(being.card.physicalId)
			window.setTimeout(() => {
				suppressBeingClick.current.delete(being.card.physicalId)
			}, 1_000)
		}
		if (!cancelled && dragged) {
			const activeSelection = {
				cardId: being.card.physicalId,
				kind: "attacker",
				targeting: "anyEnemy",
			} satisfies Selection
			const target = selectedTargetAtPoint(
				activeSelection,
				event.clientX,
				event.clientY,
			)
			if (target !== undefined) {
				socket.emit(
					"attackSummoners",
					being.card.physicalId,
					target,
					(result) => handleResult(result, () => setSelection(null)),
				)
			}
		}
		attackerPointerOrigin.current = null
		attackerDragRef.current = null
		setAttackerDrag(null)
		if (cancelled || dragged) setSelection(null)
	}

	const finishActiveAttackerDrag = (
		event: JSX.TargetedPointerEvent<HTMLElement>,
		cancelled = false,
	): void => {
		const cardId = attackerDragRef.current?.cardId
		if (cardId === undefined) return
		const being = myPlayer.battlefield.find(
			(candidate) => candidate.card.physicalId === cardId,
		)
		if (being !== undefined) finishAttackerDrag(being, event, cancelled)
	}

	const chooseOwnBeing = (being: SummonersPublicBeing): void => {
		if (suppressBeingClick.current.delete(being.card.physicalId)) return
		const target = targetForBeing(myPlayerId, being.card.physicalId)
		if (targetMatchesSelection(selection, target, myPlayerId, myPlayer)) {
			submitTarget(target)
			return
		}
		if (!myTurn || !being.ready) return
		setSelection((current) =>
			current?.kind === "attacker" && current.cardId === being.card.physicalId
				? null
				: {
						cardId: being.card.physicalId,
						kind: "attacker",
						targeting: "anyEnemy",
					},
		)
	}

	const choosePower = (): void => {
		if (
			!myTurn ||
			myPlayer.summoner === null ||
			myPlayer.powerUsed ||
			myPlayer.spark < myPlayer.summoner.power.cost
		) {
			return
		}
		const power = myPlayer.summoner.power
		if (power.targeting === "none") {
			socket.emit("useSummonerPower", null, handleResult)
			setSelection(null)
			return
		}
		setSelection((current) =>
			current?.kind === "power"
				? null
				: { kind: "power", targeting: power.targeting },
		)
	}

	if (game.phase === "lobby") {
		return (
			<summoners-table
				className={css.class}
				data-phase="lobby"
				ref={setTableRoot}
			>
				<summoners-header>
					<button type="button" onClick={onLeave} aria-label="Leave table">
						←
					</button>
					<brand-mark>
						<span>✦</span>
						<strong>SUMMONERS</strong>
					</brand-mark>
					<room-code>
						<small>ROOM</small>
						<strong>{game.roomCode}</strong>
					</room-code>
				</summoners-header>
				<SummonersLobby
					game={game}
					myPlayer={myPlayer}
					myPlayerId={myPlayerId}
					onOpenRules={() => setRulesOpen(true)}
					socket={socket}
				/>
				{rulesOpen ? <RulesCodex onClose={() => setRulesOpen(false)} /> : null}
			</summoners-table>
		)
	}

	return (
		<summoners-table
			className={css.class}
			data-my-turn={myTurn || undefined}
			data-phase={game.phase}
			onPointerCancel={(event: JSX.TargetedPointerEvent<HTMLElement>) => {
				finishHandDrag(event, true)
				finishActiveAttackerDrag(event, true)
			}}
			onPointerMove={moveAttackerDrag}
			onPointerUp={(event: JSX.TargetedPointerEvent<HTMLElement>) => {
				finishHandDrag(event)
				finishActiveAttackerDrag(event)
			}}
			ref={setTableRoot}
		>
			<summoners-header>
				<button type="button" onClick={onLeave} aria-label="Leave table">
					←
				</button>
				<brand-mark>
					<span>{myPlayer.summoner?.art ?? "✦"}</span>
					<strong>SUMMONERS</strong>
				</brand-mark>
				<turn-mark>
					<small>TURN {game.turnNumber}</small>
					<strong>
						{game.phase === "gameComplete"
							? "Conclave decided"
							: myTurn
								? "Your invocation"
								: `${game.players.find((player) => player.id === game.currentPlayerId)?.name ?? "Another Summoner"} acts`}
					</strong>
				</turn-mark>
				<room-code>
					<small>ROOM</small>
					<strong>{game.roomCode}</strong>
				</room-code>
				<button
					type="button"
					aria-label="Open rules"
					onClick={() => setRulesOpen(true)}
				>
					?
				</button>
			</summoners-header>

			<conclave-field>
				<opponent-realms data-count={opponents.length}>
					{opponents.map((opponent) => {
						const summonerTarget = targetForSummoner(opponent.id)
						const summonerTargetable = targetMatchesSelection(
							selection,
							summonerTarget,
							myPlayerId,
							opponent,
						)
						return (
							<opponent-realm
								data-current={game.currentPlayerId === opponent.id || undefined}
								data-eliminated={opponent.eliminated || undefined}
								key={opponent.id}
								style={{ "--deck-accent": opponent.deck?.accent }}
							>
								<opponent-summoner
									data-summoners-target-kind="summoner"
									data-summoners-target-player-id={opponent.id}
									data-targetable={summonerTargetable || undefined}
								>
									<button
										type="button"
										disabled={!summonerTargetable}
										onClick={() => submitTarget(summonerTarget)}
									>
										<summoner-sigil>
											{opponent.summoner?.art ?? "○"}
										</summoner-sigil>
										<summoner-name>
											<small>{opponent.summoner?.title ?? "CHOOSING"}</small>
											<strong>
												{opponent.summoner?.name ?? opponent.name}
											</strong>
											<span>{opponent.name}</span>
										</summoner-name>
										<ResourceMarks player={opponent} />
									</button>
								</opponent-summoner>
								<opponent-battlefield>
									{opponent.battlefield.length === 0 ? (
										<empty-field>no Beings</empty-field>
									) : (
										opponent.battlefield.map((being, index) => {
											const target = targetForBeing(
												opponent.id,
												being.card.physicalId,
											)
											const targetable = targetMatchesSelection(
												selection,
												target,
												myPlayerId,
												opponent,
											)
											return (
												<BattlefieldBeing
													being={being}
													disabled={!targetable}
													key={being.card.physicalId}
													onClick={() => submitTarget(target)}
													ownerId={opponent.id}
													selected={false}
													targetable={targetable}
													tooltipSide={
														index >= opponent.battlefield.length / 2
															? "left"
															: "right"
													}
												/>
											)
										})
									)}
								</opponent-battlefield>
								<OpponentHand
									cardIds={opponent.handCardIds}
									playerName={opponent.name}
								/>
							</opponent-realm>
						)
					})}
				</opponent-realms>

				<action-channel
					aria-live="polite"
					data-thinking={aiThinking || undefined}
				>
					<action-copy key={`${game.turnNumber}:${game.statusMessage}`}>
						<small>
							{game.phase === "gameComplete"
								? "CONCLAVE DECIDED"
								: aiThinking
									? "OPPONENT’S INVOCATION"
									: !myTurn
										? "THE TABLE TURNS"
										: selection === null
											? "CONCLAVE"
											: "CHOOSE A TARGET"}
						</small>
						<strong>
							{game.phase === "gameComplete"
								? game.statusMessage
								: aiThinking
									? `${currentPlayer?.name ?? "Luna"} is considering the field…`
									: !myTurn
										? `Awaiting ${currentPlayer?.name ?? "another Summoner"}’s invocation.`
										: selectionInstruction(selection, selectedCard)}
						</strong>
						{game.phase === "gameComplete" ? null : (
							<span>{game.statusMessage}</span>
						)}
					</action-copy>
					{aiThinking ? (
						<thinking-mark aria-label="Luna is thinking">
							<i />
							<i />
							<i />
						</thinking-mark>
					) : null}
					{selection === null ? null : (
						<button type="button" onClick={() => setSelection(null)}>
							Cancel
						</button>
					)}
				</action-channel>

				<player-realm style={{ "--deck-accent": myPlayer.deck?.accent }}>
					<player-summoner
						data-current={myTurn || undefined}
						data-summoners-target-kind="summoner"
						data-summoners-target-player-id={myPlayerId}
						data-targetable={
							targetMatchesSelection(
								selection,
								targetForSummoner(myPlayerId),
								myPlayerId,
								myPlayer,
							) || undefined
						}
					>
						<button
							type="button"
							disabled={
								!targetMatchesSelection(
									selection,
									targetForSummoner(myPlayerId),
									myPlayerId,
									myPlayer,
								)
							}
							onClick={() => submitTarget(targetForSummoner(myPlayerId))}
						>
							<summoner-sigil>{myPlayer.summoner?.art ?? "✦"}</summoner-sigil>
							<summoner-name>
								<small>{myPlayer.summoner?.title}</small>
								<strong>{myPlayer.summoner?.name}</strong>
								<span>{myPlayer.name} · you</span>
							</summoner-name>
							<ResourceMarks cardMotionOrigin player={myPlayer} />
						</button>
						<power-button>
							<button
								type="button"
								aria-pressed={selection?.kind === "power"}
								disabled={
									!myTurn ||
									myPlayer.powerUsed ||
									myPlayer.summoner === null ||
									myPlayer.spark < myPlayer.summoner.power.cost
								}
								onClick={choosePower}
							>
								<small>{myPlayer.summoner?.power.cost ?? 0} ✦ POWER</small>
								<strong>{myPlayer.summoner?.power.name}</strong>
								<span>
									{myPlayer.powerUsed
										? "Used this turn"
										: myPlayer.summoner?.power.rules}
								</span>
							</button>
						</power-button>
					</player-summoner>
					<player-battlefield
						aria-label="Your battlefield"
						data-summoners-dropzone="battlefield"
					>
						{myPlayer.battlefield.length === 0 ? (
							<empty-field>Summon a Being to begin your warband.</empty-field>
						) : (
							myPlayer.battlefield.map((being, index) => {
								const target = targetForBeing(myPlayerId, being.card.physicalId)
								const targetable = targetMatchesSelection(
									selection,
									target,
									myPlayerId,
									myPlayer,
								)
								const selected =
									selection?.kind === "attacker" &&
									selection.cardId === being.card.physicalId
								return (
									<BattlefieldBeing
										being={being}
										drag={
											attackerDrag?.cardId === being.card.physicalId
												? attackerDrag
												: null
										}
										disabled={
											!(
												targetable ||
												(myTurn && being.ready && selection?.kind !== "card")
											)
										}
										key={being.card.physicalId}
										onClick={() => chooseOwnBeing(being)}
										onPointerCancel={(event) =>
											finishAttackerDrag(being, event, true)
										}
										onPointerDown={(event) => startAttackerDrag(being, event)}
										onPointerMove={moveAttackerDrag}
										onPointerUp={(event) => finishAttackerDrag(being, event)}
										ownerId={myPlayerId}
										selected={selected}
										targetable={targetable}
										tooltipSide={
											index >= myPlayer.battlefield.length / 2
												? "left"
												: "right"
										}
									/>
								)
							})
						)}
					</player-battlefield>
				</player-realm>
			</conclave-field>

			<hand-dock>
				<hand-heading>
					<heading-copy>
						<small>YOUR HAND · {privateView.hand.length}/9</small>
						<strong>
							{myTurn ? `${myPlayer.spark} Spark available` : "Study the table"}
						</strong>
					</heading-copy>
					<button
						type="button"
						disabled={!myTurn}
						onClick={() =>
							socket.emit("endSummonersTurn", (result) =>
								handleResult(result, () => setSelection(null)),
							)
						}
					>
						End turn →
					</button>
				</hand-heading>
				<player-hand
					aria-label="Your cards"
					data-card-active={handDrag?.dragging || undefined}
					data-hover-active={hoveredHandCardId !== null || undefined}
				>
					<hand-hit-surface
						aria-hidden="true"
						onPointerCancel={(event: JSX.TargetedPointerEvent<HTMLElement>) =>
							finishHandDrag(event, true)
						}
						onPointerDown={(event: JSX.TargetedPointerEvent<HTMLElement>) => {
							const candidate = summonersHandCardAtPoint(
								summonersHandCardCandidates(event.currentTarget),
								event.clientX,
								event.clientY,
							)
							const cardId = candidate?.dataset.cardId as CardId | undefined
							const card = privateView.hand.find(
								(item) => item.physicalId === cardId,
							)
							if (card === undefined) return
							pointerOrigin.current = {
								pointerId: event.pointerId,
								x: event.clientX,
								y: event.clientY,
							}
							event.currentTarget.setPointerCapture?.(event.pointerId)
							setSelection(cardSelection(card))
							setHoveredHandCardId(card.physicalId)
							const nextDrag = {
								cardId: card.physicalId,
								dragging: false,
								x: 0,
								y: 0,
							}
							handDragRef.current = nextDrag
							setHandDrag(nextDrag)
						}}
						onPointerLeave={() => {
							if (pointerOrigin.current === null) {
								setHoveredHandCardId(null)
							}
						}}
						onPointerMove={(event: JSX.TargetedPointerEvent<HTMLElement>) => {
							const origin = pointerOrigin.current
							if (origin === null) {
								const candidate = closestSummonersHandCard(
									summonersHandCardCandidates(event.currentTarget),
									event.clientX,
								)
								setHoveredHandCardId(
									(candidate?.dataset.cardId as CardId | undefined) ?? null,
								)
								return
							}
							const drag = handDragRef.current
							if (origin.pointerId !== event.pointerId || drag === null) {
								return
							}
							const x = event.clientX - origin.x
							const y = event.clientY - origin.y
							const dragging = drag.dragging || Math.hypot(x, y) > 8
							const nextDrag = { ...drag, dragging, x, y }
							handDragRef.current = nextDrag
							setHandDrag(nextDrag)
							if (dragging) setHoveredHandCardId(null)
						}}
						onPointerUp={(event: JSX.TargetedPointerEvent<HTMLElement>) =>
							finishHandDrag(event)
						}
					/>
					{privateView.hand.map((card, index) => {
						const layout = summonersHandCardLayout(
							privateView.hand.length,
							index,
						)
						return (
							<summoners-hand-card
								data-disabled={
									!myTurn ||
									!privateView.playableCardIds.includes(card.physicalId) ||
									undefined
								}
								data-dragging={
									handDrag?.cardId === card.physicalId && handDrag.dragging
										? true
										: undefined
								}
								data-card-id={card.physicalId}
								data-hand-angle={layout.angle}
								data-hovered={
									hoveredHandCardId === card.physicalId || undefined
								}
								key={card.physicalId}
								style={{
									"--drag-x": `${handDrag?.cardId === card.physicalId ? handDrag.x : 0}px`,
									"--drag-y": `${handDrag?.cardId === card.physicalId ? handDrag.y : 0}px`,
									"--fan-index": index,
									"--hand-angle": `${layout.angle}deg`,
									left: `${layout.left}%`,
									transform: `translateX(-50%) translateY(${layout.rise}px) rotate(${layout.angle}deg)`,
								}}
							>
								<SummonersCard
									card={card}
									disabled={
										!myTurn ||
										!privateView.playableCardIds.includes(card.physicalId)
									}
									onClick={() => chooseHandCard(card)}
									selected={
										selection?.kind === "card" &&
										selection.cardId === card.physicalId &&
										selectedCardIsPlayable
									}
									tooltipSide={
										index >= privateView.hand.length / 2 ? "left" : "right"
									}
								/>
							</summoners-hand-card>
						)
					})}
				</player-hand>
			</hand-dock>

			{game.phase === "gameComplete" ? (
				<victory-shroud role="dialog" aria-modal="true">
					<victory-panel>
						<small>THE CONCLAVE IS DECIDED</small>
						<strong>
							{game.winnerIds.includes(myPlayerId)
								? "You stand last"
								: `${game.players.find((player) => game.winnerIds.includes(player.id))?.name ?? "No Summoner"} prevails`}
						</strong>
						<p>{game.statusMessage}</p>
						{game.hostId === myPlayerId ? (
							<button
								type="button"
								onClick={() => socket.emit("restartGame", handleResult)}
							>
								Gather another Conclave
							</button>
						) : (
							<span>Waiting for the host.</span>
						)}
					</victory-panel>
				</victory-shroud>
			) : null}
			{rulesOpen ? <RulesCodex onClose={() => setRulesOpen(false)} /> : null}
		</summoners-table>
	)
}
