# str-redistricting

## What this is
Save the Republic's redistricting algorithm: shortest splitline, deterministic, partisan-blind, reproducible by anyone.

The repository has two parts:

1. **The generator** (`src/server/`) pulls population data directly from the U.S. Census Bureau and draws every district map with the shortest splitline rule: repeatedly cut a state with the shortest straight line that divides its population in the required ratio, until each piece is one district. It uses no partisan data, no election results, no incumbent addresses and no race data. Anyone can run it and get the identical maps.
2. **The viewer** (`src/client/`) is a web app for browsing the generated maps, built to be embedded in a public website.

## Run locally
```bash
npm install
npm run typecheck
```

## Deploy
Not deployed.

## Where secrets live
None. Census data is downloaded from public endpoints.
