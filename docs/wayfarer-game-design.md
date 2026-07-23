# Wayfarer

> Status: concept draft\
> Purpose: establish a shared vocabulary, record the game's design pillars, and
> identify the smallest playable ruleset.

Wayfarer is a card-based tabletop roleplaying game about strange, ambitious
travelers exploring a suspicious world of cute critters, elemental chemistry,
frontier politics, and dangerous magic.

Players build characters from cards rather than character sheets. The same
character system supports two styles of play:

- cooperative adventures led by a Game Master;
- competitive arena matches between player characters.

The game takes inspiration from Powered by the Apocalypse games, particularly
their fiction-first actions, consequential outcomes, and rules attached to
character playbooks. Its card play adds deck construction, resource conversion,
and an elemental reaction system.

This document distinguishes established concepts from **working proposals**.
Working proposals are scaffolding for discussion and play testing, not settled
rules.

## Design pillars

### Your character is your kit

A character is assembled from a small set of visible cards and a shuffled action
deck. Advancement changes both what the character can do and the probabilities
of what they can do next.

### Every card is a choice and a resource

An action in hand may be performed, or it may be discarded to prove the
energetic requirement of a different action. Strong cards therefore have an
opportunity cost even when the character can afford them.

### Elements behave like a chemistry

Elements are more than damage types or color-coded costs. They are reagents in
timed reactions that transform the state of characters, objects, and places.
Learning useful interactions—and creating the conditions for them—is a central
form of mastery.

### Fiction and rules push each other

Cards authorize concrete changes to the fiction, while fictional positioning
determines when those cards apply, what they can target, and what consequences
follow. Skills may add rules or inline actions, called acts, to a character.

### Power makes you strange

Wayfarers are unusually persistent, adventurous, and hungry for power. Their
behavior makes ordinary people wary of them. Mechanical advancement should
create social and bodily consequences as well as new capabilities.

### One rules language, two modes

Adventure and arena play use the same characters, card types, proving rules,
energy, targeting, and elemental reactions. Mode-specific procedures may frame
those rules differently, but a card should not need two unrelated
interpretations.

## Intended experience

Players should regularly face questions like:

- Do I spend this useful card to prove a more urgent action?
- Can I turn the elements already present in the scene into an advantage?
- Is gaining this strange power worth what it will do to my body and reputation?
- Can I convince the locals that I am a harmless traveler?
- How long can I keep this body, item, or plan functioning?
- What unintended reaction have we just set in motion?

The tone combines adventurous play, tactical cleverness, cozy creature design,
body horror, political suspicion, and a knowing critique of player-character
behavior.

## Character anatomy

Every player character consists of four parts.

| Part           | Function                                                     | Visibility                             |
| -------------- | ------------------------------------------------------------ | -------------------------------------- |
| Character card | Defines the being the player inhabits and its core identity  | Face up                                |
| Action deck    | Contains shuffled spells, moves, and other actions           | Draw pile; hand private by default     |
| Equipment set  | Contains carried or equipped items                           | Face up unless a rule conceals an item |
| Skill set      | Contains passive rules, acts, permissions, and modifications | Face up                                |

### Character card

A Character card is a specialized Being designed to be composed with a player's
action deck, equipment set, and skill set. It should define at least:

- the character's name and illustration;
- its core energy capacity;
- any innate elements, traits, or rules;
- any character-specific setup;
- its level value in stars, if it contributes to the build limit.

### Action deck

The action deck contains spells, physical moves, social maneuvers, and other
moment-to-moment actions. It is shuffled and drawn during play.

The number of cards in the action deck is the character's **level**. A character
with ten action cards is level 10.

This means advancement has an unusual tension:

- adding a card increases the character's level and breadth;
- adding a card also makes any specific draw less reliable;
- the total star limit prevents every new card from being exceptionally
  powerful.

The intended starting level for an adventure is 5–10.

### Equipment set

The equipment set contains Item cards that the character carries, wears, or
wields. Items have core energy and may provide actions, elements, reactions,
protection, storage, or rules.

**Working proposal:** distinguish between _carried_ and _equipped_ items. A
character may carry several items but has a limited number of ready equipment
positions. This makes changing equipment a meaningful action without requiring
an inventory simulation.

### Skill set

Skills remain in play and modify the character. A Skill may:

- grant a passive benefit;
- add an act;
- change how an existing action works;
- change what may prove an energetic requirement;
- grant permission to do something otherwise unavailable;
- create an exception to a core rule.

