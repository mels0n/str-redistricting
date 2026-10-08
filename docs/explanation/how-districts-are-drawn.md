# How districts are drawn

This page explains how the generator turns census counts into a map of U.S. House districts, in plain language. The map depends on the census data and a short method of three steps: cut, keep blocks whole, balance. Nobody chooses a starting point, a seed or a "preferred" outcome.

## What goes in

The generator reads three things for every census block in a state, from the 2020 census:

- the number of people counted in the block,
- the block's shape on the ground, and
- the block's internal point (the Census Bureau's `INTPTLAT20` and `INTPTLON20`), which is used only to put blocks in order across a guide line.

That is all. It does not read party registration or voter records, election results or turnout, where officeholders or candidates live, current or past district lines, or race, ethnicity, age, income or anything else about people besides the count. The 119th Congress districts are shown in the viewer for comparison only. County and city boundaries are not used to draw anything. Counties are only counted afterwards, for reporting. People are counted where the census counted them, with no adjustments, so a person in a prison is counted at the prison.

The number of districts for each state is the number of House seats the state received in the 2020 apportionment.

## Step 1: cut, and step 2: keep blocks whole

Start with the whole state.

1. Suppose the piece in hand has `n` seats. Split it into two sides that hold `floor(n/2)` and `ceil(n/2)` seats. A piece with 7 seats is split 3 and 4. A piece with 2 seats is split 1 and 1.
2. Try a straight guide line in every direction, one every 0.1 degrees, starting with north-south. For each direction, the position of the line is set so that the people on one side match that side's share of the seats. When the two shares differ (an odd number of seats), each direction is tried twice: once with the smaller share on one side of the line and once with it on the other.
3. Turn each guide line into a real border made of block edges. Any stray pieces join the side around them, and the line is slid so the people still split evenly (both described below). Then measure that border.
4. Pick the guide line whose real border is shortest, among those whose two sides are each one connected piece.
5. Repeat on each side until every piece has exactly one seat. Each piece becomes one district.

A state with N seats takes exactly N minus 1 cuts. Each piece is cut on its own, so the order in which pieces are processed does not change the result.

### Straight lines on a globe

A "straight line" here is a great circle, the path a plane through the center of the Earth traces on its surface. A line like that has no distortion to argue about.

The 1,800 guide lines are defined in a gnomonic projection, a map projection in which every great circle is a straight line. The projection is centered on the center of the bounding box of all the blocks' internal points in the state. "North-south" (direction 0) is the meridian through that center. Directions are every 0.1 degrees (`k` times 0.1 degrees) measured in that flat plane. A block's position across a line is the distance of its projected internal point from the line, and blocks at equal distance go in GEOID order.

### Blocks are never split

A census block is the smallest unit and is always kept whole. Once a guide line's direction is chosen, the blocks of the piece are ordered by how far their projected internal points sit across the line. The generator walks along that order, adding up population, until the low side holds as close to its share as whole blocks allow. If stopping just before or just after the block that crosses the target gets closer, it picks whichever is closer, and a tie goes to stopping just before. Blocks at the same distance are taken in GEOID order, the census block identifier, so the order is fixed. Each side always holds at least one block.

The guide line only decides who goes on which side. The real border follows block edges, because every block belongs entirely to one side.

### Stray pieces and the re-count

Because blocks are assigned whole, a large block that straddles the guide line can leave a smaller block cut off from the rest of its side, such as a median strip inside a big lot. A block, or a connected group of blocks, cut off like this is a stray piece. For each candidate guide line:

1. Place the blocks by their internal points, as above.
2. Settle the strays. On each side, every connected group of blocks other than the side's main body joins the other side, the side around it. The main body is the group with the most people, then the most blocks, then the lowest block position in GEOID order. The low side is settled, then the high side, and this is repeated until nothing moves.
3. A block that moves is fixed to its new side at once, and stays there for the rest of that cut: it never moves again, in a later pass or after a re-count. Fixed blocks count toward their side's groups like any other block. If a group cut off from its side's main body contains fixed blocks, its free blocks still join the other side, and its fixed blocks stay where they are.
4. Re-count. Redo the walk over the free blocks only, in the same order. The fixed blocks' people already count on their sides, so the low side's target is its share minus the people fixed on it. The stopping rule is the same: whichever total is closer, and a tie stops just before the block. A side with no fixed blocks keeps at least one free block. The guide line moves to halfway between the last free block of the low side and the first free block of the high side.
5. Repeat steps 2 to 4 until a strays pass moves no free block.

