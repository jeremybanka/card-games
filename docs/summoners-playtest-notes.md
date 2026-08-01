# Summoners playtest notes

These notes distinguish observed game outcomes from model-play discontinuities.
A decisive result is not automatically a balance result when one Luna player
mis-sequences a keyword or leaves substantial Spark unused.

## 2026-07-31 — signature-keyword pass

### Ember Reliquary versus Verdant Compact

- **Result:** Ember won on turn 11 with 24 life.
- Brasshorn Ibex spent the last 3 Spark to enter play, triggered Blaze, and
  attacked immediately. On turn 9 it attacked, Last Light spent the final
  Spark, and Blaze enabled a second attack.
- Luna missed another available post-Blaze attack on turn 7, so the observed
  Ember clock was not its ceiling.
- Verdant drew no Rooted cards. Its only early Being, Seedling Scout, traded
  into Ember's board instead of pressuring Pip. This game therefore says
  little about Rooted.
- **Working hypothesis:** Blaze on an efficient Being can act as both on-curve
  Rush and later double-attack. Requiring a Blaze Being to have attacked
  earlier in the turn would preserve the sequencing combo without granting
  pseudo-Rush.

### Tidemark Menagerie versus Outland Chorus

- **Result:** Outland won on turn 14 with 24 life.
- Tidemark repeatedly used Read the Current before attacking. Current readied
  an already-ready Mistfin Minnow, after which Luna attacked only once and
  left as much as 5 Spark unused. It also failed to attack with the Minnow when
  Current readied it on turn 1.
- Outland developed Many-Eyed Moth and Dustmote Familiar, then stacked Sweet
  Morphology and Bone Needle into a 7-Attack Leech finisher. Cancerous Bloom,
  Private Thought, and Leech recovered all opposing damage.
- Outland proposed equipping Second Shadow and surviving combat to Molt, but
  omitted the required `endTurn`; the guarded decision fell back before the
  combo executed.
- **Working hypothesis:** Current's engine behavior is sound, but its model
  instruction needs an explicit attack → bonus draw → attack example. Outland's
  burst-and-recovery package merits watching once its opponent spends Spark
  competently.

### Follow-ups

- Run targeted games with early Rooted and Molt access. **Completed below.**
- Compare Verdant and Outland in both seat orders to reduce first-player bias.
  **Completed below.**
- Do not tune Rooted or Molt from the first two games; neither keyword actually
  resolved.

### Verdant Compact versus Outland Chorus — targeted opening

- **Result:** Outland won on turn 16 with 24 life.
- The seeded ordinary shuffle gave Verdant early Seedling Scout, Barkhide Mouse,
  and Rootwoven Buckler access; Outland had Marrow Hound, Second Shadow, and
  Velvet Parasite.
- Rootwoven Buckler made Seedling Scout Rooted. Luna deliberately held the
  damaged Scout ready, and Rooted restored 2 Energy at end of turn.
- Second Shadow gave Marrow Hound Molt. The Hound survived combat and Molted on
  multiple turns, then replaced Second Shadow with Bone Needle. Its accumulated
  growth remained, while the new Item added Attack and Leech; it finished as a
  7-Attack threat.
- **Signal:** granting Molt through an Item creates a strong two-stage equipment
  line: farm permanent growth, then replace the Item with a finisher without
  losing the growth.

### Outland Chorus versus Verdant Compact — reversed seats

- **Result:** Outland won on turn 21 with 24 life.
- Barkhide Mouse entered on turn 4 and visibly restored 2 Energy through Rooted
  after combat. Verdant repeatedly preserved ready Guards and used Tender
  Growth to extend them.
- Velvet Parasite plus Second Shadow survived repeated Guard combats, Molted,
  and compounded that growth with Sweet Morphology. It finished as a 13/15
  Leech Being with 9 Energy remaining.
- Both targeted games completed without model fallbacks or generation errors.
- **Signal:** Rooted and Molt form a dangerous opposing feedback loop. Rooted
  helps a Guard survive for another turn, but that same survival gives the
  Molt attacker another permanent +1/+1. The attacker eventually outscales the
  fixed 2-Energy repair, and Leech erases the defender's chip damage.

### Updated balance hypotheses

- Outland won both targeted seat orders at 24 life. First-player advantage does
  not explain the result.
