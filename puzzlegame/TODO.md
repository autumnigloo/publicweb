# Puzzlegame — Roadmap & Ideas

A 3D first-person puzzle game where each level has its own visual language and
its own mechanic. The unifying constraint: navigate from a starting pad to an
exit pad, but the *means* of navigation changes every level.

## Current state

- [x] First-person controller (WASD + mouse, jump, AABB collision against a
      `BoxWorld`).
- [x] Level loader / pointer-lock pause / per-level briefing overlay.
- [x] **Level 1 — Echo Chamber.** Pitch-black maze; press E to emit a sonar
      pulse that lights up the geometry it touches via a custom shader
      (multi-pulse, distance falloff, trailing memory).
- [x] **Level 2 — Matrix Hallway.** Three barriers of three panels each. Real
      panels flow downward (Matrix code rain), fake panels flow upward and let
      the player pass through. E briefly tints fakes red.
- [x] **Level 3 — Time Slice.** Monochrome corridor with five red sweeping
      lasers that have ghost-trail "motion blur". World-time scales with
      player XZ speed (4% when still → 100% when at full walk), so the wall's
      scrolling tick-lines visibly stop when the player does. Touching a sweep
      flashes the screen red and resets to start. E fully freezes time for
      1.4 s with a 6 s cooldown. Lasers dwell briefly at each end so there's
      always a window to commit through.
- [x] **Level 4 — Mirror Maze.** Three chambers, four archways each. Heavy
      chromatic aberration post-process. One archway per chamber is real and
      teleports the player onward; the other three are sealed by mirror
      panels. Each archway has a glyph plaque above it; the real archway
      shows it forward, the three fakes show the same glyph horizontally
      flipped (because reflections invert handedness). E "Polarizes" the
      world for 2.5 s — splits invert, fakes flash red, the truth flashes
      green. 7 s cooldown.
- [x] **Level 5 — Gravity Cubes.** Warm pastel chamber with a posterize /
      paper-grain post-process (`createPastelPosterizeMaterial`). Cubes hang
      in midair, frozen by default. Aim at one and press E to cycle its
      gravity through {frozen → fall → rise → frozen}; cubes change tint
      (mint / coral / sky-blue). A simple iterative-relaxation y-only
      physics step lets them rest on the floor, ceiling, and on each other.
      Three columns of 1/2/3 cubes drop into a flush staircase up to a
      lavender ledge. Two off-axis decoy cubes for visual interest.

## Engine deltas (cumulative)

- [x] Per-level optional `postMaterial: ShaderMaterial`. main.ts renders
      the scene to a `WebGLRenderTarget` and draws a fullscreen quad with the
      level's material when present (auto-resized on window resize). Levels
      without a postMaterial keep direct-to-canvas rendering; no overhead for
      the existing levels.
- [x] First level with **dynamic colliders** — Gravity Cubes mutates each
      cube's `Box.min/max` in place every frame, and `BoxWorld.collides`
      reads the current bounds at query time. Works for slow-moving
      platforms; tunneling at high speeds is theoretically possible but
      hasn't shown up at `CUBE_ACCEL = 6 m/s²`.
- [x] First level using a per-frame **camera-forward raycast** for
      object selection (Gravity Cubes). The aimed cube gets a yellow edge
      ring; HUD shows next-state preview ("FROZEN → FALL").

## Near-term backlog

- [ ] **Level 6 — Wireframe Dream.** White-on-black wireframe world. Solid
      objects are invisible until you bump them, after which their edges
      remain drawn. Memory puzzle.
- [ ] **Level 7 — Schrödinger Doors.** Two doors. Each "is" what you last
      observed it as — open or closed. Looking away resets it. Use peripheral
      vision (FOV-based) to keep doors fixed while you cross.
- [ ] **Level 8 — Heat Vision.** Thermal palette (blue → red). Some walls are
      hot (lethal), some are cold (passable but invisible without heat-sense).
