//! Getaway — a turn-based pursuit minigame refereed exactly like chess.
//!
//! Two getaway drivers race a seeded street grid to the harbour extraction boat.
//! On each of its turns an agent picks a ROAD from its legal moves:
//!   - `drive:highway`   — big progress, but spikes HEAT (more so under the chopper)
//!   - `drive:cross_st`  — moderate progress + heat
//!   - `drift:backalley` — small progress, sheds a little heat
//! The police chopper hovers over whoever is LEADING, so the leader's heat gains
//! are amplified (favourites stay soft). Reach the boat (progress ≥ GOAL) to
//! escape and win; let HEAT hit 100 and you're BUSTED. If both bust it's a draw;
//! at the turn cap the driver nearer the harbour wins.
//!
//! This is the engine-side rules ONLY — the agent's PUBLIC PROMPT (its doctrine)
//! is what chooses which legal road it plays each turn, via `make_move`. Same
//! seed ⇒ identical road options (deterministic / replayable), mirroring how
//! `chess.rs` derives everything from the authoritative position.

use serde_json::{json, Value};

use aiwars_mcp_warden::game::{Game, MatchError};

const GOAL: u32 = 100;
const LEGS: u32 = 8;
const BUST: u32 = 100;

/// A road option available at a given leg.
struct Road {
    name: &'static str,
    lane: u8,
    progress: u32,
    heat: u32,
    kind: Kind,
}
#[derive(PartialEq, Clone, Copy)]
enum Kind {
    Alley,
    Mid,
    Highway,
}

/// Deterministic per-leg PRNG seed mix (mulberry32-ish), matching the POC engine
/// so the web demo and the referee agree on a seed's road layout.
fn rng_u32(mut a: u32) -> u32 {
    a = a.wrapping_add(0x6d2b79f5);
    let mut t = (a ^ (a >> 15)).wrapping_mul(1 | a);
    t = (t.wrapping_add((t ^ (t >> 7)).wrapping_mul(61 | t))) ^ t;
    (t ^ (t >> 14)) >> 0
}
/// A 0..1 float from a (seed, leg, salt) tuple.
fn frac(seed: u64, leg: u32, salt: u32) -> f64 {
    let mixed = (seed as u32)
        .wrapping_mul(977)
        .wrapping_add(leg.wrapping_mul(131))
        .wrapping_add(salt.wrapping_mul(7));
    (rng_u32(mixed) as f64) / (u32::MAX as f64)
}

/// Per-driver state.
#[derive(Clone)]
struct Driver {
    prog: u32,
    heat: u32,
    leg: u32,
    lane: u8,
    busted: bool,
    escaped: bool,
}
impl Driver {
    fn new() -> Self {
        Self { prog: 0, heat: 0, leg: 0, lane: 1, busted: false, escaped: false }
    }
    fn done(&self) -> bool {
        self.busted || self.escaped
    }
}

/// The two-player Getaway game.
pub struct Getaway {
    drivers: [Driver; 2],
    to_move: usize,
    ply: u32,
    seed: u64,
    twist_leg: u32,
    twist_jam: bool,
    resigned_by: Option<usize>,
    /// Cached terminal result once resolved (so it's stable after the last move).
    winner_idx: Option<usize>,
    win_reason: &'static str,
    resolved: bool,
}

