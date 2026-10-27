# str-redistricting

## What this is
Live site: https://fairmaps.melson.us

Chris Melson's redistricting algorithm: shortest splitline, deterministic, partisan-blind, reproducible by anyone.

It draws maps for three chambers: the Federal House, the State House and the State Senate. Each chamber is drawn independently by the same rule. The number of districts in a federal map is the state's apportionment. The number of districts in a state chamber is counted from the Census Bureau's state legislative district files (the count of distinct districts; nothing else is taken from them). A chamber a state does not have, such as Nebraska's House, has no map.

The repository has two parts:

1. **The generator** (`src/server/`) pulls population data directly from the U.S. Census Bureau and draws every district map in three fixed steps: cut (repeatedly split a state with the straight guide line whose real border is shortest, among those that divide its population in the required ratio and leave each side in one connected piece, until each piece is one district), keep census blocks whole, and balance (move single border blocks between neighboring districts when that brings them closer to equal population, or leaves them exactly as close and shortens the border). It uses no partisan data, no election results, no incumbent addresses and no race data. Anyone can run it and get the identical maps.
2. **The viewer** (`src/client/`) is a web app for browsing the generated maps.

### Versions
Six things have a version, because they change for different reasons. All six live in one file, `config/versions.json`, and each has its own changelog in `changelog/`.

The engine, the schema, the web viewer and the docs read `MAJOR.MINOR.PATCH`, and the three parts mean the same thing in each:

- **Major**: something that already existed changes. For the engine, at least one map would come out different. For the schema, a reader written for the old files breaks.
- **Minor**: something is added and nothing that existed changes.
- **Patch**: a fix only.

The input is a Census vintage plus a revision count (`census-2020` revision `1`). The maps are a whole number.

| Component | Looks like | Moves up when | Changelog |
| --- | --- | --- | --- |
| Engine | `1.0.0` | the code in `src/server/` that draws maps changes | `changelog/engine.md` |
| Input | `census-2020` revision `1` | a pinned Census file changes (`config/census-sha256.json`, `config/enacted.json`). The vintage names the census; the revision counts reissues and new pins | `changelog/input.md` |
| Maps | `1` | the published maps change. One maps release is one complete, consistent set of maps | `changelog/maps.md` |
| Schema | `1.0.0` | the shape of the published and exported files changes | `changelog/schema.md` |
| Web | `1.0.0` | the viewer in `src/client/` changes | `changelog/web.md` |
| Docs | `1.0.0` | `docs/` or this README changes, or copy-only edits to the viewer | `changelog/docs.md` |

Some versions move because another one did:

| When this moves | This also moves |
| --- | --- |
| Engine major | Maps |
| Input revision | Maps |
| The published maps change (new or different maps in `public/data/index.json`) | Maps |
| Engine minor or patch | nothing else |
| Schema | Web, if the viewer reads the new field |
| Web, Docs | nothing else |

**Versions are enforced.** `enforce` in `config/release.json` is `true`: a pull request that changes a component without moving its version fails the version check, the fixture check fails when a fixture map changes without a new engine major version, and `publish-data` refuses to replace a published map that changed under the same engine major version and Census input. Every component version that changes gets a tag when the change reaches `main`. The 1.0 tags are `engine-v1.0.0`, `input-census-2020-r1`, `maps-1`, `schema-v1.0.0`, `web-v1.0.0` and `docs-v1.0.0`. Reverting a release commit makes the tag job fail, because the earlier version's tag already exists at another commit; to undo a release, make a new release with higher numbers instead.