Every re-count follows at least one newly fixed block, and fixed blocks never become free, so a piece of `m` blocks needs at most `m` walks and the process always ends. If it ends with a fixed piece still cut off from its side (it cannot move back), that line's sides are not each one connected piece, so it fails the connectivity check below and the next shortest line is considered.

There is no limit on how many people a stray piece holds. A line that strands a big region still has to win on border length like every other line, and its border is measured after the strays have joined and the line has slid. A line may cross the piece's outline any number of times.

### How long a border is

The length of a candidate is the length of the real border between its two final sides: the sum of the lengths of all block edges that have a block of one side on one side and a block of the other side on the other. Lengths are measured along the surface of the Earth. Water inside the state counts as part of the state, so a bay or a lake does not shorten or break a border. Water blocks also connect the land on either side of them.

### Every district is one connected piece

Two blocks are connected when they share an edge, and touching at a single corner does not count. A cut is accepted only if both of its sides are each one connected piece. If a cut would leave a side in two or more parts, the next shortest candidate is tried. Census blocks cover lakes, bays and coastal water, and a water block is a block like any other, so land on two shores is connected when blocks of the same district, water blocks included, join them. Land that no block reaches, even across water, is linked to the nearest block of the growing main body, which includes islands already joined, so a state with islands can still be cut. These links are called island links, and their number is reported as `bridges`.

### Ties

Two borders whose lengths agree to the nearest centimeter are tied. A tie goes to the guide line closest to north-south. If two tied lines are equally close to north-south, the one with the smaller angle wins, and then the one whose low side has fewer seats.

### Which angles are tested

Guide lines are tested at every angle in a fixed step across a half turn. The default step is 0.1 degrees, which gives 1,800 directions. The step must divide 180 degrees exactly and can be changed with `--angle-step`. A different step can produce a different map, so the step is part of the recipe for reproducing a map and is recorded in `metrics.json`.

## Step 3: balance

U.S. House districts must be as nearly equal in population as practicable. That is the standard the Supreme Court applied to congressional districts in Karcher v. Daggett (1983). Each cut places whole blocks so its two sides come as close to equal as whole blocks allow, counting the stray pieces that moved, but the small differences add up across many cuts. After all the cuts, the balancing pass moves single blocks across district borders to even out the populations.

It makes one move at a time. The ideal is the state's population divided by its number of seats, and the gap between two districts is the difference between their populations:

1. Start with the district whose population is furthest from the ideal.
2. Look at the blocks along its border: its own blocks that touch a neighboring district, and the neighbors' blocks that touch it. A block may move to the district on the other side only if it has people, if the move strictly narrows the population gap between the two districts involved, and if the district it leaves stays one connected piece. The district it joins stays connected too, because the block touches it, so the pass never breaks a district apart.
3. Of the moves allowed, make the one that brings the districts closest to equal overall, measured as the sum of the squared differences between each district's population and the ideal. A tie goes to the block that comes first in GEOID order, then to the lower-numbered district it would join.
4. If the district furthest from the ideal has no allowed move, try the next furthest. After every move, start again from the district now furthest from the ideal.
5. Stop when no district has a move that helps.

Every move lowers the sum of squared differences, so the pass always stops. The number of moves is reported as `balanceMoves`.

People come whole, so the ideal is rarely a whole number: Missouri’s 6,154,913 people over 8 seats is 769,364.125 each. An **even split** means every district holds the ideal rounded down or up, here 769,364 or 769,365 people, or exactly the ideal when the population divides evenly. The viewer reports each district's distance from an even split in whole people: 0 when its population is one of those two sizes, otherwise the number of people above the larger or below the smaller. The percentage beside it is that whole-person distance as a share of the smaller size. This changes only how the numbers are shown; the balancing rule above still works from the exact ideal.

The map in `out/<state>/` is the finished map: the cuts above followed by the balancing pass.

## Same data, same map

The generator has no random numbers and no seed. Blocks are processed in GEOID order. Given the same census files and the same angle step, it produces byte-identical `assignment.csv` and GeoJSON files on any computer. The number of threads used for the search does not change them either. `metrics.json` is identical except for `runtimeMs` and `nodeVersion`, which record how long the run took and what ran it.