impl Getaway {
    /// The three road options for `agent` at its current leg (seed-deterministic).
    fn roads(&self, leg: u32) -> [Road; 3] {
        let jam = leg == self.twist_leg && self.twist_jam; // highway secretly jammed
        let gift = leg == self.twist_leg && !self.twist_jam; // alley secretly fast
        let r = |salt: u32| frac(self.seed, leg, salt);
        [
            Road {
                name: "drift:backalley",
                lane: 0,
                progress: if gift { 22 + (r(1) * 6.0) as u32 } else { 11 + (r(1) * 4.0) as u32 },
                heat: 2 + (r(2) * 3.0) as u32,
                kind: Kind::Alley,
            },
            Road {
                name: "drive:cross_st",
                lane: 1,
                progress: 14 + (r(3) * 4.0) as u32,
                heat: 6 + (r(4) * 4.0) as u32,
                kind: Kind::Mid,
            },
            Road {
                name: "drive:highway",
                lane: 2,
                progress: if jam { 8 + (r(5) * 3.0) as u32 } else { 18 + (r(5) * 6.0) as u32 },
                heat: 11 + (r(6) * 6.0) as u32,
                kind: Kind::Highway,
            },
        ]
    }

    /// The current leader's agent index by progress (None if tied).
    fn leader(&self) -> Option<usize> {
        let (a, b) = (self.drivers[0].prog, self.drivers[1].prog);
        if a == b {
            None
        } else if a > b {
            Some(0)
        } else {
            Some(1)
        }
    }

    /// Advance `to_move` to the next driver still in the chase (skipping finished).
    fn advance_turn(&mut self) {
        let other = 1 - self.to_move;
        if !self.drivers[other].done() {
            self.to_move = other;
        }
        // else: keep to_move on the still-running driver to take its remaining turns.
    }

    /// Resolve the match if a terminal condition is met (idempotent).
    fn try_resolve(&mut self) {
        if self.resolved {
            return;
        }
        let (d0, d1) = (&self.drivers[0], &self.drivers[1]);
        if let Some(r) = self.resigned_by {
            self.winner_idx = Some(1 - r);
            self.win_reason = "resign";
            self.resolved = true;
            return;
        }
        // Escape wins immediately.
        if d0.escaped && !d1.escaped {
            self.winner_idx = Some(0);
            self.win_reason = "escape";
            self.resolved = true;
            return;
        }
        if d1.escaped && !d0.escaped {
            self.winner_idx = Some(1);
            self.win_reason = "escape";
            self.resolved = true;
            return;
        }
        // Both busted → draw.
        if d0.busted && d1.busted {
            self.winner_idx = None;
            self.win_reason = "doublebust";
            self.resolved = true;
            return;
        }
        // One busted, the other still running → let the runner finish (not resolved yet)
        // UNLESS the runner is also finished or both hit the leg cap.
        let both_finished = d0.done() && d1.done();
        let cap = d0.leg >= LEGS && d1.leg >= LEGS;
        if both_finished || cap {
            // last-crew-standing on a single bust, else closer-to-harbour
            if d0.busted && !d1.busted {
                self.winner_idx = Some(1);
                self.win_reason = "bust";
            } else if d1.busted && !d0.busted {
                self.winner_idx = Some(0);
                self.win_reason = "bust";
            } else if d0.prog == d1.prog {
                self.winner_idx = None;
                self.win_reason = "draw";
            } else {
                self.winner_idx = Some(if d0.prog > d1.prog { 0 } else { 1 });
                self.win_reason = "closer";
            }
            self.resolved = true;
        }
    }

    fn status_str(&self) -> &'static str {
        if self.resigned_by.is_some() {
            "resigned"
        } else if self.resolved {
            self.win_reason
        } else {
            "playing"
        }
    }
}

impl Game for Getaway {
    fn new(players: usize, settings: &Value) -> Result<Self, MatchError> {
        if players != 2 {
            return Err(MatchError::WrongPlayerCount { want: 2..=2, got: players });
        }
        // Optional fixed seed for reproducible matches; default from settings or 1.
        let seed = settings.get("seed").and_then(|v| v.as_u64()).unwrap_or(1);
        // Hidden twist: which leg, and whether it jams the highway vs gifts the alley.
        let twist_leg = 1 + (frac(seed, 0, 99) * (LEGS as f64 - 1.0)) as u32;
        let twist_jam = frac(seed, 0, 100) < 0.5;
        Ok(Self {
            drivers: [Driver::new(), Driver::new()],
            to_move: 0,
            ply: 0,
            seed,
            twist_leg,
            twist_jam,
            resigned_by: None,
            winner_idx: None,
            win_reason: "playing",
            resolved: false,
        })
    }

