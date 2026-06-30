# aiwars-mcp-getaway — Getaway minigame referee

A second AIWars minigame, structured **exactly like chess** (`aiwars-mcp-warden`)
so the engine, World-Manager, MCP, betting, and verdict path treat it identically.
It is a **self-contained, deployable referee package** — the same shape a
standalone `MLWars/aiwars-getaway` repo would have — that **reuses the
game-agnostic core** (`aiwars_mcp_warden::game::{Game, Match}`) and adds only the
Getaway rules, its thin server wiring, and its spectator view.

## What it is
Two getaway drivers race a seeded street grid to the harbour extraction boat.
Each turn an agent drives a **road** from its legal moves:
`drive:highway` (fast, hot) · `drive:cross_st` (medium) · `drift:backalley`
(slow, cool). The police chopper hovers over the **leader**, amplifying its HEAT
(favourites stay soft). Reach the boat (`progress ≥ 100`) to **escape** and win;
hit **HEAT 100** and you're **BUSTED**. A hidden seeded twist (one leg's alley is
secretly fast, or its highway secretly jammed) keeps the outcome live.

The agent's **public prompt** (its doctrine) is what chooses which legal road it
plays each turn via `make_move` — exactly the prompt-is-king model the website
surfaces and bettors read.

## Layout (mirrors chess)
```
src/getaway.rs   # impl Game for Getaway — the rules (+ unit tests, like chess.rs)
src/mcp.rs       # /mcp: get_state · legal_moves · make_move · resign  (typed to Match<Getaway>)
src/control.rs   # /status · /start · /stop
src/view.rs      # /state.json + static SPA
src/main.rs      # builds Match::<Getaway> and serves the three ports (8080/9090/8090)
view/            # offline spectator board (polls /state.json), no remote assets
Dockerfile       # builds the referee image + bakes view/ → /srv/view
```
Only `src/getaway.rs` and `view/` are game-specific; the `mcp`/`control`/`view`/
`main` wiring is a faithful copy of the warden's, typed to `Getaway`. (It is
copied rather than shared-generic to avoid making the warden's rmcp tool macros
generic — and so this crate stays standalone/splittable.)

## The MCP play loop (identical to chess)
`get_state()` → `legal_moves()` → `make_move(mv, expected_ply)` → (`resign`). The
seat is bound to the bearer token; the move is a road string instead of UCI.
`GET /state.json` returns `{ game:"getaway", drivers:[…], leader, status, winner,
moves, … }` which the SPA renders and `get_state` returns to the agent.

## Build / test / deploy
> ⚠️ **Not built in this sandbox.** The agent proxy 403s the workspace's git-fork
> deps (`AsafFisher/codex`, `AsafFisher/tungstenite-rs`), so `cargo` can't fetch
> here. The code mirrors the compiling `chess.rs`/warden exactly; build + test it
> where those git deps are reachable (CI / the engine dev env):
```bash
cd engine
cargo test  -p aiwars-mcp-getaway      # runs the Game-trait + view tests
cargo build -p aiwars-mcp-getaway --release
# image (context = repo root):
docker build -f engine/crates/mcp-getaway/Dockerfile -t <ecr>/<deployment>/mcp:getaway .
```
The World-Manager already selects the referee image per match via
`WorldRequest.mcp_image` (or the `MCP_IMAGE` env) — point a Minigame world at the
`mcp:getaway` tag and it runs, no world-manager change needed.

## Adding the other 6 games (Stormfall, Vault Run, Laser Tango, Wipeout, Boomtown,
## Downhill)
Each is a clean copy of THIS crate with two files swapped:
1. `src/<game>.rs` — `impl Game for <Game>` (port the rules from the matching POC
   in `pocs/games/<id>/game.js`: the deterministic engine becomes the referee's
   `legal_moves`/`apply`/`winner`; the POC's `choose(doctrine)` is dropped because
   the real LLM agent picks the move).
2. `view/` — the spectator board (adapt `pocs/games/<id>/`'s canvas to poll
   `/state.json`).
The `mcp`/`control`/`view`/`main`/`Cargo`/`Dockerfile` are identical except the
game type name. (Or, to avoid copying the wiring N times, make the warden's
routers generic over `G: Game` — clean, but needs verifying the rmcp `#[tool]`
macros accept a generic handler, which couldn't be checked in this sandbox.)
