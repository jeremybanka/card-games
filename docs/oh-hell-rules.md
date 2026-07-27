# Oh Hell! first-release rules

Wayfarer supports three or four seats. A game is five rounds with hands of
5, 4, 3, 2, then 1 card, making a complete browser game practical while still
exercising changing hand sizes.

- The dealer rotates clockwise each round. The player left of the dealer bids
  first and leads the first trick.
- One card after the deal is turned face up to establish trump. The first
  release schedule always leaves a remainder.
- Bids are ordered from 0 through the hand size. The dealer bids last and may
  not make the total of all bids equal the number of available tricks.
- Players must follow the led suit when able. Trump beats non-trump; otherwise
  the highest card of the led suit wins. The trick winner leads next.
- Making a bid exactly scores 10 plus the bid. Missing scores one point for
  every trick actually won.
- After five rounds, the highest cumulative score wins. Equal high scores are
  shared winners.

The room's game choice is immutable. All bids, public trick cards, trump,
trick counts, and scores are public. Hands remain private valued projections;
opponent hands expose opaque physical IDs only. The same 52 physical IDs live
for the room lifetime, while the seeded deal stream remaps values every round.
