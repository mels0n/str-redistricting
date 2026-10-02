# How districts are drawn

This page explains how the generator turns census counts into a map of U.S. House districts, in plain language. The map depends on the census data and one fixed rule. Nobody chooses a starting point, a seed or a "preferred" outcome.

## What goes in

The generator reads three things for every census block in a state, from the 2020 census:

- the number of people counted in the block,
- the block's shape on the ground, and
- the block's internal point (the Census Bureau's `INTPTLAT20` and `INTPTLON20`), which is used only to put blocks in order across a guide line.

That is all. It does not read party registration, election results, the addresses of current officeholders, or race and ethnicity data. County and city boundaries are not used to draw anything. Counties are only counted afterwards, for reporting. People are counted where the census counted them, with no adjustments, so a person in a prison is counted at the prison.

The number of districts for each state is the number of House seats the state received in the 2020 apportionment.

## The rule

Start with the whole state.

1. Suppose the piece in hand has `n` seats. Split it into two sides that hold `floor(n/2)` and `ceil(n/2)` seats. A piece with 7 seats is split 3 and 4. A piece with 2 seats is split 1 and 1.
2. Try a straight guide line in every direction, one every 0.1 degrees, starting with north-south. For each direction, the position of the line is set so that the people on one side match that side's share of the seats. When the two shares differ (an odd number of seats), each direction is tried twice: once with the smaller share on one side of the line and once with it on the other.
3. Turn each guide line into a real border made of block edges, with any stray pieces joining the side around them (both described below), and measure that border.
4. Keep only the guide lines that pass the stray cap: the people in the stray pieces may total at most 1% of one district's ideal population for this piece, which is the piece's population divided by its number of seats.
5. Pick the guide line whose real border is shortest.
6. Repeat on each side until every piece has exactly one seat. Each piece becomes one district.

A state with N seats takes exactly N minus 1 cuts. Each piece is cut on its own, so the order in which pieces are processed does not change the result.

### Straight lines on a globe

A "straight line" here is a great circle, the path a plane through the center of the Earth traces on its surface. A line like that has no distortion to argue about.

The 1,800 guide lines are defined in a gnomonic projection, a map projection in which every great circle is a straight line. The projection is centered on the center of the bounding box of all the blocks' internal points in the state. "North-south" (direction 0) is the meridian through that center. Directions are every 0.1 degrees (`k` times 0.1 degrees) measured in that flat plane. A block's position across a line is the distance of its projected internal point from the line, and blocks at equal distance go in GEOID order.

### Blocks are never split

A census block is the smallest unit and is always kept whole. Once a guide line's direction is chosen, the blocks of the piece are ordered by how far their projected internal points sit across the line. The generator walks along that order, adding up population, until the low side holds as close to its share as whole blocks allow. If stopping just before or just after the block that crosses the target gets closer, it picks whichever is closer, and a tie goes to stopping just before. Blocks at the same distance are taken in GEOID order, the census block identifier, so the order is fixed. Each side always holds at least one block.

The guide line only decides who goes on which side. The real border follows block edges, because every block belongs entirely to one side.

### Stray pieces join the side around them

Because blocks are assigned whole, a large block that straddles the guide line can leave a few small blocks cut off on the far side. Examples are a median strip or an on-ramp. On each side, every connected group of blocks other than the side's main body is moved to the other side. The main body is the group with the most people, then the most blocks, then the lowest block position in GEOID order. This is repeated until no group moves. If pieces are still moving after 10 passes, the run stops with an error; this can only happen when a piece is disconnected. The number of blocks and people moved this way is reported as `strayBlocksMoved` and `strayPopMoved`. These counts are net per block, with moves in both directions summed.

### The stray cap

Strays exist only because blocks are kept whole, so they should be small. A guide line that would strand a real part of the piece, for example a line that passes through a bay or across two arms of a U-shaped piece and leaves a large area cut off, would move many people this way. The stray cap rules such a line out: if the people in the stray pieces total more than 1% of one district's ideal population for the piece being cut, the line is not used and the next shortest one is considered. A line may cross the piece's outline any number of times, as long as it passes the cap. The number of lines rejected by the cap is reported as `strayCapRejected`.

### How long a border is

The length of a candidate is the length of the real border between its two final sides: the sum of the lengths of all block edges that have a block of one side on one side and a block of the other side on the other. Lengths are measured along the surface of the Earth. Water inside the state counts as part of the state, so a bay or a lake does not shorten or break a border. Water blocks also connect the land on either side of them.