The same engine version and the same input revision always draw the same map. That is the point of the engine and input versions, and it is checked: a few states (`fixtureStates` in `config/release.json`: Vermont with one seat, Rhode Island with two, Nevada with four and Connecticut with five, so a single district, one cut, a recursive split and an odd split inside an odd split are all exercised) are drawn on every pull request and compared with the fingerprints (the assignment before balancing and the finished one) recorded in `tests/fingerprints/engine.json` on the branch being merged into (never the pull request's own copy). If a map changed but the engine's major version did not go up, or the new fingerprints were not recorded with it, the check fails.

Commands:

```bash
npm run release          # propose and commit the next versions from the commits since each component's newest tag; running it again changes nothing
npm run release -- --dry-run   # show what it would do, change nothing
npm run version:check -- --base origin/main   # what CI runs on a pull request: did the versions move with the changes?
npm run release:tags -- --before <sha> --after <sha>   # the tags a commit introduces (what the tag workflow uses)
npm run fingerprints -- --check --base origin/main   # redraw the fixture states and compare with the base branch (--record writes them; --states limits them)
npm run census:watch -- --check --report report.json   # ask the Census Bureau whether a pinned file was reissued (--record notes what it serves now)
```

`release` reads commit subjects in the conventional form (`feat:`, `fix:`, a `!` for a breaking change), decides which components each commit touched from the file paths in `config/release.json` (published data under `public/data/` belongs to no path rule: the maps release follows the content hashes in `public/data/index.json`), and writes the new versions plus a dated entry in each moved component's changelog. It commits; it never pushes or tags. Publishing data with `npm run publish-data` stamps every state with the versions in `config/versions.json` and refuses to replace a published map (finished or before balancing) that changed without a new engine major version or a change to that state's census input.

Five GitHub workflows run the checks: `standards.yml` (on pull requests: typecheck, layer rules, tests, the version check and the fixture fingerprints), `census-cache.yml` (keeps the Census files the fixture fingerprints need cached on `main`, when the pinned file list changes and twice a week), `tag-release.yml` (creates the tags after a merge to `main`, and only once `enforce` is on and the previous commit already had `config/versions.json`), `census-watch.yml` (monthly, opens an issue if the Census Bureau reissued a pinned file, and another for files it could not check) and `enacted-update.yml` (the monthly enacted districts check described below, which also moves the input revision and maps release when it adopts a new file).

On the site:

- The footer names the maps release, engine, Census vintage and revision, and site version, and links to the changelog and the privacy page.
- `/changelog` lists what changed in each release, per component.
- `/privacy` says what the site counts, keeps in the browser and sends elsewhere. `tests/client/privacy-page.test.ts` checks its claims against `vercel.json`, the built pages' analytics tags, the path-only hook and the browser storage the code uses.
- Pages use real paths: `/how`, `/faq`, `/changelog`, `/privacy`, `/<ST>/d/<n>` for one district. Links written with the old `#/` form (for example `/#/CO/d/3`) still work and are rewritten to the path form on load.
- To embed the viewer in a page you do not control, set `window.STR_VIEWER_CONFIG = { dataBase: '…' }` before the script loads. Links and the address bar then use `#/` and the host page's own path is left alone. Embedders can set `routing: 'path'` in the same object to opt in to real paths. `dataBase` in the same object points the viewer at another copy of the published data.
- Each state's proof panel shows the engine version and the maps release that drew it, and its "reproduce" command checks out the matching tag (`git clone --branch maps-<n> --depth 1 ...`), so you rebuild that state with exactly the code that drew it.
- Every map carries a small credit line with the site address, the maps release, the engine and the first characters of the map's fingerprint, so a screenshot says where it came from.
- `/<ST>` (for example `/CO`) is a share link for one state's Federal House map. `/<ST>/house` and `/<ST>/senate` share the State House and State Senate maps. Each shows a preview image of its districts (`public/data/<ST>/og.png`, `public/data/<ST>/state-house/og.png` or `public/data/<ST>/state-senate/og.png`) when pasted into a chat or social post, and sends people to the map. The image and the page description carry the line "Drawn by a rule, not by politicians." The Share button on each state page shares this link (the phone's share sheet on touch screens, the clipboard elsewhere).

## Run locally
Runs on Node.js 24. The maps depend only on the census data and the method: the same inputs give the same map on any computer.

```bash
npm install
npm test
npm run explore -- --states CO
```

To browse the maps in the viewer:

```bash
npm run publish-data   # writes public/data/ from the generated plans in out/
npm run dev            # serves the viewer locally
npm run build          # builds the static site into dist/, with public/data copied in
```

