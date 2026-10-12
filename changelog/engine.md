# Engine changelog

## 2.0.0 (2026-10-12)

- Fixed: an island link added nothing to a border's length, so a cut that separated land only at a link had a border of zero and won however unevenly it split the people. Hawaii's State House split west Oahu from east Kauai that way, 40,898 people against 16,183, and balancing could not repair it. A link now adds its length, the distance between its two blocks' internal points, to the border of any cut whose sides meet across it.
- Fixed: balancing never moved a block with no people, because such a block cannot narrow a population gap. Empty blocks were left as notches that lengthened borders, and balancing could not reach across an empty block at the end of an island link. A block with no people now moves when the move shortens the total border and the district it leaves stays one connected piece. Moves of blocks with people still come first, and the pass still always stops.
- Maps of states with island links change at the cuts; every balanced map changes.

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
