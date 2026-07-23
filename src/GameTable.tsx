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
import { actionErrorAtom } from "./client-state.ts"
import { gameSocket } from "./game-socket.ts"
import {
	privatePlayerViewAtom,
	publicGameViewAtom,
} from "./game/hearts-state.ts"
import type {
	ActionResult,
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

type GameTableProps = {
	onLeave: () => void
}

type DragState = {
	cardId: CardId
	moved: boolean
	x: number
	y: number
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
	disabled = false,
	dragState,
	onDragEnd,
	onDragMove,
	onDragStart,
	onSelect,
	selected = false,
}: {
	card: VisibleCard
	compact?: boolean
	disabled?: boolean
	dragState: DragState | null
	onDragEnd: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onDragMove: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onDragStart: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void
	onSelect: () => void
	selected?: boolean
}): VNode {
	const isRed = card.suit === "diamonds" || card.suit === "hearts"
	const isDragging = dragState?.cardId === card.id
	return (
		<playing-card
			data-card-id={card.id}
			data-compact={compact || undefined}
			data-dragging={isDragging || undefined}
			data-red={isRed || undefined}
			data-selected={selected || undefined}
			style={
				isDragging
					? {
							transform: `translate3d(${dragState.x}px, ${dragState.y}px, 0) rotate(0deg)`,
						}
					: undefined
			}
		>
			<button
				type="button"
				aria-label={`${rankMark(card.rank)} of ${card.suit}`}
				aria-pressed={selected}
				disabled={disabled}
				onClick={onSelect}
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
	label,
}: {
	cardIds: CardId[]
	label: string
}): VNode {
	return (
		<taken-stack aria-label={`${label}: ${cardIds.length} cards`}>
			<stack-cards>
				{cardIds.map((cardId, index) => (
					<card-back
						data-card-id={cardId}
						key={cardId}
						style={{
							transform: `translate(${Math.min(index, 10) * 1.4}px, ${Math.min(index, 10) * -0.7}px)`,
						}}
					/>
				))}
			</stack-cards>
			<span>{Math.floor(cardIds.length / 2)} tricks</span>
		</taken-stack>
	)
}

