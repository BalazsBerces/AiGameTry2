# aiGameTry2

A top-down roguelike: floors of rooms (forest, caves, dungeon) drawn in a papercut style, fought through with shots, a sword and bombs.

## Terrain

**Obstacle**:
Unbreakable cover a room is built around; shots and the player stop against it.
_Avoid_: using "obstacle" for anything breakable

**Loose rock**:
A single breakable tile of crumbly rock in the caves; it gives way to shots, bombs and the worm boss.
_Avoid_: obstacle, boulder

**Rubble wall**:
A run of neighbouring loose rock that reads as one continuous wall; breaking a tile leaves the run's ends ragged. The worm boss's maze is built of rubble walls.
_Avoid_: rampart, worm obstacles

**Join**:
The piece drawn across the seam between two neighbouring tiles of the same kind, fusing them into one formation; it goes when either tile does. Loose rock also joins the cave wall it touches, so a rubble wall grows out of the wall.

**Crystal**:
Cave terrain grown out of the ground as faceted prisms: a crystal cluster (bounces shots) or a crystal spire.
_Avoid_: iceberg, ice

**Wall gem**:
A small cluster of crystal set into a cave wall, sparse and kept back from the room.
_Avoid_: crystal seam, wall crystal

**Glowshroom**:
A glowing violet mushroom clump that bursts into a stun cloud. Its pinkish violet is the brightest fungus light in the hollow; the hollow's other fungus glows a deeper, bluer plum.

**Mature** (mushroom):
The hollow's harmless, full-grown fungus: a deep purple, richest at the crown, flecked pale lilac, glowing a deep plum. Giant mushrooms and mushroom caps are mature.
_Avoid_: withered, dull, inactive

**Giant mushroom**:
The mushroom hollow's obstacle: a tall mature mushroom glowing a deep plum, drawn as one of several species (inkcap, parasol, a cluster of bells, a leaning pair).

**Mushroom cap**:
The mushroom hollow's loose rock: a low clump of mature fungus with a small plum glow; breaks after a few shots.

## Light

**Gloom**:
The moderate darkness over every cave room except the worm boss's arena; atmosphere, not a mechanic.
_Avoid_: dark (that is the Candle Witch's), cave dark

**Dark**:
The Candle Witch's deep darkness, part of her fight.

**Light pool**:
A lit spot cut out of the gloom round a glower.

**Glower**:
Anything that casts a light pool in the gloom: the player, shots, crystals, wall gems, glowshrooms, giant mushrooms and glinting floor decor.

## Enemies and shots

**Geode**:
A rock enemy that splits open on its crystal core and fires shard shots. It is always either shut or open.
_Avoid_: crystal turret

**Shut** (geode):
The geode closed up as plain rock: harmless, and nothing can hurt it.
_Avoid_: closed, inactive, armoured

**Open** (geode):
The geode split apart with its core showing: it fires, and it can be hurt.
_Avoid_: active, awake

**Player shot**:
The player's ranged shot: a steady pale star.

**Enemy shot**:
An enemy's plain shot: a red-hot seed.

**Shard shot**:
The geode's shot: a tumbling crystal shard with a red-hot core that ricochets off walls.
_Avoid_: crystal shot