`explore` flags. `--chamber` picks what to draw: `federal-house` (the default), `state-house` or `state-senate`. `--states` is required and takes two-letter state abbreviations, comma separated (for example `RI,CT,CO`). A state that fails is reported in the summary table and the run continues with the others. `--out-dir` sets the output directory (default `out`). `--cache-dir` sets where downloaded Census files are kept (default `data/raw`). `--threads` sets how many threads sweep the directions for each cut (default: the computer's hardware threads minus two, lowered to one thread per 400 MiB of free memory; `1` uses a single thread). The thread count never changes a map. A state whose folder already holds plans drawn from the same Census file, seat count, engine major and code is skipped and reported as unchanged; `--force` draws it again anyway. `docs/explanation/how-districts-are-drawn.md` lists exactly what is compared.

The finished map for each state is written to `out/<state>/` for the Federal House, and to `out/<state>/state-house/` or `out/<state>/state-senate/` for a state chamber. Drawing one chamber never touches another's folder. A state with no such chamber is reported and nothing is written. The same files for the plan before the balancing pass are written to `out/<state>/before-balancing/`. `docs/explanation/how-districts-are-drawn.md` explains the three steps and every output file.

`npm run publish-data` turns the generated plans into web-ready files in `public/data/` for the viewer. It reads every state that has a plan in `out/`. `--chamber` picks the chamber, with the same three values as for `explore` (default `federal-house`): a state chamber's files go to `public/data/<state>/state-house/` or `public/data/<state>/state-senate/`, the Federal House files stay in `public/data/<state>/`, and publishing one chamber leaves the other chambers' map files alone. The shared files (`index.json`, `versions.json` and `states.topo.json`) are rewritten on every publish, and the version check reads every published chamber's `stats.json`. `--states` limits the heavy work to the listed states and is optional here (the same abbreviations as above). `--cache-dir` (default `data/raw`), `--out-dir` (default `out`, where the plans are read) and `--public-dir` (default `public/data`) set the three directories. Every state is stamped with the component versions from `config/versions.json`, and `publish-data` refuses to replace a published map that changed under the same engine major version and census input (bump the engine with `npm run release`). It also refuses a plan whose `metrics.json` records no engine, a different engine major, a census hash other than the pinned one, a line search other than the exact one, or a plan without a complete run stamp from the current code (re-run `explore` for that state), and a `--states` entry that has no plan in `out/`. `--baseline` skips only that replacement check (for states that carry no stamp yet), never the run-stamp check, to stamp data published before versioning existed. `public/data/versions.json` moves to the current versions only once every published state carries them. It also downloads four Census Bureau boundary files, all for display only; none of them affects how districts are drawn:

- the state outlines (`cb_2025_us_state_20m`)
- the county names (`cb_2020_us_county_20m`)
- the state land outlines clipped to the shoreline (`cb_2020_us_state_500k`), used to mask the water the census blocks cover
- the enacted Federal House districts of the pinned Congress (the file `config/enacted.json` names, or an earlier release of the same Congress listed there)

The enacted Federal House districts are pinned to one Congress, the one named in `config/enacted.json`. If the Census Bureau serves none of the files listed there, `publish-data` stops with an error naming what it tried; it never falls back to another Congress. The Congress and the file names live in one place, `config/enacted.json`, which the publisher and the viewer both read.

Each chamber's map also gets `blocks.pmtiles`: the census blocks that sit on a district line, at full resolution, in one layer named `blocks` at zoom 13 only. A block is included when it shares a corner or an edge with a block of another district under the finished plan or under the plan before balancing. Each block carries its `geoid`, its population (`pop`), and its district under each plan (`finished`, `before`; 1-based, as in `assignment.csv`). The viewer uses it to show which blocks make up a district line at the highest zoom. `npm run publish-data -- --blocks-only` rebuilds just this file for the published states (or for those named by `--states`) from each state's published `blocks.json` and the cached census blocks. It needs nothing from `out/`, so it always matches the data already published. A state with a single district has no district line and gets no such file. Every other file is left untouched.

The enacted State House and State Senate districts come from per-state Census files (`cb_2025_<fips>_sldl_500k` and `cb_2025_<fips>_sldu_500k`) pinned at one vintage, 2025. They are shown for comparison and supply each chamber's number of districts; their shapes are never used to draw. The monthly check also watches for a newer legislative vintage and adopts it through a pull request. If a state's district count changed, that pull request also lists the state as needing a redraw; its stale map is refused at publish until it is drawn again.

The Federal House overlay updates itself. (The State House and State Senate overlays are described in the paragraph on state legislative districts above.) On the 3rd of each month the `Enacted districts update` workflow checks whether the Census Bureau has published a newer enacted Congress districts file (a newer release of the same Congress, or the next Congress). If it has, the workflow downloads and pins the file, rebuilds the overlay for all 50 states, runs the typecheck, dependency rules, tests and build, and opens a pull request. Review it and merge; nothing else is needed. For this to work the repository setting "Allow GitHub Actions to create and approve pull requests" (Settings, Actions, General) must be on. The workflow can also be started by hand from the Actions tab; its `force_file` input adopts a named file without asking the Census Bureau, which is how to test the update.

The same steps run locally for the Federal House overlay:

```
npm run enacted:check                                 # prints {"update":false} or {"update":true,"file":"cb_2027_us_cd120_500k",...}
npm run enacted:bump -- --file cb_2027_us_cd120_500k  # download, pin, rebuild the overlay
npm run publish-data -- --enacted-only                # rebuild the overlay from the pinned file alone
```

`enacted:check` only sends HEAD requests (falling back to a one-byte ranged GET) and exits non-zero if the Census Bureau cannot be reached. `enacted:bump` downloads the file into `data/raw/`, checks that it holds districts for every state, adds its SHA-256 to `config/census-sha256.json`, drops the entries of enacted files no longer in use, updates `config/enacted.json` and then runs `publish-data --enacted-only`. That mode rebuilds only `enacted.topo.json` and the `enactedSource` in `stats.json` for each published state. It reads the files already in `public/data/`, needs nothing from `out/`, accepts `--states`, `--cache-dir` and `--public-dir`, and leaves every other file untouched; run against the file the data was built from, it changes nothing. `enacted:bump` also takes `--cache-dir`, `--public-dir`, `--config-dir` and `--skip-publish`.

The "How it works" page shows worked examples taken from real runs. `npm run rule-examples` extracts them into `public/data/how/rule-examples.json`. It needs generated plans in `out/` for the states the examples use (run `explore` for them first) and the Census block files in `data/raw/` (downloaded by `explore`). The example that compares two independent runs also reads a second set of plans in `out-repeat/` (run `explore --out-dir out-repeat` for the same states); without it, that example is recorded as missing. Its flags: `--out-dir` (default `out`), `--repeat-dir` (default `out-repeat`), `--raw-dir` (default `data/raw`), `--dest` (default `public/data/how/rule-examples.json`) and `--threads` (default: hardware threads minus two, lowered to one per 400 MiB of free memory; the thread count never changes the result).

The number of districts in each state chamber lives in `config/legislative-districts.json`, which is generated and never edited by hand. `npm run legislative:count` reads each state's pinned Census state legislative district file, counts the distinct districts (skipping only `ZZZ`, the Census Bureau's code for area in no district) and writes the file. `npm run legislative:count -- --check` recomputes the counts and fails if the file disagrees, which is what CI runs. `npm run legislative:pin` downloads the per-state legislative files at the pinned vintage and records their SHA-256 in `config/census-sha256.json`.