- Molt itself is bounded correctly, but permanent growth on naturally durable
  Leech Beings appears too efficient against Guard/Rooted decks.
- Candidate adjustments to test next include making Molt grant only +1 Attack,
  limiting each Being to one Molt growth per round, or making Item-granted Molt
  growth disappear when that Item is replaced.
- Rooted behaved legibly and created a real hold-back decision. It does not yet
  look independently overpowered; its problem is chiefly the Molt matchup.

### Follow-up experiment

- **Selected Molt adjustment:** Molt now grants +1 Attack rather than +1/+1.
  It still creates an escalating threat, but no longer makes its own next
  survival trigger progressively safer.
- **Selected strategic guidance:** Luna now receives dynamic, keyword-specific
  sequencing advice. Blaze and Current explicitly teach attack → ready trigger
  → second attack; Rooted explains the repair-versus-pressure choice; Molt
  emphasizes checking return damage now that it grants no Energy.

### Follow-up results

#### Ember Reliquary versus Verdant Compact

- **Result:** Ember still won, but on turn 35 rather than turn 11.
- Luna used the intended Blaze line for lethal: attack with Furnace Fox, spend
  the last 6 Spark on Ashen Colossus, then attack again with the readied Fox.
- Ember finished at 24 life. One unrelated turn-19 decision fell back after
  proposing an illegal mid-game deck selection.
- **Signal:** the advice produces correct Blaze sequencing. The much longer
  game shows that the original turn-11 result was not a stable expected clock.

#### Tidemark Menagerie versus Outland Chorus

- **Result:** Outland still won, but on turn 25 by fatigue at 23 life rather
  than by turn-14 pressure at 24 life.
- Across multiple turns Luna attacked, used Read the Current, then attacked
  again. Riverjaw Newt also executed a Current-enabled second combat.
- **Signal:** the Current advice corrected the exact sequencing failure it was
  written for and made the matchup substantially more competitive.

#### Verdant Compact versus Outland Chorus — +1 Attack Molt

- **Result:** Outland won on turn 22 rather than turn 16, again at 24 life.
- Molt attackers remained easier to answer because combat no longer increased
  their Energy. Outland sometimes avoided Rooted defenders instead of treating
  them as free growth engines.
- The eventual win came from Sweet Morphology, Bone Needle, Private Thought,
  and large Leech Beings—especially Unbodying Choir—rather than an unkillable
  Molt body.
- One Verdant decision fell back after omitting `endTurn`.

#### Outland Chorus versus Verdant Compact — reversed seats

- **Result:** Outland won on turn 11 at 22 life, compared with its previous
  turn-21 win at 24 life.
- Molt did not materially participate. Outland's ordinary low-cost Beings,
  Cancerous Bloom, Sweet Morphology, Leech, and Private Thought produced lethal
  before the keyword engine developed.
- **Signal:** changing Molt to +1 Attack successfully removes the clearest
  self-protecting growth loop, but it does not solve Outland's overall power.
  Outland won all four recorded cross-deck comparisons, generally at or near
  full life. Its broader damage-plus-recovery package is the next tuning target.

## Verdant cultivation rebuild

### Verdant Compact versus Ember Reliquary

- **Result:** Ember won on turn 13 with 10 life; no model fallbacks occurred.
- Verdant concentrated Brindle's Tender Growth on one Seedling Scout until it
  reached 6/8, dealing meaningful face damage but never developing a second
  Being and therefore never making Tend legal.
- **Signal:** permanent growth creates a real clock even from the smallest
  body. A single tall threat remains vulnerable to tempo and does not exercise
  the deck's choice engine.

### Verdant Compact versus Outland Chorus

- **Result:** Outland won on turn 12 at 24 life; the cache-only replay passes
  with no model fallbacks.
- Verdant developed four Tenders, used Sudden Overgrowth, Tender Growth, and
  Deep Roots, but never used Tend. Luna repeatedly described preserving unused
  readiness "for future growth," even though readiness does not carry between
  turns.
- Outland dealt direct damage and attacked with two cheap Leech Beings. Leech
  erased all of Verdant's early pressure; Cancerous Bloom and Private Thought
  helped close without interacting with Verdant's invested bodies.
