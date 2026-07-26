import { setState } from "atom.io"
import { useO } from "atom.io/react"
import { myUserKeyAtom } from "atom.io/realtime-client"
import { usePullAtom } from "atom.io/realtime-react"
import type { JSX, VNode } from "preact"
import { useEffect, useMemo, useRef, useState } from "preact/hooks"

import {
	DEFAULT_AI_MODEL_ID,
	isAiModelId,
	OPENAI_HEARTS_MODELS,
} from "./ai/ai-models.ts"
import { AiStrategyReview } from "./AiStrategyReview.tsx"
import {
	advanceCardGesture,
	compactHandCardLayout,
	draggedCardTransform,
	dragTranslationFromPointer,
	handCardLayout,
	passSelectionAfterDrop,
	readableCardHorizontalCorrection,
} from "./card-hand-layout.ts"
import { capturePendingCardMotion, useCardMotion } from "./card-motion.ts"
import { actionErrorAtom } from "./client-state.ts"
import { DeckRemainder } from "./DeckRemainder.tsx"
import {
	capturedTrickCount,
	completedTrickKey,
	shouldAutoDismissTrickReview,
} from "./game-presentation.ts"
import type { GameSocket } from "./game-socket.ts"
import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "./game/hearts-state.ts"
import type {
	ActionResult,
	AiStrategyReview as AiStrategyReviewData,
	CardId,
	PassDirection,
	PlayerId,
	PrivatePlayerView,
	PublicGameView,
	PublicPlayerView,
	Suit,
	VisibleCard,
} from "./game/hearts-types.ts"
import css from "./GameTable.module.css"
import { GameTransitions } from "./GameTransitions.tsx"
import { PlayerAvatar } from "./PlayerAvatar.tsx"
import { PlayerNameplate } from "./PlayerNameplate.tsx"
import { ScorecardLockup } from "./ScorecardLockup.tsx"

type GameTableProps = {
	onLeave: () => void
	socket: GameSocket
}

type DragState = {
	cardId: CardId
	phase: "dragging" | "pending" | "picking"
	x: number
	y: number
}

type HoveredCard = {
	cardId: CardId
	horizontalOffset: number
}

function hoveredCardFromElement(
	cardId: CardId,
	element: HTMLElement,
): HoveredCard {
	const handCard = element.closest<HTMLElement>("hand-card")
	const restingRect = (handCard ?? element).getBoundingClientRect()
	const cardRect = element.getBoundingClientRect()
	const cardWidth = element.offsetWidth || cardRect.width || restingRect.width
	const cardHeight =
		element.offsetHeight || cardRect.height || restingRect.height
	const angle = Number(handCard?.dataset.handAngle ?? 0)
	const counterRotationCorrection =
		(cardHeight / 2) * Math.sin((angle * Math.PI) / 180)
	const viewportWidth =
		document.documentElement.clientWidth || window.innerWidth
	return {
		cardId,
		horizontalOffset:
			counterRotationCorrection +
			readableCardHorizontalCorrection(
				restingRect.left + restingRect.width / 2,
				cardWidth,
				viewportWidth,
			),
	}
}

function suitMark(suit: Suit): string {
	switch (suit) {
		case "clubs":
			return "♣"
		case "diamonds":
			return "♦"
		case "spades":
			return "♠"
		case "hearts":
			return "♥"
	}
}

function rankMark(rank: VisibleCard["rank"]): string {
	switch (rank) {
		case 11:
			return "J"
		case 12:
			return "Q"
		case 13:
			return "K"
		case 14:
			return "A"
		default:
			return String(rank)
	}
}

function passLabel(direction: PassDirection): string {
	switch (direction) {
		case "left":
			return "Pass left"
		case "right":
			return "Pass right"
		case "across":
			return "Pass across"
		case "hold":
			return "Hold"
	}
}

function handleResult(result: ActionResult): void {
	setState(actionErrorAtom, result.ok ? null : result.error)
}

