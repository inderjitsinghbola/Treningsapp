import { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { Check, Edit2, TrendingUp, ArrowLeft, Plus, Minus, Trophy, ChevronRight, ChevronDown, X, Clock, List, Eye, EyeOff, RotateCcw, Settings, RefreshCw } from "lucide-react";

// ─── PLATE MATH ───────────────────────────────────────────────────────────────
const AVAIL = [25, 20, 15, 10, 5, 2.5, 1.25];
const R25 = v => Math.round(v / 2.5) * 2.5;

function fillP(perSide) {
  let rem = +(+perSide).toFixed(4);
  const out = [];
  for (const p of AVAIL) while (rem >= p - 0.001) { out.push(p); rem = +(rem - p).toFixed(4); }
  return out;
}

function platesTxt(ps) {
  const c = {};
  ps.forEach(p => c[p] = (c[p] || 0) + 1);
  return Object.entries(c).sort((a, b) => b[0] - a[0]).map(([p, n]) => n > 1 ? `${n}×${p}` : p).join("+") + " kg";
}

// Core algorithm: find drop plate size(s) that let you strip cleanly,
// then build warmup by adding plates inside-out so stripping = outside-in.
function calcPlateGuide(topWeight, numDrops, approxDropPct, bar = 20) {
  const perSide = (topWeight - bar) / 2;
  if (perSide <= 0) return null;

  if (numDrops === 0) {
    // No drops: standard warmup, largest-first loading
    const warmupPcts = [0, 0.60, 0.775, 0.925];
    const steps = [];
    let prevPS = 0;
    for (let i = 1; i < warmupPcts.length; i++) {
      const tgtW = Math.max(bar, R25(topWeight * warmupPcts[i]));
      const tgtPS = (tgtW - bar) / 2;
      const addPS = +(tgtPS - prevPS).toFixed(4);
      const plates = fillP(Math.max(0, addPS));
      if (plates.length > 0) {
        const pct0 = Math.round(tgtW / topWeight * 100); const reps0 = pct0 < 65 ? '10–12' : pct0 < 80 ? '5–6' : pct0 < 90 ? '2–3' : '1'; steps.push({ add: plates, addTxt: platesTxt(plates), weight: bar + 2 * tgtPS, pct: pct0, reps: reps0 });
        prevPS = tgtPS;
      }
    }
    // Final step to top weight
    const finalAdd = +(perSide - prevPS).toFixed(4);
    if (finalAdd > 0.001) {
      const plates = fillP(finalAdd);
      steps.push({ add: plates, addTxt: platesTxt(plates), weight: topWeight, pct: 100, isTop: true, reps: '4' });
    } else if (steps.length > 0) {
      steps[steps.length - 1].isTop = true; steps[steps.length - 1].reps = '4';
      steps[steps.length - 1].weight = topWeight;
      steps[steps.length - 1].pct = 100;
    }
    return { warmupSteps: steps, dropSteps: [], adjustedDropWeights: [] };
  }

  // With drops: find a single plate size p to strip per drop (or p1 for last, p2 for earlier)
  const targetDropPS = topWeight * approxDropPct / 2;
  let best = null, bestScore = Infinity;

  for (const p of AVAIL.filter(p => p <= targetDropPS * 2.2)) {
    // All drops use same plate size p
    const totalDropPS = numDrops * p;
    const basePS = +(perSide - totalDropPS).toFixed(4);
    if (basePS < 0) continue;
    const bp = fillP(basePS);
    const actualBase = bp.reduce((a, b) => a + b, 0);
    if (Math.abs(actualBase - basePS) > 0.02) continue;
    const actualDropPct = (2 * p) / topWeight;
    const score = Math.abs(actualDropPct - approxDropPct) * 100 + bp.length;
    if (score < bestScore) { bestScore = score; best = { p, bp, same: true }; }
  }

  // Also try p1 for last drop, p2 for earlier drops
  for (const p1 of AVAIL) {
    for (const p2 of AVAIL.filter(p => p >= p1)) {
      const totalDropPS = p1 + (numDrops - 1) * p2;
      const basePS = +(perSide - totalDropPS).toFixed(4);
      if (basePS < 0) continue;
      const bp = fillP(basePS);
      if (Math.abs(bp.reduce((a, b) => a + b, 0) - basePS) > 0.02) continue;
      const avgDropPct = (totalDropPS / numDrops * 2) / topWeight;
      const score = Math.abs(avgDropPct - approxDropPct) * 80 + bp.length + (p1 !== p2 ? 5 : 0);
      if (score < bestScore) { bestScore = score; best = { p1, p2, bp, same: p1 === p2 }; }
    }
  }

  if (!best) return null;

  // Build plate order inside→out: base plates first, then drop plates outermost
  // Strip order: remove outermost plates each drop
  const dropPlates = best.same
    ? Array(numDrops).fill(best.p || best.p1)
    : [best.p1, ...Array(numDrops - 1).fill(best.p2)].reverse(); // last drop outermost

  const allPlatesOrdered = [...best.bp, ...dropPlates]; // inside to outside

  // Build warmup steps: add plates in groups matching the loading order
  // Group into warmup-friendly steps (target ~4 steps)
  const warmupSteps = [];
  let cumPS = 0;
  const pctTargets = [0.60, 0.775, 0.925];
  let pIdx = 0;
  for (let i = 0; i < allPlatesOrdered.length; i++) {
    const p = allPlatesOrdered[i];
    const isLast = i === allPlatesOrdered.length - 1;
    cumPS = +(cumPS + p).toFixed(4);
    const curW = +(bar + 2 * cumPS).toFixed(4);
    const curPct = curW / topWeight;
    // Emit a step when we hit a warmup % zone or it's the top
    const atTarget = pIdx < pctTargets.length && curPct >= pctTargets[pIdx] - 0.03;
    if (atTarget || isLast) {
      if (atTarget) pIdx++;
      // Merge consecutive small adds into one warmup step label
      const lastStep = warmupSteps[warmupSteps.length - 1];
      if (lastStep && (curW - lastStep.weight) < 5 && !isLast) {
        lastStep.addPS = +(lastStep.addPS + p).toFixed(4);
        lastStep.addTxt = `+${lastStep.addPS} kg/side`; const mp = Math.round(curW / topWeight * 100); lastStep.reps = isLast ? '4' : mp < 65 ? '10–12' : mp < 80 ? '5–6' : mp < 90 ? '2–3' : '1';
        lastStep.weight = curW;
        lastStep.pct = Math.round(curPct * 100);
      } else {
        const addPS = warmupSteps.length === 0 ? cumPS : +(cumPS - warmupSteps[warmupSteps.length - 1].cumPS).toFixed(4);
        const wp = Math.round(curPct * 100); const wr = isLast ? '4' : wp < 65 ? '10–12' : wp < 80 ? '5–6' : wp < 90 ? '2–3' : '1'; warmupSteps.push({ addPS, addTxt: `+${addPS} kg/side`, weight: curW, pct: wp, cumPS, isTop: isLast, reps: wr });
      }
    }
  }

  // Compute actual drop weights
  let dropCur = topWeight;
  const dropSteps = dropPlates.slice().reverse().map((dp, i) => {
    const prev = dropCur;
    dropCur = +(dropCur - 2 * dp).toFixed(4);
    return { remove: dp, weight: dropCur, pct: Math.round((2 * dp / prev) * 100) };
  });

  return { warmupSteps, dropSteps, adjustedDropWeights: dropSteps.map(d => d.weight) };
}

function calcDropsList(top, configs) {
  let prev = top;
  return configs.map(cfg => { const c = R25(prev * (1 - cfg.dropPct)); const w = c < prev ? c : R25(prev - 2.5); prev = w; return w; });
}

function getPlatePerSide(weight, bar) {
  if (!bar || weight <= bar) return null;
  const ps = fillP((weight - bar) / 2);
  return platesTxt(ps);
}

const fmtDate = iso => new Date(iso).toLocaleDateString("no-NO", { day: "2-digit", month: "short" });
const weekNum = () => { const d = new Date(), j = new Date(d.getFullYear(), 0, 1); return Math.ceil(((d - j) / 86400000 + j.getDay() + 1) / 7); };

// ─── PROGRAM ──────────────────────────────────────────────────────────────────
const BASE_PROGRAM = {
  monday: { label: "Økt A", sub: "Bench + Hinge", exercises: [
    { id: "bench", name: "Bench Press", type: "top_set", barWeight: 20, topWeight: 85, topReps: 4, dropConfigs: [{ dropPct: .10, targetReps: 6 }, { dropPct: .10, targetReps: 6 }, { dropPct: .10, targetReps: 6 }], increment: 2.5, successCount: 0, showWarmup: true },
    { id: "deadlift", name: "Deadlift", type: "top_set", barWeight: 20, topWeight: 130, topReps: 4, dropConfigs: [], increment: 5, successCount: 0, showWarmup: true },
    { id: "leg_curl_m", name: "Leg Curl", type: "rep_range", weight: 35, numSets: 3, minReps: 6, maxReps: 10, lastReps: [10, 10, 8], increment: 2.5 },
    { id: "cable_row", name: "Seated Cable Row", type: "rep_range", weight: 70, numSets: 3, minReps: 6, maxReps: 10, lastReps: [10, 8, 9], increment: 2.5 },
    { id: "lat_m", name: "Lateral Raises", type: "rep_range", weight: 7.5, numSets: 3, minReps: 6, maxReps: 15, lastReps: [8, 7, 7], increment: 2.5 },
    { id: "tri_push", name: "Triceps Pushdown", type: "rep_range", weight: 27.5, numSets: 3, minReps: 6, maxReps: 10, lastReps: [9, 9, 9], increment: 2.5 },
    { id: "calves", name: "Calves", type: "rep_range", weight: 90, numSets: 3, minReps: 8, maxReps: 14, lastReps: [10, 10, 10], increment: 5 },
  ]},
  wednesday: { label: "Økt B", sub: "Squat + Push", exercises: [
    { id: "squat", name: "Back Squat", type: "top_set", barWeight: 20, topWeight: 100, topReps: 4, dropConfigs: [{ dropPct: .10, targetReps: 6 }, { dropPct: .10, targetReps: 6 }], increment: 2.5, successCount: 0, showWarmup: true },
    { id: "leg_curl_w", name: "Leg Curl", type: "rep_range", weight: 35, numSets: 3, minReps: 6, maxReps: 10, lastReps: [10, 10, 8], increment: 2.5 },
    { id: "dips", name: "Weighted Dips", type: "top_set", barWeight: 0, topWeight: 25, topReps: 4, dropConfigs: [{ dropPct: .125, targetReps: 6 }, { dropPct: .125, targetReps: 6 }, { dropPct: .125, targetReps: 6 }], increment: 2.5, successCount: 0, addedWeight: true, showWarmup: false },
    { id: "ohp", name: "Overhead Press", type: "rep_range", weight: 24, numSets: 3, minReps: 6, maxReps: 10, lastReps: [8, 7, 6], increment: 2.5 },
    { id: "pullups_bw", name: "Pull-ups (BW)", type: "rep_range", weight: 0, numSets: 3, minReps: 6, maxReps: 10, lastReps: [8, 7, 6], increment: 0, bodyweight: true },
    { id: "face_pulls", name: "Face Pulls", type: "rep_range", weight: 17.5, numSets: 3, minReps: 8, maxReps: 14, lastReps: [8, 8, 8], increment: 2.5 },
    { id: "core", name: "Core", type: "checkbox", note: "2 × 6–10 reps" },
  ]},
  friday: { label: "Økt C", sub: "Pull + Volume", exercises: [
    { id: "wpullups", name: "Weighted Pull-ups", type: "top_set", barWeight: 0, topWeight: 10, topReps: 4, dropConfigs: [{ dropPct: .125, targetReps: 6 }, { dropPct: .125, targetReps: 6 }], increment: 2.5, successCount: 0, addedWeight: true, showWarmup: false },
    { id: "cs_row", name: "Chest Supported Row", type: "rep_range", weight: 16, numSets: 4, minReps: 6, maxReps: 10, lastReps: [10, 10, 10, 10], increment: 2.5 },
    { id: "bss", name: "Bulgarian Split Squat", type: "rep_range", weight: 12, numSets: 3, minReps: 6, maxReps: 10, lastReps: [9, 9, 9], increment: 2.5 },
    { id: "incline_db", name: "Incline DB Bench", type: "rep_range", weight: 32, numSets: 3, minReps: 6, maxReps: 10, lastReps: [7, 8, 7], increment: 2.5 },
    { id: "lat_f", name: "Lateral Raises", type: "rep_range", weight: 7.5, numSets: 3, minReps: 8, maxReps: 14, lastReps: [8, 7, 7], increment: 2.5 },
  ]}
};

const SEED_LOGS = [
  { day: "monday", startedAt: "2026-03-30T09:00:00.000Z", completedAt: "2026-03-30T10:30:00.000Z", exercises: [
    { id: "bench", type: "top_set", topWeight: 85, actualReps: 4, confirmed: true, drops: [{ weight: 80, actualReps: 6, confirmed: true }, { weight: 70, actualReps: 6, confirmed: true }, { weight: 60, actualReps: 6, confirmed: true }] },
    { id: "deadlift", type: "top_set", topWeight: 130, actualReps: 4, confirmed: true, drops: [] },
    { id: "leg_curl_m", type: "rep_range", weight: 35, reps: [10, 10, 8] },
    { id: "cable_row", type: "rep_range", weight: 70, reps: [10, 8, 9] },
    { id: "lat_m", type: "rep_range", weight: 7.5, reps: [8, 7, 7] },
    { id: "tri_push", type: "rep_range", weight: 27.5, reps: [9, 9, 9] },
    { id: "calves", type: "rep_range", weight: 90, reps: [10, 10, 10] },
  ]},
  { day: "wednesday", startedAt: "2026-04-01T09:00:00.000Z", completedAt: "2026-04-01T10:30:00.000Z", exercises: [
    { id: "squat", type: "top_set", topWeight: 100, actualReps: 4, confirmed: true, drops: [{ weight: 90, actualReps: 6, confirmed: true }, { weight: 80, actualReps: 6, confirmed: true }] },
    { id: "leg_curl_w", type: "rep_range", weight: 35, reps: [10, 10, 8] },
    { id: "dips", type: "top_set", topWeight: 25, actualReps: 4, confirmed: true, drops: [{ weight: 22.5, actualReps: 6, confirmed: true }, { weight: 20, actualReps: 6, confirmed: true }, { weight: 17.5, actualReps: 6, confirmed: true }] },
    { id: "ohp", type: "rep_range", weight: 24, reps: [8, 7, 6] },
    { id: "pullups_bw", type: "rep_range", weight: 0, reps: [8, 7, 6] },
    { id: "face_pulls", type: "rep_range", weight: 17.5, reps: [8, 8, 8] },
    { id: "core", type: "checkbox", completed: true },
  ]},
  { day: "friday", startedAt: "2026-04-03T09:00:00.000Z", completedAt: "2026-04-03T10:30:00.000Z", exercises: [
    { id: "wpullups", type: "top_set", topWeight: 10, actualReps: 4, confirmed: true, drops: [{ weight: 7.5, actualReps: 6, confirmed: true }, { weight: 5, actualReps: 6, confirmed: true }] },
    { id: "cs_row", type: "rep_range", weight: 16, reps: [10, 10, 10, 10] },
    { id: "bss", type: "rep_range", weight: 12, reps: [9, 9, 9] },
    { id: "incline_db", type: "rep_range", weight: 32, reps: [7, 8, 7] },
    { id: "lat_f", type: "rep_range", weight: 7.5, reps: [8, 7, 7] },
  ]}
];

// Storage — localStorage
const STORAGE_KEY = "wt-v2";

async function loadAll() {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch { return null; }
}

async function saveAll(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); return true; } catch { return false; }
}

