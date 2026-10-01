# How districts are drawn

This page explains how the generator turns census counts into a map of U.S. House districts, in plain language. The map depends on the census data and one fixed rule. Nobody chooses a starting point, a seed or a "preferred" outcome.

## What goes in

The generator reads two things for every census block in a state, from the 2020 census:

- the number of people counted in the block, and
- the block's shape on the ground.

That is all. It does not read party registration, election results, the addresses of current officeholders, or race and ethnicity data. County and city boundaries are not used to draw anything. Counties are only counted afterwards, for reporting. People are counted where the census counted them, with no adjustments, so a person in a prison is counted at the prison.

The number of districts for each state is the number of House seats the state received in the 2020 apportionment.

## The rule

Start with the whole state.

1. Suppose the piece in hand has `n` seats. Split it into two sides that hold `floor(n/2)` and `ceil(n/2)` seats. A piece with 7 seats is split 3 and 4. A piece with 2 seats is split 1 and 1.
2. Among all the straight lines that divide the population in that ratio, pick the shortest one.
3. Repeat on each side until every piece has exactly one seat. Each piece becomes one district.

A state with N seats takes exactly N minus 1 cuts. Each piece is cut on its own, so the order in which pieces are processed does not change the result.

### Straight lines on a globe

A "straight line" here is a great circle, the path a plane through the center of the Earth traces on its surface. A line like that has no projection to choose and no distortion to argue about.

### Blocks are never split

A census block is the smallest unit and is always kept whole. Once a line's direction is chosen, the blocks of the piece are ordered by how far they sit across the line. The generator then walks along that order, adding up population, until the low side holds as close to its share as whole blocks allow. If stopping just before or just after the block that crosses the target gets closer, it picks whichever is closer, and a tie goes to stopping just before. Every block with the same distance is taken in GEOID order, the census block identifier, so the order is fixed. The low side always holds at least one block and the high side at least one block.

The line only decides who goes on which side. The real border follows block edges, because every block belongs entirely to one side.

### How long a line is

The length of a candidate line counts only the part of it that lies inside the piece being cut. Water inside the state counts as part of the state, so a bay or a lake does not shorten or break a line. Water blocks also count as connecting the land on either side of them.

### Every district is one connected piece

A candidate line is eligible only if both sides it creates are each one connected piece. Two blocks are connected when they share an edge, and touching at a single corner does not count. If a line would leave one side in two or more separate parts, it is skipped and the next shortest line is tried. Islands and other detached pieces are joined to the nearest block of the main body of the piece, so a state with islands can still be cut. The number of these joins is reported as `bridges` in `metrics.json`.

### Ties

Two lines whose lengths agree to the nearest centimeter are tied. A tie goes to the line closest to north-south. If two tied lines are equally close to north-south, the one with the smaller angle wins, and then the one whose low side has fewer seats.

### Which angles are tested

Lines are tested at every angle in a fixed step across a half turn. The default step is 0.1 degrees, which gives 1,800 angles. The step must divide 180 degrees exactly and can be changed with `--angle-step`. A different step can produce a different map, so the step is part of the recipe for reproducing a map and is recorded in `metrics.json`.

## Same data, same map

The generator has no random numbers and no seed. Given the same census files, the same angle step and the same Node.js major version (the maps here were produced on Node.js 24), it produces byte-identical output. Each run writes a SHA-256 hash of the final assignment file into `metrics.json`, so two people can compare a single value to confirm they got the same map.

To reproduce a state's map:

```bash
npm install
npm run explore -- --states CO
```

The state is given by its two-letter abbreviation. A list such as `--states CO,NC` runs several states in turn. The census block file for each state is downloaded from the U.S. Census Bureau the first time it is needed and kept in `data/raw/`.

## The plans written for each state

The map in `out/<state>/` is the official map. It is the result of the rule above followed by a balancing pass. Each cut places whole blocks so its two sides come as close to equal as whole blocks allow, but small differences can add up across many cuts. The balancing pass moves single blocks across district borders when doing so reduces the differences between district populations. A block moves only if it touches the neighboring district and both districts stay connected. The pass repeats until no such move helps, and it records the number of moves as `balanceMoves`.

The plan as it stood before the balancing pass is written to `out/<state>/before-balancing/` with the same files, so the effect of the balancing pass can be read directly from the numbers. If one state fails in a multi-state run, the command reports the error in the summary table, continues with the remaining states, and exits with a non-zero code at the end.

## What the output files contain

Each plan directory holds five files:

- `assignment.csv` lists every block with its GEOID and the district number it belongs to. This is the map itself.
- `metrics.json` holds the number of blocks, the population of each district, the gap between the largest and smallest district (`rangePersons` and `rangePct`), whether every district is connected, how many counties are split, how many connected-piece joins (`bridges`) were needed, how many candidate lines were skipped for connectivity (`cutsSkipped`), the angle step, the run time, and the SHA-256 hash of `assignment.csv`.
- `borders.geojson` holds the lines where districts meet, ready to draw on a map.
- `districts.geojson` holds each district's shape.
- `cuts.geojson` holds the straight line chosen for each cut, with its angle and length, so the recursive splitting can be followed step by step.
