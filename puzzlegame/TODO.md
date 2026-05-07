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

## Near-term backlog

- [ ] **Level 4 — Mirror Maze.** Heavy chromatic aberration + mirrored
      surfaces. Some "doors" are real, some are reflections. Step into a
      reflection and you're rotated 90° / teleported to the mirror's twin.
- [ ] **Level 5 — Gravity Cubes.** Low-poly pastel world with floating cubes.
      Press E to flip the gravity vector of the cube you're aiming at. Build
      staircases / clear gaps.
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
- [ ] Code-split the Three.js bundle (current 517 kB warning).

## Mechanic ideas pile (not yet assigned to levels)

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

## Notes

- Each session: pick one level or one engine improvement, push to main when
  it builds and the prior levels still play. Commit messages should mention
  which level / mechanic was touched.
- Keep the dependency surface small: just Three.js. No physics engine; AABB
  collision is enough for everything sketched above.
- Visual effects live in `src/effects/` and should be reusable across levels
  where it makes sense.
