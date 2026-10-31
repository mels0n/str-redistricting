# Schema changelog

## 1.4.0 (2026-10-31)

- feat: write a badge for each state chamber when publishing
- feat: draw the fixed candidate badges
- refactor: share the district drawing between preview images and badges
- fix(build): keep the repository url out of the publish module
- refactor(build): name the repository url beside the site host

## 1.3.0 (2026-10-13)

- Each plan's metrics in `stats.json` now carry `balanceMovesBorderOnly` and `peopleMovedBorderOnly`: the balancing moves that only shortened the border (gain 0) and the people they carried. Both are 0 before balancing.
- A balancing move in `balance.json` may now record a `gain` of 0 (a move that leaves the districts exactly as close to equal and shortens the border), and a `pop` of 0 (a block with no people).
- The How it works examples describe these moves and island link lengths.
- The How it works examples are extracted in 8 GB of memory: states loaded only to find the passed-over line examples are let go once those examples are picked. The examples file is unchanged.

## 1.2.0 (2026-10-12)

- Census names are read as UTF-8, so accented county names such as Doña Ana County publish correctly.
- Each map now publishes the district neighbors of its before-balancing plan, so the viewer can color districts consistently before that plan loads.

## 1.1.0 (2026-10-11)

- Published files now describe each chamber separately, so a state has a Federal House, a State House and a State Senate map wherever it has them.
- When the comparison overlay is updated, every chamber is stamped again. Federal House files keep their format and paths.

## 1.0.0 (2026-10-11)

- First release of the published and exported file formats.
