# Working in str-redistricting

This file is for anyone (or any tool) making changes to this repository. It
covers how to build and check the code and where things live. It does not
restate the code itself.

## Build, test, lint

- Install: `npm ci`
- Typecheck (server and client): `npm run typecheck`
- Layer rules: `npm run depcruise`
- Test: `npm test`
- Run the viewer: `npm run dev`
- Build the viewer into `dist/`: `npm run build`
- Generate maps: `npm run explore -- --states CO` (`--states` is required; `--threads N` sets the threads that search each cut, default hardware threads minus two)
- Publish web-ready data to `public/data/`: `npm run publish-data`
- Look for a newer enacted districts file: `npm run enacted:check`; adopt one: `npm run enacted:bump -- --file cb_2027_us_cd120_500k` (rebuilds only the overlay files: `npm run publish-data -- --enacted-only`)
- Extract the How it works examples: `npm run rule-examples`
- Lint: none

## Layout

Project type: **fullstack**. Two parts, each arranged as layers from top to bottom.

The map generator (command-line tool that downloads Census data and draws districts) lives under `src/server/`:

- `src/server/app/`
- `src/server/api/`
- `src/server/features/`
- `src/server/entities/`
- `src/server/shared/`

The map viewer (web app) lives under `src/client/`:

- `src/client/app/`
- `src/client/pages/`
- `src/client/widgets/`
- `src/client/features/`
- `src/client/entities/`
- `src/client/shared/`

Imports only point downward through this list. A layer never imports from a
layer above it, and slices inside a layer are reached only through their
`index.ts`. These rules are enforced by `.dependency-cruiser.cjs` and fail CI.

## Conventions

- Validate every inbound payload with a schema before using it.
- Configuration is read once, at boot, from a single module.
- Domain errors are typed and mapped to transport codes in exactly one place.

## Documentation

`docs/` describes the system as it currently is. Keep it to explanations of how things work, with no change history or roadmaps. History lives in git.