Skills are the primary place for character-defining rules such as:

> You may use Fire as Fierce while proving an action.

or:

> When you prove Fierce, reveal the top three cards of your action deck. You may
> use revealed cards as well as cards from your hand. Discard those used and
> return the rest in their original order.

## Card types

### Action

A shuffled, drawn spell, move, maneuver, or other discrete action. An Action
normally has:

- a title;
- one or more elemental values;
- a proving requirement, if any;
- timing;
- targets or range;
- rules text and outcome;
- a star value;
- traits or tags.

### Skill

A persistent passive rule, act, permission, or modification that forms part of
a character's build.

### Being

A living entity in the world, including creatures and non-player characters. A
Being has core energy and may have elements, reactions, actions, conditions, and
behavior.

### Character

A player-facing Being intended to be combined with the rest of a player's kit.

### Item

A physical object, including equipment. An Item has core energy and may be
damaged, repaired, transformed, carried, equipped, or used as a reagent.

### Condition

A persistent state such as _Confused_ or _Bleeding_. A Condition states:

- what it attaches to;
- its mechanical and fictional effect;
- whether it stacks;
- how it is removed;
- any elemental value or reaction behavior it contributes.

**Working proposal:** use cards for consequential conditions that change the
rules, and tokens or markers for simple quantities. This preserves the
importance of a Condition card without requiring a unique card for every minor
fact in the fiction.

### Energy

An Energy card is tucked behind a Being or Item to display its remaining core
energy. Energy tokens in different denominations may be used when cards are too
cumbersome.

Energy is currently used in two related but distinct senses:

- **core energy** is the remaining capacity of a Being or Item;
- **elemental value** is the amount and kind of energy printed on an Action or
  otherwise present in play.

Keeping these terms distinct will make rules text easier to parse.

### Zone

A Zone is a navigable part of the current map. Zones establish relative
position, adjacency, hazards, occupants, and available interactions without
requiring measured distances.

### Area

An Area is the overall place containing the current Zones: for example, a
village square, a ruined greenhouse, or an arena.

An Area may define:

- which Zones begin in play and how they connect;
- ambient elements and reactions;
- special acts available to everyone present;
- encounter rules, hazards, and objectives.

## Build economy

Wayfarer uses two different measures of character progression.

### Level

Level equals the number of cards in a character's action deck.

### Star limit

Every card selected for a character may have a level value shown as
`★ number`. The sum of those values across the entire kit may not exceed the
character's level.

For a level 10 character:

```text
number of cards in action deck = 10
sum of ★ across character + actions + skills + equipment <= 10
```

This produces two simultaneous budgets:

1. an exact action-card count;
2. a maximum power budget shared across the whole kit.

### Questions to resolve

- Do ordinary or foundational cards cost `★ 0`, or does every selected card
  cost at least `★ 1`?
- Does the Character card always contribute to the star total?
- Does every carried Item contribute, or only equipped Items?
- Can a character have more Skills than their star limit permits if some cost
  `★ 0`?
- When a character levels up, do they always gain both one action-deck position
  and one star of capacity?
- Can cards be upgraded in place, or only exchanged between sessions?
- Is there a minimum deck composition that prevents a build from becoming
  unable to prove its own actions?

## Core energy

Beings and Items have core energy. Losing core energy represents the depletion
of the thing's ability to keep functioning as itself.

For a Being, depletion may mean injury, collapse, death, transformation, or loss
of the current body. For an Item, it may mean damage, breakage, exhaustion, or
loss of enchantment. The exact fictional result depends on the source of the
loss and the thing affected.

This interpretation leaves room for a sword, torch, automaton, and living
creature to share one mechanical measure without implying that all four are
biologically wounded.

### Working proposal: energy states

Use a small number of thresholds rather than a separate wound subsystem:

- **stable:** above half core energy;
- **strained:** at or below half core energy;
- **spent:** at zero core energy.

Cards may react to these states. What _spent_ means is determined by the card and
fiction. A spent body need not end the player's participation.

### Wayfarer persistence

A Wayfarer can die and continue to play. A body is released only when the player
relinquishes it, dead or alive. If the body is vaporized or crushed, the
Wayfarer may persist as a dust elemental.

This needs a procedure that answers:

- what a bodiless or dust-form Wayfarer can do;
- how a Wayfarer acquires or creates another body;
- what is lost, retained, or transformed when a body is released;
- whether equipment and conditions remain attached to the body;
- why continuing to cling to a destroyed body is sometimes preferable.

