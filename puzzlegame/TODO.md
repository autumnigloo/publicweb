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
- [x] **Level 6 — Wireframe Dream.** Pitch-black void; only the room's white
      wireframe outline + a faint grid floor are drawn at start. Invisible
      pillars are scattered between start and exit. Bumping a pillar reveals
      its edges permanently (proximity check in update, AABB-vs-XZ-distance).
      E = Lucid Flash: every unrevealed pillar dimly silhouettes for 1.5s on
      a 7s cooldown, with a smooth fade-in/out so it feels like a memory
      glimpse, not a strobe. The route you take accumulates as a dream
      blueprint behind you.
- [x] **Level 7 — Schrödinger Doors.** Cool teal observation-lab corridor
      with scan-line + cool-desaturation post. Four quantum-panel doors
      block the way; each is open only while its closest-point falls inside
      a ~16° central-FOV cone of the camera forward. The fourth door
      *inverts* the rule (observation collapses it shut) and is colour-coded
      amber instead of violet. Floor glyphs in front of each door tell you
      which rule applies — an eye (observe-to-open) or a slashed eye
      (observe-to-close). Looking down to read the slashed glyph naturally
      removes the inverted door from gaze, which is also the solution.
      E = Observer Lock: freezes every door at its current state for 2.5s
      on a 7s cooldown.
- [x] **Level 8 — Heat Vision.** Dim industrial room with a 5×5 field of
      vertical pillars. Cold structural pillars block movement and read as
      dark cyan-grey in normal vision. Heat bars (lethal on touch via a
      proximity check) are nearly invisible "glass" in normal vision and
      blaze through an IR-camera palette in thermal mode. E toggles
      Thermal Lens — a post-process that recolours the framebuffer through
      a deep-purple→red→orange→yellow→white temperature ramp, picking out
      the high-red heat-bar fragments while desaturating everything else.
      Tradeoff: thermal mode washes the cold pillars to uniform purple, so
      you have to flip-flop between senses to actually navigate. Smooth
      lerp on the toggle (~6/s) so it feels like a sensor warming up.
      Touching a heat bar respawns the player at the start pad.
- [x] **Level 9 — Inverted Color.** Long corridor cut into three obstacle
      zones. Two layers of solid objects, RED and CYAN. Polarity flips
      between POSITIVE (RED solid, CYAN intangible) and NEGATIVE (CYAN
      solid, RED intangible). E toggles polarity and the entire framebuffer
      is colour-inverted by `createColorInvertMaterial` — uPolarity 0→1
      crossfade with a brief additive flash + scanline intensification on
      the transition for tactile feedback. Dynamic colliders are spliced
      in/out of `world.solids` on flip (a `staticSolidCount` index is
      recorded after the static shell so the splice is O(N) with low
      constants). Intangible objects render at 0.22 opacity with depthWrite
      off; tangible objects are opaque. Layout solve: NEG to pass red wall
      and walk the cyan bridge over pit 1, POS to walk the red bridge over
      pit 2 and pass the cyan wall, exit. Squash-prevention: ability is
      refused (HUD message) if flipping would put the player inside a
      would-be-solid. Falling into a pit respawns at the start pad with a
      flash.

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
- [x] First level that **mutates `world.solids` on demand** (Inverted Color).
      Records `staticSolidCount` after the static shell is built, then on
      ability rebuilds `world.solids = static.concat(activeDynamics)`. Cheap
      and avoids needing per-Box "active" flags in `BoxWorld`. Pattern is
      reusable for any future "phasing" mechanic.

## Near-term backlog

- [ ] **Level 10 — Recursive Room.** Standing on the exit pad teleports you to
      a smaller copy of the same room, and so on. Find the level where the
      "exit" is actually solvable (perhaps via a key you carry across scales).
- [ ] **Level 11 — Phase Shift Pursuit.** A "ghost" copy of you trails ~2 s
      behind, replaying your past inputs. Some pressure plates need to be held
      while you stand on others — only the ghost can do it. Visual: the world
      drawn twice with the ghost lane desaturated. (From the ideas pile.)

## Inverted Color — possible follow-ups

- [ ] **Three-layer polarity** (RED / CYAN / NEUTRAL). E cycles through, so the
      puzzle becomes "find a sequence" rather than "find a single state". Would
      need a HUD chip showing which polarity is currently solid.
- [ ] **Moving polarity objects.** A red elevator that only carries you in
      POSITIVE; you have to flip mid-ride to land on a cyan ledge. Reuses the
      dynamic-collider infrastructure (Gravity Cubes already does mutable
      bounds; combine with polarity gating).
- [ ] **Flip cost / cooldown.** Currently flipping is free. A 1.5 s cooldown
      would force commitment and let us escalate later zones with timed gaps.
- [ ] **Audio "polarity click".** A short reversed-reverb sting on flip would
      really sell the visual invert. Blocked on WebAudio infrastructure.
- [ ] **In-pit cinematic.** When the player falls into a pit, drop them past a
      short reveal of the opposite-polarity floor (a tease of the "other side")
      before respawning. Sells the polarity metaphor without a tutorial.

## Heat Vision — possible follow-ups

- [ ] **Pulsing heat bars.** Each bar cycles with a phase so it has a brief
      "cool" window (~0.6s every 3s) where touch is safe. Adds a real
      timing puzzle on top of the navigation puzzle. Phase variable already
      exists (`uPhase`) — just wire a cool-window check against
      `sin(uTime + uPhase)` into both the kill check and the bar's alpha.
- [ ] **Thermal cooldown.** Currently the toggle is free, which is fine for
      a first puzzle. Once a level needs commitment (e.g. timed bars), give
      Thermal Lens a duration + cooldown so you can't peek mid-cross.
- [ ] **Hot wall surfaces.** Beyond bars, paint sections of wall/floor as
      hot. Requires the heat-detection material to be applied to a plane
      strip, plus an AABB-style proximity check for irregular hot zones.
- [ ] **Soft respawn flash.** Right now contact teleports silently. Quick
      red full-screen flash + a beep would sell the "you burned" moment.
      Worth promoting to a shared `LevelContext.respawn(pos, yaw)` helper
      since this is the second level (after Time Slice) that needs one.

## Schrödinger Doors — possible follow-ups

- [ ] Door 5 with a *cooldown lockout* — observation re-seals it permanently
      after the first peek, so you need to cross it without ever centering it
      in FOV. Makes Observer Lock essential.
- [ ] Side-passage door that requires looking 90° to the side while moving
      forward — really tests the "track-while-walking" muscle.
- [ ] Audible "decoherence hiss" when a door collapses (needs WebAudio first).
- [ ] Hint geometry: faint chevrons on the floor indicating which way to look
      for inverted doors (a pre-glyph visual breadcrumb).

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

## Wireframe Dream — possible follow-ups

- [ ] Pillars fade slowly back to invisible after ~30s of not-being-looked-at,
      so the puzzle gets harder the longer you dawdle ("the dream forgets").
- [ ] Multi-room version: when you reach an exit, the next room shares the
      same layout but in the dark again — you have to remember from the
      flashbacks. Real "memory puzzle" angle from the original brief.
- [ ] Replace the simple GridHelper floor with a custom shader that draws
      grid lines fading with distance — currently the grid pops at the fog
      cutoff. Low priority.

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
