# Sol vs. three Luna — v5 natural-prompt assessment

Recorded July 29, 2026 with the invariant `sol-vs-three-luna-live-v1` seed.
The live run made 56 model calls and the strict cache-only replay reproduced all
56 decisions, actions, and the final state. There were no guarded fallbacks.
The cache was subsequently migrated to add deterministic legal-play labels and
remove the obsolete `observation` output field; `analysis.json` preserves the
original live model exchange for audit and cost analysis.

## Cost

Standard API prices per million tokens:

- GPT-5.6 Sol: $5 input, $30 output
- GPT-5.6 Luna: $1 input, $6 output

Source: https://developers.openai.com/api/docs/models/compare

| Metric | Verbose v2 | Compact v4 | Natural v5 | v4 → v5 | v2 → v5 |
|---|---:|---:|---:|---:|---:|
| Prompt characters | 275,974 | 119,323 | 44,991 | −62.3% | −83.7% |
| Input tokens | 122,715 | 67,026 | 36,471 | −45.6% | −70.3% |
| Output tokens | 12,325 | 10,635 | 9,820 | −7.7% | −20.3% |
| Mixed-table cost | $0.374 | $0.265 | $0.178 | −32.8% | −52.4% |
| Sol seat | $0.222 | $0.167 | $0.103 | −38.0% | −53.4% |
| Average Luna seat | $0.051 | $0.032 | $0.025 | −22.2% | −51.2% |
| Fallbacks | 0 | 0 | 0 | unchanged | unchanged |

The exact v5 mixed-table cost is $0.178163: $0.103465 for Sol and
$0.074698 across the three Luna seats. No prompt-cache discount was applied.

| Seat | Input tokens | Output tokens | Cost | Round points |
|---|---:|---:|---:|---:|
| Sol | 9,137 | 1,926 | $0.103465 | 12 |
| Luna 1 | 9,121 | 2,220 | $0.022441 | 0 |
| Luna 2 | 9,124 | 2,728 | $0.025492 | 14 |
| Luna 3 | 9,089 | 2,946 | $0.026765 | 0 |

## Strategic read

The compact prompt retained enough information for every model response to
produce a legal action. Plans generally tracked useful Hearts concepts: ducking
point-free tricks, shedding `QS` or `AS` while void, and exploiting known cards
from the pass. Luna 1 discarded `AS` safely under a club winner; Sol later
discarded `QS` under `KC`. Luna 1 and Luna 3 finished the round with zero
points.

The run also exposes several targets for strategy-prompt improvements:

- Sol passed `AS`, `KH`, and `2H`, describing this as creating a heart void.
  The pass cannot guarantee a lasting void; Sol received `QS`, `KS`, and `AH`,
  was forced to take `AH`, and finished with 12 points.
- Luna 1 said its leftward pass from P1 exposed `AC`, `JC`, and `KD` to P0.
  Those cards actually went to P2. The action was legal, but the observation
  confused the pass recipient.
- On trick 5, Luna 1 said `8D` played “under” `7D`; it overtook `7D`. A later
  `KD` prevented the mistake from winning the trick, but the inference was
  factually wrong.
- Late-game plans correctly noticed exhausted suits and forced winners, but
  repeatedly restated obvious legality. More explicit objectives around
  minimizing expected points, counting outstanding scoring cards, and
  distinguishing off-suit discards from trick-winning cards should make the
  remaining output more strategic.

Final scores were Sol 12, Luna 1 zero, Luna 2 14, and Luna 3 zero. This is one
deterministic deal, so it is diagnostic evidence rather than a comparative
model-quality benchmark.