- [ ] **Level 9 — Inverted Color.** Negative-color world. Press E to invert
      back to normal — but only some objects exist in one polarity. Solve by
      toggling.
- [ ] **Level 10 — Recursive Room.** Standing on the exit pad teleports you to
      a smaller copy of the same room, and so on. Find the level where the
      "exit" is actually solvable (perhaps via a key you carry across scales).

## Engine TODO

- [ ] HUD: ability cooldown ring around the crosshair instead of HUD text.
- [ ] Footstep audio + per-level ambience (low-priority but huge for mood).
- [ ] Smarter pointer-lock UX: don't auto-show overlay on every brief
      defocus; debounce ~0.3s.
- [ ] Save progress (localStorage). Skip-completed-levels nav.
- [ ] Optimize collision: BVH or grid for many-box levels. Current O(N) per
      axis is fine while N stays small.
- [x] Basic death / respawn flow (Time Slice teleports to start + red flash
      via a camera-attached overlay). Future: maybe a generic respawn helper
      on `LevelContext` so each level doesn't roll its own.
- [ ] Level-transition fade. Currently it's an instant scene swap.
- [ ] Mobile / touch controls (probably skip — first-person on mobile is bad).
- [ ] Code-split the Three.js bundle (current ~555 kB warning).
- [ ] **Riding platforms.** Player should move with cubes that rise/fall while
      they're standing on them. Currently the player just falls off — fine
      for Gravity Cubes (you only stand on resting stacks) but limiting for
      future "elevator" puzzles. Approach: parent the player's footing
      surface from the previous frame and apply its delta to player position
      before tryMove.
- [ ] Generic **interactable raycaster** in `LevelContext`. Right now Gravity
      Cubes rolls its own per-frame ray + aim ring; lift this into the
      engine (LevelContext.aimAt(meshes) → hit) so future levels reuse it.

## Mechanic ideas pile (not yet assigned to levels)

- **Gravity Cubes v2.** Replace flat lambert cubes with a single gravity
  arrow indicator on each face (canvas texture per state) so direction is
  legible from any angle. Add a real puzzle wrinkle: an over-ledge "ceiling
  cap" so flipping a cube to "rise" past a certain point is blocked,
  forcing the player to choose which cubes fall vs rise to clear the path.
- A pen / marker that draws permanent strokes in 3D space — solve a maze by
  marking visited corridors when the maze keeps shifting.
- Shadow puzzle: only the *shadow* of a shape on a target wall must match.
  Move and rotate the caster.
- Sound-only level: no visuals, only stereo audio cues. (Probably mean.)
- Phase-shift: a "ghost" copy of you trails 2 seconds behind, and triggers
  pressure plates after you've already moved off them.
- Fog of war: only what you've seen recently stays drawn; turning around
  redraws as you look.
- "You are the cursor" — the mouse moves the player while WASD moves the world
  underneath you. (Disorienting, fun once.)
- Photograph mechanic: take a snapshot, then walk into the snapshot to enter
  the past state of the room.
- Mirror Maze v2: real reflections via `THREE.Reflector` on the panels, and
  the "tell" is what's *missing* from the reflection (the real archway shows
  no reflection at all because it's truly open; mirrors show a flipped copy
  of the chamber). Replaces the glyph-plaque cue with something more elegant.
- Bevelled / non-axis-aligned walls. AABB collision is showing its limits;
  add a `Cylinder` or `Plane` collider before any level needs slopes.
- Sound-driven Echo Chamber upgrade: real WebAudio panning + reverb so the
  pulse "sounds" like the room.

## Notes

- Each session: pick one level or one engine improvement, push to main when
  it builds and the prior levels still play. Commit messages should mention
  which level / mechanic was touched.
- Keep the dependency surface small: just Three.js. No physics engine; AABB
  collision is enough for everything sketched above.
- Visual effects live in `src/effects/` and should be reusable across levels
  where it makes sense.
