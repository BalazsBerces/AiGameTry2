# URL and console commands (playtesting)

Two ways to set up a playtest: **URL shortcuts** when the page loads, and the **dev console** while a run is going.
They share the same room lookup, enemy names and placement, and the same cheat switches.

## URL shortcuts

Add these after the game's address, e.g. `http://localhost:5173/?slime=small:3`.
Combine several with `&`. They only apply when the page first loads; a restart after death is a normal run.

### Run shortcuts

| URL | What it does |
|---|---|
| `?seed=42` | Play a fixed seed (same floors every time). |
| `?boss` | Start at the door of floor 1's boss room. |
| `?boss=2` | Same for floor 2's boss room (`?boss=3` for floor 3). |
| `?glow=ember` | Show the worm boss as the Molten Centipede (lava-fused rock and obsidian) instead of the blood-red Obsidian Centipede (`?glow=blood`, the default), to compare the two in the dark arena. Stays for the whole session, restarts included. |
| `?room=slimePit` | Start at the door of the first room of that kind, on the first seed that has one (or on `?seed=N` if given). Takes an archetype, layout or encounter id ([list below](#room-ids-for-room)). |

### Enemy test arena

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

**Enemy names:** `zombie`, `turret`, `worm`, `goblin`, `seedSpitter`, `ghoul`, `geode`, `gargoyle`, `knight`, `wasp`, `boar`, `ghost`, `bat`, `slime`

**Bosses** (spawn in the arena, not their own room): `wormBoss`, `ironMaiden`, `candleWitch`, `treantBoss`

A misspelled name is skipped with a warning in the browser console.
Enemies that don't fit on the arena's right side are left out.

#### Keys in the arena

| Key | What it does |
|---|---|
| **R** | Clear the room and respawn the same enemies. |
| **G** | God mode on/off: the same switch as the console's `god`. |
| **F** | Freeze/unfreeze all enemies: the same switch as the console's `freeze`. |

## Room ids for `?room=` and the console's `room`

**Archetypes:** `pillaredHall`, `fourCorners`, `stash`, `jar`, `sentryIsland`, `track`, `twinJars`, `gallery`, `serpentGarden`, `courtyard`, `vault`, `fortress`, `killbox`, `nest`, `crossfire`, `ruins`, `minefield`, `altar`, `shrine`, `reliquary`, `thornMaze`, `crusherCorridor`, `hauntedHall`, `crystalGallery`, `knightGuard`, `waspNest`, `boarRun`, `glowshroomCave`, `batRoost`

**Composed layouts and encounters:** `gauntlet`, `islandHall`, `descent`, `arena`, `ambush`, `colonnade`, `cloister`, `crossing`, `pondGarden`, `crossHall`, `bastion`, `pondCorner`, `ledgeSentries`, `prowlers`, `siege`, `waspSwarm`, `boarCharge`, `batColony`, `wormNest`, `slimePit`, `knightPatrol`, `haunting`

## Dev console

The key under **Esc** (by position, whatever your layout types there) opens and closes it, in every build.
The game keeps running while it is open, but no key reaches the game. **Esc** also closes it.

- **Enter** runs a line, **Up/Down** step through earlier lines (kept across reloads), **Tab** completes command, item, enemy and room names.
- Names ignore case, and a unique start is enough (`give boo`). An ambiguous one lists what it could be.
- Multi-word names work with or without quotes: `give triple shot`, `give "triple shot"`.
- `help` lists every command.

### Basics

| Command | What it does |
|---|---|
| `help` | List every command with its usage. |
| `seed` | Print this run's seed (replay it with `?seed=N` or `restart N`). |

### Items

| Command | What it does |
|---|---|
| `items` | Numbered list of the passives `give` and `drop` take. |
| `drops` | Numbered list of the pickups, stat-ups (damage up, fire rate up) and chests. The numbers carry on from `items`, so `give <number>` works for both. |
| `give <item>` | By id (`triple`), display name (`triple shot`) or its number in `items` / `drops`. A passive comes at level 1, or goes up to 2 if you have it. |
| `give <passive> 2` | Straight to level 2. |
| `give all [2]` | Every passive (at level 2 if asked). |
| `give heart\|key\|bomb\|heartContainer\|damageUp\|rateUp [n]` | n of that pickup's effect, as if picked up. |
| `remove <passive>` | Take a passive away. |
| `inv` | Passives with levels, stat-ups, keys, bombs, health. |
| `drop <item> [n]` | The real pickup, one tile ahead where you aim (or the nearest free floor), even mid-fight. `drop chest`, `drop lockedChest` work too. |

### Cheats

Each toggles, lasts the whole run across rooms and floors, and is off again in a new run.
A tag on the HUD (`GOD · NOCLIP`) shows which are on.

| Command | What it does |
|---|---|
| `god` | Health never drops; hits still knock and stun. (Arena key **G**.) |
| `noclip` | Walk through rocks, pillars, holes and thorns; room walls and locked doors still stop you. |
| `freeze` | Enemies stand still and think nothing. (Arena key **F**.) |
| `onehit` | Your hits kill anything, bosses included. |

### Resources and debug

| Command | What it does |
|---|---|
| `hp <n>` | Set health in half-hearts (capped at max health). |
| `heal` | Fill health. |
| `keys <n>`, `bombs <n>` | Set keys or bombs. |
| `kill` | Kill every enemy in the room as real kills: scraps, champion drops, room-clear loot, doors, and in a boss room the upgrade and exit. |
| `die` | End the run as a loss. |
| `speed <x>` | Game speed, e.g. `0.25` slow motion, `1` normal, `2` double. |
| `hitboxes` | Show or hide the physics outlines. |
| `glow blood\|ember` | Switch the worm boss between the blood-red Obsidian Centipede and the Molten Centipede (also `glow red`, `glow molten`), at once, a boss already in the room included. Mirrors `?glow=`. |
| `stats` | The weapon your passives and stat-ups make: mode, fire delay, damage, shots, bounces, pierce, orbitals, dash, poison, chain, freeze. |

### Travel

Teleports keep your run and inventory; rooms you skip stay as they were.

| Command | Mirrors | What it does |
|---|---|---|
| `boss [floor]` | `?boss=N` | To the door of that floor's boss room (default: this floor). |
| `floor <n>` | | To that floor's start room. |
| `room <id>` | `?room=id` | To the door of the nearest room built from that id ([list above](#room-ids-for-room-and-the-consoles-room)). If this world has none, it says so. |
| `restart [seed]` | `?seed=N` | A new run, on that seed if given. |
| `restart room <id>` | `?room=id` | A new run at such a room (the first seed that has one). |
| `reveal` | | Show the whole floor on the minimap. |
| `open` | | Unlock every door on this floor, fights included. |

### Enemies

Enemy names and slime sizes are the arena's ([enemy names above](#enemy-test-arena)).

| Command | What it does |
|---|---|
| `spawn <enemy> [n] [champion] [big\|medium\|small]` | Enemies in this room, on free floor at least 3 tiles from you. Says which didn't fit. |
| `arena <enemies>` | Into the test arena, URL style: `arena zombie=3 bat champion`, `arena slime=small:3`. |

Spawned enemies never lock the doors or undo a cleared room, and a room's own fight ends when its own enemies are dead.
Killing them gives no room-clear loot, boss exit or upgrade, but champions still drop their loot and bosses show their bar.
