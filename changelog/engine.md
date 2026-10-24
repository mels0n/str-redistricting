# Engine changelog

## 2.0.1 (2026-10-14)

Every map is drawn exactly as in 2.0.0.

- Each cut's record in `cut-stats.json` now counts the chunks of its main sweep that were split between threads while they ran (`splitChunks`), and of those, the chunks swept again whole on the calling thread (`resweptChunks`).
- The cached list of a chain's trackers is now cleared at the moment a spare tracker is taken into a pass, so it can never be read out of date.

## 2.0.0 (2026-10-13)

Bug fixes:

- Island links counted as zero length in a cut's border. A cut that separated land only at a link therefore had a border of zero and won however unevenly it split the people. A link now properly adds the distance between its two blocks' internal points (the same measure the link was built with) to the border of any cut whose sides meet across it.
- Balancing ignored equal moves that shortened the border. A move was made only when it lowered the sum of squared differences (a gain above zero), so a move that left the districts exactly as close (a gain of zero) was never made, even when it gave a shorter border, which for a shortest-border method is clearly an error. A move with a gain of zero is now made when it strictly shortens the border: people first, then border (the opposite of the cut step, which is border first, then people).

Other changes:

- Drawing is faster, with every map exactly as the rules draw it: neighbouring tie stretches are swept again with one shared start instead of one each, the trackers keep the direction points they reuse, and heavy chunks of a sweep are split between idle threads while they run. Texas's State Senate takes about 16 minutes instead of 42.

## 1.1.0 (2026-10-11)

- The engine can now draw a State House or a State Senate map as well as a Federal House map. Every chamber is drawn by the same rule and held to the same equal-population standard.
- A chamber's number of districts is the number of distinct districts in the Census Bureau's 2025 state legislative district files. Those files are pinned and their shapes are never used to draw.
- Maps are published for each chamber, and a newer Census legislative district file can be checked for and adopted.
- Federal House maps are drawn exactly as before.

## 1.0.0 (2026-10-11)

- First release. Each state is cut, again and again, along the straight line on the globe whose real border is shortest among those that split its people in the required ratio and leave both sides in one piece, until every piece holds one seat.
- Census blocks are always kept whole, and stray pieces join the side around them.
- Balancing moves single border blocks between neighboring districts when that narrows the population gap, comparing border lengths exactly in whole micrometers.
- Ties go to the shorter border, then the sides nearer their fair shares of people, then the GEOID. No tie is broken by direction.
- The side holding a piece's lowest GEOID gets the lower district numbers.
- The same engine version and Census input always draw the same map, whatever the computer or the number of threads.