function PlayingCard({
	card,
	compact = false,
	dealIndex,
	dealRound,
	disabled = false,
	dragState,
	gestureOwner = false,
	handAngle = 0,
	onDragEnd,
	onDragMove,
	onDragCancel,
	onDragStart,
	onHoverChange,
	onSelect,
	hoverOffset,
	selected = false,
}: {
	card: VisibleCard
	compact?: boolean
	dealIndex?: number
	dealRound?: number
	disabled?: boolean
	dragState: DragState | null
	gestureOwner?: boolean
	handAngle?: number
	onDragEnd: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onDragMove: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onDragCancel: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onDragStart: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onHoverChange?: (hovered: boolean, element: HTMLButtonElement) => void
	onSelect: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void
	hoverOffset?:
		| {
				angle: number
				horizontalOffset: number
				rise: number
		  }
		| undefined
	selected?: boolean
}): VNode {
	const isRed = card.suit === "diamonds" || card.suit === "hearts"
	const ownedDragState =
		gestureOwner && dragState?.cardId === card.id ? dragState : null
	const gesturePhase = ownedDragState?.phase
	return (
		<playing-card
			data-card-id={card.id}
			data-card-face="up"
			data-compact={compact || undefined}
			data-deal-index={dealIndex}
			data-deal-round={dealRound}
			data-dragging={
				gesturePhase === "dragging" || gesturePhase === "pending" || undefined
			}
			data-play-pending={gesturePhase === "pending" || undefined}
			data-picking={gesturePhase === "picking" || undefined}
			data-red={isRed || undefined}
			data-hovered={hoverOffset !== undefined || undefined}
			data-selected={selected || undefined}
			style={
				ownedDragState !== null && ownedDragState.phase !== "picking"
					? {
							transform: draggedCardTransform(handAngle, ownedDragState),
						}
					: hoverOffset === undefined
						? undefined
						: {
								"--hand-angle": `${hoverOffset.angle}deg`,
								"--hover-delta-x": `${hoverOffset.horizontalOffset}px`,
								"--hover-delta-y": `calc(var(--hand-card-width) * -0.82 - ${hoverOffset.rise}px)`,
							}
			}
		>
			<button
				type="button"
				aria-label={`${rankMark(card.rank)} of ${card.suit}`}
				aria-pressed={selected}
				disabled={disabled}
				onClick={onSelect}
				onPointerEnter={(event) => onHoverChange?.(true, event.currentTarget)}
				onPointerLeave={(event) => onHoverChange?.(false, event.currentTarget)}
				onPointerCancel={onDragCancel}
				onPointerDown={onDragStart}
				onPointerMove={onDragMove}
				onPointerUp={onDragEnd}
			>
				<card-corner>
					<strong>{rankMark(card.rank)}</strong>
					<span>{suitMark(card.suit)}</span>
				</card-corner>
				<card-suit aria-hidden="true">{suitMark(card.suit)}</card-suit>
			</button>
		</playing-card>
	)
}

function TakenStack({
	cardIds,
	hiddenCardIds,
	label,
	playerCount,
	points,
}: {
	cardIds: CardId[]
	hiddenCardIds: ReadonlySet<CardId>
	label: string
	playerCount: number
	points: number
}): VNode {
	const visibleCardIds = cardIds.filter((cardId) => !hiddenCardIds.has(cardId))
	const trickCount = capturedTrickCount(cardIds.length, playerCount)
	return (
		<taken-stack aria-label={`${label}: ${cardIds.length} cards`}>
			<stack-cards>
				{visibleCardIds.map((cardId, index) => (
					<card-back
						data-card-id={cardId}
						data-card-face="down"
						key={cardId}
						style={{
							transform: `translate(${Math.min(index, 10) * 1.4}px, ${Math.min(index, 10) * -0.7}px)`,
						}}
					/>
				))}
			</stack-cards>
			<ScorecardLockup points={points} tricks={trickCount} />
		</taken-stack>
	)
}

function OpponentZone({
	current,
	dealRound,
	hiddenCardIds,
	player,
	playerCount,
	seatIndex,
}: {
	current: boolean
	dealRound: number
	hiddenCardIds: ReadonlySet<CardId>
	player: PublicPlayerView
	playerCount: number
	seatIndex: number
}): VNode {
	return (
		<opponent-zone
			data-current={current || undefined}
			data-disconnected={!player.connected || undefined}
		>
			<opponent-heading>
				<PlayerNameplate
					player={player}
					seatIndex={seatIndex}
					surface="opponent"
				/>
			</opponent-heading>
			<opponent-hand
				aria-label={`${player.handCardIds.length} cards in ${player.name}'s hand`}
			>
				<hand-cards aria-hidden="true">
					{player.handCardIds.map((cardId, index) => {
						const layout = compactHandCardLayout(
							player.handCardIds.length,
							index,
						)
						return (
							<card-back
								data-card-id={cardId}
								data-card-face="down"
								data-deal-index={index * playerCount + seatIndex}
								data-deal-round={dealRound}
								key={cardId}
								style={{
									left: `clamp(calc(var(--opponent-card-width) / 2 + 0.4rem), ${layout.left}%, calc(100% - var(--opponent-card-width) / 2 - 0.4rem))`,
									transform: `translateX(-50%) translateY(${layout.rise}px) rotate(${layout.angle}deg)`,
								}}
							/>
						)
					})}
				</hand-cards>
				<output aria-label={`${player.handCardIds.length} cards`}>
					{player.handCardIds.length}
				</output>
			</opponent-hand>
			<TakenStack
				cardIds={player.capturedCardIds}
				hiddenCardIds={hiddenCardIds}
				label={`${player.name}'s captured cards`}
				playerCount={playerCount}
				points={player.score}
			/>
		</opponent-zone>
	)
}