function buildSession(ex) {
  if (ex.type === "top_set") {
    const guide = (!ex.addedWeight && ex.barWeight > 0)
      ? calcPlateGuide(ex.topWeight, ex.dropConfigs.length, ex.dropConfigs[0]?.dropPct || 0.10, ex.barWeight)
      : null;
    const dw = guide?.adjustedDropWeights?.length ? guide.adjustedDropWeights : calcDropsList(ex.topWeight, ex.dropConfigs);
    return { id: ex.id, type: "top_set", topWeight: ex.topWeight, actualReps: ex.topReps, confirmed: false, guide,
      drops: ex.dropConfigs.map((cfg, i) => ({ weight: dw[i] ?? 0, actualReps: cfg.targetReps, confirmed: false })) };
  }
  if (ex.type === "rep_range") return { id: ex.id, type: "rep_range", weight: ex.weight, reps: ex.lastReps.length === ex.numSets ? [...ex.lastReps] : Array(ex.numSets).fill(ex.minReps) };
  return { id: ex.id, type: "checkbox", completed: false };
}

function newSession(day, prog) { return { day, startedAt: new Date().toISOString(), exercises: prog[day].exercises.map(buildSession) }; }
function isExDone(ex) { if (ex.type === "top_set") return ex.confirmed && (ex.drops.length === 0 || ex.drops.every(d => d.confirmed)); if (ex.type === "checkbox") return ex.completed; return true; }
function getAlerts(prog, day) { return prog[day].exercises.flatMap(ex => { if (ex.type === "top_set" && (ex.successCount || 0) >= 3) return [{ id: ex.id, name: ex.name, newW: ex.topWeight + ex.increment, inc: ex.increment }]; if (ex.type === "rep_range" && ex.increment > 0 && ex.lastReps.every(r => r >= ex.maxReps)) return [{ id: ex.id, name: ex.name, newW: ex.weight + ex.increment, inc: ex.increment }]; return []; }); }

const C = { bg: "#080808", card: "#141414", inner: "#1c1c1c", border: "#252525", red: "#dc2626", redDim: "#7f1d1d", orange: "#c2410c", green: "#16a34a", text: "#f0f0f0", muted: "#6b7280", dim: "#374151" };

function Btn({ onClick, children, color = "red", disabled = false, className = "" }) {
  const bg = { red: C.red, gray: "#1e1e1e", green: C.green }[color] ?? C.red;
  return <button onClick={onClick} disabled={disabled} className={`font-bold transition-all active:scale-95 disabled:opacity-25 disabled:cursor-not-allowed ${className}`} style={{ background: bg, color: "#fff", border: color === "gray" ? `1px solid ${C.border}` : "none", cursor: disabled ? "not-allowed" : "pointer" }}>{children}</button>;
}

function NumAdj({ value, onChange, step = 2.5, min = 0 }) {
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(Math.max(min, +(value - step).toFixed(4)))} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}><Minus size={13} /></button>
      <span className="font-mono font-bold text-center min-w-[60px]" style={{ color: C.text }}>{value}</span>
      <button onClick={() => onChange(+(value + step).toFixed(4))} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}><Plus size={13} /></button>
    </div>
  );
}

