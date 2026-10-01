# Working in str-redistricting

This file is for anyone (or any tool) making changes to this repository. It
covers how to build and check the code and where things live. It does not
restate the code itself.

## Build, test, lint

- Install: `npm ci`
- Typecheck: `npx tsc --noEmit`
- Layer rules: `npm run depcruise`
- Test: not yet set up
- Lint: not yet set up

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
- Database rows never leave the data layer as-is; map them to a transport type.
- Configuration is read once, at boot, from a single module.
- Domain errors are typed and mapped to transport codes in exactly one place.

## Documentation

`docs/` describes the system as it currently is. Keep it to final explanations of how things work: no decision logs, change history, or future plans. History lives in git.
