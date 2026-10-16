# Typecheck

`npm run typecheck` runs `tsc --noEmit --checkJs -p jsconfig.json`.

The first slice is the closed set that already typechecks:

- `shared/` except `shared/bandBonds.js`; `shared/protocol.js` is checked too, including its imported cloud-save validators.
- `server/sim/rng.js`, `server/sim/detmath.js`, `server/sim/dir.js`, `server/sim/constants.js` (the last imports `GEO` from shared)
- `types/` — JSDoc for `Unit`, `DamageInfo`, the snapshot tuples, and the protocol message envelope; `web-globals.d.ts` declares only the shared UTF-8 `TextEncoder`, without enabling all browser or Node globals

`strict` is off. `tsc` does not read `jsconfig.json` on its own; the script passes `-p`.

## Widen it

Add one file or one folder to `jsconfig.json` `include`, then run `npm run typecheck`. Fix JSDoc that disagrees with the code in that folder. Leave `strict` off until the folder reports nothing. Do not add `@ts-nocheck`.

Suggested order once the sim split settles: `server/sim/grid.js`, `server/sim/body.js`, `server/sim/buffs.js`, then `server/sim/damage.js` against the typedefs in `types/core.js`. The sim does not import `types/`. The typedefs are a reference, not a runtime dependency.

`types/core.js` follows docs/DESIGN.md §5.2, §5.4, §8 and docs/SIM.md §4, §9. Where those two disagree on `DamageInfo.type`, the typedef uses the union `makeDamageInfo` actually builds (`'elemental'` as well as `'element'`).

## Protocol catalogue

`shared/protocol.js` declares checker functions separately from the `$optional` metadata array. The validator skips that metadata before calling a checker; its local type assertion records this invariant. `unitStatsEntry` lists the actual cultivation, side, range and silence fields, and normalised loadout maps have explicit record types. These changes do not loosen runtime validation.

## Not in the first slice

`shared/bandBonds.js` — the data-shape JSDoc rejects an empty fallback object and a tuple callback. Same treatment.
