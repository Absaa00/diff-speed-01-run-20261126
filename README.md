[![make.fun · diff-speed-01-run-20261126](https://make.fun/badge/diff-speed-01-run-20261126.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![rank](https://make.fun/badge/diff-speed-01-run-20261126/Absaa00/diff-speed-01-run-20261126/rank.svg)](https://make.fun/bounty/diff-speed-01-run-20261126/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)
[![reward](https://make.fun/badge/diff-speed-01-run-20261126/Absaa00/diff-speed-01-run-20261126/reward.svg)](https://make.fun/bounty/diff-speed-01-run-20261126?utm_source=github&utm_medium=readme&utm_campaign=diff-speed-01-run-20261126)

# diff-speed — a faster drop-in for makefun-diff 1.0.0

`makefun-diff` is make.fun's own line diff: it patches two texts by the rule in
its header — lines cut after every `\n`, the common prefix kept, then the common
suffix, and between them Myers's greedy search with make.fun's own tie-break
(the deletion wins when a deletion and an insertion reach the same point). This
entry answers exactly as it does on every case, faster.

## How it is faster

- **Lines become small integers.** Each line's string is interned once in tables
  shared by both texts (keyed by the content the split already made, so no new
  string is built per line), and from then on equality is one integer compare.
- **The Myers search keeps no path objects.** For every diagonal it keeps only
  the furthest old position, stored +2 in a `Uint16Array` so 0 means "no path"
  and a fresh row needs no fill. The edit script is rebuilt afterwards by
  walking the stored positions back, replaying the same choice — the same
  tie-break, the same first path to both ends — at each step.
- **The insertion candidate of one diagonal is the deletion candidate of the
  next**, so it is carried over instead of read again.
- The patch is then formatted exactly as the reference formats it.

## Results on the practice set

| case | this entry | makefun-diff 1.0.0 |
| --- | --- | --- |
| g-0001 | ~143 ms | ~524 ms |
| g-0002 | ~131 ms | ~450 ms |
| g-0003 | ~113 ms | ~419 ms |
| g-0004 | ~118 ms | ~397 ms |

All four answers byte-identical to the reference (median of 5 runs, Node 24 on
this machine; the harness times on Node 22). About 3.5x faster overall, and
4,515 fuzz cases — edge cases plus random small and medium texts, including
CRLF, bare last lines, and repeated lines that force the tie-break — all
byte-identical too.

## Files

- `solve.js` — the ES module: `run(input)` returns makefun-diff's patch of
  `{ old, new }` as one string. Dependency-free, deterministic, no network.
- `main.ts` — the program the harness runs: reads every case from
  `/input/cases.json`, answers each one alone with `run`, writes
  `/output/answers.json`.

## Bounty

[Diff two texts faster, 27 November 2026](https://make.fun/bounty/diff-speed-01-run-20261126) — $100 over 10 places, entries close 29 Nov 2026 13:07 WIB.
