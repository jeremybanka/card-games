import { setState } from "atom.io"
import { myUserKeyAtom } from "atom.io/realtime-client"
import { usePullAtom } from "atom.io/realtime-react"
import type { VNode } from "preact"
import { useEffect, useMemo, useState } from "preact/hooks"

import { actionErrorAtom } from "./client-state.ts"
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
	selected = false,
}: {
	card: SummonersVisibleCard
	compact?: boolean
	disabled?: boolean
	onClick: () => void
	selected?: boolean
}): VNode {
	return (
		<summoners-card
			data-card-id={card.physicalId}
			data-compact={compact || undefined}
			data-element={card.element}
			data-selected={selected || undefined}
			data-type={card.type}
		>
			<button
				type="button"
				aria-label={`${card.name}, ${card.cost} Spark, ${card.rules}`}
				aria-pressed={selected}
				disabled={disabled}
				onClick={onClick}
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
							<strong aria-label={`${card.attack ?? 0} Attack`}>
								{card.attack ?? 0}
							</strong>
							<strong aria-label={`${card.energy ?? 0} Energy`}>
								{card.energy ?? 0}
							</strong>
						</card-combat>
					) : card.type === "item" ? (
						<card-combat>
							<strong aria-label={`${card.attack ?? 0} Attack bonus`}>
								+{card.attack ?? 0}
							</strong>
							<strong aria-label={`${card.energy ?? 0} Energy bonus`}>
								+{card.energy ?? 0}
							</strong>
						</card-combat>
					) : null}
				</card-frame>
			</button>
		</summoners-card>
	)
}

function BattlefieldBeing({
	being,
	disabled,
	onClick,
	selected,
	targetable,
}: {
	being: SummonersPublicBeing
	disabled: boolean
	onClick: () => void
	selected: boolean
	targetable: boolean
}): VNode {
	return (
		<battlefield-being
			data-ready={being.ready || undefined}
			data-selected={selected || undefined}
			data-targetable={targetable || undefined}
		>
			<SummonersCard
				card={being.card}
				compact
				disabled={disabled}
				onClick={onClick}
				selected={selected}
			/>
			<being-state>
				<being-attack aria-label={`${being.attack} Attack`}>
					{being.attack}
				</being-attack>
				<being-energy
					aria-label={`${being.energy - being.damage} of ${being.energy} Energy`}
				>
					{being.energy - being.damage}/{being.energy}
				</being-energy>
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
							<small>{player.deck?.name ?? "Choosing…"}</small>
						</li>
					))}
				</ol>
				{game.hostId === myPlayerId ? (
					<button
						type="button"
						disabled={!readyToStart}
						onClick={() => socket.emit("startGame", handleResult)}
					>
						Begin the Conclave
					</button>
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
	const [rulesOpen, setRulesOpen] = useState(false)
	const [tableRoot, setTableRoot] = useState<HTMLElement | null>(null)

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

	const chooseOwnBeing = (being: SummonersPublicBeing): void => {
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
										opponent.battlefield.map((being) => {
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
													selected={false}
													targetable={targetable}
												/>
											)
										})
									)}
								</opponent-battlefield>
							</opponent-realm>
						)
					})}
				</opponent-realms>

				<action-channel aria-live="polite">
					<action-copy>
						<small>
							{game.phase === "gameComplete"
								? "CONCLAVE DECIDED"
								: selection === null
									? "CONCLAVE"
									: "CHOOSE A TARGET"}
						</small>
						<strong>
							{game.phase === "gameComplete"
								? game.statusMessage
								: selectionInstruction(selection, selectedCard)}
						</strong>
						{game.phase === "gameComplete" ? null : (
							<span>{game.statusMessage}</span>
						)}
					</action-copy>
					{selection === null ? null : (
						<button type="button" onClick={() => setSelection(null)}>
							Cancel
						</button>
					)}
				</action-channel>

				<player-realm style={{ "--deck-accent": myPlayer.deck?.accent }}>
					<player-summoner
						data-current={myTurn || undefined}
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
					<player-battlefield aria-label="Your battlefield">
						{myPlayer.battlefield.length === 0 ? (
							<empty-field>Summon a Being to begin your warband.</empty-field>
						) : (
							myPlayer.battlefield.map((being) => {
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
										disabled={
											!(
												targetable ||
												(myTurn && being.ready && selection?.kind !== "card")
											)
										}
										key={being.card.physicalId}
										onClick={() => chooseOwnBeing(being)}
										selected={selected}
										targetable={targetable}
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
				<player-hand aria-label="Your cards">
					{privateView.hand.map((card, index) => {
						const layout = summonersHandCardLayout(
							privateView.hand.length,
							index,
						)
						return (
							<summoners-hand-card
								data-card-id={card.physicalId}
								data-hand-angle={layout.angle}
								key={card.physicalId}
								style={{
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