function TrickCenter({
	dragState,
	game,
	myPlayerId,
	onPlay,
	selectedCard,
}: {
	dragState: DragState | null
	game: PublicGameView
	myPlayerId: PlayerId
	onPlay: (cardId: CardId) => void
	selectedCard: CardId | null
}): VNode {
	const myIndex = game.players.findIndex((player) => player.id === myPlayerId)
	return (
		<trick-center>
			<DeckRemainder cardIds={game.deckCardIds} />
			<trick-heading>
				<strong>
					{game.currentPlayerId === myPlayerId
						? "Your play"
						: game.statusMessage}
				</strong>
				<span>
					Trick {Math.min(game.trickNumber + 1, 26)}
					{game.heartsBroken ? " · hearts broken" : ""}
				</span>
			</trick-heading>
			<trick-slots>
				{game.players.map((player, index) => {
					const relativeIndex =
						(index - myIndex + game.players.length) % game.players.length
					const angle =
						Math.PI / 2 + (relativeIndex / game.players.length) * Math.PI * 2
					const left = 50 - Math.cos(angle) * 33
					const top = 50 + Math.sin(angle) * 34
					const play = game.currentTrick.find(
						(candidate) => candidate.playerId === player.id,
					)
					const isCurrent = game.currentPlayerId === player.id
					return (
						<trick-slot
							data-current={isCurrent || undefined}
							data-filled={play !== undefined || undefined}
							data-local={player.id === myPlayerId || undefined}
							key={player.id}
							style={
								player.id === myPlayerId
									? { bottom: "2.5rem", left: "50%" }
									: { left: `${left}%`, top: `${top}%` }
							}
						>
							<trick-avatar>
								<PlayerAvatar
									name={player.name}
									seatIndex={index}
									size="small"
								/>
							</trick-avatar>
							{play === undefined ? (
								<>
									<small>{isCurrent ? "play" : "open"}</small>
								</>
							) : (
								<PlayingCard
									card={play.card}
									compact
									disabled
									dragState={dragState}
									onDragEnd={() => {}}
									onDragMove={() => {}}
									onDragCancel={() => {}}
									onDragStart={() => {}}
									onSelect={() => {}}
								/>
							)}
						</trick-slot>
					)
				})}
			</trick-slots>
			<button
				type="button"
				disabled={selectedCard === null || game.currentPlayerId !== myPlayerId}
				onClick={() => {
					if (selectedCard !== null) onPlay(selectedCard)
				}}
			>
				{selectedCard === null ? "Drag a card here" : "Play selected card"}
			</button>
		</trick-center>
	)
}

function ScoreSheet({
	game,
	myPlayerId,
	socket,
}: {
	game: PublicGameView
	myPlayerId: PlayerId
	socket: GameSocket
}): VNode {
	const [strategyReview, setStrategyReview] =
		useState<AiStrategyReviewData | null>(null)
	const [reviewError, setReviewError] = useState<string | null>(null)
	const [reviewingAiId, setReviewingAiId] = useState<PlayerId | null>(null)
	const reviewRequestId = useRef(0)

	const requestStrategyReview = (player: PublicPlayerView): void => {
		const requestId = ++reviewRequestId.current
		setReviewError(null)
		setReviewingAiId(player.id)
		socket.emit("requestAiStrategyReview", player.id, (result) => {
			if (requestId !== reviewRequestId.current) return
			setReviewingAiId(null)
			if (result.ok) {
				setStrategyReview(result.review)
			} else {
				setReviewError(result.error)
			}
		})
	}

	return (
		<score-sheet>
			<score-heading>
				<small>
					{game.phase === "gameComplete" ? "GAME COMPLETE" : "ROUND COMPLETE"}
				</small>
				<h2>
					{game.phase === "gameComplete"
						? game.winnerIds.includes(myPlayerId)
							? "You win"
							: `${
									game.players.find((player) =>
										game.winnerIds.includes(player.id),
									)?.name ?? "The low score"
								} wins`
						: "Scores"}
				</h2>
			</score-heading>
			<ol>
				{[...game.players]
					.sort((left, right) => left.score - right.score)
					.map((player) => (
						<li
							data-reviewable={player.kind === "ai" || undefined}
							key={player.id}
						>
							<score-identity>
								{player.kind === "ai" ? (
									<button
										type="button"
										aria-label={`Review ${player.name}'s strategy`}
										aria-pressed={
											strategyReview?.playerId === player.id || undefined
										}
										onClick={() => requestStrategyReview(player)}
									>
										<PlayerNameplate
											player={player}
											seatIndex={game.players.findIndex(
												(candidate) => candidate.id === player.id,
											)}
											surface="score"
										/>
										<small>
											{reviewingAiId === player.id
												? "Loading…"
												: "View strategy"}
										</small>
									</button>
								) : (
									<PlayerNameplate
										player={player}
										seatIndex={game.players.findIndex(
											(candidate) => candidate.id === player.id,
										)}
										surface="score"
									/>
								)}
							</score-identity>
							<small>+{player.roundPoints}</small>
							<strong>{player.score}</strong>
						</li>
					))}
			</ol>
			{reviewError === null ? null : <p role="alert">{reviewError}</p>}
			{game.hostId === myPlayerId ? (
				<button
					type="button"
					onClick={() => {
						socket.emit(
							game.phase === "gameComplete" ? "restartGame" : "startNextRound",
							handleResult,
						)
					}}
				>
					{game.phase === "gameComplete" ? "New game" : "Deal next round"}
				</button>
			) : (
				<p>Waiting for the host.</p>
			)}
			{strategyReview === null ? null : (
				<AiStrategyReview
					onClose={() => setStrategyReview(null)}
					review={strategyReview}
				/>
			)}
		</score-sheet>
	)
}