## Proving actions

To play an Action, a player must satisfy its proving requirement. Proving means
discarding cards whose relevant elemental values total at least the required
amount.

### Basic procedure

1. Declare the Action and its intended target or outcome.
2. Check that the Action is currently legal in the fiction.
3. Name the proving requirement.
4. Select eligible cards from hand.
5. Apply Skills and other rules that change eligibility or supply.
6. Discard the selected cards.
7. Resolve the Action.

Excess value is normally lost.

### Example: Brutal Swing

> **Brutal Swing**\
> Prove Fierce 3.\
> Make a forceful close-range attack.

To play Brutal Swing, discard other cards from hand whose Fierce values total at
least 3.

A Skill might allow Fire values to count as Fierce for this proof. Another Skill
might reveal the top three cards of the action deck and allow those cards to be
used alongside cards from hand.

### Rules questions

- Is the Action being played allowed to contribute its own elemental value to
  its proof? The current example implies no.
- May a card with multiple elements contribute all of them, or must its player
  choose one?
- Is over-proving intentionally wasteful, or can excess value be stored or
  redirected?
- Is every proving card discarded, exhausted, or sent somewhere elementally
  meaningful?
- When does the played Action enter the discard pile?
- What happens when a player declares an Action but cannot complete its proof?
- Can several characters contribute to one proof?
- Can energy already present on Beings, Items, Conditions, or Zones be used to
  prove an Action?

## Draw, discard, and tempo

The feel of proving depends heavily on the card-flow rules. They are not yet
defined.

### Working proposal: prototype flow

For the first prototype only:

1. Draw up to a fixed hand size at the start of your turn.
2. Play one primary Action on your turn.
3. Acts, reactions, and explicitly quick Actions may occur outside that limit.
4. Cards used to prove and the Action played go to the discard pile.
5. When the action deck is empty, shuffle the discard pile to form a new deck.

Start testing with a hand size of five. This is a test parameter, not a final
rule.

This loop makes an expensive action accelerate the deck cycle and temporarily
remove several options from the player's hand. Tests should watch for:

- turns where no card is playable;
- dominant hands that repeat too reliably;
- excessive time spent calculating proofs;
- whether discarding feels like an interesting sacrifice;
- whether small decks cycle so quickly that their order is easy to exploit.

## Acts and fiction-first play

An **act** is an inline action printed on a Skill, Character, Item, Condition,
Zone, or Area rather than drawn from the action deck.

Acts are useful for:

- basic actions every character should always be able to attempt;
- signature abilities that should not depend on a draw;
- exploration and conversation procedures;
- actions granted by the immediate environment;
- risky attempts that create consequences without spending a card.

### Working proposal: outcome structure

To preserve the Powered by the Apocalypse influence, uncertain acts should
produce three broad outcome bands:

- **strong outcome:** the intent succeeds cleanly or with an added benefit;
- **costly outcome:** the intent succeeds incompletely or introduces a choice,
  cost, danger, or reduced effect;
- **turn:** the situation changes against the acting character and the GM or
  opposing rules gain initiative.

The game still needs to decide how an outcome band is determined. Possibilities
include drawing from the action deck, revealing elemental values, comparing
proof against difficulty, rolling dice, or letting specific acts define their
own procedure.

The decision should preserve these qualities:

- fictional position matters before random resolution;
- partial success is common;
- failure changes the situation rather than merely consuming a turn;
- character cards and Skills create distinct approaches;
- the procedure works without a GM in arena play.

## Elements

Elements describe both material substances and expressive approaches. An Action
usually carries one element and a numeric elemental value, though some Actions
may carry more than one.

### Material and magical elements

| Element | Palette direction | Notes                                                             |
| ------- | ----------------- | ----------------------------------------------------------------- |
| Heart   | Pink              | Living feeling, vitality, or flesh; exact domain unresolved       |
| Bone    | Faded pink        | Extremely washed out and low saturation                           |
| Wood    | Orange + yellow   | Often dark and low in saturation, especially on low-quality items |
| Leaf    | Green + lime      | —                                                                 |
| Iron    | Orange + red      | Typically fairly low saturation                                   |
| Gold    | Yellow            | Slightly rich                                                     |
| Ice     | Cyan              | —                                                                 |
| Slime   | Lime              | —                                                                 |
| Fire    | Orange + red      | —                                                                 |
| Dust    | Orange + yellow   | Very washed out                                                   |
| Air     | Teal              | Washed out                                                        |
| Water   | Blue + cyan       | —                                                                 |
| Light   | Yellow            | —                                                                 |
| Ether   | Magenta           | —                                                                 |
| Sand    | Orange            | Medium saturation                                                 |
| Stone   | Blue              | Medium saturation                                                 |

