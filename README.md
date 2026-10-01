# str-redistricting

## What this is
Save the Republic's redistricting algorithm: shortest splitline, deterministic, partisan-blind, reproducible by anyone.

The repository has two parts:

1. **The generator** (`src/server/`) pulls population data directly from the U.S. Census Bureau and draws every district map with the shortest splitline rule: repeatedly cut a state with the shortest straight line that divides its population in the required ratio, until each piece is one district. It uses no partisan data, no election results, no incumbent addresses and no race data. Anyone can run it and get the identical maps.
2. **The viewer** (`src/client/`) is a web app for browsing the generated maps, built to be embedded in a public website.

Status: early exploration. The rules are still being settled, including whether a deterministic cleanup step is needed to balance district populations exactly.

## Run locally
```bash
npm install
npm run typecheck
```
Generator and viewer commands will be added as each part lands.

## Deploy
Nothing is deployed yet. The viewer is planned as a static site; this section will name its host and trigger once one exists.

## Where secrets live
None are required today. Census data is downloaded from public endpoints. If a Census API key is added later, it is read from a gitignored `.env` file and never committed.
