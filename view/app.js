/* Getaway spectator board. Polls ./state.json (the referee's live game state) and
 * renders the chase: two cars climb a neon street grid toward the harbour boat,
 * heat bars, the police chopper over the leader, and live odds. Read-only and
 * offline — everything is drawn procedurally (no remote assets), like the chess
 * board's app.js. Dispatches on data.game so the same SPA shape generalises. */
(function () {
  const W = 780, H = 560, GOAL = 100;
  const cv = document.getElementById("c"), ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  const statusEl = document.getElementById("status");
  const LANE_X = [W * 0.26, W * 0.5, W * 0.74];
  const trackTop = 90, trackBot = H - 70;
  const lerp = (a, b, t) => a + (b - a) * t;

  let data = null;            // latest state.json
  let shown = [0, 0];         // displayed progress (eased toward real)
  let shownHeat = [0, 0];

  function progY(p) { return lerp(trackBot, trackTop, Math.min(1, p / GOAL)); }

  async function tick() {
    try {
      const r = await fetch("./state.json", { cache: "no-store" });
      data = await r.json();
      if (data.game !== "getaway") {
        statusEl.innerHTML = `<span class="off">unsupported game: ${data.game || "?"}</span>`;
        data = null;
      } else {
        const d = data.drivers;
        statusEl.textContent = data.winner
          ? `Final — ${data.winner} wins (${data.win_reason}).`
          : `Live · ${d[0].handle} ${d[0].progress}% (🔥${d[0].heat}) vs ${d[1].handle} ${d[1].progress}% (🔥${d[1].heat}) · chopper on ${data.leader || "—"}`;
      }
    } catch (e) {
      statusEl.innerHTML = `<span class="off">waiting for referee…</span>`;
    }
  }
  setInterval(tick, 1000); tick();

  // ---- drawing ----
  function nightSky(t) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#04060f"); g.addColorStop(0.5, "#0a1230"); g.addColorStop(1, "#241a4a");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 46; i++) {
      const x = (i * 137) % W, y = (i * 53) % 180, tw = (Math.sin(t / 700 + i) + 1) / 2;
      ctx.fillStyle = `rgba(200,220,255,${0.12 + tw * 0.32})`; ctx.fillRect(x, y, 2, 2);
    }
    ctx.fillStyle = "#e7ecff"; ctx.beginPath(); ctx.arc(96, 64, 24, 0, 7); ctx.fill();
    ctx.fillStyle = "#04060f"; ctx.beginPath(); ctx.arc(84, 57, 20, 0, 7); ctx.fill();
  }
  function harbor(t) {
    const g = ctx.createLinearGradient(0, 0, 0, 96);
    g.addColorStop(0, "#06223a"); g.addColorStop(1, "#0a1428");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, 96);
    for (let i = 0; i < 18; i++) {
      ctx.strokeStyle = `rgba(80,200,255,${0.05 + 0.05 * (Math.sin(t / 600 + i) * .5 + .5)})`;
      ctx.beginPath(); ctx.moveTo(0, 30 + i * 3); ctx.lineTo(W, 30 + i * 3 + Math.sin(t / 500 + i) * 2); ctx.stroke();
    }
    // boat
    const bx = W * 0.5, by = 64, esc = data && data.winner && data.win_reason === "escape";
    const gl = ctx.createRadialGradient(bx, by, 0, bx, by, 46);
    gl.addColorStop(0, esc ? "rgba(52,211,153,.5)" : "rgba(52,211,153,.26)"); gl.addColorStop(1, "rgba(52,211,153,0)");
    ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(bx, by, 46, 0, 7); ctx.fill();
    ctx.fillStyle = "#13324a"; rrect(bx - 26, by, 52, 16, 6); ctx.fill();
    ctx.fillStyle = "#0c1c2c"; rrect(bx - 12, by - 9, 24, 11, 3); ctx.fill();
    label(bx, 52, "▲ EXTRACTION", 11, "#34d399", "center");
  }
  function roads(t) {
    ctx.lineWidth = 22; ctx.lineCap = "round";
    for (let lane = 0; lane < 3; lane++) {
      ctx.strokeStyle = "#0e1729"; ctx.beginPath();
      ctx.moveTo(LANE_X[lane], trackBot); ctx.lineTo(LANE_X[lane], trackTop); ctx.stroke();
      ctx.setLineDash([10, 14]); ctx.lineDashOffset = -(t / 30) % 24;
      ctx.strokeStyle = "rgba(220,230,255,.10)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(LANE_X[lane], trackBot); ctx.lineTo(LANE_X[lane], trackTop); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 22;
    }
  }
  function car(x, y, col, name, moving, t, id) {
    // headlight cone (up)
    const hg = ctx.createLinearGradient(0, 0, 0, -48);
    hg.addColorStop(0, "rgba(255,245,200,.30)"); hg.addColorStop(1, "rgba(255,245,200,0)");
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = hg; ctx.beginPath(); ctx.moveTo(-5, -8); ctx.lineTo(-20, -50); ctx.lineTo(20, -50); ctx.lineTo(5, -8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.34)"; ctx.beginPath(); ctx.ellipse(0, 14, 15, 5, 0, 0, 7); ctx.fill();
    ctx.fillStyle = "#0a0f1a"; rrect(-12, -16, 24, 34, 7); ctx.fill();
    ctx.fillStyle = col; rrect(-11, -15, 22, 32, 6); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.18)"; rrect(-11, -15, 22, 7, 5); ctx.fill();
    ctx.fillStyle = "#0c1424"; rrect(-8, -10, 16, 12, 3); ctx.fill();
    label(0, 0, id, 8, "rgba(255,255,255,.75)", "center");
    ctx.fillStyle = "#fff7da"; ctx.fillRect(-9, -16, 4, 3); ctx.fillRect(5, -16, 4, 3);
    ctx.fillStyle = "#ff4d5e"; ctx.fillRect(-9, 15, 4, 3); ctx.fillRect(5, 15, 4, 3);
    ctx.restore();
    ctx.fillStyle = "rgba(8,16,30,.9)"; const w = Math.max(46, name.length * 8);
    rrect(x - w / 2, y + 20, w, 15, 4); ctx.fill();
    label(x, y + 31, name.toUpperCase(), 9, id === "A" ? "#5eead4" : "#c4b5fd", "center");
  }
  function chopper(x, y, t) {
    const cx = x + Math.sin(t / 700) * 26, cy = y - 86;
    ctx.save(); const ang = Math.atan2(y - cy, x - cx); ctx.translate(cx, cy); ctx.rotate(ang);
    const len = Math.hypot(x - cx, y - cy);
    const g = ctx.createLinearGradient(0, 0, len, 0);
    g.addColorStop(0, "rgba(255,240,180,.28)"); g.addColorStop(1, "rgba(255,240,180,.02)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len, -34); ctx.lineTo(len, 34); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#0e1626"; rrect(cx - 15, cy - 7, 28, 14, 7); ctx.fill();
    ctx.fillStyle = "#16243f"; rrect(cx - 13, cy - 5, 11, 9, 5); ctx.fill();
    ctx.fillStyle = "#0c1322"; ctx.fillRect(cx + 12, cy - 2, 20, 3);
    const rb = Math.floor(t / 220) % 2 === 0;
    ctx.fillStyle = rb ? "#ff3b53" : "#2b6bff"; ctx.beginPath(); ctx.arc(cx - 12, cy + 5, 3, 0, 7); ctx.fill();
    ctx.fillStyle = rb ? "#2b6bff" : "#ff3b53"; ctx.beginPath(); ctx.arc(cx + 9, cy + 5, 3, 0, 7); ctx.fill();
    if ((t / 30) % 1 < .5) { ctx.strokeStyle = "rgba(200,220,255,.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - 26, cy - 10); ctx.lineTo(cx + 26, cy - 10); ctx.stroke(); }
  }
  function hud() {
    if (!data) return;
    const d = data.drivers, rows = [[d[0], "#10b981", "#5eead4"], [d[1], "#8b5cf6", "#c4b5fd"]];
    ctx.fillStyle = "rgba(8,14,26,.82)"; rrect(12, 108, 250, 70, 10); ctx.fill();
    rows.forEach(([dr, col, soft], i) => {
      const y = 126 + i * 28;
      label(24, y + 4, dr.handle.toUpperCase().slice(0, 12), 10, soft, "left");
      bar(110, y - 6, 90, 7, dr.progress / GOAL, col);
      const hk = Math.min(1, dr.heat / 100);
      bar(110, y + 3, 90, 5, hk, hk > 0.8 ? "#ff3b53" : "#ffb13b");
      label(210, y - 1, dr.busted ? "BUST" : dr.escaped ? "BOAT" : dr.progress + "%", 9, dr.busted ? "#ff5d6c" : soft, "left");
    });
    // odds pill (top-center)
    const a = oddsA(), pa = Math.round(a * 100), pb = 100 - pa;
    const bw = 248, x = (W - bw) / 2, yy = 7;
    ctx.fillStyle = "rgba(7,11,20,.82)"; rrect(x, yy, bw, 30, 9); ctx.fill();
    label(W / 2, yy + 12, "◷ LIVE ODDS", 8, "#7C8AA0", "center");
    label(x + 12, yy + 12, d[0].handle.toUpperCase() + " " + pa + "%", 9, "#5eead4", "left");
    label(x + bw - 12, yy + 12, pb + "% " + d[1].handle.toUpperCase(), 9, "#c4b5fd", "right");
    const aw = Math.max(2, (bw - 24) * a);
    ctx.fillStyle = "#10b981"; rrect(x + 12, yy + 18, aw, 7, 3); ctx.fill();
    ctx.fillStyle = "#8b5cf6"; rrect(x + 12 + aw, yy + 18, bw - 24 - aw, 7, 3); ctx.fill();
  }
  function oddsA() {
    if (!data) return 0.5;
    const d = data.drivers;
    const lead = (d[0].progress - d[1].progress) / 30, risk = (d[1].heat - d[0].heat) / 80;
    const f = (x) => 1 / (1 + Math.exp(-x));
    const a = f(lead + risk), b = f(-lead - risk); return a / (a + b);
  }
  function finish() {
    if (!data || !data.winner && data.status !== "doublebust" && data.status !== "draw") return;
    if (!data.winner && !["doublebust", "draw"].includes(data.status)) return;
    ctx.fillStyle = "rgba(3,6,12,.55)"; ctx.fillRect(0, 0, W, H);
    const draw = !data.winner;
    const col = draw ? "#9aa2b6" : data.win_reason === "escape" ? "#34d399" : "#a855f7";
    const title = draw ? "DRAW" : data.win_reason === "escape" ? "ESCAPED" : data.win_reason === "bust" ? "LAST CREW STANDING" : "FINISH";
    label(W / 2, H / 2 - 8, title, 36, col, "center");
    label(W / 2, H / 2 + 22, draw ? "Both crews busted" : data.winner + " wins", 16, "#e9ecf5", "center");
  }

  function frame(t) {
    nightSky(t); harbor(t); roads(t);
    if (data) {
      const d = data.drivers;
      for (let i = 0; i < 2; i++) { shown[i] += (d[i].progress - shown[i]) * 0.12; shownHeat[i] += (d[i].heat - shownHeat[i]) * 0.12; }
      const lead = data.leader;
      const pos = [0, 1].map(i => ({ x: LANE_X[d[i].lane], y: d[i].escaped ? 64 : progY(shown[i]) }));
      const order = lead === d[0].handle ? [1, 0] : [0, 1];
      for (const i of order) car(pos[i].x, pos[i].y, i ? "#8b5cf6" : "#10b981", d[i].handle, !data.winner, t, i ? "B" : "A");
      if (!data.winner && lead) { const li = d[0].handle === lead ? 0 : 1; chopper(pos[li].x, pos[li].y, t); }
      hud(); finish();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // tiny helpers
  function rrect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function label(x, y, t, px, c, al) { ctx.fillStyle = c; ctx.textAlign = al || "left"; ctx.font = `700 ${px}px ui-monospace,monospace`; ctx.fillText(t, x, y); }
  function bar(x, y, w, h, f, c) { ctx.fillStyle = "#0a1322"; rrect(x, y, w, h, h / 2); ctx.fill(); ctx.fillStyle = c; rrect(x, y, Math.max(2, w * Math.max(0, Math.min(1, f))), h, h / 2); ctx.fill(); }
})();