Every Census file is downloaded once into `data/raw/` and checked against a pinned SHA-256 in `config/census-sha256.json`, both when it is downloaded and each time the cached copy is reused, so the maps are always built from the exact same bytes. A failed or interrupted download is retried up to three times. If a file fails the check, the cached copy is corrupt or the Census Bureau has reissued it: delete the file to download it again, and if the new file still differs, the Census Bureau reissued it, so update the manifest only knowing that it changes the maps.

## Representative data
State pages show who represents an address and let a visitor ask those people to adopt the rule. The names come from two open sources, pinned by SHA-256 in `config/reps-sources.json`:

- U.S. House and Senate members from the [congress-legislators](https://github.com/unitedstates/congress-legislators) files, which are public domain.
- State legislators from the [Open States](https://open.pluralpolicy.com/) people files (`data.openstates.org/people/current/<st>.csv`), released under CC0.

`npm run reps:pin` downloads the files into `data/raw/reps/` and records their hashes in `config/reps-sources.json`. `npm run reps:publish` checks every file against those hashes and writes `public/data/reps/<ST>.json` (one file per state) and `public/data/reps/coverage.json`, which lists, for each state and chamber, how many districts were matched and which district codes found no person. Both take `--cache-dir`, `--config-dir` and `--public-dir`. Party is never written to the published files.

Two small files fix what the sources cannot say. `config/reps-district-aliases.json` maps a district code as the Census Bureau writes it to the code (or codes, separated by `|`, for a district with several seats) the source uses, such as `AK:state-senate:00A` to `A` or `ID:state-house:001` to `1A|1B`. `config/reps-vacant-seats.json` lists U.S. House seats that are vacant (for example `FL-20`) so they show as vacant, not as missing.

## The backend
Signatures, notes and removal requests are handled by a small backend: serverless functions on Vercel and a Supabase Postgres database. It is configured only through environment variables, read once at boot by `src/server/shared/config/backend.ts` (the Postgres one is read by `build/migrate.ts`). The names:

- `NEXT_PUBLIC_BACKERS_SUPABASE_URL`, `BACKERS_SUPABASE_SECRET_KEY` and `BACKERS_POSTGRES_URL_NON_POOLING` for the database
- `RESEND_API_KEY` for sending mail, plus the optional `SIGNON_FROM`
- `TURNSTILE_SECRET_KEY` for the bot check
- `SIGNON_HASH_SECRET` and `SIGNON_ENCRYPTION_KEY` (each base64 of 32 bytes) for hashing and sealing personal data
- `SITE_ORIGIN` (default `https://fairmaps.melson.us`), `EMAIL_DAILY_CAP` (default 20) and `CRON_SECRET` (you create it: 16 or more random characters, as a Production environment variable in Vercel; Vercel then sends it as a bearer token on the daily cron call, and without it the daily mail job cannot authenticate and nothing queued is sent)

Migrations are the numbered files in `supabase/migrations/`. They are append-only: a file that was applied and then edited, or removed, stops the build. `npm run build` applies the ones not yet recorded, but only in the Vercel production build (`VERCEL_ENV=production`); preview builds and local builds skip it.

Every file in `api/` is a thin wrapper of at most 15 lines that imports one handler from `src/server/api/`. The logic, validation and error mapping live in `src/server/`, and the browser code in `src/client/` never imports it.

Mail goes through a queue. A confirmation or removal email is written to the outbox, and a daily job (`/api/cron-drain`) sends what fits under `EMAIL_DAILY_CAP`; removal emails are limited to half of each day's cap, and confirmations carry on past that. The same job also deletes old rate-limit rows and unconfirmed sign-ups whose link went out and expired more than a week ago (the sign endpoint does it too). A sign-up whose email has not been sent, queued or never sent, is never deleted for age: it is kept until the email goes out. While an email is queued, the address is stored sealed in the outbox row and is deleted when the email is sent. A removal link opens a page that does nothing until the person presses its button, and that button deletes the signer and their note.

## Pledges
`/pledges` lists public statements of support for the rule. Each entry in `config/pledges.json` needs a name, an office, a state, a district where one applies, and a URL where the statement can be read; party is never listed. To add one, open a GitHub issue with the "Add a pledge" form, or send a pull request that edits `config/pledges.json`. An entry is listed only if its statement URL shows the pledge publicly.

## Notes
A person who signs can add a note of up to 280 characters, and choose whether it is shown on the site and whether it is shared with their representative. Notes are screened by rules in `config/note-rules.json`:

- A note is rejected, and the sender sees why, if it is over 280 characters or holds a link or handle, an email address, a phone number, a street address or a blocked word (whole word, after normalizing case, accents and letter swaps).
- A note that uses a party or election word (for example "vote for" or "defeat") or seems to name a person is flagged. Flags only help the reader decide; they never publish or reject.
- Every note that passes is stored as pending. Nothing is shown or shared until it has been approved by hand in the database table editor.

The blocked-word list starts from the `badwords-list` npm package (version 1.0.0, MIT License, Copyright (c) 2013 Maurice Butler). The rules file records which upstream entries were removed and which words this project added; the license text is in `NOTICE`.

## Deploy
Deployed on Vercel at https://fairmaps.melson.us (the `str-redistricting.vercel.app` address also serves it) from the `main` branch: every push to `main` builds the site with `npm run build` and serves the static output in `dist/` (settings in `vercel.json`). `vercel.json` sets a Content-Security-Policy, a no-referrer policy, `nosniff`, a restrictive Permissions-Policy and long-lived caching for built assets. `public/_headers` carries the same headers for hosts that read that file, such as Cloudflare Pages. The outside requests the viewer makes are the address lookup, a script from the Census Bureau geocoder, and, only when the sign-on form is opened or the `/remove` page loads, the Cloudflare Turnstile bot check (a script and a frame from `challenges.cloudflare.com`); the policy allows both. Built pages also load Vercel Web Analytics from the site's own `/_vercel/insights/` path (added by `build/web-analytics.ts`, left out of the dev server), after `public/va-path-only.js`, which makes it send each page's path without the query or fragment. It counts page views without cookies; it reports nothing until Web Analytics is turned on for the project in Vercel.

## Where secrets live
The Census data and the representative data come from public endpoints and need no keys. The backend's keys are environment variables set in the hosting dashboard; they are never in the repository (see "The backend" for the names).

## License
The code is licensed under the [Apache License 2.0](LICENSE). You may use, change and redistribute it, including commercially, as long as you keep the copyright notice and pass along the [NOTICE](NOTICE) file, which credits the original work.

The published maps and data in `public/data/` and the documentation in `docs/` are licensed under [Creative Commons Attribution 4.0](LICENSES/CC-BY-4.0.txt). You may reuse them for any purpose if you credit "Chris Melson, fairmaps.melson.us" and note any changes you made.

The Census Bureau population counts and boundary files the maps are built from are public domain.