function OpponentZone({
	current,
	player,
}: {
	current: boolean
	player: PublicPlayerView
}): VNode {
	return (
		<opponent-zone
			data-current={current || undefined}
			data-disconnected={!player.connected || undefined}
		>
			<opponent-heading>
				<strong>
					{player.name}
					{player.kind === "ai" ? " · AI" : ""}
				</strong>
				<span>{player.score} pts</span>
			</opponent-heading>
			<opponent-hand
				aria-label={`${player.handCardIds.length} cards in ${player.name}'s hand`}
			>
				{player.handCardIds.map((cardId, index) => (
					<card-back
						data-card-id={cardId}
						key={cardId}
						style={{
							transform: `translateX(${Math.min(index, 12) * 2.4}px) rotate(${(index - (player.handCardIds.length - 1) / 2) * 0.45}deg)`,
						}}
					/>
				))}
				<output>{player.handCardIds.length}</output>
			</opponent-hand>
			<TakenStack
				cardIds={player.capturedCardIds}
				label={`${player.name}'s captured cards`}
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
		<trick-center data-dropzone="trick">
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
							key={player.id}
							style={{ left: `${left}%`, top: `${top}%` }}
						>
							{play === undefined ? (
								<>
									<span>{player.name.slice(0, 1).toUpperCase()}</span>
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
}: {
	game: PublicGameView
	myPlayerId: PlayerId
}): VNode {
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
						<li key={player.id}>
							<span>{player.name}</span>
							<small>+{player.roundPoints}</small>
							<strong>{player.score}</strong>
						</li>
					))}
			</ol>
			{game.hostId === myPlayerId ? (
				<button
					type="button"
					onClick={() => {
						gameSocket.emit(
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
		</score-sheet>
	)
}

function PlayerZone({
	dragState,
	game,
	myPlayer,
	onDragEnd,
	onDragMove,
	onDragStart,
	onSelectCard,
	passSelection,
	privateView,
	selectedCard,
}: {
	dragState: DragState | null
	game: PublicGameView
	myPlayer: PublicPlayerView
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
	onSelectCard: (cardId: CardId) => void
	passSelection: CardId[]
	privateView: PrivatePlayerView
	selectedCard: CardId | null
}): VNode {
	const playable = new Set(privateView.playableCardIds)
	const passing = game.phase === "passing"
	return (
		<player-zone
			data-current={game.currentPlayerId === myPlayer.id || undefined}
		>
			<player-heading>
				<strong>{myPlayer.name}</strong>
				<span>
					{myPlayer.score} pts
					{myPlayer.roundPoints > 0 ? ` · +${myPlayer.roundPoints}` : ""}
				</span>
			</player-heading>
			<TakenStack
				cardIds={myPlayer.capturedCardIds}
				label="Your captured cards"
			/>
			<player-hand aria-label={`Your hand: ${privateView.cards.length} cards`}>
				{privateView.cards.map((card, index) => {
					const middle = (privateView.cards.length - 1) / 2
					const selected =
						selectedCard === card.id || passSelection.includes(card.id)
					const fanAngle =
						(index - middle) *
						Math.min(3.2, 31 / Math.max(privateView.cards.length, 1))
					const fanRise = Math.abs(index - middle) * 1.2
					return (
						<hand-card
							key={card.id}
							data-disabled={!(passing || playable.has(card.id)) || undefined}
							style={{
								transform: `translateY(${selected ? -18 : fanRise}px) rotate(${fanAngle}deg)`,
								zIndex: selected ? 100 : index,
							}}
						>
							<PlayingCard
								card={card}
								disabled={!(passing || playable.has(card.id))}
								dragState={dragState}
								onDragEnd={(event) => onDragEnd(card, event)}
								onDragMove={(event) => onDragMove(card, event)}
								onDragStart={(event) => onDragStart(card, event)}
								onSelect={() => onSelectCard(card.id)}
								selected={selected}
							/>
						</hand-card>
					)
				})}
			</player-hand>
		</player-zone>
	)
}

export function GameTable({ onLeave }: GameTableProps): VNode {
	const game = usePullAtom(publicGameViewAtom)
	const privateView = usePullAtom(privatePlayerViewAtom)
	const myUserKey = usePullAtom(myUserKeyAtom) as PlayerId | null
	const actionError = useO(actionErrorAtom)
	const [selectedCard, setSelectedCard] = useState<CardId | null>(null)
	const [selectedAiModel, setSelectedAiModel] = useState(DEFAULT_AI_MODEL_ID)
	const [passSelection, setPassSelection] = useState<CardId[]>([])
	const [dragState, setDragState] = useState<DragState | null>(null)
	const pointerOrigin = useRef<{
		x: number
		y: number
	} | null>(null)
	const draggingCardId = useRef<CardId | null>(null)
	const dragMoved = useRef(false)

	useEffect(() => {
		setPassSelection([])
		setSelectedCard(null)
	}, [game.phase, game.roundNumber])

	const myPlayer = game.players.find((player) => player.id === myUserKey)
	const opponents = useMemo(() => {
		if (myUserKey === null) return game.players
		const index = game.players.findIndex((player) => player.id === myUserKey)
		return index === -1
			? game.players
			: [...game.players.slice(index + 1), ...game.players.slice(0, index)]
	}, [game.players, myUserKey])

	const playCard = (cardId: CardId): void => {
		if (!privateView.playableCardIds.includes(cardId)) return
		gameSocket.emit("playCard", cardId, (result) => {
			handleResult(result)
			if (result.ok) setSelectedCard(null)
		})
	}

	const selectCard = (cardId: CardId): void => {
		if (game.phase === "passing") {
			if (privateView.passSubmitted) return
			setPassSelection((current) =>
				current.includes(cardId)
					? current.filter((candidate) => candidate !== cardId)
					: current.length < 3
						? [...current, cardId]
						: current,
			)
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
		<game-table className={css.class}>
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
						key={player.id}
						player={player}
					/>
				))}
			</opponents-row>

			<table-center>
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
									<span>{player.name}</span>
									{player.kind === "ai" ? (
										<>
											<small>{player.aiModel}</small>
											{game.hostId === myUserKey ? (
												<button
													type="button"
													aria-label={`Remove ${player.name}`}
													onClick={() => {
														gameSocket.emit(
															"removeAiSeat",
															player.id,
															handleResult,
														)
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
												gameSocket.emit(
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
										gameSocket.emit("startGame", handleResult)
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

			{game.phase === "passing" ? (
				<pass-banner>
					<strong>
						{privateView.passSubmitted
							? "Cards ready"
							: `${passSelection.length} of 3 selected`}
					</strong>
					<span>
						{privateView.passSubmitted
							? "Waiting for the other players."
							: "Tap three cards, then pass."}
					</span>
					<button
						type="button"
						disabled={passSelection.length !== 3 || privateView.passSubmitted}
						onClick={() => {
							gameSocket.emit("passCards", passSelection, (result) => {
								handleResult(result)
								if (result.ok) setPassSelection([])
							})
						}}
					>
						{passLabel(game.passDirection)}
					</button>
				</pass-banner>
			) : null}

			<PlayerZone
				dragState={dragState}
				game={game}
				myPlayer={myPlayer}
				onDragStart={(card, event) => {
					if (!privateView.playableCardIds.includes(card.id)) return
					pointerOrigin.current = { x: event.clientX, y: event.clientY }
					draggingCardId.current = card.id
					dragMoved.current = false
				}}
				onDragMove={(card, event) => {
					if (
						draggingCardId.current !== card.id ||
						pointerOrigin.current === null
					) {
						return
					}
					const x = event.clientX - pointerOrigin.current.x
					const y = event.clientY - pointerOrigin.current.y
					const moved = Math.hypot(x, y) > 8
					if (!moved) return
					dragMoved.current = true
					if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
						event.currentTarget.setPointerCapture(event.pointerId)
					}
					setDragState({
						cardId: card.id,
						moved: true,
						x,
						y,
					})
				}}
				onDragEnd={(card, event) => {
					if (draggingCardId.current !== card.id) return
					const dropTarget = document
						.elementFromPoint(event.clientX, event.clientY)
						?.closest("trick-center")
					const shouldPlay = dragMoved.current && dropTarget !== null
					setDragState(null)
					pointerOrigin.current = null
					draggingCardId.current = null
					dragMoved.current = false
					if (shouldPlay) playCard(card.id)
				}}
				onSelectCard={selectCard}
				passSelection={passSelection}
				privateView={privateView}
				selectedCard={selectedCard}
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
				<ScoreSheet game={game} myPlayerId={myUserKey} />
			) : null}
		</game-table>
	)
}