### Every district is one connected piece

Two blocks are connected when they share an edge, and touching at a single corner does not count. A cut is accepted only if both of its sides are each one connected piece. If a cut would leave a side in two or more parts, the next shortest candidate is tried. Islands and other detached pieces of land are joined to the nearest block of the growing main body, which includes islands already joined, so a state with islands can still be cut. The number of these joins is reported as `bridges`.

### Ties

Two borders whose lengths agree to the nearest centimeter are tied. A tie goes to the guide line closest to north-south. If two tied lines are equally close to north-south, the one with the smaller angle wins, and then the one whose low side has fewer seats.

### Which angles are tested

Guide lines are tested at every angle in a fixed step across a half turn. The default step is 0.1 degrees, which gives 1,800 directions. The step must divide 180 degrees exactly and can be changed with `--angle-step`. A different step can produce a different map, so the step is part of the recipe for reproducing a map and is recorded in `metrics.json`.

## The balancing pass

Each cut places whole blocks so its two sides come as close to equal as whole blocks allow, but small differences, and the stray moves above, can add up across many cuts. After all the cuts, the balancing pass moves single blocks across district borders to even out the populations. A block moves only if it touches the neighboring district and both districts stay one connected piece, so the pass never breaks a district apart. Blocks with no people are never moved, and a block moves only if the move strictly narrows the population gap between the two districts involved. It repeats until no move helps, so it always stops. The number of moves is reported as `balanceMoves`.

The map in `out/<state>/` is the official map: the cuts above followed by the balancing pass.

## Same data, same map

The generator has no random numbers and no seed. Blocks are processed in GEOID order. Given the same census files, the same angle step and the same Node.js major version (the maps here were produced on Node.js 24), it produces byte-identical `assignment.csv` and GeoJSON files. `metrics.json` is identical except for `runtimeMs` and the provenance fields `nodeVersion` and `inputSha256`. Each run writes a SHA-256 hash of the final assignment file into `metrics.json`, so two people can compare a single value to confirm they got the same map.

To reproduce a state's map:

```bash
npm install
npm run explore -- --states CO
```

The state is given by its two-letter abbreviation. A list such as `--states CO,NC` runs several states in turn. The census block file for each state is downloaded from the U.S. Census Bureau the first time it is needed and kept in `data/raw/`. If one state fails in a multi-state run, the command reports the error in the summary table, continues with the remaining states, and exits with a non-zero code at the end.

## What is written for each state

The official map is in `out/<state>/`. The plan as it stood after the cuts and before the balancing pass is written to `out/<state>/before-balancing/` with the same files, so the effect of the balancing pass can be read directly from the numbers.

Each plan directory holds five files:

- `assignment.csv` lists every block with its GEOID and the district number it belongs to. This is the map itself.
- `metrics.json` holds the following:
  - `state`, `seats`, `blocks`, `population` and `ideal` (the population divided by the number of seats), and `districts`, which lists for each district `district` (its number), `pop` (its population), `dev` and `devPct` (its difference from `ideal` in people and in percent) and `contiguous` (whether it is one connected piece).
  - `rangePersons` and `rangePct`, the gap between the largest and smallest district in people and as a percentage of `ideal`.
  - `allContiguous`, whether every district is one connected piece.
  - `countiesSplit` and `countiesTotal`, for reporting only.
  - `bridges`, the number of joins made to connect detached land.
  - `cutsSkipped`, the number of candidate lines skipped, and `strayCapRejected`, how many of those were skipped because their stray pieces held more people than the stray cap allows. The rest of `cutsSkipped` are lines whose sides were not each one connected piece.
  - `strayBlocksMoved` and `strayPopMoved`, the blocks and people moved by the stray rule, net per block with both directions summed, over all cuts.
  - `balanceMoves`, the number of blocks the balancing pass moved. It is 0 in `before-balancing/`.
  - `angleStepDeg`, the angle step used.
  - `runtimeMs`, the run time of the whole state.
  - `assignmentSha256`, the SHA-256 hash of `assignment.csv`.
  - `nodeVersion`, the Node.js version that ran the generator, and `inputSha256`, the SHA-256 hash of the state's Census zip file. Neither feeds into `assignmentSha256`.
- `borders.geojson` holds the lines where districts meet, ready to draw on a map.
- `districts.geojson` holds each district's shape.
- `cuts.geojson` holds the straight guide line chosen for each cut, with its angle and the length of the real border it produced, so the recursive splitting can be followed step by step.