### Approach elements

| Element | Color                 | Expressive domain                      |
| ------- | --------------------- | -------------------------------------- |
| Fierce  | Red                   | Force, passion, aggression             |
| Tough   | Blue                  | Endurance, resistance, steadiness      |
| Keen    | Darkened yellow-brown | Precision, perception, analysis        |
| Mystic  | Violet                | Occult understanding and strange power |
| Deft    | Green                 | Speed, grace, subtle manipulation      |

The distinction between material and approach elements is descriptive for now.
The game must decide whether they follow identical reaction and proving rules.

### Core CMY(K) palette

The visual system uses a twelve-step color wheel derived from cyan, magenta, and
yellow mixtures.

| Color   | CMY          |
| ------- | ------------ |
| Yellow  | C0 M0 Y100   |
| Orange  | C0 M50 Y100  |
| Red     | C0 M100 Y100 |
| Pink    | C0 M100 Y50  |
| Magenta | C0 M100 Y0   |
| Violet  | C50 M100 Y0  |
| Indigo  | C100 M100 Y0 |
| Blue    | C100 M50 Y0  |
| Cyan    | C100 M0 Y0   |
| Teal    | C100 M0 Y50  |
| Green   | C100 M0 Y100 |
| Lime    | C50 M0 Y100  |

Black may serve as a shared shading or key channel rather than an element.
Element identity must never depend on hue alone: names, symbols, patterns, and
card text should remain legible for color-blind players and in poor lighting.

## Elemental reactions

Each element claims several reactions. A reaction:

- occurs at a defined timing rate;
- includes the claiming element as a reagent;
- consumes a number of reagents;
- produces an equal number of products.

The equal-input/equal-output rule conserves the number of elemental units while
allowing their identities and containers to change.

### Reaction notation

**Working proposal:**

```text
[timing] Reagent + Reagent -> Product + Product
```

For example, using placeholder chemistry:

```text
[immediate] Fire + Wood -> Fire + Dust
```

This example is illustrative only. It is not yet a canonical Wayfarer reaction.

### Reaction record

Every reaction should specify:

| Field    | Meaning                                                            |
| -------- | ------------------------------------------------------------------ |
| Claim    | The element whose rules own the reaction                           |
| Timing   | When or how quickly it checks and resolves                         |
| Reagents | Elements and quantities required                                   |
| Products | Elements and quantities created                                    |
| Site     | The Being, Item, Zone, Area, or other container where it can occur |
| Effect   | Any non-elemental state change                                     |
| Priority | How it interacts with simultaneous reactions                       |
| Repeat   | Whether products may react again during the same timing window     |

### Timing rates

The timing system must be usable both in freeform adventure scenes and in
structured arena turns.

**Working proposal:** begin with three rates.

- **flash:** resolves when the final reagent is introduced;
- **beat:** resolves at the end of the current action or turn;
- **slow:** resolves during an upkeep, travel, or scene clock step.

These names and exact windows need play testing. The important property is that
a
player can predict whether there is time to interrupt, move, or add another
reagent.

### Reaction design constraints

- Reactions must be discoverable from cards or a concise reference.
- A reaction chain needs an explicit stopping rule.
- Simultaneous reactions need deterministic priority.
- No element should be useful only when paired with one specific other element.
- Common reactions should create tactical opportunities, not routine
  bookkeeping.
- Adventure-mode rulings and arena-mode adjudication should reach the same
  result from the same state.
- The system needs a representation for where elemental units reside and
  whether they move with their container.

### Central unresolved question

What is a single unit of an element in play?

Possible answers include:

- a token attached to a card or Zone;
- one point of elemental value printed on a persistent card;
- a temporary result created by an Action;
- an abstract tag with no quantity until a reaction calls for it.

This decision affects proving, reactions, damage, component count, and table
readability, so it should be settled in the first physical prototype.

## Space: Areas and Zones

Zones form a map through adjacency rather than measured distance. A Being or
Item is in one Zone unless a rule says otherwise.

