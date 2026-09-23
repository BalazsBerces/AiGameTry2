Isaac like top down rougelike
(Built parts are in present tense; the plan is under ROADMAP at the bottom. GitHub: BalazsBerces/AiGameTry2)

Map generation:
    -Grid system, one room is 13x7 tiles (plus a 1-tile wall ring)
    -rooms form a tree-like structure, like in isaac (no accidental adjacency)
    -start room is the middle of the level
    -1 item room, 1 boss room (2x2 cells) at the deepest dead end, furthest from spawn
    -average map size around 14 rooms
    -3 floors chained together: the boss room's exit leads to the next floor's start
    -generation is centralized and deterministic per seed (?seed=123 in the url)

Room generation (archetypes, PR #32):
    -every normal and item room is built from a named "archetype": one clear idea, symmetric on at least one axis
     (only the idea's own feature, e.g. a jar opening, may break symmetry)
    -enemies are placed to support the idea, never randomly scattered
    -each floor has its own exclusive set, max 2 uses of one idea per floor (when possible)
        floor 1: Pillared Hall (breather), Four Corners, The Stash (puzzle), The Jar, Sentry Island
        floor 2: Courtyard (breather), The Track, Twin Jars, Gallery, Serpent Garden, The Vault (puzzle)
        floor 3: Ruins (breather), Fortress, Killbox, The Nest, Crossfire, Minefield (puzzle)
        item rooms: Altar (f1), Shrine (f2), Reliquary (f3), no enemies, item in the middle
    -a room validator checks every room: doors reachable, walkers reachable, turrets shootable,
     nothing spawns next to a door, sealed pockets may only hold loot
    -room-clear drop lands on the free tile nearest the middle
    -loot placed by the idea (puzzle chests) is visible from the start

Tiles:
    -floor, stone (obstacle), rock (breaks after 3 shots), hole (blocks walking, not shots)
    -destroyed tiles stay destroyed for the whole run

Hud:
    -Health
    -Keys
    -Bombs

Enemies:
    -stationary turret
    -following zombie
    -worm (floor 2+)

Bosses:
    -floor 1: larger worm with splitting body and random direction, in a labyrinth arena with small gaps
    -floor 2: Hive (spiral shots, summons zombies)
    -floor 3: Shadow (mirrors the player through the room centre)

Player:
    -can move with wasd
    -can shoot with arrows
    -direction and velocity influence shot speed and direction but not too much
    -can interract with items and chests by running into them
    -opening a chest stops the player from interacting with the item for a fraction of a second
    -bombs: start with 1, E drops one, 1.5s fuse, destroys rock and stone in the 3x3 around it,
     hurts enemies, costs the player a full heart if caught in it

Main Passive Items:
    -spawn in item rooms
    -spawn in locked chests
    -one for homing
    -one for replacing the fired shots for a sword to swing
    -one that drastically increases fire rate but reduces damage too

Secondary items:
    -chance to appear after a room is cleared
    -hearts, keys, bombs, chests (locked, unlocked)


ROADMAP (PRD issue #33), in this order:
    phase 0 - floor themes:
        -floor 1 forest (boss = cave entrance), floor 2 caves (worms, underground), floor 3 dungeon (scarier monsters)
        -palette + themed tile looks per floor, still simple shapes (no sprite art)
        -rule: if an enemy looks different it must behave differently
        -walkers: forest goblin (fast, flees when hurt), cave ghoul (slow, lunges), dungeon zombie (tougher)
        -turrets: forest seed-spitter (3-shot spread), cave crystal turret (ricochets once), dungeon gargoyle (dormant, then bursts)
        -bosses: new Treant on floor 1 (root eruptions, seed pods, branch sweep), worm boss moves to floor 2, Shadow stays on floor 3, Hive retired
        -existing rooms get rethemed + recast (floor 3 rooms lose their worms)
    phase 1 - new enemies (each debuts on its floor in rooms built around it):
        -forest: boar (charges, stuns itself on stone/rock), wasp swarm (fast flyers)
        -caves: bat (erratic flyer)
        -dungeon: ghost (through walls, only hittable when visible), skeleton knight (shield blocks the front)
    phase 2 - interactive tiles:
        -forest: pond, thorn bush (hurts)
        -caves: crystal (reflects shots), chasm, glowshroom (stun burst when shot)
        -dungeon: pit, crusher (wakes on line of sight, slides until it hits something, hurts everything, stays as an obstacle)
    phase 3 - room shapes: wide 2x1, tall 1x2, big 2x2, L-shaped; 1-3 per floor
    phase 4 - champions: ~15% of rooms have one bigger, tinted, double-HP enemy with a guaranteed extra drop
    -all numbers are placeholders for playtesting
