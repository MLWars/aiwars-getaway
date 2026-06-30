/* Getaway — a wet-neon isometric city chase. Two getaway drivers (Champions)
 * thread a seeded street grid toward the harbor extraction boat. Their PUBLIC
 * PROMPT is a route/risk doctrine: floor the highway (fast, but the police
 * chopper's HEAT spikes) or ghost the back-alleys (slow, cool). The chopper
 * hovers over whoever's LEADING, so a fast favourite is never a lock. First to
 * the boat escapes; max your HEAT and you're BUSTED.
 *
 * Faithful to the engine Game-trait model: turn-based, opaque move-strings, the
 * agent plays via get_state → legal_moves → make_move(mv, ply). The prompt
 * decides which legal road it takes each turn.
 */
(function () {
  const A = window.AW;
  const W = 780, H = 560;
  const GOAL = 100, LEGS = 8;

  // lane lattice: 0=alley(left,cool,slow) 1=mid 2=highway(right,fast,hot)
  const LANE_X = [W * 0.26, W * 0.5, W * 0.74];
  const legY = (leg) => H - 96 - leg * ((H - 230) / LEGS);
  const wp = (leg, lane, seed) => {
    const r = A.rng(seed * 131 + leg * 17 + lane * 7);
    return { x: LANE_X[lane] + (r() - 0.5) * 64, y: legY(leg) + (r() - 0.5) * 16 };
  };
  const BOAT = { x: W * 0.62, y: 78 };

  // ---- doctrine: parse the public prompt into a driving policy --------------
  const KW = {
    speed: ["highway", "bridge", "fast", "floor", "sprint", "speed", "boat first", "race", "fastest", "pedal", "aggressive"],
    stealth: ["alley", "back", "quiet", "stealth", "cool", "low heat", "careful", "patient", "ghost", "shadow", "avoid", "dark"],
  };
  function doctrine(prompt) {
    const p = (prompt || "").toLowerCase();
    let s = 0, st = 0;
    for (const k of KW.speed) if (p.includes(k)) s++;
    for (const k of KW.stealth) if (p.includes(k)) st++;
    if (s === 0 && st === 0) return { kind: "balanced", tag: "balanced", speed: 0.5 };
    if (s > st) return { kind: "speed", tag: "highway hammer", speed: 0.85 };
    if (st > s) return { kind: "stealth", tag: "alley ghost", speed: 0.18 };
    return { kind: "balanced", tag: "balanced", speed: 0.5 };
  }
  function highlight(prompt) {
    let h = A && prompt ? prompt : prompt || "";
    h = h.replace(/[&<>]/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[m]));
    for (const k of [...KW.speed, ...KW.stealth]) {
      h = h.replace(new RegExp("\\b(" + k + ")\\b", "ig"), "<b>$1</b>");
    }
    return h;
  }

  const DEF_A = "Floor it. Take the highway and the bridge — reach the extraction boat first. Speed beats stealth; I'll outrun the heat.";
  const DEF_B = "Stay cool and quiet. Ghost the back-alleys in the dark, keep my heat low, and slip to the harbor before they ever spot me.";

  // ---- the deterministic engine --------------------------------------------
  function build(seed, opts) {
    const rng = A.rng(seed);
    const prompts = { A: (opts.prompts && opts.prompts.A) || DEF_A, B: (opts.prompts && opts.prompts.B) || DEF_B };
    const doc = { A: doctrine(prompts.A), B: doctrine(prompts.B) };
    // hidden seeded twist: on one leg an alley is secretly a fast shortcut, and a
    // highway is secretly jammed — so the same doctrines don't always resolve.
    const twistLeg = 1 + Math.floor(rng() * (LEGS - 1));
    const twistJam = rng() < 0.5; // jam the highway vs gift the alley

    function roads(leg) {
      // returns 3 lane options with {lane,name,progress,heat}
      const jam = leg === twistLeg && twistJam;
      const gift = leg === twistLeg && !twistJam;
      const r = A.rng(seed * 977 + leg);
      return [
        { lane: 0, name: "drift:backalley", progress: gift ? 22 + r() * 6 : 11 + r() * 4, heat: 2 + r() * 3, kind: "alley" },
        { lane: 1, name: "drive:cross_st", progress: 14 + r() * 4, heat: 6 + r() * 4, kind: "mid" },
        { lane: 2, name: "drive:highway", progress: jam ? 8 + r() * 3 : 18 + r() * 6, heat: 11 + r() * 6, kind: "highway" },
      ];
    }
    function choose(d, opts3) {
      // speed→max progress; stealth→min heat; balanced→best progress per heat
      if (d.kind === "speed") return opts3.slice().sort((a, b) => b.progress - a.progress)[0];
      if (d.kind === "stealth") return opts3.slice().sort((a, b) => a.heat - b.heat)[0];
      return opts3.slice().sort((a, b) => b.progress / (b.heat + 3) - a.progress / (a.heat + 3))[0];
    }

    const st = {
      A: { prog: 0, heat: 0, leg: 0, lane: 1, busted: false, escaped: false, lastWP: { x: W * 0.36, y: H - 84 } },
      B: { prog: 0, heat: 0, leg: 0, lane: 1, busted: false, escaped: false, lastWP: { x: W * 0.64, y: H - 84 } },
    };
    const beats = [];
    const oddsHist = [];
    let ply = 1, winner = undefined, winReason = "closer", done = false;
    const leader = () => (st.A.prog === st.B.prog ? null : st.A.prog > st.B.prog ? "A" : "B");

    function snapOdds() {
      const f = (me, op) => {
        const lead = (st[me].prog - st[op].prog) / 30;
        const risk = (st[op].heat - st[me].heat) / 80;
        return 1 / (1 + Math.exp(-(lead + risk)));
      };
      let a = f("A", "B"), b = f("B", "A");
      const s = a + b; a /= s; b /= s;
      return { A: a * 100, B: b * 100 };
    }
    oddsHist.push(snapOdds());

    for (let leg = 0; leg < LEGS && !done; leg++) {
      for (const id of ["A", "B"]) {
        if (done) break;
        const me = st[id], op = st[id === "A" ? "B" : "A"];
        if (me.escaped || me.busted) continue;
        const opts3 = roads(leg);
        const lead = leader();
        const chopperOnMe = lead === id;
        const pick = choose(doc[id], opts3);
        const heatMul = chopperOnMe ? 1.5 : 1; // reactive heat: chopper punishes the leader
        const cool = pick.kind === "alley" ? 5 : 0; // alleys shed a little heat
        me.heat = A.clamp(me.heat + pick.heat * heatMul - cool, 0, 130);
        me.prog = Math.min(GOAL, me.prog + pick.progress);
        me.leg = leg + 1; me.lane = pick.lane;
        let result, ok = true;
        if (me.heat >= 100) { me.busted = true; result = "BUSTED · heat " + Math.round(me.heat) + "%"; ok = false; }
        else if (me.prog >= GOAL) { me.escaped = true; result = "ESCAPED · reached the boat"; }
        else result = "ok · +" + Math.round(pick.progress) + " to harbor · heat " + Math.round(me.heat) + "%";

        const thought = doc[id].kind === "speed"
          ? "Chopper or not, fastest road wins — punch it."
          : doc[id].kind === "stealth" ? "Keep it dark and cool; let them burn the heat."
          : "Best ground per degree of heat — thread it.";
        const fromWP = me.lastWP;
        const toWP = me.escaped ? { x: BOAT.x, y: BOAT.y + 10 } : wp(leg, pick.lane, seed);
        me.lastWP = toWP;
        beats.push({
          ply: ply++, agent: id,
          thought,
          observe: { pos: "leg" + (leg + 1), heat: Math.round((me.heat)) + "%", to_harbor: Math.max(0, GOAL - Math.round(me.prog)), chopper: chopperOnMe ? "overhead" : "tailing-rival" },
          legal: opts3.map((o) => o.name),
          move: pick.name, ok, result,
          // render state snapshot
          state: {
            A: { ...st.A }, B: { ...st.B }, mover: id, lead, chopperOn: lead,
            fromWP, toWP, pickKind: pick.kind,
          },
          events: [
            `${nameOf(id)} takes the ${pick.kind === "alley" ? "back-alley" : pick.kind === "highway" ? "highway" : "cross-street"} — ${ok ? (me.escaped ? "and reaches the boat!" : "+" + Math.round(pick.progress) + " toward harbor") : "HEAT maxes — BUSTED!"}`,
          ],
        });
        oddsHist.push(snapOdds());
        if (me.escaped) { winner = id; winReason = "escape"; done = true; }
        else if (st.A.busted && st.B.busted) { winner = null; winReason = "doublebust"; done = true; }
        else if (me.busted && !op.busted && (op.escaped || op.prog > 0)) {
          // a bust hands it to the rival only if the rival is still in the chase
          if (op.escaped) { winner = id === "A" ? "B" : "A"; winReason = "escape"; done = true; }
        }
      }
    }
    // resolve no-escape end: rival busted → last crew standing; else closer wins
    if (winner === undefined) {
      if (st.A.busted && !st.B.busted) { winner = "B"; winReason = "bust"; }
      else if (st.B.busted && !st.A.busted) { winner = "A"; winReason = "bust"; }
      else if (st.A.busted && st.B.busted) { winner = null; winReason = "doublebust"; }
      else { winner = st.A.prog === st.B.prog ? null : st.A.prog > st.B.prog ? "A" : "B"; winReason = winner == null ? "doublebust" : "closer"; }
    }
    function nameOf(id) { return id === "A" ? "Vex" : "Nyx"; }
    function finalLine() {
      if (winner == null) return "Draw — both crews busted.";
      const loser = winner === "A" ? "B" : "A";
      if (winReason === "escape") return `${nameOf(winner)} reaches the extraction boat first — match over.`;
      if (winReason === "bust") return `${nameOf(loser)} maxed their heat and busted — ${nameOf(winner)} escapes by default.`;
      return `Time's up — ${nameOf(winner)} was closest to the harbor.`;
    }

    beats.push({
      ply: ply++, agent: "ref", move: "resolve", legal: null,
      observe: { winner: winner == null ? "draw" : nameOf(winner), reason: winReason },
      result: winner == null ? "draw — both busted" : nameOf(winner) + " wins · " + winReason,
      events: [finalLine()],
      state: { A: { ...st.A }, B: { ...st.B }, mover: null, final: true },
    });

    return {
      seed, beats, winner, winReason,
      names: { A: nameOf("A"), B: nameOf("B") },
      promptOf: (id) => highlight(prompts[id]),
      tagOf: (id) => doc[id].tag,
      oddsAt: (b) => oddsHist[Math.min(b, oddsHist.length - 1)] || { A: 50, B: 50 },
      _doc: doc, _twistLeg: twistLeg, _twistJam: twistJam,
    };
  }

  // ====== RENDER =============================================================
  function carPos(result, beat, beatT) {
    // interpolate each car between its previous and current leg waypoint.
    const out = { A: null, B: null };
    for (const id of ["A", "B"]) {
      // find the latest beat <= current index for this agent and the one before
      let cur = null, prev = null;
      for (let k = 0; k <= beat; k++) {
        const bt = result.beats[k];
        if (bt.agent === id) { prev = cur; cur = bt; }
      }
      if (!cur) { out[id] = wp(0, 1, result.seed); continue; }
      const from = cur.state.fromWP, to = cur.state.toWP;
      const active = result.beats[beat] && result.beats[beat].agent === id && result.beats[beat].state && !result.beats[beat].state.final;
      const tt = active ? A.easeOut(beatT) : 1;
      out[id] = { x: A.lerp(from.x, to.x, tt), y: A.lerp(from.y, to.y, tt), moving: active && beatT < 0.96, kind: cur.state.pickKind };
    }
    return out;
  }

  function draw(ctx, v) {
    const t = v.t, res = v.result, beat = v.beat, bt = res.beats[beat];
    const stt = bt && bt.state ? bt.state : { A: { prog: 0, heat: 0 }, B: { prog: 0, heat: 0 } };
    // sky
    A.nightSky(ctx, W, H, t, ["#04060f", "#0a1230", "#241a4a"]);
    moon(ctx); skyline(ctx, t); rain(ctx, t);
    harbor(ctx, t);
    city(ctx, res.seed, t);
    roadGrid(ctx, res.seed, t);
    boat(ctx, t, res.winner != null && v.over);
    npcTraffic(ctx, t);

    const cars = carPos(res, beat, v.beatT);
    const lead = stt.lead;
    // draw both cars (leader last so it's on top)
    const order = lead === "A" ? ["B", "A"] : ["A", "B"];
    for (const id of order) if (cars[id]) car(ctx, cars[id], id === "A" ? "#10b981" : "#8b5cf6", res.names[id], t, id);

    // chopper over the leader / mover
    const chopOn = stt.chopperOn || lead;
    if (chopOn && cars[chopOn] && !v.over) chopper(ctx, cars[chopOn], t);

    hud(ctx, res, stt, t);
    dispatcher(ctx, res, bt, v);

    // finish overlays
    if (v.over) finishOverlay(ctx, res, t);
    else {
      // bust flash on the busted car this beat
      for (const id of ["A", "B"]) {
        if (stt[id] && stt[id].busted && bt.agent === id) bustFlash(ctx, cars[id], v.beatT);
      }
    }
    vignette(ctx);
  }

  // --- scene pieces ----------------------------------------------------------
  function moon(ctx) {
    ctx.fillStyle = "#e7ecff"; ctx.beginPath(); ctx.arc(96, 70, 26, 0, 7); ctx.fill();
    ctx.fillStyle = "#04060f"; ctx.beginPath(); ctx.arc(84, 62, 22, 0, 7); ctx.fill();
    A.glow(ctx, 96, 70, 60, "rgba(160,180,255,0.16)");
  }
  function skyline(ctx, t) {
    const spec = [[0, 80, 150], [60, 64, 120], [150, 92, 175], [230, 54, 140], [300, 70, 120],
      [470, 60, 150], [540, 96, 175], [620, 50, 130], [690, 78, 160]];
    for (const [x, w, top] of spec) {
      A.box(ctx, x, top, w, 200 - top + 120, 10, "#070c20", "#0c1530", "#050a18");
      for (let wy = top + 12; wy < 200; wy += 16) for (let wx = x + 7; wx < x + w - 7; wx += 13) {
        const on = ((wx * 7 + wy * 13 + Math.floor(t / 1700)) % 17) < 3;
        ctx.fillStyle = on ? "rgba(120,170,230,.5)" : "rgba(26,40,74,.5)";
        ctx.fillRect(wx, wy, 4, 6);
      }
    }
  }
  function rain(ctx, t) {
    if (A.reduced) return;
    ctx.strokeStyle = "rgba(150,190,255,0.10)"; ctx.lineWidth = 1;
    for (let i = 0; i < 90; i++) {
      const x = (i * 97 + t * 0.5) % W, y = (i * 53 + t * 1.6) % H;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + 9); ctx.stroke();
    }
  }
  function harbor(ctx, t) {
    const g = ctx.createLinearGradient(0, 0, 0, 150);
    g.addColorStop(0, "#06223a"); g.addColorStop(1, "#0a1428");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 150);
    // water shimmer band near the top goal
    ctx.save(); ctx.beginPath(); ctx.rect(0, 30, W, 90); ctx.clip();
    for (let i = 0; i < 26; i++) {
      const y = 36 + i * 3.4; const a = 0.04 + 0.05 * (Math.sin(t / 600 + i) * 0.5 + 0.5);
      ctx.strokeStyle = `rgba(80,200,255,${a})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y + Math.sin(t / 500 + i) * 2); ctx.lineTo(W, y + Math.cos(t / 480 + i) * 2); ctx.stroke();
    }
    ctx.restore();
    // pier
    A.tile(ctx, 0, 118, W, 26, "#0c1422");
    ctx.fillStyle = "#0a101c"; for (let x = 20; x < W; x += 60) ctx.fillRect(x, 120, 6, 22);
    A.label(ctx, W * 0.62, 56, "▲ EXTRACTION", 11, "#34d399", "center");
  }
  function city(ctx, seed, t) {
    // dense neon city blocks filling the gaps between the road corridors,
    // drawn as low iso rooftops with lit windows (top-down-ish chase view).
    for (let leg = 0; leg < LEGS; leg++) {
      for (let g = 0; g < 2; g++) {
        const pts = [wp(leg, g, seed), wp(leg, g + 1, seed), wp(leg + 1, g + 1, seed), wp(leg + 1, g, seed)];
        const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
        const x0 = Math.min(...xs) + 17, x1 = Math.max(...xs) - 17;
        const y0 = Math.min(...ys) + 15, y1 = Math.max(...ys) - 15;
        const w = x1 - x0, h = y1 - y0;
        if (w < 20 || h < 16) continue;
        const r = A.rng(seed * 31 + leg * 7 + g * 3);
        const dep = 6 + r() * 7;
        A.box(ctx, x0, y0, w, h, dep, "#0a1322", "#0e1a30", "#06101f");
        ctx.strokeStyle = "rgba(52,224,255,.08)"; ctx.lineWidth = 1; A.rrect(ctx, x0, y0, w, h, 3); ctx.stroke();
        for (let i = 0; i < Math.floor(w * h / 130); i++) {
          const wx = x0 + 5 + r() * (w - 10), wy = y0 + 4 + r() * (h - 8);
          const on = ((Math.floor(t / 1600) + i * 3) % 7) < 2;
          ctx.fillStyle = on ? (r() < 0.5 ? "#ffcf6b" : "#5ec8ff") : "#16233a";
          ctx.fillRect(wx, wy, 3, 3);
        }
        // occasional neon rooftop sign
        if (r() < 0.22) { ctx.fillStyle = (r() < 0.5 ? "#ff5db1" : "#34e0ff") + "cc"; ctx.fillRect(x0 + 5, y0 + 4, Math.min(w - 10, 16), 2); }
      }
    }
  }
  function roadGrid(ctx, seed, t) {
    // glossy wet asphalt corridors connecting the lane lattice; chosen segments glow.
    ctx.lineWidth = 26; ctx.lineCap = "round";
    for (let lane = 0; lane < 3; lane++) {
      ctx.beginPath();
      for (let leg = 0; leg <= LEGS; leg++) { const p = wp(leg, lane, seed); leg === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
      ctx.strokeStyle = "#0c1220"; ctx.stroke();
      ctx.strokeStyle = "#10182b"; ctx.lineWidth = 22; ctx.stroke(); ctx.lineWidth = 26;
    }
    // cross links between lanes (the grid)
    ctx.lineWidth = 16; ctx.strokeStyle = "#0c1220";
    for (let leg = 0; leg <= LEGS; leg++) {
      const a0 = wp(leg, 0, seed), a1 = wp(leg, 1, seed), a2 = wp(leg, 2, seed);
      ctx.beginPath(); ctx.moveTo(a0.x, a0.y); ctx.lineTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y); ctx.stroke();
    }
    // neon lane glow + dashes
    const neon = ["#1bd6a6", "#34a0ff", "#ff5db1"];
    for (let lane = 0; lane < 3; lane++) {
      ctx.beginPath();
      for (let leg = 0; leg <= LEGS; leg++) { const p = wp(leg, lane, seed); leg === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y); }
      ctx.strokeStyle = neon[lane] + "22"; ctx.lineWidth = 3; ctx.stroke();
      // dashed centerline
      ctx.setLineDash([10, 14]); ctx.lineDashOffset = -(t / 30) % 24;
      ctx.strokeStyle = "rgba(220,230,255,0.10)"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]);
    }
    // junction nodes
    for (let leg = 0; leg <= LEGS; leg++) for (let lane = 0; lane < 3; lane++) {
      const p = wp(leg, lane, seed);
      ctx.fillStyle = "#1a2742"; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill();
    }
  }
  function boat(ctx, t, escaped) {
    const x = BOAT.x, y = BOAT.y;
    A.glow(ctx, x, y + 6, 46, escaped ? "rgba(52,211,153,0.5)" : "rgba(52,211,153,0.28)");
    ctx.fillStyle = "#13324a"; A.rrect(ctx, x - 26, y, 52, 16, 6); ctx.fill();
    ctx.fillStyle = "#1d4d6e"; ctx.beginPath(); ctx.moveTo(x - 26, y); ctx.lineTo(x - 32, y + 8); ctx.lineTo(x - 26, y + 16); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#0c1c2c"; A.rrect(ctx, x - 12, y - 9, 24, 11, 3); ctx.fill();
    const on = Math.floor(t / 500) % 2 === 0;
    ctx.fillStyle = on ? "#34d399" : "#19593f"; ctx.beginPath(); ctx.arc(x + 20, y - 6, 3, 0, 7); ctx.fill();
  }
  function npcTraffic(ctx, t) {
    for (let i = 0; i < 5; i++) {
      const lane = i % 3; const ph = (t / (2600 + i * 400) + i * 0.3) % 1;
      const p0 = wp(0, lane, 999 + i), p1 = wp(LEGS, lane, 999 + i);
      const x = A.lerp(p0.x, p1.x, ph) + 18, y = A.lerp(p0.y, p1.y, ph);
      ctx.fillStyle = "rgba(255,170,120,.5)"; ctx.fillRect(x, y, 3, 3);
      ctx.fillStyle = "rgba(255,60,60,.4)"; ctx.fillRect(x - 7, y, 2, 3);
    }
  }
  function car(ctx, pc, col, name, t, id) {
    const ang = -Math.PI / 2 + Math.atan2(0, 0); // up-ish; refine by velocity below
    ctx.save(); ctx.translate(pc.x, pc.y);
    // taillight smear when moving
    if (pc.moving && !A.reduced) {
      const g = ctx.createLinearGradient(0, 28, 0, 4);
      g.addColorStop(0, col + "00"); g.addColorStop(1, col + "66");
      ctx.fillStyle = g; ctx.fillRect(-7, 4, 14, 30);
    }
    // headlight cone (points up toward harbor)
    const hg = ctx.createLinearGradient(0, -8, 0, -54);
    hg.addColorStop(0, "rgba(255,245,200,0.32)"); hg.addColorStop(1, "rgba(255,245,200,0)");
    ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(-22, -54); ctx.lineTo(22, -54); ctx.lineTo(5, -8); ctx.closePath(); ctx.fill();
    A.shadow(ctx, 0, 14, 16, 6, 0.34);
    // body
    ctx.fillStyle = "#0a0f1a"; A.rrect(ctx, -12, -16, 24, 34, 7); ctx.fill();
    ctx.fillStyle = col; A.rrect(ctx, -11, -15, 22, 32, 6); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.18)"; A.rrect(ctx, -11, -15, 22, 7, 5); ctx.fill();
    // windshield + roof initial
    ctx.fillStyle = "#0c1424"; A.rrect(ctx, -8, -10, 16, 12, 3); ctx.fill();
    A.label(ctx, 0, 0, id, 8, "rgba(255,255,255,.7)", "center");
    // headlights / taillights
    ctx.fillStyle = "#fff7da"; ctx.fillRect(-9, -16, 4, 3); ctx.fillRect(5, -16, 4, 3);
    ctx.fillStyle = "#ff4d5e"; ctx.fillRect(-9, 15, 4, 3); ctx.fillRect(5, 15, 4, 3);
    ctx.restore();
    // name tag
    ctx.fillStyle = "rgba(8,16,30,.9)"; const w = Math.max(46, name.length * 8);
    A.rrect(ctx, pc.x - w / 2, pc.y + 20, w, 15, 4); ctx.fill();
    A.label(ctx, pc.x, pc.y + 31, name.toUpperCase(), 9, id === "A" ? "#5eead4" : "#c4b5fd", "center");
  }
  function chopper(ctx, target, t) {
    const cx = target.x + Math.sin(t / 700) * 30, cy = target.y - 120 + Math.sin(t / 900) * 8;
    // searchlight cone to the target
    ctx.save();
    const ang = Math.atan2(target.y - cy, target.x - cx);
    ctx.translate(cx, cy); ctx.rotate(ang);
    const len = Math.hypot(target.x - cx, target.y - cy);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(255,240,180,0.30)"); g.addColorStop(1, "rgba(255,240,180,0.02)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -42); ctx.lineTo(len, 42); ctx.closePath(); ctx.fill();
    ctx.restore();
    // lit pool on the road
    A.glow(ctx, target.x, target.y, 40, "rgba(255,240,180,0.18)");
    // skids
    ctx.strokeStyle = "#1a2336"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx - 14, cy + 7); ctx.lineTo(cx + 12, cy + 7); ctx.stroke();
    // tail boom
    ctx.fillStyle = "#0c1322"; ctx.beginPath(); ctx.moveTo(cx + 12, cy - 3); ctx.lineTo(cx + 34, cy - 1); ctx.lineTo(cx + 34, cy + 2); ctx.lineTo(cx + 12, cy + 3); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#16203a"; ctx.fillRect(cx + 32, cy - 5, 3, 9); // tail fin
    // tail rotor
    if (!A.reduced) { ctx.strokeStyle = "rgba(200,220,255,.4)"; ctx.lineWidth = 1.5; const tr = 6, ta = t / 25; ctx.beginPath(); ctx.moveTo(cx + 34, cy - tr * Math.cos(ta)); ctx.lineTo(cx + 34, cy + tr * Math.cos(ta)); ctx.stroke(); }
    // cockpit body
    ctx.fillStyle = "#0e1626"; A.rrect(ctx, cx - 16, cy - 7, 30, 15, 7); ctx.fill();
    ctx.fillStyle = "#16243f"; A.rrect(ctx, cx - 14, cy - 5, 12, 9, 5); ctx.fill(); // glass nose
    // main rotor blur
    if (!A.reduced) { ctx.strokeStyle = "rgba(200,220,255,.5)"; ctx.lineWidth = 2; const r = 28, a = t / 38; ctx.beginPath(); ctx.moveTo(cx - Math.cos(a) * r, cy - 10 - Math.sin(a) * 4); ctx.lineTo(cx + Math.cos(a) * r, cy - 10 + Math.sin(a) * 4); ctx.stroke(); ctx.fillStyle = "#2a3856"; ctx.fillRect(cx - 2, cy - 12, 4, 4); }
    // beacons red/blue
    const rb = Math.floor(t / 220) % 2 === 0;
    ctx.fillStyle = rb ? "#ff3b53" : "#2b6bff"; ctx.beginPath(); ctx.arc(cx - 14, cy + 5, 3, 0, 7); ctx.fill();
    ctx.fillStyle = rb ? "#2b6bff" : "#ff3b53"; ctx.beginPath(); ctx.arc(cx + 10, cy + 5, 3, 0, 7); ctx.fill();
  }
  function hud(ctx, res, stt, t) {
    // per-driver HEAT + progress, top-left
    const rows = [["A", res.names.A, "#10b981", "#5eead4"], ["B", res.names.B, "#8b5cf6", "#c4b5fd"]];
    ctx.fillStyle = "rgba(8,14,26,.82)"; A.rrect(ctx, 12, 12, 250, 70, 10); ctx.fill();
    ctx.strokeStyle = "rgba(52,211,153,.4)"; ctx.lineWidth = 1; A.rrect(ctx, 12.5, 12.5, 249, 69, 10); ctx.stroke();
    rows.forEach(([id, nm, col, soft], i) => {
      const y = 30 + i * 28; const s = stt[id] || { prog: 0, heat: 0, busted: false, escaped: false };
      A.label(ctx, 24, y + 4, nm.toUpperCase(), 10, soft, "left");
      // progress bar
      bar(ctx, 92, y - 6, 90, 7, s.prog / GOAL, col, "#0a1322");
      // heat bar
      const hk = s.heat / 100; bar(ctx, 92, y + 3, 90, 5, Math.min(1, hk), hk > 0.8 ? "#ff3b53" : "#ffb13b", "#0a1322");
      A.label(ctx, 190, y - 1, s.busted ? "BUST" : s.escaped ? "BOAT" : Math.round(s.prog) + "%", 9, s.busted ? "#ff5d6c" : soft, "left");
      A.label(ctx, 232, y + 6, "🔥" + Math.round(s.heat), 8, hk > 0.8 ? "#ff5d6c" : "#ffb13b", "left");
    });
  }
  function bar(ctx, x, y, w, h, frac, col, bg) {
    ctx.fillStyle = bg; A.rrect(ctx, x, y, w, h, h / 2); ctx.fill();
    ctx.fillStyle = col; A.rrect(ctx, x, y, Math.max(2, w * A.clamp(frac, 0, 1)), h, h / 2); ctx.fill();
  }
  function dispatcher(ctx, res, bt, v) {
    const h = 44; const y = H - h;
    ctx.fillStyle = "rgba(5,9,16,.92)"; ctx.fillRect(0, y, W, h);
    ctx.strokeStyle = "rgba(52,211,153,.4)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(W, y + .5); ctx.stroke();
    A.label(ctx, 16, y + 18, "📻 DISPATCH", 10, "#34d399", "left");
    let line = "Two crews racing for the harbor boat. Read each prompt — who burns heat for speed, who ghosts the alleys?";
    if (bt && bt.events && bt.events[0]) line = bt.events[0];
    if (v.over && res.beats.length) line = res.beats[res.beats.length - 1].events[0];
    A.wrap(ctx, line, 110, y + 18, W - 130, 14, 12, "#cfe0ff", "ui-monospace,monospace");
  }
  function bustFlash(ctx, pc, beatT) {
    const a = Math.sin(beatT * Math.PI) * 0.5;
    ctx.fillStyle = `rgba(255,40,60,${a * 0.4})`; ctx.fillRect(0, 0, W, H);
    if (pc) { A.label(ctx, pc.x, pc.y - 30, "BUSTED", 16, "#ff3b53", "center"); }
  }
  function finishOverlay(ctx, res, t) {
    ctx.fillStyle = "rgba(3,6,12,.55)"; ctx.fillRect(0, 0, W, H);
    const draw = res.winner == null;
    const col = draw ? "#9aa2b6" : res.winner === "A" ? "#34d399" : "#a855f7";
    A.glow(ctx, W / 2, H / 2 - 14, 220, (draw ? "rgba(154,162,182," : res.winner === "A" ? "rgba(52,211,153," : "rgba(168,85,247,") + "0.18)");
    const loser = res.winner === "A" ? "B" : "A";
    const title = draw ? "DRAW" : res.winReason === "bust" ? "LAST CREW STANDING" : res.winReason === "closer" ? "TIME UP" : "ESCAPED";
    const sub = draw ? "Both crews busted"
      : res.winReason === "escape" ? res.names[res.winner] + " reaches the boat first"
      : res.winReason === "bust" ? res.names[loser] + " busted — " + res.names[res.winner] + " escapes"
      : res.names[res.winner] + " was closest to the harbor";
    A.label(ctx, W / 2, H / 2 - 16, title, draw ? 40 : 34, col, "center", "ui-monospace,monospace");
    A.label(ctx, W / 2, H / 2 + 18, sub, 16, "#e9ecf5", "center");
    // confetti-ish sparks
    if (!draw && !A.reduced) for (let i = 0; i < 40; i++) {
      const a = (i / 40) * 7 + t / 600; const r = 60 + (i % 5) * 26 + Math.sin(t / 300 + i) * 10;
      ctx.fillStyle = i % 2 ? col : "#fff";
      ctx.fillRect(W / 2 + Math.cos(a) * r, H / 2 - 14 + Math.sin(a) * r * 0.6, 3, 3);
    }
  }
  function vignette(ctx) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }

  window.GETAWAY = {
    id: "getaway", name: "Getaway", W, H,
    tag: "Two getaway drivers race a seeded city to the extraction boat. Floor the highway and the chopper's HEAT spikes; ghost the alleys and stay cool. First to the boat escapes.",
    champions: [{ id: "A", name: "Vex", color: "#10b981" }, { id: "B", name: "Nyx", color: "#8b5cf6" }],
    prompts: { A: DEF_A, B: DEF_B },
    mcp: {
      kickoff: "You are a getaway driver in a refereed chase, played entirely through your tools. Each turn: get_state, legal_moves, then make_move with a road and the current ply. Reach the extraction boat before your HEAT hits 100%. Win.",
      tools: [
        { name: "get_state", args: "", ret: "{pos, heat, to_harbor, chopper}", desc: "Read the chase: your position, heat %, distance to the boat, where the chopper is." },
        { name: "legal_moves", args: "", ret: "[road, …], ply", desc: "The roads you can take from here (highway / cross-street / back-alley)." },
        { name: "make_move", args: "road, expected_ply", desc: "Drive a road. Highways gain ground fast but spike heat; alleys are slow and cool.", ret: "new state | error" },
        { name: "resign", args: "", ret: "forfeit", desc: "Give up the chase." },
      ],
      vocab: "drive:highway · drive:cross_st · drift:backalley",
    },
    build, draw,
  };
})();
