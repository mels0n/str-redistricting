# str-redistricting

## What this is
Live site: https://fairmaps.melson.us

Chris Melson's redistricting algorithm: shortest splitline, deterministic, partisan-blind, reproducible by anyone.

The repository has two parts:

1. **The generator** (`src/server/`) pulls population data directly from the U.S. Census Bureau and draws every district map in three fixed steps: cut (repeatedly split a state with the straight guide line whose real border is shortest, among those that divide its population in the required ratio and leave each side in one connected piece, until each piece is one district), keep census blocks whole, and balance (move single border blocks between neighboring districts when that narrows the population gap). It uses no partisan data, no election results, no incumbent addresses and no race data. Anyone can run it and get the identical maps.
2. **The viewer** (`src/client/`) is a web app for browsing the generated maps.

### Versions
Six things have a version, because they change for different reasons. All six live in one file, `config/versions.json`, and each has its own changelog in `changelog/`.

| Component | Looks like | Moves up when | Changelog |
| --- | --- | --- | --- |
| Engine | `1.0.0` | the code in `src/server/` that draws maps changes. A change that alters any map is a major version; a feature is a minor one; anything else is a patch | `changelog/engine.md` |
| Input | `census-2020` revision `1` | a pinned Census file changes (`config/census-sha256.json`, `config/enacted.json`). The vintage names the census; the revision counts reissues | `changelog/input.md` |
| Maps | `1` | the engine major or the input moved, or the published maps changed (the assignment or input hashes in `public/data/index.json`). Whole numbers: one maps release is one complete, consistent set of 50 states | `changelog/maps.md` |
| Schema | `1.0.0` | the shape of the published and exported files changes | `changelog/schema.md` |
| Web | `1.0.0` | the viewer in `src/client/` changes | `changelog/web.md` |
| Docs | `1.0.0` | `docs/` or this README changes, or copy-only edits to the viewer | `changelog/docs.md` |

**Versioning starts at the 1.0 release.** Until that release is cut, no version tags exist in this repository, `config/versions.json` holds the 1.0 baseline, and the version checks only warn (`enforce` in `config/release.json` is `false`). After it, every component version that changes gets a tag when the change reaches `main`: `engine-v1.0.0`, `input-census-2020-r1`, `maps-1`, `schema-v1.0.0`, `web-v1.0.0`, `docs-v1.0.0`. Reverting a release commit makes the tag job fail, because the earlier version's tag already exists at another commit; to undo a release, make a new release with higher numbers instead.

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

Four GitHub workflows run the checks: `standards.yml` (typecheck, layer rules, tests, the version check and the fixture fingerprints), `tag-release.yml` (creates the tags after a merge to `main`, and only once `enforce` is on and the previous commit already had `config/versions.json`), `census-watch.yml` (monthly, opens an issue if the Census Bureau reissued a pinned file, and another for files it could not check) and `enacted-update.yml` (the monthly enacted districts check described below, which also moves the input revision and maps release when it adopts a new file).

On the site:

- The footer names the maps release, engine, Census vintage and revision, and site version, and links to the changelog.
- `#/changelog` lists what changed in each release, per component.
- Each state's proof panel shows the engine version and the maps release that drew it, and its "reproduce" command checks out the matching tag (`git clone --branch maps-<n> --depth 1 ...`), so you rebuild that state with exactly the code that drew it.
- Every map carries a small credit line with the site address, the maps release, the engine and the first characters of the map's fingerprint, so a screenshot says where it came from.
- `/<ST>/` (for example `/CO/`) is a share link for one state. It shows a preview image of the state's districts (`public/data/<ST>/og.png`) when pasted into a chat or social post, and sends people to the map. The image and the page description carry the line "Drawn by a rule, not by politicians." The Share button on each state page shares this link (the phone's share sheet on touch screens, the clipboard elsewhere).

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

