# Oh Hell! table rules

Each Oh Hell table has a public, server-authoritative rule set. The host can
configure it in the lobby; the rules and derived hand schedule are fixed when
the first round is dealt. Every client sees the selected rules, while saved
profiles remain private to the browser that owns them in `localStorage`.

## Standard Pagat default

The default follows [Pagat's standard Oh Hell description](https://www.pagat.com/exact/ohhell.html):

- Three to five players begin with 10 cards, six with 8, and seven with 7.
  Hands descend to 1 and then ascend to the starting size. For 8–12 players,
  Wayfarer uses the same valley shape with a practical, deck-safe start of 6
  cards or `floor(52 / players)`, whichever is lower.
- The player left of the dealer bids first and leads the first trick. The
  dealer bids last and may not make the total bids equal the available tricks
  (the “hook” or hot seat).
- Players must follow the led suit when able. Trump beats non-trump; otherwise
  the highest card of the led suit wins. Trump may be led immediately; Pagat
  lists requiring trump to be broken as a variation.
- Making a bid exactly scores 10 plus the bid. A missed bid scores zero. The
  optional pittance variation instead gives one point per trick on a miss.

## Configurable variations

The lobby supports independent switches for trump breaking, hot-seat bidding,
and pittance scoring. A schedule can be:

- flat, with a hand size and round count;
- ascending or descending between configured endpoints;
- valley (descending then ascending); or
- mountain (ascending then descending).

The turning round in a valley or mountain is played once. A maximum can use
Pagat's automatic recommendation or an explicit value. The server rejects any
schedule that would require more than the available 52-card deck for the
number of seated players. Tables support 3–12 players.

Alongside Standard Pagat, the built-in “Family valley 8–1” profile plays
8–7–…–1–…–7–8, requires trump to be broken, uses hot-seat bidding, and gives no
pittance points. Custom profiles can be named, updated, and deleted locally.

The room's game choice is immutable. All bids, public trick cards, trump,
rules, trick counts, and scores are public. Hands remain private valued
projections; opponent hands expose opaque physical IDs only. The same 52
physical IDs live for the room lifetime, while the seeded deal stream remaps
values every round.