function PlayerZone({
	dealRound,
	dragState,
	game,
	hiddenCardIds,
	myPlayer,
	onDragCancel,
	onDragEnd,
	onDragMove,
	onDragStart,
	onHoverCard,
	onSelectCard,
	onSubmitPass,
	passSelection,
	privateView,
	hoveredCard,
	selectedCard,
	playerCount,
	seatIndex,
}: {
	dealRound: number
	dragState: DragState | null
	game: PublicGameView
	hiddenCardIds: ReadonlySet<CardId>
	myPlayer: PublicPlayerView
	onDragCancel: (
		card: VisibleCard,
		event: JSX.TargetedPointerEvent<HTMLButtonElement>,
	) => void
	onDragEnd: (
		card: VisibleCard,
		event: JSX.TargetedPointerEvent<HTMLButtonElement>,
	) => void
	onDragMove: (
		card: VisibleCard,
		event: JSX.TargetedPointerEvent<HTMLButtonElement>,
	) => void
	onDragStart: (
		card: VisibleCard,
		event: JSX.TargetedPointerEvent<HTMLButtonElement>,
	) => void
	onHoverCard: (cardId: CardId | null, element?: HTMLElement) => void
	onSelectCard: (cardId: CardId, keyboard: boolean) => void
	onSubmitPass: () => void
	passSelection: CardId[]
	privateView: PrivatePlayerView
	hoveredCard: HoveredCard | null
	selectedCard: CardId | null
	playerCount: number
	seatIndex: number
}): VNode {
	const playable = new Set(privateView.playableCardIds)
	const passing = game.phase === "passing"
	const passCards = passSelection
		.map((cardId) => privateView.cards.find((card) => card.id === cardId))
		.filter((card): card is VisibleCard => card !== undefined)
	const handCards = passing
		? privateView.cards.filter((card) => !passSelection.includes(card.id))
		: privateView.cards
	return (
		<player-zone
			data-current={game.currentPlayerId === myPlayer.id || undefined}
		>
			<player-heading>
				<PlayerNameplate
					detail={
						myPlayer.roundPoints > 0
							? `+${myPlayer.roundPoints} this round`
							: undefined
					}
					player={myPlayer}
					seatIndex={game.players.findIndex(
						(candidate) => candidate.id === myPlayer.id,
					)}
				/>
			</player-heading>
			<TakenStack
				cardIds={myPlayer.capturedCardIds}
				hiddenCardIds={hiddenCardIds}
				label="Your captured cards"
				playerCount={playerCount}
				points={myPlayer.score}
			/>
			{passing ? (
				<pass-zone
					aria-label={`Cards to pass: ${passCards.length} of 3`}
					data-dropzone="pass"
					data-ready={passCards.length === 3 || undefined}
				>
					<pass-heading>
						<strong>
							{privateView.passSubmitted
								? "Cards ready"
								: `${passCards.length} of 3 to pass`}
						</strong>
						<span>
							{privateView.passSubmitted
								? "Waiting for the other players."
								: "Drag cards here. Drag them back to your hand to remove."}
						</span>
						<button
							type="button"
							disabled={passCards.length !== 3 || privateView.passSubmitted}
							onClick={onSubmitPass}
						>
							{passLabel(game.passDirection)}
						</button>
					</pass-heading>
					<pass-cards aria-label={`${passCards.length} cards to pass`}>
						{passCards.map((card, index) => (
							<pass-card
								data-card-id={card.id}
								key={card.id}
								style={{ zIndex: 100 + index }}
							>
								<PlayingCard
									card={card}
									dealRound={dealRound}
									disabled={privateView.passSubmitted}
									dragState={dragState}
									gestureOwner
									onDragCancel={(event) => onDragCancel(card, event)}
									onDragEnd={(event) => onDragEnd(card, event)}
									onDragMove={(event) => onDragMove(card, event)}
									onDragStart={(event) => onDragStart(card, event)}
									onSelect={(event) =>
										onSelectCard(card.id, event.detail === 0)
									}
									selected
								/>
							</pass-card>
						))}
					</pass-cards>
				</pass-zone>
			) : null}
			<player-hand
				aria-label={`Your hand: ${handCards.length} cards`}
				data-hover-active={
					handCards.some((card) => hoveredCard?.cardId === card.id) || undefined
				}
			>
				{handCards.map((card, index) => {
					const selected = selectedCard === card.id
					const layout = handCardLayout(handCards.length, index)
					const hovered =
						hoveredCard?.cardId === card.id &&
						(passing || playable.has(card.id))
					return (
						<hand-card
							key={card.id}
							data-card-id={card.id}
							data-disabled={!(passing || playable.has(card.id)) || undefined}
							data-hand-angle={layout.angle}
							data-selected={selected || undefined}
							style={{
								left: `${layout.left}%`,
								transform: `translateX(-50%) translateY(${layout.rise}px) rotate(${layout.angle}deg)`,
								zIndex: hovered ? 250 : index,
							}}
						>
							<PlayingCard
								card={card}
								dealIndex={
									privateView.cards.findIndex(
										(candidate) => candidate.id === card.id,
									) *
										playerCount +
									seatIndex
								}
								dealRound={dealRound}
								disabled={!(passing || playable.has(card.id))}
								dragState={dragState}
								gestureOwner
								handAngle={layout.angle}
								onDragCancel={(event) => onDragCancel(card, event)}
								onDragEnd={(event) => onDragEnd(card, event)}
								onDragMove={(event) => onDragMove(card, event)}
								onDragStart={(event) => onDragStart(card, event)}
								onHoverChange={(hovered, element) =>
									onHoverCard(hovered ? card.id : null, element)
								}
								onSelect={(event) => onSelectCard(card.id, event.detail === 0)}
								hoverOffset={
									!hovered
										? undefined
										: {
												angle: layout.angle,
												horizontalOffset: hoveredCard.horizontalOffset,
												rise: layout.rise,
											}
								}
								selected={selected}
							/>
						</hand-card>
					)
				})}
				<output aria-label={`${handCards.length} cards in your hand`}>
					{handCards.length}
				</output>
			</player-hand>
		</player-zone>
	)
}

