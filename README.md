# str-redistricting

## What this is
Save the Republic's redistricting algorithm: shortest splitline, deterministic, partisan-blind, reproducible by anyone.

The repository has two parts:

1. **The generator** (`src/server/`) pulls population data directly from the U.S. Census Bureau and draws every district map with the shortest splitline rule: repeatedly cut a state with the shortest straight line that divides its population in the required ratio, until each piece is one district. It uses no partisan data, no election results, no incumbent addresses and no race data. Anyone can run it and get the identical maps.
2. **The viewer** (`src/client/`) is a web app for browsing the generated maps, built to be embedded in a public website.

## Run locally
Requires Node.js 24 (maps are reproducible on the same Node.js major version).

```bash
npm install
npm test
npm run explore -- --states CO
```

`--states` takes two-letter state abbreviations, comma separated (for example `RI,CT,CO`). A state that fails is reported in the summary table and the run continues with the others. `--angle-step` sets the guide line step in degrees (default 0.1). `--out-dir` sets the output directory (default `out`).

The official map for each state is written to `out/<state>/`. The same files for the plan before the balancing pass are written to `out/<state>/before-balancing/`. `docs/explanation/how-districts-are-drawn.md` explains the rules and every output file.

`npm run publish-data` turns the generated plans into web-ready files in `public/data/` for the viewer. It also downloads Census Bureau boundary files for state outlines, county names and today's enacted districts; these are for display only and never affect how districts are drawn.

## Deploy
Not deployed.

## Where secrets live
None. Census data is downloaded from public endpoints.
