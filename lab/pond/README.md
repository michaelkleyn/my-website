# Leave a fish — the pond store

Visitors design a small fish in the Boids Lab (the paper button, bottom right) and release it into the
pond. A fish is ~200 bytes of parameters — style, four shape sliders, size, five colours, a koi pattern,
a seed — and the pond paints it with the same p5.brush pipeline as the school, so nothing is uploaded
but a little JSON.

## Policy

- The pond keeps the newest **30** (`visitorCap` in the lab; `cap` in `leave_fish`). A new arrival
  retires the oldest.
- The same design is never stored twice (hash of the normalised design).
- One fish per visitor: leaving another replaces it. The visitor is identified by a random secret kept in
  their browser (`localStorage.pond-mine`), so they can come back and find their fish.
- Names: up to 16 characters of letters, digits, space, `. ' -`; anything else is stripped.

## Stores

`PondStore` in `boids-lab.html` has two backends with the same three calls (`list`, `leave`, `mine`):

- **local** — this browser's `localStorage`. What the lab runs on; also the fallback whenever the remote
  store fails, so the page never breaks because of the backend.
- **remote** — any Postgres behind PostgREST (Supabase is the zero-ops version). Apply `pond_fish.sql`,
  then, before the lab script, set

  ```html
  <script>window.POND_REMOTE = { url: 'https://<project>.supabase.co', key: '<anon / publishable key>' };</script>
  ```

  The anon key is meant to be public; the SQL only ever lets it read `id, name, params, created_at`
  and call `leave_fish` / `retire_fish`, which validate, rate-limit (six arrivals per ten minutes,
  pond-wide) and enforce the policy above inside the database.

Note: the claude.ai artifact sandbox blocks all fetches, so the artifact copy of the lab always runs on
the local store. The remote store works from the worktree (`python3 -m http.server 8765`) and on the
site.

## Cost, roughly

- Per page load: one GET of ≤30 rows (~7 KB), then ≤30 sprite paints on the visitor's GPU, one every
  120 ms after the school's atlas is done (a full pond takes ~4 s to fill in, deliberately — the fish
  arrive). Each painted sprite is one ~400×220 canvas; 30 of them are ~10 MB of texture memory.
- Simulation: 35 + 30 boids is ~4 k pair checks per frame — nothing. Drawing: each fish is ~16 warped
  strips; 65 fish is ~1 000 `drawImage` calls, the same order the school already does.
- Writes: rare, tiny, rate-limited. Free tier anywhere.

For the production site: cache painted sprites in IndexedDB by design hash so returning visitors paint
nothing, and stop painting residents under `prefers-reduced-motion` or a low-end-device heuristic.