export function GameTable({ onLeave, socket }: GameTableProps): VNode {
	const game = usePullAtom(publicGameViewAtom)
	const privateView = usePullAtom(privatePlayerViewAtom)
	const myUserKey = usePullAtom(myUserKeyAtom) as PlayerId | null
	const actionError = useO(actionErrorAtom)
	const [selectedCard, setSelectedCard] = useState<CardId | null>(null)
	const [hoveredCard, setHoveredCard] = useState<HoveredCard | null>(null)
	const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL_ID)
	const [passSelection, setPassSelection] = useState<CardId[]>([])
	const [dragState, setDragState] = useState<DragState | null>(null)
	const [dismissedTrickKey, setDismissedTrickKey] = useState<string | null>(
		null,
	)
	const [tableRoot, setTableRoot] = useState<HTMLElement | null>(null)
	const pointerOrigin = useRef<{
		pointerId: number
		x: number
		y: number
	} | null>(null)
	const draggingCardId = useRef<CardId | null>(null)
	const dragOriginZone = useRef<"hand" | "pass">("hand")
	const dragPhase = useRef<"dragging" | "picking">("picking")
	const dragCommit = useRef<{
		angle: number
		baseX: number
		baseY: number
		pointerX: number
		pointerY: number
	} | null>(null)
	const dragMoved = useRef(false)
	const suppressClick = useRef(false)
	const pendingCardFocus = useRef<CardId | null>(null)
	const pendingPlay = useRef<{
		cardId: CardId
		requestId: number
		timeout: number
	} | null>(null)
	const nextPlayRequestId = useRef(0)

	useCardMotion(tableRoot)

	const latestCompletedTrick = game.completedTricks.at(-1) ?? null
	const latestTrickKey = completedTrickKey(game)
	const shouldAutoDismissReview =
		myUserKey !== null &&
		latestCompletedTrick !== null &&
		shouldAutoDismissTrickReview(game, myUserKey, latestCompletedTrick)
	const trickReview =
		latestTrickKey !== null &&
		latestTrickKey !== dismissedTrickKey &&
		!shouldAutoDismissReview
			? latestCompletedTrick
			: null
	const hiddenReviewCardIds = useMemo(
		() => new Set<CardId>(trickReview?.plays.map((play) => play.card.id) ?? []),
		[trickReview],
	)

	useEffect(() => {
		if (shouldAutoDismissReview && latestTrickKey !== null) {
			setDismissedTrickKey(latestTrickKey)
		}
	}, [latestTrickKey, shouldAutoDismissReview])

	useEffect(() => {
		setPassSelection([])
		setSelectedCard(null)
	}, [game.phase, game.roundNumber])

	useEffect(() => {
		const cardId = pendingCardFocus.current
		if (cardId === null || tableRoot === null) return
		const card = Array.from(
			tableRoot.querySelectorAll<HTMLElement>("playing-card[data-card-id]"),
		).find((candidate) => candidate.dataset.cardId === cardId)
		card?.querySelector<HTMLButtonElement>("button")?.focus()
		pendingCardFocus.current = null
	}, [passSelection, tableRoot])

	const myPlayer = game.players.find((player) => player.id === myUserKey)
	const opponents = useMemo(() => {
		if (myUserKey === null) return game.players
		const index = game.players.findIndex((player) => player.id === myUserKey)
		return index === -1
			? game.players
			: [...game.players.slice(index + 1), ...game.players.slice(0, index)]
	}, [game.players, myUserKey])

	const clearPendingPlay = (requestId: number): void => {
		if (pendingPlay.current?.requestId !== requestId) return
		window.clearTimeout(pendingPlay.current.timeout)
		pendingPlay.current = null
		setDragState(null)
	}

	useEffect(() => {
		const clearDisconnectedPlay = (): void => {
			const pending = pendingPlay.current
			if (pending === null) return
			clearPendingPlay(pending.requestId)
		}
		socket.on("disconnect", clearDisconnectedPlay)
		return () => {
			socket.off("disconnect", clearDisconnectedPlay)
			const pending = pendingPlay.current
			if (pending !== null) window.clearTimeout(pending.timeout)
		}
	}, [socket])

	useEffect(() => {
		const pending = pendingPlay.current
		if (
			pending !== null &&
			!privateView.cards.some((card) => card.id === pending.cardId)
		) {
			clearPendingPlay(pending.requestId)
		}
	}, [privateView.cards])

	const playCard = (cardId: CardId, fromDrag = false): void => {
		if (!privateView.playableCardIds.includes(cardId)) return
		if (pendingPlay.current !== null) return
		const requestId = ++nextPlayRequestId.current
		if (fromDrag) {
			const timeout = window.setTimeout(() => {
				if (pendingPlay.current?.requestId !== requestId) return
				setState(actionErrorAtom, "The play timed out. Please try again.")
				clearPendingPlay(requestId)
			}, 10_000)
			pendingPlay.current = { cardId, requestId, timeout }
		}
		socket.emit("playCard", cardId, (result) => {
			if (fromDrag && pendingPlay.current?.requestId !== requestId) return
			handleResult(result)
			if (result.ok) setSelectedCard(null)
			if (fromDrag && !result.ok) clearPendingPlay(requestId)
		})
	}

	const selectCard = (cardId: CardId, keyboard: boolean): void => {
		if (game.phase === "passing") {
			if (privateView.passSubmitted || !keyboard) return
			pendingCardFocus.current = cardId
			setPassSelection((current) => {
				const inPassZone = current.includes(cardId)
				return passSelectionAfterDrop(
					current,
					cardId,
					inPassZone ? "pass" : "hand",
					inPassZone ? "hand" : "pass",
				)
			})
			return
		}
		if (!privateView.playableCardIds.includes(cardId)) return
		setSelectedCard(selectedCard === cardId ? null : cardId)
	}

	if (game.roomCode === "" || myUserKey === null || myPlayer === undefined) {
		return (
			<game-table className={css.class} data-loading>
				<loading-table>
					<span />
					<strong>Taking your seat…</strong>
				</loading-table>
			</game-table>
		)
	}

	return (
		<game-table
			className={css.class}
			data-card-gesture={dragState?.phase}
			data-card-round={game.roundNumber}
			ref={setTableRoot}
		>
			<table-header>
				<button type="button" onClick={onLeave} aria-label="Leave table">
					←
				</button>
				<room-mark>
					<small>ROOM</small>
					<strong>{game.roomCode}</strong>
				</room-mark>
				<round-mark>
					<small>
						{game.phase === "lobby" ? "TABLE" : `ROUND ${game.roundNumber}`}
					</small>
					<strong>
						{game.phase === "passing"
							? passLabel(game.passDirection)
							: game.heartsBroken
								? "♥ broken"
								: "♥ whole"}
					</strong>
				</round-mark>
			</table-header>

			<opponents-row data-count={opponents.length}>
				{opponents.map((player) => (
					<OpponentZone
						current={game.currentPlayerId === player.id}
						dealRound={game.roundNumber}
						hiddenCardIds={hiddenReviewCardIds}
						key={player.id}
						player={player}
						playerCount={game.players.length}
						seatIndex={game.players.findIndex(
							(candidate) => candidate.id === player.id,
						)}
					/>
				))}
			</opponents-row>

			<table-center
				data-drag-active={
					game.phase === "playing" && dragState?.phase === "dragging"
						? true
						: undefined
				}
				data-dropzone={game.phase === "playing" ? "trick" : undefined}
			>
				{game.phase === "lobby" ? (
					<waiting-room>
						<small>PASS THE CODE</small>
						<h2>{game.roomCode}</h2>
						<p>{game.players.length} of 4 players seated</p>
						<seated-list>
							{game.players.map((player) => (
								<seat-pill
									key={player.id}
									data-connected={player.connected || undefined}
								>
									<PlayerNameplate
										detail={
											player.aiModel === null ? undefined : player.aiModel
										}
										player={player}
										seatIndex={game.players.findIndex(
											(candidate) => candidate.id === player.id,
										)}
										surface="lobby"
									/>
									{player.kind === "ai" ? (
										<>
											{game.hostId === myUserKey ? (
												<button
													type="button"
													aria-label={`Remove ${player.name}`}
													onClick={() => {
														socket.emit("removeAiSeat", player.id, handleResult)
													}}
												>
													×
												</button>
											) : null}
										</>
									) : null}
								</seat-pill>
							))}
						</seated-list>
						{game.hostId === myUserKey ? (
							<>
								{game.players.length < 4 ? (
									<ai-seat-controls>
										<label>
											<span>OpenAI opponent</span>
											<select
												value={selectedAiModel}
												onInput={(event) => {
													const modelId = event.currentTarget.value
													if (isAiModelId(modelId)) {
														setSelectedAiModel(modelId)
													}
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
											onClick={() => {
												socket.emit(
													"assignAiSeat",
													selectedAiModel,
													handleResult,
												)
											}}
										>
											Fill AI seat
										</button>
									</ai-seat-controls>
								) : null}
								<button
									type="button"
									disabled={game.players.length < 2}
									onClick={() => {
										socket.emit("startGame", handleResult)
									}}
								>
									Deal the cards
								</button>
							</>
						) : (
							<p>Waiting for the host to deal.</p>
						)}
					</waiting-room>
				) : (
					<TrickCenter
						dragState={dragState}
						game={game}
						myPlayerId={myUserKey}
						onPlay={playCard}
						selectedCard={selectedCard}
					/>
				)}
			</table-center>

			<PlayerZone
				dealRound={game.roundNumber}
				dragState={dragState}
				game={game}
				hiddenCardIds={hiddenReviewCardIds}
				hoveredCard={hoveredCard}
				myPlayer={myPlayer}
				onDragCancel={(_card, event) => {
					if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
						event.currentTarget.releasePointerCapture?.(event.pointerId)
					}
					setDragState(null)
					pointerOrigin.current = null
					draggingCardId.current = null
					dragOriginZone.current = "hand"
					dragPhase.current = "picking"
					dragCommit.current = null
					dragMoved.current = false
					setHoveredCard(null)
				}}
				onDragStart={(card, event) => {
					const canPick =
						game.phase === "passing"
							? !privateView.passSubmitted
							: privateView.playableCardIds.includes(card.id)
					if (!canPick) return
					pointerOrigin.current = {
						pointerId: event.pointerId,
						x: event.clientX,
						y: event.clientY,
					}
					draggingCardId.current = card.id
					dragOriginZone.current =
						event.currentTarget.closest("pass-zone") === null ? "hand" : "pass"
					setHoveredCard(
						dragOriginZone.current === "hand"
							? hoveredCardFromElement(card.id, event.currentTarget)
							: null,
					)
					dragPhase.current = "picking"
					dragCommit.current = null
					dragMoved.current = false
					event.currentTarget.setPointerCapture?.(event.pointerId)
					setDragState({
						cardId: card.id,
						phase: "picking",
						x: 0,
						y: 0,
					})
				}}
				onHoverCard={(cardId, element) => {
					setHoveredCard(
						cardId === null || element === undefined
							? null
							: hoveredCardFromElement(cardId, element),
					)
				}}
				onDragMove={(_card, event) => {
					if (pointerOrigin.current === null) {
						return
					}
					const x = event.clientX - pointerOrigin.current.x
					const y = event.clientY - pointerOrigin.current.y
					const moved = Math.hypot(x, y) > 8
					if (!moved) return
					dragMoved.current = true
					if (dragOriginZone.current === "pass") {
						setHoveredCard(null)
						draggingCardId.current = _card.id
						dragPhase.current = "dragging"
						setDragState({
							cardId: _card.id,
							phase: "dragging",
							x,
							y,
						})
						return
					}
					const hand = event.currentTarget.closest("player-hand")
					const candidates = Array.from(
						hand?.querySelectorAll<HTMLElement>(
							"hand-card:not([data-disabled])",
						) ?? [],
					)
					const activeCardId = draggingCardId.current
					if (activeCardId === null) return
					const closest = candidates.reduce<{
						cardId: CardId
						distance: number
					} | null>((nearest, candidate) => {
						const cardId = candidate.dataset.cardId as CardId | undefined
						if (cardId === undefined) return nearest
						const rect = candidate.getBoundingClientRect()
						const centerX = rect.left + rect.width / 2
						const distance = Math.abs(centerX - event.clientX)
						return nearest === null || distance < nearest.distance
							? { cardId, distance }
							: nearest
					}, null)
					if (closest === null) return
					const gesture = advanceCardGesture(
						{ cardId: activeCardId, phase: dragPhase.current },
						closest.cardId,
						{ x, y },
					)
					const activeCandidate = candidates.find(
						(candidate) => candidate.dataset.cardId === gesture.cardId,
					)
					if (activeCandidate === undefined) return
					if (gesture.phase === "dragging" && dragCommit.current === null) {
						const activeCard =
							activeCandidate.querySelector<HTMLElement>("playing-card")
						const matrix = new DOMMatrixReadOnly(
							activeCard === null
								? undefined
								: getComputedStyle(activeCard).transform,
						)
						dragCommit.current = {
							angle: Number(activeCandidate.dataset.handAngle ?? 0),
							baseX: matrix.m41,
							baseY: matrix.m42,
							pointerX: event.clientX,
							pointerY: event.clientY,
						}
					}
					const commit = dragCommit.current
					const translation =
						gesture.phase === "dragging" && commit !== null
							? dragTranslationFromPointer(
									commit.angle,
									{ x: commit.baseX, y: commit.baseY },
									{
										x: event.clientX - commit.pointerX,
										y: event.clientY - commit.pointerY,
									},
								)
							: { x: 0, y: 0 }
					draggingCardId.current = gesture.cardId
					dragPhase.current = gesture.phase
					const hoveredElement =
						activeCandidate.querySelector<HTMLElement>("button")
					setHoveredCard(
						gesture.phase === "picking" && hoveredElement !== null
							? hoveredCardFromElement(gesture.cardId, hoveredElement)
							: null,
					)
					setDragState({
						cardId: gesture.cardId,
						phase: gesture.phase,
						x: gesture.phase === "dragging" ? translation.x : 0,
						y: gesture.phase === "dragging" ? translation.y : 0,
					})
				}}
				onDragEnd={(_card, event) => {
					const cardId = draggingCardId.current
					const origin = pointerOrigin.current
					if (origin === null) return
					const moved = dragMoved.current
					const trickRect = document
						.querySelector("table-center[data-dropzone='trick']")
						?.getBoundingClientRect()
					const releasedOverTable =
						trickRect !== undefined &&
						event.clientX >= trickRect.left &&
						event.clientX <= trickRect.right &&
						event.clientY >= trickRect.top &&
						event.clientY <= trickRect.bottom
					const shouldPlay =
						game.phase === "playing" &&
						dragPhase.current === "dragging" &&
						releasedOverTable
					const passZone = document.querySelector("pass-zone")
					const passRect = passZone?.getBoundingClientRect()
					const releasedOverPass =
						passRect !== undefined &&
						event.clientX >= passRect.left &&
						event.clientX <= passRect.right &&
						event.clientY >= passRect.top &&
						event.clientY <= passRect.bottom
					const handRect = document
						.querySelector("player-hand")
						?.getBoundingClientRect()
					const releasedOverHand =
						handRect !== undefined &&
						event.clientX >= handRect.left &&
						event.clientX <= handRect.right &&
						event.clientY >= handRect.top &&
						event.clientY <= handRect.bottom
					const originZone = dragOriginZone.current
					const committedDrag = dragPhase.current === "dragging"
					if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
						event.currentTarget.releasePointerCapture?.(event.pointerId)
					}
					pointerOrigin.current = null
					draggingCardId.current = null
					dragOriginZone.current = "hand"
					dragPhase.current = "picking"
					dragCommit.current = null
					dragMoved.current = false
					setHoveredCard(null)
					if (moved) {
						suppressClick.current = true
						window.setTimeout(() => {
							suppressClick.current = false
						}, 0)
					}
					if (cardId === null || !moved) {
						setDragState(null)
						return
					}
					if (shouldPlay) {
						if (tableRoot !== null) {
							capturePendingCardMotion(tableRoot, cardId)
						}
						setDragState((current) =>
							current?.cardId === cardId
								? { ...current, phase: "pending" }
								: current,
						)
						playCard(cardId, true)
					} else if (game.phase === "passing" && committedDrag) {
						const destination = releasedOverPass
							? "pass"
							: releasedOverHand
								? "hand"
								: null
						const destinationIndex =
							destination === "pass"
								? Array.from(
										passZone?.querySelectorAll<HTMLElement>("pass-card") ?? [],
									).filter((candidate) => {
										if (candidate.dataset.cardId === cardId) return false
										const rect = candidate.getBoundingClientRect()
										return rect.left + rect.width / 2 < event.clientX
									}).length
								: undefined
						setPassSelection((current) =>
							passSelectionAfterDrop(
								current,
								cardId,
								originZone,
								destination,
								destinationIndex,
							),
						)
						setDragState(null)
					} else {
						setDragState(null)
					}
				}}
				onSelectCard={(cardId, keyboard) => {
					if (suppressClick.current) return
					selectCard(cardId, keyboard)
				}}
				onSubmitPass={() => {
					socket.emit("passCards", passSelection, (result) => {
						handleResult(result)
					})
				}}
				passSelection={passSelection}
				privateView={privateView}
				selectedCard={selectedCard}
				playerCount={game.players.length}
				seatIndex={game.players.findIndex(
					(candidate) => candidate.id === myPlayer.id,
				)}
			/>

			<GameTransitions
				awardedLeftoverCard={privateView.awardedLeftoverCard ?? null}
				game={game}
				myPlayerId={myUserKey}
				onDismissTrick={() => {
					if (latestTrickKey !== null) {
						setDismissedTrickKey(latestTrickKey)
					}
				}}
				review={trickReview}
			/>

			{actionError === null ? null : (
				<action-toast role="alert">
					<span>{actionError}</span>
					<button
						type="button"
						onClick={() => setState(actionErrorAtom, null)}
						aria-label="Dismiss error"
					>
						×
					</button>
				</action-toast>
			)}

			{game.phase === "roundComplete" || game.phase === "gameComplete" ? (
				<ScoreSheet game={game} myPlayerId={myUserKey} socket={socket} />
			) : null}
		</game-table>
	)
}