function RepBtn({ value, onChange }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <button onClick={() => onChange(value + 1)} className="w-10 h-9 rounded-lg flex items-center justify-center active:scale-90" style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.muted }}><Plus size={15} /></button>
      <span className="font-mono font-black text-2xl leading-none py-0.5" style={{ color: C.text }}>{value}</span>
      <button onClick={() => onChange(Math.max(0, value - 1))} className="w-10 h-9 rounded-lg flex items-center justify-center active:scale-90" style={{ background: C.inner, border: `1px solid ${C.border}`, color: C.muted }}><Minus size={15} /></button>
    </div>
  );
}

// ─── PLATE GUIDE CARD ─────────────────────────────────────────────────────────
function PlateGuideCard({ guide }) {
  const [hidden, setHidden] = useState(false);
  if (!guide) return null;
  const { warmupSteps, dropSteps } = guide;

  if (hidden) return (
    <button onClick={() => setHidden(false)} className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold mb-1 active:scale-95" style={{ background: "#0a0f1a", color: "#4a7099", border: "1px solid #1a2a3a" }}>
      <Eye size={12} /> Vis lasteguide
    </button>
  );

  return (
    <div className="rounded-xl overflow-hidden mb-1" style={{ border: "1px solid #1a2a3a" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5" style={{ background: "#0a0f1a" }}>
        <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#4a7099" }}>Lasteguide</span>
        <button onClick={() => setHidden(true)} className="flex items-center gap-1 text-xs" style={{ color: "#2d4a6b" }}><EyeOff size={11} /> Skjul</button>
      </div>

      {/* Warmup section */}
      <div className="px-4 pt-2.5 pb-1" style={{ background: "#080d14" }}>
        <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#1e3a5a" }}>↑ Legg på (innsiden → ut)</span>
      </div>
      {warmupSteps.map((s, i) => (
        <div key={i} className="flex items-center px-4 py-2" style={{ background: "#080d14", borderTop: "1px solid #0d1a28" }}>
          <span className="font-mono text-xs font-bold w-5 shrink-0" style={{ color: "#1a3050" }}>S{i + 1}</span>
          <span className="font-mono font-bold text-sm ml-3" style={{ color: s.isTop ? "#e0e8f0" : "#5b8ab0" }}>{s.addTxt}</span>
          <span className="font-mono text-sm font-bold ml-auto" style={{ color: s.isTop ? "#ffffff" : "#7aaac8" }}>{s.weight} kg</span>
          <span className="font-mono text-xs ml-3 text-right" style={{ color: "#4a7099" }}>{s.reps} reps</span>
          <span className="font-mono text-xs ml-2 w-16 text-right font-bold" style={{ color: s.isTop ? C.red : "#1e3a5a" }}>{s.isTop ? "▶ TOP" : `${s.pct}%`}</span>
        </div>
      ))}

      {/* Drop section */}
      {dropSteps.length > 0 && (
        <>
          <div className="px-4 pt-2.5 pb-1" style={{ background: "#0d0805", borderTop: "1px solid #1a2a3a" }}>
            <span className="text-xs font-bold uppercase tracking-widest" style={{ color: "#5a2a10" }}>↓ Fjern (utsiden → inn)</span>
          </div>
          {dropSteps.map((d, i) => (
            <div key={i} className="flex items-center px-4 py-2" style={{ background: "#0a0603", borderTop: "1px solid #120804" }}>
              <span className="text-xs font-black uppercase w-16 shrink-0" style={{ color: C.orange }}>DROP {i + 1}</span>
              <span className="font-mono text-sm font-bold ml-2" style={{ color: "#e07040" }}>−{d.remove} kg/side</span>
              <span className="font-mono text-sm font-bold ml-auto" style={{ color: C.text }}>{d.weight} kg</span>
              <span className="font-mono text-xs ml-3 w-10 text-right" style={{ color: "#7a3010" }}>−{d.pct}%</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ─── TOP SET CARD ─────────────────────────────────────────────────────────────
function TopSetCard({ ex, cfg, onUpdate }) {
  const recompute = w => {
    const guide = (!cfg.addedWeight && cfg.barWeight > 0)
      ? calcPlateGuide(w, cfg.dropConfigs.length, cfg.dropConfigs[0]?.dropPct || 0.10, cfg.barWeight)
      : null;
    const dw = guide?.adjustedDropWeights?.length ? guide.adjustedDropWeights : calcDropsList(w, cfg.dropConfigs);
    return { guide, drops: ex.drops.map((d, i) => ({ ...d, weight: dw[i] ?? d.weight })) };
  };

  const u = patch => onUpdate({ ...ex, ...patch });
  const setTopW = w => { const { guide, drops } = recompute(w); u({ topWeight: w, guide, drops }); };
  const done = isExDone(ex);

  const pTag = w => {
    if (cfg.addedWeight) return <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: C.inner, color: C.muted }}>+{w} kg tillegg</span>;
    const txt = cfg.barWeight ? getPlatePerSide(w, cfg.barWeight) : null;
    if (!txt) return null;
    return <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: C.inner, color: C.muted }}>{txt}/side</span>;
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${done ? C.green + "55" : C.border}` }}>
      {cfg.showWarmup && <PlateGuideCard guide={ex.guide} />}

      <div className="p-4" style={{ background: ex.confirmed ? C.card : "#150a0a" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: C.red }}>Top Set</span>
          {ex.confirmed && <span className="flex items-center gap-1 text-xs font-bold" style={{ color: C.green }}><Check size={12} />OK</span>}
        </div>
        <div className="flex items-center justify-between mb-3">
          {cfg.bodyweight ? <span className="font-mono font-black text-xl" style={{ color: C.text }}>BW</span>
            : <NumAdj value={ex.topWeight} onChange={setTopW} step={cfg.increment || 2.5} />}
          <div className="text-right"><div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.muted }}>Reps</div><NumAdj value={ex.actualReps} onChange={r => u({ actualReps: r })} step={1} min={1} /></div>
        </div>
        <div className="mb-3">{pTag(ex.topWeight)}</div>
        {!ex.confirmed ? <Btn onClick={() => u({ confirmed: true })} color="red" className="w-full py-3 rounded-xl text-sm">✓ Bekreft top set</Btn>
          : <div className="text-center text-xs font-bold py-1" style={{ color: C.green }}>✓ Fullført</div>}
      </div>

      {ex.drops.map((drop, i) => (
        <div key={i} className="p-4" style={{ background: drop.confirmed ? C.card : C.inner, borderTop: `1px solid ${C.border}` }}>
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs font-black uppercase tracking-widest" style={{ color: C.orange }}>Drop {i + 1}</span>
              {ex.guide?.dropSteps?.[i] && (
                <span className="font-mono text-xs ml-2 px-2 py-0.5 rounded" style={{ background: "#1a0a04", color: C.orange }}>
                  fjern {ex.guide.dropSteps[i].remove} kg/side
                </span>
              )}
            </div>
            {drop.confirmed && <span className="flex items-center gap-1 text-xs font-bold" style={{ color: C.green }}><Check size={12} />OK</span>}
          </div>
          <div className="flex items-center justify-between mb-2">
            <NumAdj value={drop.weight} onChange={w => u({ drops: ex.drops.map((d, j) => j === i ? { ...d, weight: w } : d) })} step={2.5} />
            <div className="text-right"><div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.muted }}>Reps</div><NumAdj value={drop.actualReps} onChange={r => u({ drops: ex.drops.map((d, j) => j === i ? { ...d, actualReps: r } : d) })} step={1} min={1} /></div>
          </div>
          <div className="mb-2">{pTag(drop.weight)}</div>
          {!drop.confirmed && ex.confirmed && <Btn onClick={() => u({ drops: ex.drops.map((d, j) => j === i ? { ...d, confirmed: true } : d) })} color="gray" className="w-full py-2.5 rounded-xl text-sm">✓ Bekreft drop {i + 1}</Btn>}
          {!drop.confirmed && !ex.confirmed && <p className="text-xs" style={{ color: C.dim }}>Fullfør top set først</p>}
        </div>
      ))}
    </div>
  );
}

function RepRangeCard({ ex, cfg, onUpdate }) {
  const allMax = ex.reps.every(r => r >= cfg.maxReps);
  const prevMax = cfg.lastReps.every(r => r >= cfg.maxReps) && cfg.increment > 0;
  return (
    <div className="p-4 rounded-xl" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-3">
        {cfg.bodyweight ? <span className="font-mono font-black" style={{ color: C.text }}>Kroppsvekt</span>
          : <NumAdj value={ex.weight} onChange={w => onUpdate({ ...ex, weight: w })} step={2.5} />}
        <div className="text-right"><div className="text-xs uppercase tracking-widest" style={{ color: C.muted }}>Mål</div><div className="font-mono text-sm font-bold" style={{ color: C.muted }}>{Array(cfg.numSets).fill(cfg.maxReps).join("/")}</div></div>
      </div>
      {prevMax && <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 text-xs font-semibold" style={{ background: "#1c1005", border: "1px solid #92400e55", color: "#fbbf24" }}><TrendingUp size={13} /> Nådde rep-mål sist — vurder å øke vekt</div>}
      <div className="flex gap-2">
        {ex.reps.map((r, i) => (
          <div key={i} className="flex-1 flex flex-col items-center py-3 rounded-xl" style={{ background: C.inner, border: `1px solid ${C.border}` }}>
            <div className="text-xs font-bold mb-1.5" style={{ color: C.muted }}>S{i + 1}</div>
            <RepBtn value={r} onChange={v => { const reps = [...ex.reps]; reps[i] = v; onUpdate({ ...ex, reps }); }} />
            <div className="font-mono text-xs mt-1.5" style={{ color: C.dim }}>sist:{cfg.lastReps[i]}</div>
          </div>
        ))}
      </div>
      {allMax && <div className="text-center text-xs font-bold mt-3" style={{ color: C.green }}>🎯 Rep-mål nådd!</div>}
    </div>
  );
}

function CheckboxCard({ ex, cfg, onUpdate }) {
  return (
    <div className="p-4 rounded-xl flex items-center justify-between" style={{ background: C.card, border: `1px solid ${C.border}` }}>
      <span className="text-sm" style={{ color: C.muted }}>{cfg.note}</span>
      <button onClick={() => onUpdate({ ...ex, completed: !ex.completed })} className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm active:scale-95" style={{ background: ex.completed ? C.green : C.inner, color: "#fff", border: `1px solid ${ex.completed ? C.green : C.border}` }}><Check size={15} /> {ex.completed ? "Fullført" : "Fullfør"}</button>
    </div>
  );
}

function useElapsed(startedAt) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!startedAt) { setElapsed(0); return; }
    const tick = () => setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  return elapsed;
}

function fmtElapsed(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
  return `${m}:${String(sec).padStart(2,"0")}`;
}

function SessionView({ session, program, saveStatus, onUpdate, onComplete, onBack }) {
  const [summary, setSummary] = useState(false);
  const [accepted, setAccepted] = useState({});
  const dp = program[session.day];
  const doneCount = session.exercises.filter(isExDone).length;
  const total = session.exercises.length;
  const allDone = doneCount === total;
  const elapsed = useElapsed(session.startedAt);
  const updEx = (idx, upd) => { const exs = [...session.exercises]; exs[idx] = upd; onUpdate({ ...session, exercises: exs }); };

  const postAlerts = summary ? session.exercises.flatMap(ex => {
    const cfg = dp.exercises.find(e => e.id === ex.id); if (!cfg) return [];
    if (ex.type === "top_set" && ex.confirmed && ((cfg.successCount || 0) + 1) >= 3) return [{ id: ex.id, name: cfg.name, newW: cfg.topWeight + cfg.increment, inc: cfg.increment }];
    if (ex.type === "rep_range" && cfg.increment > 0 && ex.reps.every(r => r >= cfg.maxReps)) return [{ id: ex.id, name: cfg.name, newW: cfg.weight + cfg.increment, inc: cfg.increment }];
    return [];
  }) : [];

  if (summary) return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3"><button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button><span className="font-black text-lg">Økt fullført</span></div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <div className="text-center py-6"><Trophy size={52} style={{ color: "#eab308", margin: "0 auto 12px" }} /><div className="font-black text-2xl">{dp.label} — ferdig! 🔥</div><div className="text-sm mt-1" style={{ color: C.muted }}>{dp.sub}</div><div className="font-mono text-lg font-black mt-3" style={{ color: C.muted }}>{fmtElapsed(elapsed)}</div></div>
        {postAlerts.length > 0 ? (
          <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
            <div className="px-4 py-3 flex items-center gap-2" style={{ background: C.inner }}><TrendingUp size={15} style={{ color: C.green }} /><span className="font-bold text-sm">Progresjonsforslag</span></div>
            {postAlerts.map(a => (
              <div key={a.id} className="flex items-center justify-between px-4 py-4" style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
                <div><div className="font-bold text-sm">{a.name}</div><div className="font-mono text-xs mt-0.5" style={{ color: C.muted }}>→ {a.newW} kg (+{a.inc} kg)</div></div>
                <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" checked={accepted[a.id] || false} onChange={e => setAccepted(p => ({ ...p, [a.id]: e.target.checked }))} style={{ accentColor: C.red, width: 20, height: 20 }} /><span className="text-sm font-semibold">Øk neste</span></label>
              </div>
            ))}
          </div>
        ) : <div className="text-center py-4 text-sm rounded-xl" style={{ color: C.muted, background: C.card, border: `1px solid ${C.border}` }}>Forslag vises etter 3 bekreftede top sets 💪</div>}
        <Btn onClick={() => onComplete(session, accepted)} color="green" className="w-full py-4 rounded-xl text-base">Lagre og avslutt</Btn>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10" style={{ background: C.bg + "f2", borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto px-4 py-3">
          <div className="flex items-center gap-3 mb-2">
            <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button>
            <div className="flex-1 min-w-0"><div className="font-black text-lg">{dp.label}</div><div className="text-xs" style={{ color: C.muted }}>{dp.sub}</div></div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold" style={{ color: C.muted }}>{doneCount}/{total}</span>
              <span className="font-mono text-sm font-bold px-2 py-0.5 rounded-lg" style={{ background: C.inner, color: allDone ? C.green : C.red }}>{fmtElapsed(elapsed)}</span>
              {saveStatus === "saving" && <span className="font-mono text-xs" style={{ color: C.muted }}>↑</span>}
              {saveStatus === "saved" && <span className="font-mono text-xs" style={{ color: C.green }}>✓</span>}
              {saveStatus === "error" && <span className="font-mono text-xs" style={{ color: C.red }}>!</span>}
            </div>
          </div>
          <div className="h-0.5 rounded-full" style={{ background: C.inner }}><div className="h-full rounded-full transition-all duration-500" style={{ width: `${(doneCount / total) * 100}%`, background: allDone ? C.green : C.red }} /></div>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-5 pb-32">
        {session.exercises.map((ex, idx) => {
          const cfg = dp.exercises.find(e => e.id === ex.id); if (!cfg) return null;
          const done = isExDone(ex);
          return (
            <div key={ex.id}>
              <div className="flex items-center justify-between mb-2 px-1"><h2 className="font-black text-sm uppercase tracking-wide" style={{ color: done ? C.muted : C.text }}>{cfg.name}</h2>{done && <span className="text-xs font-bold flex items-center gap-1" style={{ color: C.green }}><Check size={12} />Ferdig</span>}</div>
              {ex.type === "top_set" && <TopSetCard ex={ex} cfg={cfg} onUpdate={u => updEx(idx, u)} />}
              {ex.type === "rep_range" && <RepRangeCard ex={ex} cfg={cfg} onUpdate={u => updEx(idx, u)} />}
              {ex.type === "checkbox" && <CheckboxCard ex={ex} cfg={cfg} onUpdate={u => updEx(idx, u)} />}
            </div>
          );
        })}
      </div>
      <div className="fixed bottom-0 left-0 right-0 p-4" style={{ background: C.bg + "f5", borderTop: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex gap-2">
          {!allDone && (
            <button onClick={() => setSummary(true)} className="px-4 py-4 rounded-xl font-bold text-sm active:scale-95 shrink-0"
              style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}>
              Avslutt tidlig
            </button>
          )}
          <Btn onClick={() => setSummary(true)} color={allDone ? "green" : "gray"} disabled={!allDone} className="flex-1 py-4 rounded-xl text-base">
            {allDone ? "🎉 Fullfør økt" : `${doneCount}/${total} øvelser ferdig`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// ─── SETTINGS VIEW ────────────────────────────────────────────────────────────
function SettingsView({ onBack, onSyncNow, onRestore, syncStatus }) {
  const [token, setToken] = useState(() => { try { return localStorage.getItem("wt-gist-token") || ""; } catch { return ""; } });
  const [gistId, setGistId] = useState(() => { try { return localStorage.getItem("wt-gist-id") || ""; } catch { return ""; } });
  const [saved, setSaved] = useState(false);

  const save = (t, g) => {
    try { localStorage.setItem("wt-gist-token", t); localStorage.setItem("wt-gist-id", g); } catch {}
    setSaved(true); setTimeout(() => setSaved(false), 2000);
  };

  const ready = token.length > 10 && gistId.length > 10;

  return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button>
          <span className="font-black text-lg">Innstillinger</span>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4">

        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div className="px-4 py-3" style={{ background: C.inner }}>
            <span className="font-black text-sm">GitHub Gist backup</span>
          </div>

          <div className="px-4 py-4 space-y-3" style={{ background: C.card }}>
            <div>
              <div className="text-xs uppercase tracking-widest mb-1.5 font-bold" style={{ color: C.muted }}>Personal Access Token</div>
              <input value={token} onChange={e => { setToken(e.target.value); save(e.target.value, gistId); }}
                placeholder="ghp_xxxxxxxxxxxx"
                className="w-full rounded-xl px-4 py-3 text-xs focus:outline-none"
                style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-widest mb-1.5 font-bold" style={{ color: C.muted }}>Gist ID</div>
              <input value={gistId} onChange={e => { setGistId(e.target.value); save(token, e.target.value); }}
                placeholder="abc123def456..."
                className="w-full rounded-xl px-4 py-3 text-xs focus:outline-none"
                style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }} />
            </div>
            {saved && <div className="text-xs" style={{ color: C.green }}>✓ Lagret</div>}
          </div>

          {ready && (
            <div className="px-4 py-4 space-y-2" style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
              <div onClick={onSyncNow} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer"
                style={{ background: C.green, color: "#fff" }}>
                <RefreshCw size={15} />
                {syncStatus === "syncing" ? "Lagrer…" : syncStatus === "ok" ? "✓ Backup lagret!" : syncStatus === "fail" ? "! Feil — sjekk token/ID" : "Ta backup nå"}
              </div>
              <div onClick={onRestore} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer"
                style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}>
                ↓ Gjenopprett fra backup
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl px-4 py-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.muted }}>Hva lagres?</div>
          <div className="text-xs space-y-1" style={{ color: C.muted }}>
            <div>• Full backup i GitHub Gist etter hver økt</div>
            <div>• Alt (program, logger, historikk) i én JSON-fil</div>
            <div>• Gjenopprett på ny telefon med token + Gist ID</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function HomeView({ program, logs, session, saveStatus, onStart, onContinue, onAbandon, onProgram, onHistory, onProgression, onSettings }) {
  const lastFor = day => logs.find(l => l.day === day);
  const elapsed = useElapsed(session?.startedAt);
  return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="max-w-lg mx-auto px-4 pt-8 pb-4">
        <div className="flex items-center justify-between mb-8">
          <div><div className="font-black text-3xl" style={{ letterSpacing: "-0.04em" }}>TRAINING LOG</div><div className="font-mono text-xs mt-1" style={{ color: C.muted }}>UKE {weekNum()}</div></div>
          <div className="flex items-center gap-2">
            {saveStatus === "saving" && <span className="font-mono text-xs" style={{ color: C.muted }}>lagrer…</span>}
            {saveStatus === "saved" && <span className="font-mono text-xs" style={{ color: C.green }}>✓ lagret</span>}
            {saveStatus === "error" && <span className="font-mono text-xs" style={{ color: C.red }}>! lagringsfeil</span>}
            <button onClick={onSettings} className="p-1.5 rounded-lg" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}><Settings size={15} /></button>
            <div className="w-2 h-2 rounded-full" style={{ background: C.red, boxShadow: `0 0 10px ${C.red}` }} />
          </div>
        </div>
        {session && (
          <div className="rounded-xl overflow-hidden mb-5" style={{ border: `1px solid ${C.red}66` }}>
            {/* Pulsing top bar */}
            <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${C.red}, #ff6b6b, ${C.red})`, backgroundSize: "200%", animation: "pulse 2s ease-in-out infinite" }} />
            <div className="px-4 py-4" style={{ background: "#160404" }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: C.red, boxShadow: `0 0 6px ${C.red}` }} />
                  <span className="font-black text-sm uppercase tracking-wide" style={{ color: C.red }}>Økt pågår</span>
                </div>
                <span className="font-mono font-black text-xl" style={{ color: C.text }}>{fmtElapsed(elapsed)}</span>
              </div>
              <div className="mb-3">
                <div className="font-black text-lg">{program[session.day].label}</div>
                <div className="text-sm" style={{ color: C.muted }}>{program[session.day].sub}</div>
              </div>
              {/* Progress bar */}
              <div className="h-1.5 rounded-full mb-3" style={{ background: C.inner }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${(session.exercises.filter(isExDone).length / session.exercises.length) * 100}%`, background: C.red }} />
              </div>
              <div className="text-xs mb-3" style={{ color: C.muted }}>
                {session.exercises.filter(isExDone).length} av {session.exercises.length} øvelser fullført
              </div>
              <div className="flex gap-2">
                <Btn onClick={onContinue} color="red" className="flex-1 py-3 rounded-xl text-sm">Fortsett økt →</Btn>
                <button onClick={onAbandon} className="px-4 py-3 rounded-xl text-xs font-semibold" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}>Forkast</button>
              </div>
            </div>
          </div>
        )}
        <div className="space-y-3 mb-6">
          {["monday", "wednesday", "friday"].map(day => {
            const d = program[day], last = lastFor(day), alerts = getAlerts(program, day), isActive = session?.day === day, blocked = !!session && !isActive;
            return (
              <div key={day} className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${isActive ? C.red + "99" : C.border}` }}>
                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div><div className="font-black text-xl">{d.label}</div><div className="text-sm" style={{ color: C.muted }}>{d.sub}</div></div>
                    <div className="text-right">{last ? <div className="flex items-center gap-1.5 text-xs" style={{ color: C.muted }}><Clock size={11} />{fmtDate(last.startedAt)}</div> : <div className="text-xs" style={{ color: C.dim }}>Ingen logger</div>}<div className="font-mono text-xs mt-1" style={{ color: C.dim }}>{d.exercises.length} øvelser</div></div>
                  </div>
                  {alerts.length > 0 && <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3" style={{ background: "#021207", border: "1px solid #14532d", color: "#4ade80" }}><TrendingUp size={13} /><span className="text-xs font-semibold">{alerts.length} øvelse{alerts.length > 1 ? "r" : ""} klar for vektøkning</span></div>}
                  <Btn onClick={isActive ? onContinue : () => onStart(day)} color={blocked ? "gray" : "red"} disabled={blocked} className="w-full py-3 rounded-xl text-sm">{isActive ? "Fortsett økt" : blocked ? "Annen økt pågår" : "Start økt"}</Btn>
                </div>
              </div>
            );
          })}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[["Program", <List size={15} />, onProgram], ["Historikk", <Clock size={15} />, onHistory], ["Progresjon", <TrendingUp size={15} />, onProgression]].map(([lbl, icon, fn]) => (
            <button key={lbl} onClick={fn} className="flex items-center justify-center gap-1.5 py-3 rounded-xl font-semibold text-xs active:scale-95" style={{ background: C.card, color: C.muted, border: `1px solid ${C.border}` }}>{icon}{lbl}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function OverviewView({ program, onBack, onEdit, onAdd, onReorder, onDelete }) {
  const [open, setOpen] = useState("monday");
  const [reordering, setReordering] = useState(false);
  const days = ["monday", "wednesday", "friday"];

  return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button>
            <span className="font-black text-lg">Program</span>
          </div>
          <div onClick={() => setReordering(r => !r)}
            className="px-3 py-2 rounded-xl text-xs font-bold cursor-pointer"
            style={{ background: reordering ? C.red : C.inner, color: reordering ? "#fff" : C.muted, border: `1px solid ${C.border}` }}>
            {reordering ? "Ferdig" : "Rediger"}
          </div>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-3">
        {days.map(day => {
          const d = program[day], isOpen = open === day;
          return (
            <div key={day} className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              <div onClick={() => setOpen(isOpen ? null : day)} className="w-full flex items-center justify-between p-4 cursor-pointer" style={{ background: C.card }}>
                <div className="text-left"><div className="font-black">{d.label}</div><div className="text-sm" style={{ color: C.muted }}>{d.sub}</div></div>
                {isOpen ? <ChevronDown size={18} style={{ color: C.muted }} /> : <ChevronRight size={18} style={{ color: C.muted }} />}
              </div>
              {isOpen && (
                <>
                  {d.exercises.map((ex, idx) => (
                    <div key={ex.id} className="flex items-center px-3 py-2.5" style={{ background: C.inner, borderTop: `1px solid ${C.border}` }}>
                      {reordering && (
                        <div className="flex flex-col gap-0.5 mr-2 shrink-0">
                          <div onClick={() => idx > 0 && onReorder(day, idx, idx - 1)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer"
                            style={{ background: idx > 0 ? C.card : "transparent", color: idx > 0 ? C.muted : C.dim }}>
                            <Plus size={11} style={{ transform: "rotate(0deg)" }}>▲</Plus>
                          </div>
                          <div onClick={() => idx < d.exercises.length - 1 && onReorder(day, idx, idx + 1)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center cursor-pointer"
                            style={{ background: idx < d.exercises.length - 1 ? C.card : "transparent", color: idx < d.exercises.length - 1 ? C.muted : C.dim }}>
                            <Minus size={11}>▼</Minus>
                          </div>
                        </div>
                      )}
                      <div className="flex-1 min-w-0 mr-2">
                        <div className="font-semibold text-sm truncate">{ex.name}</div>
                        <div className="font-mono text-xs mt-0.5 truncate" style={{ color: C.muted }}>
                          {ex.type === "top_set" && `${ex.addedWeight ? "+" : ""}${ex.topWeight}kg · ${ex.topReps}reps${ex.dropConfigs.length ? ` · ${ex.dropConfigs.length}drops` : ""}${(ex.successCount || 0) > 0 ? ` · ${ex.successCount}/3✓` : ""}`}
                          {ex.type === "rep_range" && `${ex.bodyweight ? "BW" : ex.weight + "kg"} · ${ex.numSets}×${ex.minReps}–${ex.maxReps} · sist:${ex.lastReps.join("/")}`}
                          {ex.type === "checkbox" && ex.note}
                        </div>
                      </div>
                      {reordering
                        ? <div onClick={() => onDelete(day, ex.id)} className="p-2 rounded-xl shrink-0 cursor-pointer" style={{ background: "#2a0a0a", color: C.red }}><X size={15} /></div>
                        : <div onClick={() => onEdit(day, ex.id)} className="p-2 rounded-xl shrink-0 cursor-pointer" style={{ background: C.card, color: C.muted }}><Edit2 size={15} /></div>
                      }
                    </div>
                  ))}
                  <div onClick={() => onAdd(day)}
                    className="flex items-center gap-2 px-4 py-3 cursor-pointer"
                    style={{ background: "#0d160d", borderTop: `1px solid ${C.border}`, color: "#4ade80" }}>
                    <Plus size={14} />
                    <span className="text-sm font-semibold">Legg til øvelse</span>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────
function buildCSV(logs, program) {
  const rows = [["Dato","Økt","Øvelse","Type","Vekt","S1","S2","S3","S4","TopReps","D1v","D1r","D2v","D2r","D3v","D3r"]];
  [...logs].reverse().forEach(log => {
    const d = program[log.day];
    log.exercises.forEach(ex => {
      const cfg = d.exercises.find(e => e.id === ex.id); if (!cfg) return;
      const date = new Date(log.startedAt).toLocaleDateString("no-NO");
      if (ex.type === "top_set") {
        const row = [date, d.label, cfg.name, "Top Set", ex.topWeight, "", "", "", "", ex.confirmed ? ex.actualReps : ""];
        (ex.drops||[]).forEach(dr => row.push(dr.weight, dr.confirmed ? dr.actualReps : ""));
        rows.push(row);
      } else if (ex.type === "rep_range") {
        const r = ex.reps||[];
        rows.push([date, d.label, cfg.name, "Rep Range", ex.bodyweight?"BW":ex.weight, r[0]??"",r[1]??"",r[2]??"",r[3]??""]);
      }
    });
  });
  return rows.map(r => r.join("\t")).join("\n");
}

// ─── HISTORY VIEW ─────────────────────────────────────────────────────────────
function HistoryView({ logs, program, onBack }) {
  const [filter, setFilter] = useState("all");
  const [csvOpen, setCsvOpen] = useState(false);
  const filtered = filter === "all" ? logs : logs.filter(l => l.day === filter);
  return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button>
          <span className="font-black text-lg">Historikk</span>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4">
        <div className="mb-4 rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div onClick={() => setCsvOpen(v => !v)}
            className="flex items-center justify-between px-4 py-3 cursor-pointer"
            style={{ background: C.inner }}>
            <span className="font-bold text-sm">↓ Eksporter treningsdata</span>
            <span className="font-mono text-xs" style={{ color: C.muted }}>{csvOpen ? "Skjul" : "Vis"}</span>
          </div>
          {csvOpen && (
            <div className="p-3" style={{ background: C.card }}>
              <p className="text-xs mb-2" style={{ color: C.muted }}>Marker alt, kopier og lim inn i Excel/Numbers</p>
              <textarea readOnly value={buildCSV(logs, program)} onFocus={e => e.target.select()}
                className="w-full font-mono text-xs p-2 rounded-lg focus:outline-none"
                style={{ background: "#0a0a0a", color: "#8ab4d4", border: `1px solid ${C.border}`, height: 180, resize: "none", display: "block" }} />
            </div>
          )}
        </div>
        <div className="flex gap-2 mb-4">
          {[["all","Alle"],["monday","A"],["wednesday","B"],["friday","C"]].map(([v,l]) => (
            <button key={v} onClick={() => setFilter(v)} className="px-3 py-1.5 rounded-lg text-sm font-semibold active:scale-95" style={{ background: filter === v ? C.red : C.card, color: "#fff", border: `1px solid ${C.border}` }}>{l}</button>
          ))}
        </div>
        {filtered.length === 0 && <div className="text-center py-16 text-sm" style={{ color: C.muted }}>Ingen logger ennå.</div>}
        <div className="space-y-3">
          {filtered.map((log, i) => {
            const d = program[log.day];
            return (
              <div key={i} className="rounded-xl overflow-hidden" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
                  <div className="font-black text-sm">{d.label} <span style={{ color: C.muted, fontWeight: 400 }}>— {d.sub}</span></div>
                  <div className="font-mono text-xs" style={{ color: C.muted }}>{fmtDate(log.startedAt)}</div>
                </div>
                {log.exercises.map(ex => {
                  const cfg = d.exercises.find(e => e.id === ex.id); if (!cfg) return null;
                  return (
                    <div key={ex.id} className="flex justify-between items-center px-4 py-2" style={{ borderBottom: `1px solid ${C.border}22` }}>
                      <span className="text-xs" style={{ color: C.muted }}>{cfg.name}</span>
                      <span className="font-mono text-xs font-bold" style={{ color: C.text }}>
                        {ex.type === "top_set" && (ex.confirmed ? `${ex.topWeight}kg ×${ex.actualReps}` : "—")}
                        {ex.type === "rep_range" && `${ex.bodyweight ? "BW" : ex.weight + "kg"} ${ex.reps.join("/")}`}
                        {ex.type === "checkbox" && (ex.completed ? "✓" : "—")}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── PROGRESSION VIEW ─────────────────────────────────────────────────────────
function ProgressionView({ logs, program, onBack }) {
  const days = ["monday", "wednesday", "friday"];
  const [selDay, setSelDay] = useState("monday");
  const [selEx, setSelEx] = useState(null);

  // Build per-exercise history from logs
  const exHistory = {};
  [...logs].reverse().forEach(log => {
    const d = program[log.day];
    log.exercises.forEach(ex => {
      const cfg = d.exercises.find(e => e.id === ex.id); if (!cfg) return;
      if (ex.type === "checkbox") return;
      if (!exHistory[ex.id]) exHistory[ex.id] = { name: cfg.name, type: ex.type, bodyweight: cfg.bodyweight, points: [] };
      const date = fmtDate(log.startedAt);
      if (ex.type === "top_set" && ex.confirmed) {
        exHistory[ex.id].points.push({ date, weight: ex.topWeight, reps: ex.actualReps });
      } else if (ex.type === "rep_range") {
        const total = (ex.reps || []).reduce((a, b) => a + b, 0);
        const avg = ex.reps.length ? Math.round(total / ex.reps.length * 10) / 10 : 0;
        exHistory[ex.id].points.push({ date, weight: ex.bodyweight ? 0 : ex.weight, reps: avg, repsRaw: ex.reps });
      }
    });
  });

  const dayExercises = program[selDay].exercises.filter(e => e.type !== "checkbox");
  const selected = selEx ? exHistory[selEx] : null;
  const selCfg = selEx ? program[selDay].exercises.find(e => e.id === selEx) : null;

  // Mini sparkline using divs
  function Sparkline({ points, field, color }) {
    if (!points || points.length < 2) return null;
    const vals = points.map(p => p[field]).filter(v => v != null && !isNaN(v));
    if (vals.length < 2) return null;
    const min = Math.min(...vals), max = Math.max(...vals);
    const range = max - min || 1;
    return (
      <div className="flex items-end gap-0.5 h-8">
        {points.map((p, i) => {
          const v = p[field]; if (v == null || isNaN(v)) return null;
          const h = Math.max(4, Math.round(((v - min) / range) * 28) + 4);
          const isLast = i === points.length - 1;
          return <div key={i} style={{ width: 6, height: h, background: isLast ? color : color + "66", borderRadius: 2, flexShrink: 0 }} />;
        })}
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={selEx ? () => setSelEx(null) : onBack} className="p-2 rounded-xl" style={{ background: C.card }}>
            <ArrowLeft size={20} />
          </button>
          <span className="font-black text-lg">{selEx ? (selected?.name || "Progresjon") : "Progresjon"}</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4">
        {!selEx ? (
          <>
            {/* Day tabs */}
            <div className="flex gap-2 mb-4">
              {days.map((day, i) => (
                <button key={day} onClick={() => { setSelDay(day); setSelEx(null); }}
                  className="px-3 py-1.5 rounded-lg text-sm font-semibold active:scale-95"
                  style={{ background: selDay === day ? C.red : C.card, color: "#fff", border: `1px solid ${C.border}` }}>
                  {["A","B","C"][i]}
                </button>
              ))}
            </div>

            {/* Exercise list with mini sparklines */}
            <div className="space-y-2">
              {dayExercises.map(cfg => {
                const hist = exHistory[cfg.id];
                const pts = hist?.points || [];
                const latest = pts[pts.length - 1];
                const first = pts[0];
                const improved = latest && first && latest.weight > first.weight;
                return (
                  <button key={cfg.id} onClick={() => setSelEx(cfg.id)}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl active:scale-95 transition-all"
                    style={{ background: C.card, border: `1px solid ${C.border}` }}>
                    <div className="text-left mr-3 flex-1 min-w-0">
                      <div className="font-bold text-sm truncate">{cfg.name}</div>
                      <div className="font-mono text-xs mt-0.5" style={{ color: C.muted }}>
                        {pts.length === 0 && "Ingen data ennå"}
                        {pts.length > 0 && cfg.bodyweight && `BW · sist ${latest.reps} reps snitt`}
                        {pts.length > 0 && !cfg.bodyweight && `${latest.weight}kg · ${pts.length} økter logget`}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {pts.length >= 2 && <Sparkline points={pts} field="weight" color={improved ? C.green : C.muted} />}
                      {improved && <TrendingUp size={14} style={{ color: C.green }} />}
                      <ChevronRight size={16} style={{ color: C.dim }} />
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          /* Detail view for one exercise */
          selected && (
            <div className="space-y-4">
              {selected.points.length === 0 ? (
                <div className="text-center py-16 text-sm" style={{ color: C.muted }}>Ingen data logget ennå.</div>
              ) : (
                <>
                  {/* Summary stats */}
                  {!selected.bodyweight && (
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        ["Start", selected.points[0].weight + " kg"],
                        ["Nå", selected.points[selected.points.length - 1].weight + " kg"],
                        ["Økt", "+" + Math.max(0, selected.points[selected.points.length - 1].weight - selected.points[0].weight).toFixed(1) + " kg"],
                      ].map(([label, val]) => (
                        <div key={label} className="rounded-xl p-3 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                          <div className="font-mono font-black text-lg" style={{ color: C.text }}>{val}</div>
                          <div className="text-xs mt-1" style={{ color: C.muted }}>{label}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Visual bar chart of weight */}
                  {!selected.bodyweight && selected.points.length >= 2 && (() => {
                    const weights = selected.points.map(p => p.weight);
                    const minW = Math.min(...weights), maxW = Math.max(...weights);
                    const range = maxW - minW || 1;
                    return (
                      <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                        <div className="text-xs uppercase tracking-widest mb-3 font-bold" style={{ color: C.muted }}>Vektutvikling</div>
                        <div className="flex items-end gap-1 h-24">
                          {selected.points.map((p, i) => {
                            const h = Math.max(8, Math.round(((p.weight - minW) / range) * 80) + 8);
                            const isLast = i === selected.points.length - 1;
                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                                {isLast && <span className="font-mono text-xs font-bold" style={{ color: C.green }}>{p.weight}</span>}
                                <div style={{ height: h, background: isLast ? C.green : C.red + "55", borderRadius: "3px 3px 0 0", width: "100%" }} />
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex justify-between mt-1">
                          <span className="font-mono text-xs" style={{ color: C.dim }}>{selected.points[0].date}</span>
                          <span className="font-mono text-xs" style={{ color: C.dim }}>{selected.points[selected.points.length - 1].date}</span>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Log table */}
                  <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                    <div className="px-4 py-2.5" style={{ background: C.inner }}>
                      <span className="text-xs uppercase tracking-widest font-bold" style={{ color: C.muted }}>Alle logger</span>
                    </div>
                    {[...selected.points].reverse().map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3" style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
                        <span className="font-mono text-xs" style={{ color: C.muted }}>{p.date}</span>
                        <div className="text-right">
                          {!selected.bodyweight && <span className="font-mono font-bold text-sm" style={{ color: C.text }}>{p.weight} kg</span>}
                          {selected.bodyweight && <span className="font-mono font-bold text-sm" style={{ color: C.text }}>BW</span>}
                          <span className="font-mono text-xs ml-3" style={{ color: C.muted }}>
                            {selected.type === "top_set" ? `×${p.reps} reps` : p.repsRaw ? p.repsRaw.join("/") : `snitt ${p.reps}`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )
        )}
      </div>

    </div>
  );
}

// ─── ADD EXERCISE VIEW ────────────────────────────────────────────────────────
function AddExerciseView({ day, program, onSave, onBack }) {
  const [type, setType] = useState("rep_range");
  const [name, setName] = useState("");
  const [weight, setWeight] = useState(20);
  const [numSets, setNumSets] = useState(3);
  const [minReps, setMinReps] = useState(6);
  const [maxReps, setMaxReps] = useState(10);
  const [increment, setIncrement] = useState(2.5);
  const [topWeight, setTopWeight] = useState(60);
  const [topReps, setTopReps] = useState(4);
  const [numDrops, setNumDrops] = useState(0);
  const [bodyweight, setBodyweight] = useState(false);
  const [note, setNote] = useState("2 x 6-10 reps");

  const handleSave = () => {
    if (!name.trim()) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]/g,"_") + "_" + Date.now();
    let ex;
    if (type === "rep_range") {
      ex = { id, name: name.trim(), type:"rep_range", weight: bodyweight?0:weight, numSets, minReps, maxReps, lastReps:Array(numSets).fill(minReps), increment:bodyweight?0:increment, bodyweight };
    } else if (type === "top_set") {
      const drops = Array(numDrops).fill(null).map(()=>({dropPct:0.10,targetReps:6}));
      ex = { id, name:name.trim(), type:"top_set", barWeight:20, topWeight, topReps, dropConfigs:drops, increment, successCount:0, showWarmup:true };
    } else {
      ex = { id, name:name.trim(), type:"checkbox", note:note.trim()||"Fullfort" };
    }
    onSave(day, ex);
  };

  const Row = ({label, children}) => (
    <div className="flex items-center justify-between py-3" style={{borderBottom:`1px solid ${C.border}`}}>
      <span className="text-sm" style={{color:C.muted}}>{label}</span>{children}
    </div>
  );

  return (
    <div className="min-h-screen pb-8" style={{background:C.bg, color:C.text}}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{background:C.bg, borderBottom:`1px solid ${C.border}`}}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl" style={{background:C.card}}><X size={20}/></button>
          <span className="font-black text-lg flex-1">Ny oevelse</span>
          <Btn onClick={handleSave} color={name.trim()?"green":"gray"} disabled={!name.trim()} className="px-4 py-2 rounded-xl text-sm">Legg til</Btn>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <div className="rounded-xl p-4" style={{background:C.card, border:`1px solid ${C.border}`}}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{color:C.muted}}>Navn</div>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="F.eks. Leg Press"
            className="w-full rounded-lg px-4 py-3 font-bold text-sm focus:outline-none"
            style={{background:C.inner, color:C.text, border:`1px solid ${C.border}`}} />
        </div>
        <div className="rounded-xl p-4" style={{background:C.card, border:`1px solid ${C.border}`}}>
          <div className="text-xs uppercase tracking-widest mb-3" style={{color:C.muted}}>Type</div>
          <div className="flex gap-2">
            {[["rep_range","Rep Range"],["top_set","Top Set"],["checkbox","Avhuking"]].map(([v,l]) => (
              <div key={v} onClick={()=>setType(v)} className="flex-1 text-center py-2 rounded-xl text-xs font-bold cursor-pointer"
                style={{background:type===v?C.red:C.inner, color:type===v?"#fff":C.muted, border:`1px solid ${type===v?C.red:C.border}`}}>{l}</div>
            ))}
          </div>
        </div>
        {type==="rep_range" && (
          <div className="rounded-xl p-4" style={{background:C.card, border:`1px solid ${C.border}`}}>
            <Row label="Kroppsvekt">
              <div onClick={()=>setBodyweight(b=>!b)} className="px-4 py-2 rounded-xl font-bold text-sm cursor-pointer"
                style={{background:bodyweight?C.green:C.inner, color:"#fff", border:`1px solid ${bodyweight?C.green:C.border}`}}>
                {bodyweight?"Ja":"Nei"}
              </div>
            </Row>
            {!bodyweight && <Row label="Startvekt (kg)"><NumAdj value={weight} onChange={setWeight} step={2.5}/></Row>}
            <Row label="Antall sett"><NumAdj value={numSets} onChange={setNumSets} step={1} min={1}/></Row>
            <Row label="Min reps"><NumAdj value={minReps} onChange={setMinReps} step={1} min={1}/></Row>
            <Row label="Maal reps"><NumAdj value={maxReps} onChange={v=>setMaxReps(Math.max(minReps+1,v))} step={1} min={minReps+1}/></Row>
            {!bodyweight && <Row label="Okning per steg"><NumAdj value={increment} onChange={setIncrement} step={1.25} min={1.25}/></Row>}
          </div>
        )}
        {type==="top_set" && (
          <div className="rounded-xl p-4" style={{background:C.card, border:`1px solid ${C.border}`}}>
            <Row label="Startvekt (kg)"><NumAdj value={topWeight} onChange={setTopWeight} step={2.5}/></Row>
            <Row label="Top set reps"><NumAdj value={topReps} onChange={setTopReps} step={1} min={1}/></Row>
            <Row label="Antall drop sets"><NumAdj value={numDrops} onChange={setNumDrops} step={1} min={0}/></Row>
            <Row label="Okning per steg"><NumAdj value={increment} onChange={setIncrement} step={1.25} min={1.25}/></Row>
          </div>
        )}
        {type==="checkbox" && (
          <div className="rounded-xl p-4" style={{background:C.card, border:`1px solid ${C.border}`}}>
            <div className="text-xs uppercase tracking-widest mb-2" style={{color:C.muted}}>Notat</div>
            <input value={note} onChange={e=>setNote(e.target.value)}
              className="w-full rounded-lg px-4 py-3 text-sm focus:outline-none"
              style={{background:C.inner, color:C.text, border:`1px solid ${C.border}`}} />
          </div>
        )}
      </div>
    </div>
  );
}

function EditView({ program, day, exerciseId, onSave, onBack }) {
  const orig = program[day]?.exercises.find(e => e.id === exerciseId);
  const [form, setForm] = useState(orig ? JSON.parse(JSON.stringify(orig)) : null);
  if (!orig || !form) return null;
  const upd = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const updRep = (i, v) => { const r = [...form.lastReps]; r[i] = v; upd("lastReps", r); };
  const Row = ({ label, children }) => <div className="flex items-center justify-between py-3" style={{ borderBottom: `1px solid ${C.border}` }}><span className="text-sm" style={{ color: C.muted }}>{label}</span>{children}</div>;
  return (
    <div className="min-h-screen pb-8" style={{ background: C.bg, color: C.text }}>
      <div className="sticky top-0 z-10 px-4 py-3" style={{ background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><X size={20} /></button>
          <span className="font-black text-lg flex-1 truncate">{orig.name}</span>
          <Btn onClick={() => onSave(day, exerciseId, form)} color="red" className="px-4 py-2 rounded-xl text-sm">Lagre</Btn>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4">
        <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs uppercase tracking-widest mb-2" style={{ color: C.muted }}>Navn</div>
          <input value={form.name} onChange={e => upd("name", e.target.value)} className="w-full rounded-lg px-4 py-3 font-bold text-sm focus:outline-none" style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }} />
        </div>
        {form.type === "top_set" && (
          <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.muted }}>Top Set</div>
            <Row label={form.addedWeight ? "Tilleggsvekt (kg)" : "Vekt (kg)"}><NumAdj value={form.topWeight} onChange={v => upd("topWeight", v)} step={form.increment || 2.5} /></Row>
            <Row label="Reps"><NumAdj value={form.topReps} onChange={v => upd("topReps", v)} step={1} min={1} /></Row>
            <Row label="Vektøkning per steg"><NumAdj value={form.increment} onChange={v => upd("increment", v)} step={1.25} min={1.25} /></Row>
            <Row label={`Suksess-teller (${form.successCount || 0}/3)`}>
              <div className="flex items-center gap-2"><NumAdj value={form.successCount || 0} onChange={v => upd("successCount", v)} step={1} min={0} /><button onClick={() => upd("successCount", 0)} className="p-1.5 rounded-lg" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}><RotateCcw size={13} /></button></div>
            </Row>
            <Row label="Vis lasteguide"><button onClick={() => upd("showWarmup", !form.showWarmup)} className="px-4 py-2 rounded-xl font-bold text-sm" style={{ background: form.showWarmup ? C.green : C.inner, color: "#fff", border: `1px solid ${form.showWarmup ? C.green : C.border}` }}>{form.showWarmup ? "På" : "Av"}</button></Row>
            {form.dropConfigs?.length > 0 && (<>
              <div className="text-xs uppercase tracking-widest mt-4 mb-1" style={{ color: C.muted }}>Drop Sets</div>
              {form.dropConfigs.map((dc, i) => <Row key={i} label={`Drop ${i + 1} — ${Math.round(dc.dropPct * 100)}% drop`}><NumAdj value={dc.targetReps} onChange={v => { const d = [...form.dropConfigs]; d[i] = { ...d[i], targetReps: v }; upd("dropConfigs", d); }} step={1} min={1} /></Row>)}
            </>)}
          </div>
        )}
        {form.type === "rep_range" && (
          <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.muted }}>Rep Range</div>
            {!form.bodyweight && <Row label="Vekt (kg)"><NumAdj value={form.weight} onChange={v => upd("weight", v)} step={2.5} min={0} /></Row>}
            <Row label="Antall sett"><NumAdj value={form.numSets} onChange={v => { const lr = [...form.lastReps]; while (lr.length < v) lr.push(form.minReps); while (lr.length > v) lr.pop(); setForm(f => ({ ...f, numSets: v, lastReps: lr })); }} step={1} min={1} /></Row>
            <Row label="Min reps"><NumAdj value={form.minReps} onChange={v => upd("minReps", v)} step={1} min={1} /></Row>
            <Row label="Max reps (mål)"><NumAdj value={form.maxReps} onChange={v => upd("maxReps", v)} step={1} min={form.minReps + 1} /></Row>
            {!form.bodyweight && <Row label="Vektøkning per steg"><NumAdj value={form.increment} onChange={v => upd("increment", v)} step={1.25} min={0} /></Row>}
          </div>
        )}
        {form.type === "rep_range" && (
          <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs uppercase tracking-widest mb-3" style={{ color: C.muted }}>Siste reps</div>
            <div className="flex gap-3 justify-center">{form.lastReps.map((r, i) => <div key={i} className="flex flex-col items-center gap-2"><div className="text-xs" style={{ color: C.muted }}>S{i + 1}</div><NumAdj value={r} onChange={v => updRep(i, v)} step={1} min={0} /></div>)}</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [program, setProgram] = useState(null);
  const [logs, setLogs] = useState([]);
  const [session, setSession] = useState(null);
  const [view, setView] = useState("home");
  const [editTarget, setEditTarget] = useState(null);
  const [addTarget, setAddTarget] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("");
  const [syncStatus, setSyncStatus] = useState(""); // "" | "syncing" | "ok" | "fail"

  const getGistCfg = () => {
    try {
      return {
        token: localStorage.getItem("wt-gist-token") || "",
        id: localStorage.getItem("wt-gist-id") || ""
      };
    } catch { return { token: "", id: "" }; }
  };

  const syncToGoogle = async (prog, lg, sess) => {
    const { token, id } = getGistCfg();
    if (!token || !id) return;
    setSyncStatus("syncing");
    try {
      const res = await fetch(`https://api.github.com/gists/${id}`, {
        method: "PATCH",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
          "Accept": "application/vnd.github+json"
        },
        body: JSON.stringify({
          files: {
            "treningapp-backup.json": {
              content: JSON.stringify({ program: prog, logs: lg, session: sess, savedAt: new Date().toISOString() }, null, 2)
            }
          }
        })
      });
      setSyncStatus(res.ok ? "ok" : "fail");
    } catch { setSyncStatus("fail"); }
    setTimeout(() => setSyncStatus(""), 3000);
  };

  const restoreFromGoogle = async () => {
    const { token, id } = getGistCfg();
    if (!token || !id) return;
    setSyncStatus("syncing");
    try {
      const res = await fetch(`https://api.github.com/gists/${id}`, {
        headers: { "Authorization": `Bearer ${token}`, "Accept": "application/vnd.github+json" }
      });
      const gist = await res.json();
      const raw = gist.files?.["treningapp-backup.json"]?.content;
      if (!raw) { setSyncStatus("fail"); return; }
      const data = JSON.parse(raw);
      if (data.program) { setProgram(data.program); }
      if (data.logs) setLogs(data.logs);
      setSession(null);
      await saveAll({ program: data.program || program, logs: data.logs || logs, session: null });
      setSyncStatus("ok");
    } catch { setSyncStatus("fail"); }
    setTimeout(() => setSyncStatus(""), 3000);
  };

  // Load once on mount
  useEffect(() => {
    (async () => {
      const data = await loadAll();
      if (data) {
        setProgram(data.program || JSON.parse(JSON.stringify(BASE_PROGRAM)));
        setLogs(data.logs || SEED_LOGS);
        if (data.session) setSession(data.session);
      } else {
        setProgram(JSON.parse(JSON.stringify(BASE_PROGRAM)));
        setLogs(SEED_LOGS);
      }
      setLoading(false);
    })();
  }, []);

  // Single save function — writes everything atomically
  const persist = async (newProgram, newLogs, newSession) => {
    setSaveStatus("saving");
    const ok = await saveAll({ program: newProgram, logs: newLogs, session: newSession });
    setSaveStatus(ok ? "saved" : "error");
    setTimeout(() => setSaveStatus(""), 2000);
  };

  const doStart = day => {
    const s = newSession(day, program);
    setSession(s);
    persist(program, logs, s);
    setView("session");
  };

  const doUpdateSession = s => {
    setSession(s);
    persist(program, logs, s);
  };

  const doComplete = (sess, accepted) => {
    const completed = { ...sess, completedAt: new Date().toISOString() };
    const newLogs = [completed, ...logs];
    const next = JSON.parse(JSON.stringify(program));
    next[sess.day].exercises = next[sess.day].exercises.map(ex => {
      const sx = sess.exercises.find(e => e.id === ex.id); if (!sx) return ex;
      if (ex.type === "top_set") { const sc = sx.confirmed ? (ex.successCount || 0) + 1 : (ex.successCount || 0); return accepted[ex.id] ? { ...ex, topWeight: ex.topWeight + ex.increment, successCount: 0 } : { ...ex, successCount: sc }; }
      if (ex.type === "rep_range") { const base = { ...ex, lastReps: sx.reps }; return accepted[ex.id] ? { ...base, weight: ex.weight + ex.increment } : base; }
      return ex;
    });
    setLogs(newLogs); setProgram(next); setSession(null);
    persist(next, newLogs, null);
    syncToGoogle(next, newLogs, null);
    setView("home");
  };

  const doAddExercise = (day, ex) => {
    const next = JSON.parse(JSON.stringify(program));
    next[day].exercises.push(ex);
    setProgram(next);
    persist(next, logs, session);
    setView("overview"); setAddTarget(null);
  };

  const doReorder = (day, fromIdx, toIdx) => {
    const next = JSON.parse(JSON.stringify(program));
    const [moved] = next[day].exercises.splice(fromIdx, 1);
    next[day].exercises.splice(toIdx, 0, moved);
    setProgram(next);
    persist(next, logs, session);
  };

  const doDelete = (day, exId) => {
    const next = JSON.parse(JSON.stringify(program));
    next[day].exercises = next[day].exercises.filter(e => e.id !== exId);
    setProgram(next);
    persist(next, logs, session);
  };

  const doSaveEdit = (day, exId, updates) => {
    const next = JSON.parse(JSON.stringify(program));
    next[day].exercises = next[day].exercises.map(ex => ex.id === exId ? { ...ex, ...updates } : ex);
    setProgram(next);
    persist(next, logs, session);
    setView("overview"); setEditTarget(null);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center" style={{ background: C.bg }}><div className="font-mono text-sm animate-pulse" style={{ color: C.muted }}>Laster...</div></div>;
  return (
    <div className="min-h-screen" style={{ background: C.bg, color: C.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {view === "home" && <HomeView program={program} logs={logs} session={session} saveStatus={saveStatus} onStart={doStart} onContinue={() => setView("session")} onAbandon={() => { setSession(null); persist(program, logs, null); }} onProgram={() => setView("overview")} onHistory={() => setView("history")} onProgression={() => setView("progression")} onSettings={() => setView("settings")} />}
      {view === "session" && session && <SessionView session={session} program={program} saveStatus={saveStatus} onUpdate={doUpdateSession} onComplete={doComplete} onBack={() => setView("home")} />}
      {view === "overview" && <OverviewView program={program} onBack={() => setView("home")} onEdit={(day, exId) => { setEditTarget({ day, exId }); setView("edit"); }} onAdd={(day) => { setAddTarget(day); setView("add"); }} onReorder={doReorder} onDelete={doDelete} />}
      {view === "history" && <HistoryView logs={logs} program={program} onBack={() => setView("home")} />}
      {view === "progression" && <ProgressionView logs={logs} program={program} onBack={() => setView("home")} />}
      {view === "edit" && editTarget && <EditView program={program} day={editTarget.day} exerciseId={editTarget.exId} onSave={doSaveEdit} onBack={() => { setView("overview"); setEditTarget(null); }} />}
      {view === "add" && addTarget && <AddExerciseView day={addTarget} program={program} onSave={doAddExercise} onBack={() => { setView("overview"); setAddTarget(null); }} />}
      {view === "settings" && <SettingsView onBack={() => setView("home")} onSyncNow={() => syncToGoogle(program, logs, session)} onRestore={restoreFromGoogle} syncStatus={syncStatus} />}
    </div>
  );
}

const root = document.getElementById("root");
ReactDOM.createRoot(root).render(<App />);
