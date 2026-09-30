# URL commands (playtesting)

Add these after the game's address, e.g. `http://localhost:5173/?slime=small:3`.
Combine several with `&`. They only apply when the page first loads; a restart after death is a normal run.

## Run shortcuts

| URL | What it does |
|---|---|
| `?seed=42` | Play a fixed seed (same floors every time). |
| `?boss` | Start at the door of floor 1's boss room. |
| `?boss=2` | Same for floor 2's boss room (`?boss=3` for floor 3). |
| `?room=slimePit` | Start at the door of the first room of that kind, on the first seed that has one (or on `?seed=N` if given). Takes an archetype, layout or encounter id ([list below](#room-ids-for-room)). |

## Enemy test arena

Name any enemy to start in a small hand-made arena with just those enemies.

| URL | What it does |
|---|---|
| `?zombie` | One zombie. |
| `?zombie=3` | Three zombies. |
| `?zombie=2&bat` | A mix: two zombies and a bat. |
| `&champion` | Makes every spawned enemy a champion, e.g. `?zombie=2&bat&champion`. |
| `?slime` | One big slime. |
| `?slime=medium` | Slime size: `big` (default), `medium` or `small`. |
| `?slime=small:3` | Three small slimes. |
| `?slime=2` | Two big slimes. |

**Enemy names:** `zombie`, `turret`, `worm`, `goblin`, `seedSpitter`, `ghoul`, `crystalTurret`, `gargoyle`, `knight`, `wasp`, `boar`, `ghost`, `bat`, `slime`

**Bosses** (spawn in the arena, not their own room): `wormBoss`, `ironMaiden`, `candleWitch`, `treantBoss`

A misspelled name is skipped with a warning in the browser console.
Enemies that don't fit on the arena's right side are left out.

### Keys in the arena

| Key | What it does |
|---|---|
| **R** | Clear the room and respawn the same enemies. |
| **G** | God mode on/off (you can't be hurt). |
| **F** | Freeze/unfreeze all enemies. |

## Room ids for `?room=`

**Archetypes:** `pillaredHall`, `fourCorners`, `stash`, `jar`, `sentryIsland`, `track`, `twinJars`, `gallery`, `serpentGarden`, `courtyard`, `vault`, `fortress`, `killbox`, `nest`, `crossfire`, `ruins`, `minefield`, `altar`, `shrine`, `reliquary`, `thornMaze`, `crusherCorridor`, `hauntedHall`, `crystalGallery`, `knightGuard`, `waspNest`, `boarRun`, `glowshroomCave`, `batRoost`

**Composed layouts and encounters:** `gauntlet`, `islandHall`, `descent`, `arena`, `ambush`, `colonnade`, `cloister`, `crossing`, `pondGarden`, `crossHall`, `bastion`, `pondCorner`, `ledgeSentries`, `prowlers`, `siege`, `waspSwarm`, `boarCharge`, `batColony`, `wormNest`, `slimePit`, `knightPatrol`, `haunting`
