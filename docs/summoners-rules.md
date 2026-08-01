# Summoners

> First edition · starter-deck format · 2–4 players

Summoners is a multiplayer Living Card Game about adorable, suspicious
magicians calling strange Beings from a frontier where elemental craft,
government folklore, and bodily mutation are difficult to separate.

Each player chooses one complete 24-card starter deck and its face-up Summoner.
There is no deck construction in this first edition. Deckbuilding can arrive
after the starter environment has proved that its resource, combat, and
multiplayer rules are sound.

## Winning

Each Summoner begins with **24 life**. When a Summoner reaches 0 life, they are
unbound and leave the match. The last Summoner standing wins.

## Setup

1. Seat two to four players and choose starter decks. Players may choose the
   same deck.
2. Shuffle each 24-card deck and draw five cards.
3. The host takes the first turn with 1 maximum Spark. They do not draw an
   additional card on that first turn.

Hands hold at most nine cards. If a draw would exceed that limit, discard the
drawn card. A player may control at most five Beings.

## Turns and Spark

At the start of your turn:

1. Increase your maximum Spark by 1, to a limit of 10.
2. Refill your Spark to that maximum.
3. Ready all your Beings.
4. Draw one card.

Then play cards, use your Summoner power, and attack in any order. End the turn
when finished. Unspent Spark disappears.

Some effects place **growth counters** on Beings. Each growth counter gives its
Being +1 Attack and +1 Energy while it remains on the battlefield.

If you draw from an empty deck, take fatigue damage instead: 1 for the first
failed draw, 2 for the next, then 3, and so on.

## Card types

- **Being:** enters the battlefield weary and cannot attack that turn unless it
  has Rush. Damage on a Being persists. A Being is spent and discarded when its
  damage equals or exceeds its Energy.
- **Item:** equips one friendly Being. Its Attack, Energy, and keywords are
  added to that Being. Each Being holds one Item; equipping another discards
  the old one.
- **Spell:** resolves its rules and is discarded.

Every card costs Spark. Cards and powers with a target must choose a legal
character before they resolve.

## Combat

A ready Being may attack one enemy Being or Summoner. It becomes weary. Two
Beings in combat deal their Attack to one another simultaneously. A Being that
attacks a Summoner deals its Attack to that Summoner.

In a multiplayer match, each attack chooses one opponent. Guard applies only to
the chosen opponent's battlefield.

### Keywords

- **Guard:** while a player controls a Guard, enemies attacking that player
  must choose one of their Guards.
- **Rush:** this Being enters ready and may attack immediately.
- **Leech:** after this Being deals combat damage, restore that much life to its
  Summoner, up to 24.
- **Blaze:** the first time each turn this Being's Summoner spends their last
  Spark, ready this Being.
- **Breakthrough:** when this Being attacks another Being, excess combat damage
  is dealt to the defending Being's Summoner.
- **Current:** the first time each turn this Being's Summoner draws a card
  outside the start-of-turn draw, ready this Being.
- **Molt:** the first time each turn this Being survives combat with another
  Being, it gets +1 Attack while it remains on the battlefield.
- **Rooted:** at the end of its Summoner's turn, if this Being is ready and
  damaged, restore 2 Energy to it.
- **Tend:** once each turn, this ready Being may become weary to put a growth
  counter on another friendly Being.

## Summoner powers

Each Summoner has a face-up power. It costs Spark and can be used once during
each of that player's turns.

## Starter decks

### Ember Reliquary

**Pip, Last Lamplighter** · Fire and Iron

An aggressive deck of Rush and Blaze Beings, direct damage, and hot equipment.
Blaze rewards sequencing attacks before spending the final Spark. Pip's
**Pocket Ember** costs 2 Spark and deals 1 damage to any enemy.

### Verdant Compact

**Brindle, Mossmother** · Leaf, Wood, and Slime

Verdant's small Tenders invest their attacks into permanent growth, unlocking
Guard and Breakthrough thresholds on larger Beings. Its spells can concentrate,
protect, or harvest that investment. Brindle's **Tender Growth** costs 2 Spark,
puts a growth counter on a friendly Being, and restores 1 Energy to it.

### Tidemark Menagerie

**Nix of the Blue Mile** · Water, Ice, and Air

Card draw, efficient Beings, and effects that return enemy Beings to hand.
Current turns the first bonus draw into a second attack. Nix's **Read the
Current** costs 2 Spark and draws a card.

### Outland Chorus

**Vesper, Many-Eyed** · Ether and Bone

Leech, self-damage, mutation, and stolen tempo. Molt rewards choosing combats
that its changing Beings can survive. Vesper's **Private Thought** costs 2
Spark, deals 1 damage to an enemy Summoner, and restores 1 life.

The canonical deck lists and card text live in
`src/summoners/summoners-cards.ts`; every starter contains 24 physical cards.