### Working proposal: range language

- **here:** the same Zone;
- **nearby:** an adjacent Zone;
- **far:** any more distant Zone in the current Area;
- **elsewhere:** outside the current Area.

Movement normally changes a Being's Zone. Terrain, barriers, and occupied
connections may change what movement requires.

In adventure play, the GM creates or selects an Area and lays out its Zones. In
arena play, the match format defines a symmetrical or deliberately asymmetric
Area, starting Zones, and objective.

## Adventure play

In cooperative play, the GM presents the world honestly, portrays its people,
tracks consequences, and applies the same card and reaction rules as the
players.

A likely adventure loop is:

1. arrive somewhere that has reason to distrust Wayfarers;
2. learn what its inhabitants want, fear, or conceal;
3. explore Zones and change the elemental state of the Area;
4. take risky acts and play Actions to overcome dangers;
5. face social, bodily, and political consequences;
6. acquire cards, powers, obligations, or mutations;
7. decide what to add to the character while respecting level and stars.

The GM needs procedures for:

- creating Areas and encounters;
- signaling threats before consequences land;
- running Beings without hidden arbitrary difficulty;
- deciding when an act is uncertain;
- choosing consequences on a costly outcome or turn;
- rewarding discovery and resolving advancement;
- representing factions and reputation.

## Arena play

Arena play pits player characters against one another using the same kit rules.
It needs explicit answers where adventure play can rely on GM judgment.

A match format should define:

- allowed character level and star limit;
- number of players and teams;
- Area and Zone layout;
- starting positions and hands;
- initiative and turn order;
- victory conditions;
- card legality or format restrictions;
- what happens to a spent or released body;
- tie resolution and match duration.

Possible objectives include last Wayfarer standing, control of Zones, capture
and extraction of an Item, escort, elemental objectives, or scored rounds.
Elimination should not be the only supported structure, especially because
Wayfarers can remain active after bodily death.

## The world

### Wayfarers

Player characters are known as Wayfarers. The world's inhabitants are wary of
them because Wayfarers often:

- behave antisocially;
- seek power with little restraint;
- form roving war bands;
- accept risks that ordinary people would reject;
- explore simply because something is there;
- treat the world with the alien priorities of players.

This is “real gamer shit” interpreted as an in-world social phenomenon.

### Townsfolk and the Frontier

Townsfolk—especially those near the Frontier—regard travelers with suspicion.
They look for tells that someone is not “real,” meaning an ordinary,
self-preserving inhabitant of the world.

This suggests a recurring social pressure: Wayfarers may conceal their nature,
perform normalcy, cultivate a reputation, or openly exploit the fear they
inspire.

### The Realm

The government bars Wayfarers from entering the Realm. At the same time, it
exploits their low risk aversion and appetite for discovery, directing them
toward dangerous work on the Frontier.

This relationship should not be simply oppositional. The government can offer
licenses, bounties, pardons, equipment, information, and controlled access while
still treating Wayfarers as a hazardous class.

### Druids, the tree, and the cure

The government is ruled by druids who made a pact with a great tree to spread
the spores of a magical mushroom.

The mushroom suppresses—or “cures”—psionic mutations. For highly advanced
wizards, however, it attacks bodily morphology directly and produces an
aggressive magical cancer.

### Wizards of the Outland

The government and the wizards living in the Outland are locked in a cold war.
Psionic power is mechanically available to Wayfarers, but acquiring it damages
their reputation with the government.

Psionics should embody a genuine risk/reward choice:

- they grant capabilities that ordinary elemental practice cannot;
- mutations visibly or behaviorally mark their users;
- government agents, settlements, and services react to those marks;
- the fungal cure may remove power, change cards, harm the body, or create new
  conditions;
- advanced use draws the Wayfarer into the larger political conflict.

### World questions

- What makes someone a Wayfarer, and when does that status become visible?
- What does “real” mean metaphysically, and what do townsfolk merely believe it
  means?
- Why can Wayfarers persist after death?
- What does the great tree receive from its pact?
- Is the mushroom truly restoring balance, enforcing one preferred morphology,
  or both?
- What caused the cold war, and what would turn it hot?
- What lies beyond the Frontier that the Realm cannot or will not confront?
- What kinds of cute critters populate the Realm, Frontier, and Outland?

## Presentation direction

The visual identity should juxtapose:

