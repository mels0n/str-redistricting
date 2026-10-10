# How districts are drawn

This page explains how the generator turns census counts into a map of U.S. House districts, in plain language. The map depends on the census data and a short method of three steps: cut, keep blocks whole, balance. Nobody chooses a starting point, a seed or a "preferred" outcome.

## What goes in

The generator reads three things for every census block in a state, from the 2020 census:

- the number of people counted in the block,
- the block's shape on the ground, and
- the block's internal point (the Census Bureau's `INTPTLAT20` and `INTPTLON20`), which is used to put blocks in order across a guide line and to measure island links (see [Every district is one connected piece](#every-district-is-one-connected-piece)).

That is all. It does not read party registration or voter records, election results or turnout, where officeholders or candidates live, current or past district lines, or race, ethnicity, age, income or anything else about people besides the count. The enacted districts of the current Congress are shown in the viewer for comparison only. County and city boundaries are not used to draw anything. Counties are only counted afterwards, for reporting. People are counted where the census counted them, with no adjustments, so a person in a prison is counted at the prison.

The number of districts for each state is the number of House seats the state received in the 2020 apportionment.

## Step 1: cut, and step 2: keep blocks whole

Start with the whole state.

1. Suppose the piece in hand has `n` seats. Split it into two sides that hold `floor(n/2)` and `ceil(n/2)` seats. A piece with 7 seats is split 3 and 4. A piece with 2 seats is split 1 and 1. The side the sliding guide line reaches first is the first side, and it gets its share of the seats; the other is the second side.
2. Consider a straight guide line in every possible direction. For each direction, the position of the line is set so that the people on one side match that side's share of the seats. When the two shares differ (an odd number of seats), each direction is considered twice: once with the smaller share on one side of the line and once with it on the other. There are infinitely many directions, but they fall into a limited number of ranges that give the same split, and each range is evaluated once (see [Every direction is covered](#every-direction-is-covered)).
3. Turn each candidate into a real border made of block edges. Any stray pieces join the side around them, and the line is slid so the people still split evenly (both described below). Then measure that border.
4. Pick the candidate whose real border is shortest, among those whose two sides are each one connected piece.
5. Repeat on each side until every piece has exactly one seat. Each piece becomes one district.

A state with N seats takes exactly N minus 1 cuts. Each piece is cut on its own, so the order in which pieces are processed does not change the result.

### Straight lines on a globe

A "straight line" here is a great circle, the path a plane through the center of the Earth traces on its surface. A line like that has no distortion to argue about.

Guide lines are defined in a gnomonic projection, a map projection in which every great circle is a straight line. The projection is centered on the center of the bounding box of all the blocks' internal points in the state. "North-south" (direction 0) is the meridian through that center. A direction is an angle measured clockwise from north-south in that flat plane, from 0 up to but not including 180 degrees (a half turn, since a line has no front or back). A block's position across a line is the distance of its projected internal point from the line, and two blocks sit at exactly the same distance only at the one direction where they swap places, which every range is checked between. Blocks whose internal points coincide go in GEOID order, the census block identifier, so the order is fixed.

### Blocks are never split

A census block is the smallest unit and is always kept whole. Once a guide line's direction is chosen, the blocks of the piece are ordered by how far their projected internal points sit across the line. The generator walks along that order, adding up population, until the first side holds as close to its share as whole blocks allow. If stopping just before or just after the block that crosses the target gets closer, it picks whichever is closer. If both are exactly equally close, or an empty block sits next to a side that is exactly on its share, the walk from one end of the order and the walk from the other end can stop in different places. Both stopping points are candidates, and the rules under [Ties](#ties) choose between them. The generator walks from the other end only where such a tie happens. Each side always holds at least one block.

The guide line only decides who goes on which side. The real border follows block edges, because every block belongs entirely to one side.

### Stray pieces and the re-count

Because blocks are assigned whole, a large block that straddles the guide line can leave a smaller block cut off from the rest of its side, such as a median strip inside a big lot. A block, or a connected group of blocks, cut off like this is a stray piece. For each candidate:

1. Place the blocks by their internal points, as above.
2. Settle the strays. On each side, every connected group of blocks other than the side's main body joins the other side, the side around it. The main body is the group with the most people; if two groups have exactly as many, the one holding the lower GEOID. Each round settles first the side that holds the piece's lowest GEOID, then the other side, and this is repeated until nothing moves.
3. A block that moves is fixed to its new side at once, and stays there for the rest of that cut: it never moves again, in a later pass or after a re-count. Fixed blocks count toward their side's groups like any other block. If a group cut off from its side's main body contains fixed blocks, its free blocks still join the other side, and its fixed blocks stay where they are.
4. Re-count. Redo the walk over the free blocks only, in the same order. The fixed blocks' people already count on their sides, so the first side's target is its share minus the people fixed on it. The stopping rule is the same: whichever total is closer, with both stopping points kept as candidates when they are exactly equally close. A side with no fixed blocks keeps at least one free block. The guide line moves to between the last free block of the first side and the first free block of the second side.
5. Repeat steps 2 to 4 until a strays pass moves no free block.

Every re-count follows at least one newly fixed block, and fixed blocks never become free, so a piece of `m` blocks needs at most `m` walks and the process always ends. If it ends with a fixed piece still cut off from its side (it cannot move back), that line's sides are not each one connected piece, so it fails the connectivity check below and the next shortest line is considered.

There is no limit on how many people a stray piece holds. A line that strands a big region still has to win on border length like every other line, and its border is measured after the strays have joined and the line has slid. A line may cross the piece's outline any number of times.

### How long a border is

The length of a candidate is the length of the real border between its two final sides: the sum of the lengths of all block edges that have a block of one side on one side and a block of the other side on the other. Lengths are measured along the surface of the Earth. Water inside the state counts as part of the state, so a bay or a lake does not shorten or break a border. Water blocks also connect the land on either side of them.

The Census Bureau publishes each block's outline as a list of corner points in longitude and latitude, to at most six decimal places of a degree (about 11 cm north-south). It publishes no lengths. Every length is computed from those corner points, in three steps:

1. **One stretch of outline.** Where two blocks share their outline, each straight stretch between two corner points is measured as the shortest path between those points over a sphere of radius 6,371,008.8 meters, the Earth's mean radius (the haversine formula). The shared stretch is measured once, from the corner points as published, so both blocks see the same number.
2. **One pair of neighbors.** All the stretches two blocks share are added together, giving one length for that pair, stored once as a whole number of micrometers. Island links (below) have length zero.
3. **One border.** The border of a candidate is the sum of the stored lengths of every pair of neighboring blocks that ended up on different sides.

The census gives block outlines to about 11 cm (six decimal places of a degree). Lengths are kept in whole micrometers only so that adding them up always gives exactly the same total; that unit is far finer than the outlines themselves.

Whole numbers add exactly, in any order. Two candidates often reach the same final border by different routes, for example after moving different stray pieces, and because the sum is exact they get exactly the same length every time, however the border was reached. Lengths are compared as these exact whole numbers.

The sine, cosine and arcsine in step 1 are computed by the generator's own code from basic arithmetic, not by the computer's math library, so every length comes out the same to the last digit on any computer.

### Every district is one connected piece

Two blocks are connected when they share an edge, and touching at a single corner does not count. A cut is accepted only if both of its sides are each one connected piece. If a cut would leave a side in two or more parts, the next shortest candidate is tried. Census blocks cover lakes, bays and coastal water, and a water block is a block like any other, so land on two shores is connected when blocks of the same district, water blocks included, join them. Some land is reached by no block at all, such as an island beyond the coastal water blocks. It is connected by island links, and links are chosen the way cuts are: measure every option and take the shortest. A block stands at its internal point, and a link's length is the distance along the surface of the Earth between the internal points of its two blocks.

1. Find every piece of the state that shared edges alone hold together. The piece with the most blocks is the connected land to start from.
2. Of every possible link between a block of the connected land and a block of a piece not yet connected, take the shortest. If two are exactly the same length, the one that joins the lower GEOID wins (the lowest GEOID on the connected land, then the lowest on the other piece).
3. That piece is now part of the connected land. Repeat step 2 until no piece is left.

Each link is the shortest one available, so together the links are the shortest set that connects every piece. An island links to whatever land is nearest, which is often another island rather than the mainland. The order the blocks are numbered in does not change which links are made, except where two possible links are exactly the same length (step 2).

A piece is a group of blocks, not a single island. The Census Bureau sometimes draws one block around a cluster of small islands, and those islands are then one block, so no link is drawn between them; a link goes only between pieces. In the map viewer, click a district to select it and zoom in: zoomed in, the map is drawn block by block, so a block that spans several islands shows as one shape, and the selected district's links stay on screen as dashed lines.

A link adds nothing to any border's length, and it counts toward connection only when both of its ends are on the same side. This is how a state with islands can be cut like any other. The number of links is reported as `bridges`.

### Ties

Borders are compared by their exact lengths, the sums of the stored whole-micrometer lengths described above. Two borders are tied only when those sums are exactly equal. Any shorter border wins, however small the difference; the stored unit is a bookkeeping choice, not a claim about how precisely the census outlines are known (about 11 cm).

The rule for choosing a cut is: the shortest border, then the sides nearer their fair shares of people, then GEOID. Ranges that give the same two sides are the same cut, so there is nothing to decide between them. Usually that is what a tie of exactly equal borders is. When two different cuts have exactly equal borders, two rules decide in turn.

1. Fair shares. A cut's fair share for its first side is the piece's people times the first side's seats, divided by the piece's seats. The cut whose first side has people nearer that share is used. Measured from the second side the distance is the same.
2. GEOID. If the distances are exactly equal too, for each cut take the side that holds the piece's lowest GEOID and list its blocks in GEOID order. Read the two lists together. At the first GEOID where they differ, the cut whose list has that GEOID (the lower one there) is used, and a list that ends first loses. In plain words: the lowest GEOID on which the two cuts disagree goes with the piece's lowest GEOID. If the lists are identical the cuts have the same two sides, and then the one with fewer seats on that side is used. That never happens in practice.

The candidates include the lines found by walking from the other end of the order (see [Blocks are never split](#blocks-are-never-split)), so the same rules choose between a line walked from one end and a line walked from the other. No direction is preferred over another. Exact ties between different cuts are rare on real census lengths.

Which range is drawn is a separate matter. Of the ranges that give the winning cut, the guide line is drawn at the middle of the first one going clockwise from north. This is a choice about drawing, not a rule for choosing the cut.

### Every direction is covered

The generator does not sample directions. It evaluates every straight line, which it can do because the problem has a simple structure.

Turn the guide line slowly through the half turn. The order in which the blocks are walked changes only at the moments when the line becomes parallel to the segment joining two blocks' internal points: at that moment those two blocks swap places. Between two such moments the order, and therefore the split, cannot change. The first side is the first part of the walk, so it can change only when the last block on the first side or the first block on the second side changes.

The generator follows this as the line turns. It keeps the first side in one ordered structure and the rest in another, together with the direction at which each pair of neighbors in the order would next swap, and it processes those swaps in order of direction. After a swap that touches the boundary between the two sides, it applies the stopping rule from above again, locally, to see whether the best stopping point moved. The same is done for every re-count, each of which has its own tracker over the free blocks.

Between two consecutive directions where anything changes, every pass produces the same split, hence the same strays, the same re-counts and the same border. So the half turn falls into ranges, and each range gives exactly one candidate, which is evaluated once. A range is a stretch of directions that give the same final sides. A state's first cut has roughly one range per block, and the shortest border is always in one of them.

Evaluating a range does not start from nothing. Each pass keeps its connected groups (blocks on the same side with the same fixed or free status) up to date as blocks move. When a block joins a side, the groups it touches merge. When a block leaves, a search runs outward from each of its neighbors in turn until only one search is still running, which shows whether the group split in two. The stray rule runs on this list of groups, and the blocks fixed by one pass are handed to the next pass as a short list. None of this changes a result, since each shortcut is exact; it only avoids repeating work.

### Why the result is exact and reproducible

No angle is ever computed to make a decision. A direction is the vector between two internal points, and "which swap comes first" or "which side of the line is this block on" is the sign of a small product of coordinate differences. The generator computes each sign with ordinary floating-point arithmetic when that is safe, and falls back to exact integer arithmetic when it cannot be sure (every double-precision number is a whole multiple of 2 to the power -1074, so exact integer arithmetic is always available). There is no tolerance, so the answer is the same on every computer.

The half turn is cut into chunks, handed to worker threads. A range that continues across the edge of a chunk is joined to its neighbor, so neither the number of chunks nor the number of threads can change a result. The number of chunks depends only on the size of the piece being cut.

## Step 3: balance

U.S. House districts must be as nearly equal in population as practicable. That is the standard the Supreme Court applied to congressional districts in Karcher v. Daggett (1983). Each cut places whole blocks so its two sides come as close to equal as whole blocks allow, counting the stray pieces that moved, but the small differences add up across many cuts. After all the cuts, the balancing pass moves single blocks across district borders to even out the populations.

It makes one move at a time. The ideal is the state's population divided by its number of seats, and the gap between two districts is the difference between their populations:

1. Start with the district whose population is furthest from the ideal, measured as the absolute difference, so 400 over and 400 under are equally far. If two districts are equally far, the one whose first block comes first in GEOID order goes first.
2. Look at the blocks along its border: its own blocks that touch a neighboring district, and the neighbors' blocks that touch it. A block may move to the district on the other side only if the move strictly narrows the population gap between the two districts involved and the district it leaves stays one connected piece. A block with no people never narrows a gap, so it never moves. The district it joins stays connected too, because the block touches it, so the pass never breaks a district apart.
3. Of the moves allowed, make the one that brings the districts closest to equal overall, measured as the sum of the squared differences between each district's population and the ideal. A tie goes to the trade that leaves the shorter total border: the length the block shares with the district it leaves, minus the length it shares with the district it joins, compared exactly (no rounding) with each sum added in the block's fixed neighbor order. A further tie goes to the block that comes first in GEOID order, and if one block could go to two neighboring districts with the same score and the same border change, to the receiving district whose first block comes first in GEOID order.
4. If the district furthest from the ideal has no allowed move, try the next furthest (equally far districts are ordered the same way as in step 1). After every move, start again from the district now furthest from the ideal.
5. Stop when no district has a move that helps.

Every move lowers the sum of squared differences, so the pass always stops. The number of moves is reported as `balanceMoves`.

People come whole, so the ideal is rarely a whole number: Missouri’s 6,154,913 people over 8 seats is 769,364.125 each. An **even split** means every district holds the ideal rounded down or up, here 769,364 or 769,365 people, or exactly the ideal when the population divides evenly. The viewer reports each district's distance from an even split in whole people: 0 when its population is one of those two sizes, otherwise the number of people above the larger or below the smaller. The percentage beside it is that whole-person distance as a share of the smaller size. This changes only how the numbers are shown; the balancing rule above still works from the exact ideal.

The map in `out/<state>/` is the finished map: the cuts above followed by the balancing pass.

## Same data, same map

The generator has no random numbers and no seed. Blocks are processed in GEOID order. Given the same census files, it produces byte-identical `assignment.csv` and GeoJSON files on any computer. The number of threads used for the search does not change them either. `metrics.json` is identical except for `runtimeMs` and `nodeVersion`, which record how long the run took and what ran it.

This holds because every number the generator computes comes from operations that give the same result everywhere. Addition, subtraction, multiplication, division and square root are rounded exactly the same way on every computer, and whole-number operations, comparisons and rounding to whole numbers are exact. Functions such as sine, cosine and arctangent are different: each JavaScript engine computes them its own way, so their last digit can differ from one engine or version to the next. The generator therefore never uses the engine's versions of those functions. It computes the sines, cosines, arctangents and arcsines it needs with its own code, built only from the exactly rounded operations above and accurate to within one unit in the last place, and a test fails if any of the engine's own versions appears in the generator's code. Each run writes a SHA-256 hash of the final assignment file into `metrics.json`, so two people can compare a single value to confirm they got the same map.

To reproduce a state's map, get the code from the project's repository, [github.com/mels0n/str-redistricting](https://github.com/mels0n/str-redistricting), and run the generator:

```bash
git clone https://github.com/mels0n/str-redistricting
cd str-redistricting
npm install
npm run explore -- --states CO
```

To get the map the site shows, use the code that drew it. Every published map names the maps release it belongs to (on the site, in the state's proof panel and the page footer), and each release has a tag in the repository, so clone that tag instead of the latest code:

```bash
git clone --branch maps-<n> --depth 1 https://github.com/mels0n/str-redistricting
```

Replace `<n>` with the Maps release number shown on the state's page, then run the same commands. The tag pins both the engine version and the Census file checksums (`config/census-sha256.json`), so the same inputs go through the same code. Maps published before versioning began have no release number; for those the latest code is the nearest match. Release tags start with the 1.0 release. What changed in each release is on the site's changelog page.

`--states` is required. The state is given by its two-letter abbreviation. A list such as `--states CO,NC` runs several states in turn. `--threads` sets how many threads sweep the directions for each cut; the default is the computer's hardware threads minus two, lowered to one thread per 400 MiB of free memory (at least one), and `--threads 1` searches on a single thread. The census block file for each state is downloaded from the U.S. Census Bureau the first time it is needed and kept in `data/raw/` (`--cache-dir` changes that, and `--out-dir` changes where the plans are written; the defaults are `data/raw` and `out`). If one state fails in a multi-state run, the command reports the error in the summary table, continues with the remaining states, and exits with a non-zero code at the end.

## Why a district can look strange

A strange shape is not a mistake. The generator runs the same steps in every state, and the map is whatever those steps produce. Nobody looks at the result and fixes it.

The generator doesn't know what a town, a county, a river, a highway or a neighborhood is. All it sees is how many people live in each census block and the block's shape. So a line can run through a city, split a county or cross a bay. Bays are made of census blocks too.

"It looks wrong" usually means it doesn't match a picture you already have, like the old district lines, the county map, or where you feel your area ends. People drew those pictures. Making the map match them would mean adding back the human choices this method leaves out.

Odd edges have plain causes. Stair steps come from following block edges and keeping every block whole. Notches and small bumps come from the balancing pass moving single blocks. A district crosses water because water is census blocks like any other, and island links join land no block reaches. The shortest border wins each cut, and the people, not a neat outline, decide where that is, so it sometimes leaves a long or thin piece.

Every border traces back to a cut or a balancing move, both of which can be replayed in the viewer, and anyone who reruns the generator gets the same map and the same fingerprint. The rules themselves, shortest border and equal population, were chosen once and up front. They apply to every state alike and were fixed before any map existed. Nobody chose any single line.

## What is written for each state

The finished map is in `out/<state>/`. The plan as it stood after the cuts and before the balancing pass is written to `out/<state>/before-balancing/` with the same files, so the effect of the balancing pass can be read directly from the numbers.

Each plan directory holds five files (the finished map's directory also holds `balance.json` and `inputs.json`, described below, and two diagnostic files):

- `assignment.csv` lists every block with its GEOID and the district number it belongs to. This is the map itself.
- `metrics.json` holds the following:
  - `state`, `seats`, `blocks`, `population` and `ideal` (the population divided by the number of seats), and `districts`, which lists for each district `district` (its number), `pop` (its population), `dev` and `devPct` (its difference from `ideal` in people and in percent, which keep the fraction; the viewer shows distance from an even split instead) and `contiguous` (whether it is one connected piece).
  - `rangePersons` and `rangePct`, the gap between the largest and smallest district in people and as a percentage of `ideal`.
  - `allContiguous`, whether every district is one connected piece.
  - `countiesSplit` and `countiesTotal`, for reporting only.
  - `bridges`, the number of joins made to connect detached land.
  - `cutsSkipped`, the number of distinct border lengths, shorter than the chosen one, that belonged only to ranges whose sides were not each one connected piece, over all cuts.
  - `strayBlocksMoved` and `strayPopMoved`, the blocks and people that joined the other side as strays on the chosen lines, over all cuts. A stray moves once and stays, so each block is counted once.
  - `recounts`, the number of re-counts made on the chosen lines over all cuts, and `recountsMaxPerCut`, the most made for any one cut. A cut with no strays has none.
  - `balanceMoves`, the number of blocks the balancing pass moved, and `peopleMovedByBalancing`, the total population of those blocks. Both are 0 in `before-balancing/`. `rangeBeforeBalancing` and `rangeAfterBalancing` give the gap between the largest and smallest district in people before and after the pass, in both plans.
  - `cuts`, the number of cuts, `candidateRangesPerCut`, the number of candidate ranges each cut evaluated (every range of directions, once per way of splitting the seats), and `candidateRangesEvaluated`, their total.
  - `lineSearch`, how the cut lines were searched; always `"exact"`.
  - `runtimeMs`, the run time of the whole state.
  - `assignmentSha256`, the SHA-256 hash of `assignment.csv`.
  - `nodeVersion`, the Node.js version that ran the generator, recorded for information only. `inputSha256`, the SHA-256 hash of the state's Census zip file, so a reader can confirm they started from the same data. Neither feeds into `assignmentSha256`.
- `borders.geojson` holds the lines where districts meet, ready to draw on a map.
- `districts.geojson` holds each district's shape.
- `balance.json` (finished map only) lists every balancing move in the order it was made, as the block's index and GEOID, the district it left and the one it joined (numbered from 1), its population and its gain, together with the district populations before the first move.
- `cut-stats.json` and `candidates.json` (finished map only) are diagnostic files, not used by the viewer or needed to reproduce a map. `cut-stats.json` records what each cut's search saw, including `threads`, the number of threads that ran the search, `fromDeg` and `toDeg`, the winning range of directions, `candidateRanges`, how many ranges were evaluated (including those walked from the other end), and `splitChanges`, how many times the split changed during the sweep, and `reversed`, true when the winning line is the one slid from the other end of the order, and `tiedRanges` and `tiedCuts`, the ranges at the winning length whose sides passed and the distinct cuts among them (2 or more means the tie rules decided), and four profiling counters: `tieSpanMs`, the milliseconds spent sweeping the tie stretches again from the other end, `derivedBuilds` and `reconfigs`, how often the sweep derived or re-aimed its trackers instead of building them from scratch, and `exactFallbacks`, how many direction comparisons were too close for rounded arithmetic and were decided in whole numbers. Only `tieSpanMs` depends on the machine and the thread count. `candidates.json` lists each cut's leading candidate ranges (the best few from each part of the half turn, resolved ranges only, at most 200, in the order the generator tries them, with the winning range first among those of its length; `lengthM` there is exact to the micrometer, while `cut-stats.json` rounds it to the meter), each with `lowSeats`, `fromDeg`, `toDeg`, `lengthM`, `lowPop` and `reversed` (1 when the line was slid from the other end, otherwise 0).
- `inputs.json` (finished map only) records what the state's plans were drawn from: `inputSha256`, the pinned SHA-256 of its Census block file, `seats`, `engineMajor`, `codeSha256`, a fingerprint of the generator's code, and `files`, every file the run wrote for the state with the SHA-256 of what was written. It is written after all of them, so a run that stops partway leaves a state without one.
- `cuts.geojson` holds the straight guide line chosen for each cut, after its re-counts, with its direction and the length of the real border it produced, so the recursive splitting can be followed step by step. Each cut also records how many seats it divides (`seats`, `lowSeats`, `highSeats`), `firstDistrict`, the 0-based number of the first district in its range, so each cut can be tied to the districts it separates, and `strayBlocks`, `strayPop` and `recounts`, the stray blocks and people that cut moved and the re-counts it made.

### Running a state again

`explore` skips a state whose folder already holds plans drawn from the same inputs. It compares the state's `inputs.json` with what this run would use and draws the state again when any of these differ, naming the reason as it starts:

- the pinned Census block file (a new file pinned in `config/census-sha256.json`),
- the number of seats,
- the engine major version,
- the code: every source file `explore` loads, including the cut search worker, and every installed package those files use, with its own dependencies. A change to any of them draws every state again, whether or not it would have changed a map. JSON configuration is not part of this fingerprint; the parts of it that decide a map are the pinned Census hash and the seat counts above.

A state is also drawn again when `inputs.json` is missing or unreadable, or when any file it lists is gone or no longer has the hash recorded for it, so a file that was cut short, copied over only partly, or rewritten by another run is never trusted. Checking those hashes takes seconds; drawing a state takes far longer. A skipped state keeps the `engine` and `nodeVersion` recorded in its `metrics.json` by the run that drew it. The thread count is not compared, since it never changes a map. `--force` draws every listed state regardless.

## Data for the map viewer

```bash
npm run publish-data
```

This reads the plans in `out/` and writes web-ready files to `public/data/` (`--states` limits it to some states; `--cache-dir`, `--out-dir` and `--public-dir` change the three directories): an `index.json` listing all 50 states with a summary for each state that has a plan, a `states.topo.json` of state outlines, and for each state with a plan:

- `districts.topo.json` and `before.topo.json`, the finished and before-balancing districts as simplified TopoJSON. Simplification runs along shared borders, so neighboring districts still meet exactly. These are the overview shapes, drawn when the whole state is in view, and are slightly coarser than the block-level `districts.geojson`.
- `detail.pmtiles`, the full-detail districts and the borders between them as vector tiles (zoom 7 to 13), for both plans. The viewer draws them in place of the overview shapes as the map is zoomed in, and they are never simplified at the deepest zoom.
- `blocks.json`, every block's district in both plans, which address search uses to name the exact district for an address.
- `blocks.pmtiles`, the Census blocks that touch a district line under either plan, at full resolution, as vector tiles in one layer named `blocks` at zoom 13 only. Each block carries its `geoid`, its population (`pop`), and its district under each plan (`finished` and `before`). The viewer shows these blocks at the highest zoom.
- `cuts.json`, the ordered guide lines with their direction, length, seat split, strays and re-counts.
- `stats.json`, the metrics for both plans (under `finished` and `beforeBalancing`) plus, for each district, the counties it touches and `landParts`, the number of separate pieces of land in the district, after clipping to the shoreline, that have people living on them. `landParts` is for display only. It carries the per-cut counts from `metrics.json` as `candidateRangesPerCut`.
- `balance.json`, the balancing moves in order, with each moved block's outline taken unsimplified from the Census block file (rounded to six decimals) and the district populations before the first move, so the pass can be replayed move by move.
- `enacted.topo.json`, the enacted districts for the state (the Congress named in `config/enacted.json`), for comparison only.
- `bridges.json`, the island links of the state. Each link lists its two end points and, for each end, the district it belongs to in the finished map and before balancing. The list is empty when the state has no links. The viewer draws a link as a dashed line when the selected district holds both ends.
- `water.topo.json`, the part of the state's districts that lies over water. Census blocks include water: they run out to the state's legal boundary, across lakes, bays and coastal water, so the districts drawn from them cover that water too. The mask is the area the districts cover, less the land in the Census Bureau's shoreline-clipped state outlines (`cb_2020_us_state_500k`). The viewer draws it as a pale wash over the districts so land stands out, and draws the selected district's water in full color. The water is part of each district and counts toward connection; the mask itself is for display only: no district, assignment, fingerprint, population or statistic depends on it.

The numbers, `assignment.csv` and `blocks.json` are never simplified.

The enacted districts, the state outlines and the county names come from the U.S. Census Bureau's cartographic boundary files, which are downloaded into `data/raw/`. They are used only for display and reporting. The generator never reads them, and they have no effect on any district drawn. `stats.json` records which file the enacted districts came from as `enactedSource`. The file is the one `config/enacted.json` names, or an earlier release of the same Congress listed there, so it shows the maps in use for that Congress. The source is pinned to that one Congress: if the Census Bureau serves none of those files, publishing stops with an error rather than using another Congress. The Congress and file names are kept in `config/enacted.json`, which the publisher and the viewer both read. A scheduled workflow checks each month for a newer file and opens a pull request that updates the overlay; the same steps run by hand as `npm run enacted:check` and `npm run enacted:bump -- --file <name>`, and `npm run publish-data -- --enacted-only` rebuilds just the enacted files (`enacted.topo.json` and `enactedSource`) from the published data. In the same way, `npm run publish-data -- --blocks-only` rebuilds just `blocks.pmtiles` from each state's published `blocks.json` and the cached Census blocks. The README has the details. A state that adopted a new map after that file was made is not reflected in it.

Alaska's western Aleutian Islands lie east of the 180th meridian, so the state has longitudes on both sides of it. In the published display files only, those longitudes continue past -180 (172 degrees east is written as -188), so the state is one continuous shape. The same shift is applied to its guide lines, balancing blocks and enacted districts. The files in `out/` are not changed.

A state with one seat (Alaska, Delaware, North Dakota, South Dakota, Vermont and Wyoming) needs no cut and has nothing to balance. Its published files hold the one district, an empty `cuts.json` and a `balance.json` with no moves. It has no district line, so it gets no `blocks.pmtiles`.
