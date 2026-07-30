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

## Summoner powers

Each Summoner has a face-up power. It costs Spark and can be used once during
each of that player's turns.

## Starter decks

### Ember Reliquary

**Pip, Last Lamplighter** · Fire and Iron

An aggressive deck of Rush Beings, direct damage, and hot equipment. Pip's
**Pocket Ember** costs 2 Spark and deals 1 damage to any enemy.

### Verdant Compact

**Brindle, Mossmother** · Leaf, Wood, and Slime

Durable Beings, Guard, healing, and permanent growth. Brindle's **Tender
Growth** costs 2 Spark and restores 2 life to a friendly character.

### Tidemark Menagerie

**Nix of the Blue Mile** · Water, Ice, and Air

Card draw, efficient Beings, and effects that return enemy Beings to hand.
Nix's **Read the Current** costs 2 Spark and draws a card.

### Outland Chorus

**Vesper, Many-Eyed** · Ether and Bone

Leech, self-damage, mutation, and stolen tempo. Vesper's **Private Thought**
costs 2 Spark, deals 1 damage to an enemy Summoner, and restores 1 life.

The canonical deck lists and card text live in
`src/summoners/summoners-cards.ts`; every starter contains 24 physical cards.