This holds because every number the generator computes comes from operations that give the same result everywhere. The IEEE 754 standard for floating-point arithmetic requires addition, subtraction, multiplication, division and square root to be rounded exactly the same way on every computer, and whole-number operations, comparisons and rounding to whole numbers are exact. The JavaScript language standard, on the other hand, lets each engine approximate sine, cosine, arctangent and similar functions in its own way, so their last digit can differ from one engine or version to the next. The generator therefore never uses the engine's versions of those functions. It computes the sines, cosines, arctangents and arcsines it needs with its own code, built only from the exactly rounded operations above (a port of the long-established fdlibm routines, accurate to within one unit in the last place), and a test fails if any of the engine's approximated functions appears in the generator's code. Each run writes a SHA-256 hash of the final assignment file into `metrics.json`, so two people can compare a single value to confirm they got the same map.

To reproduce a state's map, get the code from the project's repository, [github.com/mels0n/str-redistricting](https://github.com/mels0n/str-redistricting), and run the generator:

```bash
git clone https://github.com/mels0n/str-redistricting
cd str-redistricting
npm install
npm run explore -- --states CO
```

`--states` is required. The state is given by its two-letter abbreviation. A list such as `--states CO,NC` runs several states in turn. `--threads` sets how many threads search the guide lines for each cut; the default is the computer's hardware threads minus two, and `--threads 1` searches on a single thread. The census block file for each state is downloaded from the U.S. Census Bureau the first time it is needed and kept in `data/raw/` (`--cache-dir` changes that, and `--out-dir` changes where the plans are written; the defaults are `data/raw` and `out`). If one state fails in a multi-state run, the command reports the error in the summary table, continues with the remaining states, and exits with a non-zero code at the end.

## What is written for each state

The finished map is in `out/<state>/`. The plan as it stood after the cuts and before the balancing pass is written to `out/<state>/before-balancing/` with the same files, so the effect of the balancing pass can be read directly from the numbers.

Each plan directory holds five files (the finished map's directory also holds `balance.json`, described below, and two diagnostic files):

- `assignment.csv` lists every block with its GEOID and the district number it belongs to. This is the map itself.
- `metrics.json` holds the following:
  - `state`, `seats`, `blocks`, `population` and `ideal` (the population divided by the number of seats), and `districts`, which lists for each district `district` (its number), `pop` (its population), `dev` and `devPct` (its difference from `ideal` in people and in percent, which keep the fraction; the viewer shows distance from an even split instead) and `contiguous` (whether it is one connected piece).
  - `rangePersons` and `rangePct`, the gap between the largest and smallest district in people and as a percentage of `ideal`.
  - `allContiguous`, whether every district is one connected piece.
  - `countiesSplit` and `countiesTotal`, for reporting only.
  - `bridges`, the number of joins made to connect detached land.
  - `cutsSkipped`, the number of candidate lines ranked ahead of the chosen one but skipped because their sides were not each one connected piece, over all cuts.
  - `strayBlocksMoved` and `strayPopMoved`, the blocks and people that joined the other side as strays on the chosen lines, over all cuts. A stray moves once and stays, so each block is counted once.
  - `recounts`, the number of re-counts made on the chosen lines over all cuts, and `recountsMaxPerCut`, the most made for any one cut. A cut with no strays has none.
  - `balanceMoves`, the number of blocks the balancing pass moved, and `peopleMovedByBalancing`, the total population of those blocks. Both are 0 in `before-balancing/`. `rangeBeforeBalancing` and `rangeAfterBalancing` give the gap between the largest and smallest district in people before and after the pass, in both plans.
  - `cuts`, the number of cuts, `angleCount`, the number of directions tested per cut, `directionsPerCut`, the number of candidate lines each cut evaluated (every angle, once per way of splitting the seats), and `candidateLinesEvaluated`, their total.
  - `angleStepDeg`, the angle step used.
  - `runtimeMs`, the run time of the whole state.
  - `assignmentSha256`, the SHA-256 hash of `assignment.csv`.
  - `nodeVersion`, the Node.js version that ran the generator, recorded for information only. `inputSha256`, the SHA-256 hash of the state's Census zip file, so a reader can confirm they started from the same data. Neither feeds into `assignmentSha256`.
- `borders.geojson` holds the lines where districts meet, ready to draw on a map.
- `districts.geojson` holds each district's shape.
- `balance.json` (finished map only) lists every balancing move in the order it was made, as the block's index and GEOID, the district it left and the one it joined (numbered from 1), its population and its gain, together with the district populations before the first move.
- `cut-stats.json` and `candidates.json` (finished map only) are diagnostic files, not used by the viewer or needed to reproduce a map. `cut-stats.json` records what each cut's search saw, including `threads`, the number of threads that ran the search. `candidates.json` lists the candidate lines each cut evaluated.
- `cuts.geojson` holds the straight guide line chosen for each cut, after its re-counts, with its angle and the length of the real border it produced, so the recursive splitting can be followed step by step. Each cut also records how many seats it divides (`seats`, `lowSeats`, `highSeats`), `firstDistrict`, the 0-based number of the first district in its range, so each cut can be tied to the districts it separates, and `strayBlocks`, `strayPop` and `recounts`, the stray blocks and people that cut moved and the re-counts it made.

## Data for the map viewer

```bash
npm run publish-data
```

This reads the plans in `out/` and writes web-ready files to `public/data/` (`--states` limits it to some states; `--cache-dir`, `--out-dir` and `--public-dir` change the three directories): an `index.json` listing all 50 states with a summary for each state that has a plan, a `states.topo.json` of state outlines, and for each state with a plan:

- `districts.topo.json` and `before.topo.json`, the finished and before-balancing districts as simplified TopoJSON. Simplification runs along shared borders, so neighbouring districts still meet exactly. These are the overview shapes, drawn when the whole state is in view, and are slightly coarser than the block-level `districts.geojson`.
- `detail.pmtiles`, the full-detail districts and the borders between them as vector tiles (zoom 7 to 13), for both plans. The viewer draws them in place of the overview shapes as the map is zoomed in, and they are never simplified at the deepest zoom.
- `blocks.json`, every block's district in both plans, which address search uses to name the exact district for an address.
- `cuts.json`, the ordered guide lines with their angle, length, seat split, strays and re-counts.
- `stats.json`, the metrics for both plans (under `finished` and `beforeBalancing`) plus, for each district, the counties it touches and `landParts`, the number of separate pieces of land in the district, after clipping to the shoreline, that have people living on them. `landParts` is for display only. It carries the per-cut counts from `metrics.json` as `candidateLinesPerCut` (the generator's own file calls them `directionsPerCut`).
- `balance.json`, the balancing moves in order, with each moved block's outline taken unsimplified from the Census block file (rounded to six decimals) and the district populations before the first move, so the pass can be replayed move by move.
- `enacted.topo.json`, the districts of the 119th Congress for the state, for comparison only.
- `bridges.json`, the island links of the state. Each link lists its two end points and, for each end, the district it belongs to in the finished map and before balancing. The list is empty when the state has no links. The viewer draws a link as a dashed line when the selected district holds both ends.
- `water.topo.json`, the part of the state's districts that lies over water. Census blocks include water: they run out to the state's legal boundary, across lakes, bays and coastal water, so the districts drawn from them cover that water too. The mask is the area the districts cover, less the land in the Census Bureau's shoreline-clipped state outlines (`cb_2020_us_state_500k`). The viewer draws it as a pale wash over the districts so land stands out, and draws the selected district's water in full color. The water is part of each district and counts toward connection; the mask itself is for display only: no district, assignment, fingerprint, population or statistic depends on it.

The numbers, `assignment.csv` and `blocks.json` are never simplified.

The 119th Congress districts, the state outlines and the county names come from the U.S. Census Bureau's cartographic boundary files, which are downloaded into `data/raw/`. They are used only for display and reporting. The generator never reads them, and they have no effect on any district drawn. `stats.json` records which file the enacted districts came from as `enactedSource`. The file is the one named `cb_2025_us_cd119_500k` (or the 2024 release of the same Congress), so it shows the maps in use for the 119th Congress. The source is pinned to that one Congress: if the Census Bureau serves neither file, publishing stops with an error rather than using another Congress. The Congress and file names are kept in `config/enacted.json`, which the publisher and the viewer both read. A scheduled workflow checks each month for a newer file and opens a pull request that updates the overlay; the same steps run by hand as `npm run enacted:check` and `npm run enacted:bump -- --file <name>`, and `npm run publish-data -- --enacted-only` rebuilds just the enacted files (`enacted.topo.json` and `enactedSource`) from the published data. The README has the details. A state that adopted a new map after that file was made is not reflected in it.

Alaska's western Aleutian Islands lie east of the 180th meridian, so the state has longitudes on both sides of it. In the published display files only, those longitudes continue past -180 (172 degrees east is written as -188), so the state is one continuous shape. The same shift is applied to its guide lines, balancing blocks and enacted districts. The files in `out/` are not changed.

A state with one seat (Alaska, Delaware, North Dakota, South Dakota, Vermont and Wyoming) needs no cut and has nothing to balance. Its published files hold the one district, an empty `cuts.json` and a `balance.json` with no moves.