- **Signal:** Outland remains overtuned, but this game also underestimates
  Verdant because the complete-turn controller failed to cash otherwise wasted
  readiness into growth.

### Verdant Compact versus Tidemark Menagerie — partial

- The first seed repeatedly stalled on an unbounded OpenAI response after
  reaching the middle game. A fresh seed recorded through turn 9 before its
  next model request remained pending for more than ten minutes.
- A later incremental rerun replayed those nine decisions locally, then left
  the identical turn-10 request open for another ten minutes without receiving
  a response or fixture output. The stall is reproducible at the model boundary,
  not within the authoritative game loop.
- At the last authoritative state, Verdant was at 14 life and Tidemark at 24.
  Tidemark repeatedly executed attack → Read the Current → second attack with
  an equipped Mistfin Minnow.
- Verdant initially passed turns with playable Barkhide Mouse in hand, but on
  turn 9 finally summoned it, Tended it with Seedling Scout, then used Tender
  Growth to reach 2 growth and unlock Guard in one sequence.
- **Signal:** the new threshold line is legible and Luna can execute it. The
  model-call timeout is a separate reliability gap; this recording is partial
  and should not be treated as a matchup result.

## Move-by-move Luna loop

Summoners now asks Luna for exactly one legal action, submits that intent
through the authoritative realtime handler, and renders a fresh observation
after the action resolves. The current plan carries forward as strategic
memory, but Spark, readiness, targets, triggers, and battlefield references
always come from the new server projection. The `ai-natural-v6` Varmint
boundary records each observation and atomic decision separately.

### Ember Reliquary versus Verdant Compact

- **Result:** Verdant won on turn 22 at 24 life; no model fallbacks occurred.
- The final cache contains 59 separately generated decisions for 61 committed
  intents including deck selection. Twelve turns contained multiple actions,
  with as many as six separately observed actions in one turn.
- Verdant used Tend, Tender Growth, attacks, and multiple summons in coherent
  sequences. Ember likewise executed Rush lines action by action.
- An initial loop recording exposed Luna's false assumption that a ready Being
  could block. Summoners has no blocking or response window, so the prompt now
  states that only Guard protects a Summoner and that unused Spark/readiness do
  not carry forward.
- After that correction, Verdant stopped passing resource-rich turns and the
  match lasted three times as long as the initial turn-7 Ember rout.
- **Signal:** iterative observation fixes both the combinatorial full-turn
  generation stall and stale-state sequencing. It also makes strategic prompt
  defects much easier to identify from the per-action cache.

### Turn-objective and end-turn discipline comparison

The `ai-natural-v7` contract resets strategic memory at every authoritative
turn boundary, keeps one objective immutable within the turn, lists previously
acknowledged actions with their reasons, and renders an end-turn audit of
Spark, ready attackers, playable cards, Tend, powers, and Rooted recovery.

Using the same Ember-versus-Verdant deal seed:

| Measure | v6 atomic loop | v7 objective + ledger |
| --- | ---: | ---: |
| Result | Verdant, turn 22 at 24 life | Ember, turn 9 at 20 life |
| Model decisions | 59 | 30 |
| Empty playing turns | 10 | 0 |
| Multi-action playing turns | 12 | 9 |
| Most actions in one turn | 6 | 5 |
| Model fallbacks | 0 | 0 |

- Under v6, turns 3–8 were six consecutive passes despite listed attacks,
  powers, and playable cards. Stale prose such as "already attacked" survived
  into later turns and overruled the freshly readied state.
- Under v7, every playing turn converted at least one available resource or
  readiness before ending. Each `endTurn` reason explicitly checked the audit,
  and the runtime test verified an empty objective/ledger on the first
  observation of every turn followed by one ledger entry per resolved action.
- Ember executed coherent pressure: attack before development, add a Rush
  Being, attack again; later use Wildfire Lesson, clear Seedling Scout, then
  send the remaining attackers at the Summoner. Verdant used Tender Growth,
  life-gain development, attacks, and remaining Spark rather than waiting for
  an imagined future block.
- **Signal:** the agents are substantially more disciplined and the cached
  reasons are easier to appraise. The reversal to an Ember win is not enough to
  establish balance by itself, but it suggests the older Verdant win was
  heavily distorted by donated tempo.