- cute, readable animal characters;
- tactile cards, tokens, and tucked energy bars;
- precise CMY-derived elemental color;
- weathered, lower-saturation materials;
- vivid magic and mutation;
- occasional unsettling bodily transformation.

The world may feel inviting at first glance while revealing anxiety, control,
and strangeness under sustained attention.

Cards need consistent locations for:

- card type;
- title;
- illustration;
- elemental value and symbols;
- proving requirement;
- timing and range;
- rules text;
- traits;
- star value;
- core energy, when applicable.

## First playable prototype

The first prototype should test the game's unique decisions, not the entire
world.

### Contents

- 2 Character cards;
- 20–24 Actions, enough for two distinct level 10 decks plus alternatives;
- 6 Skills;
- 6 Items;
- 4 Conditions;
- 1 Area with 5–7 Zones;
- 4 material elements and 3 approach elements;
- 8–12 reactions;
- energy cards or tokens;
- a one-page reaction reference.

### Scenario

Two Wayfarers enter a small frontier location containing:

- one suspicious local faction;
- one environmental problem that can be altered through reactions;
- two hostile or obstructive Beings;
- one objective that does not require defeating either Being;
- one tempting source of psionic power.

Run the scenario once cooperatively with a GM and once as a symmetrical or
objective-based arena.

### Prototype rules to choose

Before the first test, decide only:

1. starting hand size and draw timing;
2. whether the played Action can help prove itself;
3. where cards go after play and proof;
4. how uncertain acts determine outcome bands;
5. what a unit of an element is in play;
6. the three reaction timing windows;
7. what happens at zero core energy;
8. one advancement reward.

### Questions for play testers

- Did proving create painful, interesting choices?
- Could you understand why each Action was or was not playable?
- Did deck size feel like advancement, dilution, or both?
- Did star values produce meaningfully different builds?
- Could you predict elemental reactions without stopping play?
- Did reactions change plans, or merely add arithmetic?
- Were Zones easier to use than measured distance?
- Did acts create consequential fiction rather than generic skill checks?
- Did death and persistence feel distinctive?
- Did adventure and arena play feel like the same game?
- Which rule generated the most table conversation?

## Design risks

### Excessive card taxonomy

Eight card types can make learning and setup difficult. Shared layout rules and
clear physical behavior must justify every type.

### Two competing resource systems

Core energy and elemental value may feel confusing if both are casually called
energy. Rules text should consistently use the full terms until players have
internalized them.

### Proving can create non-turns

If a player draws Actions that cannot collectively pay for one another, they may
be unable to act. Basic acts, card cycling, `★ 0` actions, or flexible elements
may be needed as safety valves.

### Reaction explosion

A Doodle God-like chemistry is appealing, but too many pairwise interactions
become impossible to remember and expensive to author. Each element should own
a short, curated set of high-impact reactions.

### Adventure and arena divergence

GM interpretation can conceal ambiguity that becomes contentious in
competitive play. Cards should use deterministic core procedures, with the GM
adjudicating fictional applicability and consequences rather than rewriting
card outcomes.

### Cute tone versus body horror

The contrast is a strength if handled deliberately. Art direction and safety
guidance should establish how explicit mutation, cancer, bodily occupation, and
death are meant to become at the table.

### Advancement may punish the player

Because level is deck size, leveling up can reduce consistency. New cards must
create enough flexibility or synergy that advancement feels expansive rather
than like mandatory deck dilution.

## Glossary

| Term            | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| Act             | An inline action granted by a persistent card or core rule       |
| Area            | The overall place containing the current map                     |
| Core energy     | A Being's or Item's remaining capacity to function as itself     |
| Elemental value | Numeric elemental energy printed on or contributed by a card     |
| Kit             | A Character card, action deck, equipment set, and skill set      |
| Level           | The number of cards in a character's action deck                 |
| Prove           | Pay an Action's requirement with eligible elemental values       |
| Reaction        | A timed transformation of equal numbers of reagents and products |
| Star limit      | The maximum total `★` value of all cards in a character's kit    |
| Wayfarer        | A player character; a persistent, power-seeking traveler         |
| Zone            | A navigable position within an Area                              |

## Immediate design decisions

The next revision should focus on four connected decisions:

1. define the physical representation and location of elemental units;
2. define the draw–prove–play–discard loop;
3. define how acts produce strong outcomes, costly outcomes, and turns;
4. write a small canonical reaction set that exercises all timing rates.

Once those exist, sample cards can be written against actual rules rather than
inventing their own local procedures.