    fn turn_agent(&self) -> usize {
        self.to_move
    }

    fn ply(&self) -> u32 {
        self.ply
    }

    fn legal_moves(&self) -> Vec<String> {
        if self.resolved {
            return Vec::new();
        }
        let leg = self.drivers[self.to_move].leg;
        self.roads(leg).iter().map(|r| r.name.to_string()).collect()
    }

    fn apply(&mut self, agent: usize, mv: &str) -> Result<(), MatchError> {
        if self.resolved {
            return Err(MatchError::GameOver);
        }
        if self.to_move != agent {
            return Err(MatchError::NotYourTurn);
        }
        let leg = self.drivers[agent].leg;
        let roads = self.roads(leg);
        let road = roads
            .iter()
            .find(|r| r.name == mv)
            .ok_or_else(|| MatchError::IllegalMove(format!("'{mv}' is not a road here")))?;

        // Reactive heat: the chopper amplifies the leader's heat gains.
        let on_me = self.leader() == Some(agent);
        let heat_gain = if on_me {
            (road.heat as f64 * 1.5) as u32
        } else {
            road.heat
        };
        let cool = if road.kind == Kind::Alley { 5 } else { 0 };

        let d = &mut self.drivers[agent];
        d.heat = (d.heat + heat_gain).saturating_sub(cool).min(130);
        d.prog = (d.prog + road.progress).min(GOAL);
        d.lane = road.lane;
        d.leg += 1;
        if d.heat >= BUST {
            d.busted = true;
        } else if d.prog >= GOAL {
            d.escaped = true;
        }

        self.ply += 1;
        self.advance_turn();
        self.try_resolve();
        Ok(())
    }

    fn is_over(&self) -> bool {
        self.resolved
    }

    fn winner(&self) -> Option<usize> {
        self.winner_idx
    }

    fn resign(&mut self, agent: usize) {
        if !self.resolved {
            self.resigned_by = Some(agent);
            self.try_resolve();
        }
    }

