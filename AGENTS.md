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
- Generate maps: `npm run explore -- --states CO` (`--states` is required; `--chamber federal-house|state-house|state-senate` picks the chamber, default `federal-house`; `--threads N` sets the threads that search each cut, default hardware threads minus two, at most one per 400 MiB of free memory; a state drawn earlier from the same inputs and code is skipped, `--force` redraws it)
- Publish web-ready data to `public/data/`: `npm run publish-data` (`-- --chamber state-house|state-senate` for a state chamber). Runs for different chambers or states can go at the same time: each file is replaced through a rename, and the index and versions files are rebuilt one run at a time under a lock
- Count state chamber districts from the pinned Census files: `npm run legislative:count` (`-- --check` fails if `config/legislative-districts.json` disagrees). Pin the per-state legislative files: `npm run legislative:pin`
- Look for a newer enacted districts file: `npm run enacted:check`; adopt one: `npm run enacted:bump -- --file cb_2027_us_cd120_500k` (rebuilds only the overlay files: `npm run publish-data -- --enacted-only`, which covers the US House only; add `--chamber state-house` or `--chamber state-senate` to rebuild those overlays)
- Extract the How it works examples: `npm run rule-examples`
- Propose and commit the next component versions: `npm run release` (`-- --dry-run` to preview). Check a branch against its base: `npm run version:check -- --base origin/main`. Tags a commit introduces: `npm run release:tags -- --before <sha> --after <sha>`
- Redraw the fixture states and compare with `tests/fingerprints/engine.json`: `npm run fingerprints -- --check --base origin/main` (`--record` writes new ones)
- Ask the Census Bureau whether a pinned file was reissued: `npm run census:watch -- --check --report report.json` (`--record` stores what it serves now)
- Publish over data made before versioning existed: `npm run publish-data -- --baseline`
- Pin the open representative data sources: `npm run reps:pin`; publish them to `public/data/reps/`: `npm run reps:publish`
- Write the Markdown summary of a district's public notes and signer count (needs the backend variables): `npm run digest -- --key CO:us-house:03` (`--out file.md` writes a file)
- Database migrations in `supabase/migrations/` are applied by `npm run build`, only in a Vercel production build; any other build skips them
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

## Versions

Six components are versioned in `config/versions.json` (engine, input, maps, schema, web, docs), each with a changelog in `changelog/`. A change to a component's files comes with a version bump and a changelog entry; `npm run release` proposes both from the commit subjects, so write them as `feat:`, `fix:`, `docs:` and mark breaking changes with `!`. The README has the full table. Reverting a release commit makes the tag job fail, because the earlier version's tag already exists at another commit; to undo a release, make a new release with higher numbers instead.

## Documentation

`docs/` describes the system as it currently is. Keep it to explanations of how things work, with no change history or roadmaps. History lives in git.