`explore` flags. `--states` is required and takes two-letter state abbreviations, comma separated (for example `RI,CT,CO`). A state that fails is reported in the summary table and the run continues with the others. `--out-dir` sets the output directory (default `out`). `--cache-dir` sets where downloaded Census files are kept (default `data/raw`). `--threads` sets how many threads sweep the directions for each cut (default: the computer's hardware threads minus two; `1` uses a single thread). The thread count never changes a map.

The finished map for each state is written to `out/<state>/`. The same files for the plan before the balancing pass are written to `out/<state>/before-balancing/`. `docs/explanation/how-districts-are-drawn.md` explains the three steps and every output file.

`npm run publish-data` turns the generated plans into web-ready files in `public/data/` for the viewer. It reads every state that has a plan in `out/`. `--states` limits the heavy work to the listed states and is optional here (the same abbreviations as above). `--cache-dir` (default `data/raw`), `--out-dir` (default `out`, where the plans are read) and `--public-dir` (default `public/data`) set the three directories. Every state is stamped with the component versions from `config/versions.json`, and `publish-data` refuses to replace a published map that changed under the same engine major version and census input (bump the engine with `npm run release`). It also refuses a plan whose `metrics.json` records no engine, a different engine major, a census hash other than the pinned one, or a line search other than the exact one (re-run `explore` for that state), and a `--states` entry that has no plan in `out/`. `--baseline` skips that check for states that carry no stamp yet, to stamp data published before versioning existed. `public/data/versions.json` moves to the current versions only once every published state carries them. It also downloads four Census Bureau boundary files, all for display only; none of them affects how districts are drawn:

- the state outlines (`cb_2025_us_state_20m`)
- the county names (`cb_2020_us_county_20m`)
- the state land outlines clipped to the shoreline (`cb_2020_us_state_500k`), used to mask the water the census blocks cover
- the enacted districts of the pinned Congress (the file `config/enacted.json` names, or an earlier release of the same Congress listed there)

The enacted districts are pinned to one Congress, the one named in `config/enacted.json`. If the Census Bureau serves none of the files listed there, `publish-data` stops with an error naming what it tried; it never falls back to another Congress. The Congress and the file names live in one place, `config/enacted.json`, which the publisher and the viewer both read.

Each state also gets `blocks.pmtiles`: the census blocks that sit on a district line, at full resolution, in one layer named `blocks` at zoom 13 only. A block is included when it shares a corner or an edge with a block of another district under the finished plan or under the plan before balancing. Each block carries its `geoid`, its population (`pop`), and its district under each plan (`finished`, `before`; 1-based, as in `assignment.csv`). The viewer uses it to show which blocks make up a district line at the highest zoom. `npm run publish-data -- --blocks-only` rebuilds just this file for the published states (or for those named by `--states`) from each state's published `blocks.json` and the cached census blocks. It needs nothing from `out/`, so it always matches the data already published. A state with a single district has no district line and gets no such file. Every other file is left untouched.

The overlay updates itself. On the 3rd of each month the `Enacted districts update` workflow checks whether the Census Bureau has published a newer enacted districts file (a newer release of the same Congress, or the next Congress). If it has, the workflow downloads and pins the file, rebuilds the overlay for all 50 states, runs the typecheck, dependency rules, tests and build, and opens a pull request. Review it and merge; nothing else is needed. For this to work the repository setting "Allow GitHub Actions to create and approve pull requests" (Settings, Actions, General) must be on. The workflow can also be started by hand from the Actions tab; its `force_file` input adopts a named file without asking the Census Bureau, which is how to test the update.

The same steps run locally:

```
npm run enacted:check                                 # prints {"update":false} or {"update":true,"file":"cb_2027_us_cd120_500k",...}
npm run enacted:bump -- --file cb_2027_us_cd120_500k  # download, pin, rebuild the overlay
npm run publish-data -- --enacted-only                # rebuild the overlay from the pinned file alone
```

`enacted:check` only sends HEAD requests (falling back to a one-byte ranged GET) and exits non-zero if the Census Bureau cannot be reached. `enacted:bump` downloads the file into `data/raw/`, checks that it holds districts for every state, adds its SHA-256 to `config/census-sha256.json`, drops the entries of enacted files no longer in use, updates `config/enacted.json` and then runs `publish-data --enacted-only`. That mode rebuilds only `enacted.topo.json` and the `enactedSource` in `stats.json` for each published state. It reads the files already in `public/data/`, needs nothing from `out/`, accepts `--states`, `--cache-dir` and `--public-dir`, and leaves every other file untouched; run against the file the data was built from, it changes nothing. `enacted:bump` also takes `--cache-dir`, `--public-dir`, `--config-dir` and `--skip-publish`.

The "How it works" page shows worked examples taken from real runs. `npm run rule-examples` extracts them into `public/data/how/rule-examples.json`. It needs generated plans in `out/` for the states the examples use (run `explore` for them first) and the Census block files in `data/raw/` (downloaded by `explore`). The example that compares two independent runs also reads a second set of plans in `out-repeat/` (run `explore --out-dir out-repeat` for the same states); without it, that example is recorded as missing. Its flags: `--out-dir` (default `out`), `--repeat-dir` (default `out-repeat`), `--raw-dir` (default `data/raw`), `--dest` (default `public/data/how/rule-examples.json`) and `--threads` (default: hardware threads minus two; the thread count never changes the result).

Every Census file is downloaded once into `data/raw/` and checked against a pinned SHA-256 in `config/census-sha256.json`, both when it is downloaded and each time the cached copy is reused, so the maps are always built from the exact same bytes. A failed or interrupted download is retried up to three times. If a file fails the check, the cached copy is corrupt or the Census Bureau has reissued it: delete the file to download it again, and if the new file still differs, the Census Bureau reissued it, so update the manifest only knowing that it changes the maps.

## Deploy
Deployed on Vercel at https://fairmaps.melson.us (the `str-redistricting.vercel.app` address also serves it) from the `main` branch: every push to `main` builds the site with `npm run build` and serves the static output in `dist/` (settings in `vercel.json`). `vercel.json` sets a Content-Security-Policy, a no-referrer policy, `nosniff`, a restrictive Permissions-Policy and long-lived caching for built assets. `public/_headers` carries the same headers for hosts that read that file, such as Cloudflare Pages. The one outside request the viewer makes is the address lookup, a script from the Census Bureau geocoder, which the policy allows.

## Where secrets live
None. Census data is downloaded from public endpoints.

## License
The code is licensed under the [Apache License 2.0](LICENSE). You may use, change and redistribute it, including commercially, as long as you keep the copyright notice and pass along the [NOTICE](NOTICE) file, which credits the original work.

The published maps and data in `public/data/` and the documentation in `docs/` are licensed under [Creative Commons Attribution 4.0](LICENSES/CC-BY-4.0.txt). You may reuse them for any purpose if you credit "Chris Melson, fairmaps.melson.us" and note any changes you made.

The Census Bureau population counts and boundary files the maps are built from are public domain.