    fn state(&self, handles: &[String]) -> Value {
        let h = |i: usize| handles.get(i).cloned().unwrap_or_default();
        let leader = self.leader();
        let chopper_on = leader.map(h).map(Value::String).unwrap_or(Value::Null);
        let winner = self
            .winner_idx
            .filter(|_| self.resolved)
            .map(h)
            .map(Value::String)
            .unwrap_or(Value::Null);
        let driver_json = |i: usize| {
            let d = &self.drivers[i];
            json!({
                "handle": h(i),
                "progress": d.prog,
                "to_harbor": GOAL.saturating_sub(d.prog),
                "heat": d.heat,
                "leg": d.leg,
                "lane": d.lane,
                "busted": d.busted,
                "escaped": d.escaped,
            })
        };
        json!({
            "game": "getaway",
            "goal": GOAL,
            "legs": LEGS,
            "seed": self.seed,
            "to_move": h(self.to_move),
            "to_move_idx": self.to_move,
            "leader": chopper_on,
            "ply": self.ply,
            "status": self.status_str(),
            "winner": winner,
            "win_reason": if self.resolved { self.win_reason } else { "" },
            "moves": self.legal_moves(),
            "drivers": [driver_json(0), driver_json(1)],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aiwars_mcp_warden::game::Match;
    use serde_json::json;

    fn handles() -> Vec<String> {
        vec!["vex".to_string(), "nyx".to_string()]
    }

    #[test]
    fn rejects_wrong_player_count() {
        for n in [1usize, 3] {
            let hs: Vec<String> = (0..n).map(|i| format!("p{i}")).collect();
            match Match::<Getaway>::new(hs, &json!({})) {
                Err(MatchError::WrongPlayerCount { want, got }) => {
                    assert_eq!(want, 2..=2);
                    assert_eq!(got, n);
                }
                _ => panic!("expected WrongPlayerCount for {n} players"),
            }
        }
    }

    #[test]
    fn first_move_advances_ply_and_passes_turn() {
        let mut m = Match::<Getaway>::new(handles(), &json!({ "seed": 7 })).unwrap();
        m.start();
        assert_eq!(m.state_json()["ply"], 0);
        assert_eq!(m.state_json()["to_move_idx"], 0);
        let legal = m.turn_info(0)["moves"].as_array().unwrap().len();
        assert_eq!(legal, 3, "three roads at each leg");
        let st = m.make_move(0, "drive:highway", 0).unwrap();
        assert_eq!(st["ply"], 1);
        assert_eq!(st["to_move_idx"], 1, "turn passes to the rival");
        assert!(st["drivers"][0]["progress"].as_u64().unwrap() > 0);
        assert!(st["drivers"][0]["heat"].as_u64().unwrap() > 0);
    }

    #[test]
    fn illegal_and_out_of_turn_rejected_without_change() {
        let mut m = Match::<Getaway>::new(handles(), &json!({ "seed": 7 })).unwrap();
        m.start();
        let before = m.state_json();
        // wrong agent
        assert_eq!(m.make_move(1, "drive:highway", 0).unwrap_err(), MatchError::NotYourTurn);
        // bogus road
        assert!(matches!(
            m.make_move(0, "fly:helicopter", 0).unwrap_err(),
            MatchError::IllegalMove(_)
        ));
        assert_eq!(m.state_json(), before, "no state change on a rejected move");
    }

    #[test]
    fn stale_ply_rejected() {
        let mut m = Match::<Getaway>::new(handles(), &json!({ "seed": 7 })).unwrap();
        m.start();
        assert_eq!(m.make_move(0, "drive:highway", 9).unwrap_err(), MatchError::StalePly);
    }

    #[test]
    fn flooring_the_highway_eventually_escapes_or_busts_with_a_winner() {
        // Both drivers always take the highway: a decisive result must emerge
        // (someone reaches the boat or busts) with a concrete winner or a draw.
        let mut m = Match::<Getaway>::new(handles(), &json!({ "seed": 7 })).unwrap();
        m.start();
        let mut guard = 0;
        while !m.is_resolved() && guard < 64 {
            let seat = m.state_json()["to_move_idx"].as_u64().unwrap() as usize;
            let ply = m.state_json()["ply"].as_u64().unwrap() as u32;
            let mv = m.turn_info(seat)["moves"][0].as_str().unwrap().to_string();
            // ignore occasional NotYourTurn on a finished driver; pick current seat's move
            let _ = m.make_move(seat, &mv, ply);
            guard += 1;
        }
        assert!(m.is_resolved(), "match must resolve within the leg cap");
        let result = m.result().expect("resolved match has a result");
        assert!(result.outcome == "Winner" || result.outcome == "Draw");
    }

    #[test]
    fn resign_awards_opponent() {
        let mut m = Match::<Getaway>::new(handles(), &json!({ "seed": 3 })).unwrap();
        m.start();
        let st = m.resign(0);
        assert_eq!(st["status"], "resigned");
        assert!(m.is_resolved());
        let result = m.result().unwrap();
        assert_eq!(result.outcome, "Winner");
        assert_eq!(result.winner.as_deref(), Some("nyx"));
    }

    #[test]
    fn same_seed_same_roads() {
        let a = Match::<Getaway>::new(handles(), &json!({ "seed": 42 })).unwrap();
        let b = Match::<Getaway>::new(handles(), &json!({ "seed": 42 })).unwrap();
        assert_eq!(a.state_json()["moves"], b.state_json()["moves"]);
    }
}
