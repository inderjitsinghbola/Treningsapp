import { useState, useEffect, useRef } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
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
    let cumulativePlates = []; // track all plates on bar per side
    for (let i = 1; i < warmupPcts.length; i++) {
      const tgtW = Math.max(bar, R25(topWeight * warmupPcts[i]));
      const tgtPS = (tgtW - bar) / 2;
      const addPS = +(tgtPS - prevPS).toFixed(4);
      const plates = fillP(Math.max(0, addPS));
      if (plates.length > 0) {
        cumulativePlates = [...cumulativePlates, ...plates];
        const pct0 = Math.round(tgtW / topWeight * 100); const reps0 = pct0 < 65 ? '10–12' : pct0 < 80 ? '5–6' : pct0 < 90 ? '2–3' : '1';
        steps.push({ add: plates, addTxt: platesTxt(plates), weight: bar + 2 * tgtPS, pct: pct0, reps: reps0, plateStr: cumulativePlates.join("+") + " kg/side" });
        prevPS = tgtPS;
      }
    }
    // Final step to top weight
    const finalAdd = +(perSide - prevPS).toFixed(4);
    if (finalAdd > 0.001) {
      const plates = fillP(finalAdd);
      cumulativePlates = [...cumulativePlates, ...plates]; steps.push({ add: plates, addTxt: platesTxt(plates), weight: topWeight, pct: 100, isTop: true, reps: '4', plateStr: cumulativePlates.join('+') + ' kg/side' });
    } else if (steps.length > 0) {
      steps[steps.length - 1].isTop = true; steps[steps.length - 1].reps = '4';
      steps[steps.length - 1].weight = topWeight; steps[steps.length - 1].plateStr = cumulativePlates.join('+') + ' kg/side';
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
    { id: "hip_thrust_m", name: "Hip Thrusts", type: "rep_range", weight: 60, numSets: 3, minReps: 6, maxReps: 10, lastReps: [8, 8, 8], increment: 5 },
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
    { id: "biceps_curl_f", name: "Biceps Curls", type: "rep_range", weight: 12, numSets: 3, minReps: 6, maxReps: 12, lastReps: [8, 8, 8], increment: 1 },
    { id: "calves_f", name: "Calves", type: "rep_range", weight: 90, numSets: 3, minReps: 8, maxReps: 14, lastReps: [10, 10, 10], increment: 5 },
  ]}
};

const SEED_LOGS = [
  { day: "monday", startedAt: "2026-03-30T09:00:00.000Z", completedAt: "2026-03-30T10:30:00.000Z", exercises: [
    { id: "bench", type: "top_set", topWeight: 85, actualReps: 4, confirmed: true, drops: [{ weight: 80, actualReps: 6, confirmed: true }, { weight: 70, actualReps: 6, confirmed: true }, { weight: 60, actualReps: 6, confirmed: true }] },
    { id: "deadlift", type: "top_set", topWeight: 130, actualReps: 4, confirmed: true, drops: [] },
    { id: "hip_thrust_m", type: "rep_range", weight: 60, reps: [8, 8, 8] },
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
    { id: "biceps_curl_f", type: "rep_range", weight: 12, reps: [8, 8, 8] },
    { id: "calves_f", type: "rep_range", weight: 90, reps: [10, 10, 10] },
  ]}
];

// Storage — localStorage only (standalone PWA)
const STORAGE_KEY = "wt-v2";

async function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveAll(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch { return false; }
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
  if (ex.type === "rep_range") return { id: ex.id, type: "rep_range", weight: ex.weight, confirmed: false, reps: ex.lastReps.length === ex.numSets ? [...ex.lastReps] : Array(ex.numSets).fill(ex.minReps) };
  return { id: ex.id, type: "checkbox", completed: false };
}

function newSession(day, prog) { return { day, startedAt: new Date().toISOString(), exercises: prog[day].exercises.map(buildSession) }; }
function isExDone(ex) { if (ex.type === "top_set") return ex.confirmed && (ex.drops.length === 0 || ex.drops.every(d => d.confirmed)); if (ex.type === "rep_range") return ex.confirmed === true; if (ex.type === "checkbox") return ex.completed; return false; }
function getAlerts(prog, day) { return prog[day].exercises.flatMap(ex => { if (ex.type === "top_set" && (ex.successCount || 0) >= 3) return [{ id: ex.id, name: ex.name, newW: ex.topWeight + ex.increment, inc: ex.increment }]; if (ex.type === "rep_range" && ex.increment > 0 && ex.lastReps.every(r => r >= ex.maxReps)) return [{ id: ex.id, name: ex.name, newW: ex.weight + ex.increment, inc: ex.increment }]; return []; }); }

const C = {
  bg: "#1c1c1e",
  card: "#2c2c2e",
  inner: "#3a3a3c",
  border: "#48484a",
  red: "#ff3b30",
  redDim: "#4a0a07",
  orange: "#ff9500",
  green: "#30d158",
  blue: "#0a84ff",
  text: "#ffffff",
  muted: "#8e8e93",
  dim: "#48484a",
  accent: "#0a84ff",
};

function Btn({ onClick, children, color = "red", disabled = false, className = "" }) {
  const styles = {
    red: { background: C.blue, color: "#fff", border: "none" },
    green: { background: C.green, color: "#000", border: "none" },
    gray: { background: C.inner, color: C.muted, border: `1px solid ${C.border}` },
  };
  const s = styles[color] ?? styles.red;
  return (
    <button onClick={onClick} disabled={disabled}
      className={`font-bold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
      style={{ ...s, cursor: disabled ? "not-allowed" : "pointer", letterSpacing: "-0.01em" }}>
      {children}
    </button>
  );
}

const STEPS = [0.5, 1, 2.5, 5, 10];
// Store step preferences outside React so they survive re-renders
const _stepStore = {};

function NumAdj({ value, onChange, step = 2.5, min = 0, allowStepChange = false, sid = "default" }) {
  const key = sid;
  if (_stepStore[key] === undefined) _stepStore[key] = step;
  const [curStep, setCurStep] = useState(() => _stepStore[key]);
  const dec = () => onChange(Math.max(min, +(value - curStep).toFixed(4)));
  const inc = () => onChange(+(value + curStep).toFixed(4));
  const cycleStep = () => {
    const next = STEPS[(STEPS.indexOf(curStep) + 1) % STEPS.length];
    _stepStore[key] = next;
    setCurStep(next);
  };
  return (
    <div className="flex items-center gap-1.5">
      <button onClick={dec} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}><Minus size={13} /></button>
      <div className="flex flex-col items-center" style={{ minWidth: 60 }}>
        <span className="font-mono font-bold text-center" style={{ color: C.text }}>{value}</span>
        {allowStepChange && (
          <button onClick={cycleStep} style={{ fontSize: 9, color: C.muted, background: "#2a2a2a", border: `1px solid ${C.border}`, borderRadius: 4, padding: "1px 5px", marginTop: 2, cursor: "pointer" }}>
            ±{curStep}
          </button>
        )}
      </div>
      <button onClick={inc} className="w-8 h-8 rounded-lg flex items-center justify-center active:scale-90" style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}><Plus size={13} /></button>
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
  const totalSteps = warmupSteps.length + dropSteps.length;

  if (hidden) return (
    <button onClick={() => setHidden(false)}
      className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-bold mb-2 active:scale-95"
      style={{ background: "#0e1520", color: "#4a7099", border: "1px dashed #1e3a5a" }}>
      <Eye size={12} /> Vis plateguide
    </button>
  );

  // Visual barbell representation
  const PlateVisual = ({ steps, highlight }) => {
    const allPlates = [];
    let cum = 0;
    steps.forEach((s, si) => {
      if (s.add) s.add.forEach(p => allPlates.push({ kg: p, step: si, isHighlight: si === highlight }));
    });
    const plateColor = p => p >= 20 ? "#e53e3e" : p >= 15 ? "#d69e2e" : p >= 10 ? "#3182ce" : p >= 5 ? "#38a169" : "#718096";
    const plateH = p => p >= 20 ? 44 : p >= 10 ? 36 : p >= 5 ? 28 : 22;
    const plateW = p => p >= 20 ? 14 : p >= 10 ? 12 : p >= 5 ? 10 : 8;
    return (
      <div className="flex items-center justify-center py-3 gap-0.5 overflow-hidden">
        <div style={{ width: 32, height: 8, background: "#4a5568", borderRadius: 4 }} />
        <div style={{ width: 6, height: 44, background: "#2d3748", borderRadius: 2 }} />
        {allPlates.map((p, i) => (
          <div key={i} style={{
            width: plateW(p.kg), height: plateH(p.kg),
            background: plateColor(p.kg),
            borderRadius: 3,
            opacity: p.isHighlight ? 1 : 0.35,
            transition: "opacity 0.3s",
            flexShrink: 0
          }} />
        ))}
        <div style={{ width: 6, height: 44, background: "#2d3748", borderRadius: 2 }} />
        <div style={{ width: 32, height: 8, background: "#4a5568", borderRadius: 4 }} />
      </div>
    );
  };

  return (
    <div className="rounded-xl overflow-hidden mb-3" style={{ border: "1px solid #1e2a3a", background: "#0a0f18" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#4a7099" }}>Plateguide</span>
          <span className="font-mono text-xs px-2 py-0.5 rounded-full" style={{ background: "#1a2a3a", color: "#4a7099" }}>{totalSteps} steg</span>
        </div>
        <button onClick={() => setHidden(true)} className="text-xs flex items-center gap-1 active:scale-95" style={{ color: "#2d4a6b" }}>
          <EyeOff size={11} /> Skjul
        </button>
      </div>

      {/* Loading steps */}
      {warmupSteps.length > 0 && (
        <div style={{ borderTop: "1px solid #1a2530" }}>
          <div className="px-4 py-2" style={{ background: "#080d14" }}>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#2a5070" }}>↑ Last opp — innsiden ut</span>
          </div>
          {warmupSteps.map((s, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ background: i % 2 === 0 ? "#070c12" : "#080e15", borderTop: "1px solid #0f1a24" }}>
              <div className="flex items-center justify-center shrink-0 font-mono font-black text-xs" style={{
                width: 28, height: 28, borderRadius: 8,
                background: s.isTop ? C.red : "#1a2a3a",
                color: s.isTop ? "#fff" : "#4a7099"
              }}>{s.isTop ? "▶" : `S${i+1}`}</div>
              <div className="flex-1 min-w-0">
                <div className="font-mono font-black text-sm" style={{ color: s.isTop ? C.text : "#7aaac8" }}>{s.addTxt}</div>
                <div className="font-mono text-xs mt-0.5" style={{ color: "#2d4a6b" }}>{s.reps} reps · {s.pct}%</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-black" style={{ color: s.isTop ? "#fff" : "#4a7099", fontSize: s.isTop ? 18 : 15 }}>{s.weight}</div>
                <div className="font-mono text-xs" style={{ color: "#1e3a5a" }}>kg</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Drop steps */}
      {dropSteps.length > 0 && (
        <div style={{ borderTop: "1px solid #2a1a10" }}>
          <div className="px-4 py-2" style={{ background: "#100804" }}>
            <span className="text-xs font-black uppercase tracking-widest" style={{ color: "#6b3010" }}>↓ Strip — utsiden inn</span>
          </div>
          {dropSteps.map((d, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ background: "#0a0603", borderTop: "1px solid #180c06" }}>
              <div className="flex items-center justify-center shrink-0 font-mono font-black text-xs" style={{
                width: 28, height: 28, borderRadius: 8,
                background: "#2a1008", color: C.orange
              }}>D{i+1}</div>
              <div className="flex-1 min-w-0">
                <div className="font-mono font-black text-sm" style={{ color: "#e07040" }}>−{d.remove} kg/side</div>
                <div className="font-mono text-xs mt-0.5" style={{ color: "#5a2a10" }}>−{d.pct}% av forrige</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-black text-lg" style={{ color: C.orange }}>{d.weight}</div>
                <div className="font-mono text-xs" style={{ color: "#5a2a10" }}>kg</div>
              </div>
            </div>
          ))}
        </div>
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

      <div className="p-4" style={{ background: ex.confirmed ? C.card : "#1a0808", border: ex.confirmed ? "none" : "none" }}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-black uppercase tracking-widest" style={{ color: C.red }}>Top Set</span>
          {ex.confirmed && <span className="flex items-center gap-1 text-xs font-bold" style={{ color: C.green }}><Check size={12} />OK</span>}
        </div>
        <div className="flex items-center justify-between mb-3">
          {cfg.bodyweight ? <span className="font-mono font-black text-xl" style={{ color: C.text }}>BW</span>
            : <NumAdj value={ex.topWeight} onChange={setTopW} step={cfg.increment || 2.5} allowStepChange={true} sid={"ts-"+ex.id} />}
          <div className="text-right"><div className="text-xs uppercase tracking-widest mb-1" style={{ color: C.muted }}>Reps</div><NumAdj value={ex.actualReps} onChange={r => u({ actualReps: r })} step={1} min={1} /></div>
        </div>
        <div className="mb-3">{pTag(ex.topWeight)}</div>
        {!ex.confirmed ? <Btn onClick={() => u({ confirmed: true })} color="red" className="w-full py-3 rounded-xl text-sm">✓ Bekreft top set</Btn>
          : <div className="text-center text-xs font-bold py-1" style={{ color: C.green }}>✓ Fullført</div>}
      </div>

      {ex.drops.map((drop, i) => (
        <div key={i} className="p-4" style={{ background: drop.confirmed ? "#1a1a1a" : "#222222", borderTop: `1px solid ${C.border}` }}>
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
            <NumAdj value={drop.weight} onChange={w => u({ drops: ex.drops.map((d, j) => j === i ? { ...d, weight: w } : d) })} step={2.5} allowStepChange={true} sid={"dr-"+ex.id+"-"+i} />
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
  const done = ex.confirmed;
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${done ? C.green + "55" : C.border}` }}>
      <div className="p-4" style={{ background: done ? C.card : C.card }}>
        <div className="flex items-center justify-between mb-3">
          {cfg.bodyweight ? <span className="font-mono font-black" style={{ color: C.text }}>Kroppsvekt</span>
            : <NumAdj value={ex.weight} onChange={w => onUpdate({ ...ex, weight: w, confirmed: false })} step={2.5} allowStepChange={true} sid={"rr-"+ex.id} />}
          <div className="flex items-center gap-3">
            {done && <span className="flex items-center gap-1 text-xs font-bold" style={{ color: C.green }}><Check size={12} />OK</span>}
            <div className="text-right"><div className="text-xs uppercase tracking-widest" style={{ color: C.muted }}>Mål</div><div className="font-mono text-sm font-bold" style={{ color: C.muted }}>{Array(cfg.numSets).fill(cfg.maxReps).join("/")}</div></div>
          </div>
        </div>
        {prevMax && <div className="flex items-center gap-2 px-3 py-2 rounded-lg mb-3 text-xs font-semibold" style={{ background: "#1c1005", border: "1px solid #92400e55", color: "#fbbf24" }}><TrendingUp size={13} /> Nådde rep-mål sist — vurder å øke vekt</div>}
        <div className="flex gap-2 mb-3">
          {ex.reps.map((r, i) => (
            <div key={i} className="flex-1 flex flex-col items-center py-3 rounded-xl" style={{ background: C.inner, border: `1px solid ${C.border}` }}>
              <div className="text-xs font-bold mb-1.5" style={{ color: C.muted }}>S{i + 1}</div>
              <RepBtn value={r} onChange={v => { const reps = [...ex.reps]; reps[i] = v; onUpdate({ ...ex, reps, confirmed: false }); }} />
              <div className="font-mono text-xs mt-1.5" style={{ color: C.dim }}>sist:{cfg.lastReps[i]}</div>
            </div>
          ))}
        </div>
        {allMax && !done && <div className="text-center text-xs font-bold mb-2" style={{ color: C.green }}>🎯 Rep-mål nådd!</div>}
        {!done
          ? <Btn onClick={() => onUpdate({ ...ex, confirmed: true })} color="gray" className="w-full py-3 rounded-xl text-sm">✓ Bekreft sett</Btn>
          : <div className="text-center text-xs font-bold py-1" style={{ color: C.green }}>✓ Fullført</div>}
      </div>
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
    <div style={{ minHeight: "100vh", paddingBottom: 32, background: C.bg, color: C.text }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: C.bg, borderBottom: `1px solid ${C.border}`, paddingTop: "max(12px, env(safe-area-inset-top))", paddingBottom: 12, paddingLeft: 16, paddingRight: 16 }}>
        <div className="max-w-lg mx-auto flex items-center gap-3"><button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button><span className="font-black text-lg">Økt fullført</span></div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4" style={{ paddingTop: 20 }}>
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
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text }}>
      <div className="sticky top-0" style={{ zIndex: 50, background: C.bg + "f2", borderBottom: `1px solid ${C.border}`, }}>
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
      <div className="max-w-lg mx-auto p-4 space-y-5 pb-32" style={{ paddingTop: 16 }}>
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
      <div className="fixed bottom-0 left-0 right-0" style={{ background: C.bg + "f5", borderTop: `1px solid ${C.border}`, padding: "12px 16px", paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
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
  const [url, setUrl] = useState(() => { try { return localStorage.getItem("wt-gs-url") || ""; } catch { return ""; } });
  const [saved, setSaved] = useState(false);
  const saveUrl = (v) => { setUrl(v); try { localStorage.setItem("wt-gs-url", v); } catch {} setSaved(true); setTimeout(() => setSaved(false), 2000); };
  const ready = url.length > 20;
  return (
    <div style={{ minHeight: "100vh", paddingBottom: 32, background: C.bg, color: C.text }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button>
          <span className="font-black text-lg">Innstillinger</span>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4 space-y-4" style={{ paddingTop: 20 }}>
        <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
          <div className="px-4 py-3" style={{ background: C.inner }}><span className="font-black text-sm">Google Sheets backup</span></div>
          <div className="px-4 py-4 space-y-3" style={{ background: C.card }}>
            <div className="text-xs uppercase tracking-widest mb-1.5 font-bold" style={{ color: C.muted }}>Apps Script URL</div>
            <input value={url} onChange={e => saveUrl(e.target.value)}
              placeholder="https://script.google.com/macros/s/..."
              className="w-full rounded-xl px-4 py-3 text-xs focus:outline-none"
              style={{ background: C.inner, color: C.text, border: `1px solid ${C.border}` }} />
            {saved && <div className="text-xs" style={{ color: C.green }}>✓ URL lagret</div>}
          </div>
          {ready && (
            <div className="px-4 py-4 space-y-2" style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
              <div onClick={onSyncNow} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer"
                style={{ background: C.green, color: "#fff" }}>
                <RefreshCw size={15} />
                {syncStatus === "syncing" ? "Synkroniserer…" : syncStatus === "ok" ? "✓ Synkronisert!" : syncStatus === "fail" ? "! Feil — sjekk URL" : "Synkroniser nå"}
              </div>
              <div onClick={onRestore} className="w-full flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm cursor-pointer"
                style={{ background: C.inner, color: C.muted, border: `1px solid ${C.border}` }}>
                ↓ Gjenopprett fra Google Sheets
              </div>
            </div>
          )}
        </div>
        <div className="rounded-xl px-4 py-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
          <div className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: C.muted }}>Hva lagres?</div>
          <div className="text-xs space-y-1" style={{ color: C.muted }}>
            <div>• Automatisk backup til Google Sheets etter hver økt</div>
            <div>• Lesbar logg i Logger-fanen</div>
            <div>• Full gjenoppretting fra Backup-fanen</div>
          </div>
        </div>
      </div>
    </div>
  );
}
function HomeView({ program, logs, session, saveStatus, onStart, onContinue, onAbandon, onProgram, onHistory, onProgression, onSettings }) {
  const lastFor = day => logs.find(l => l.day === day);
  const elapsed = useElapsed(session?.startedAt);
  const days = ["monday", "wednesday", "friday"];
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
      <div style={{ maxWidth: 480, margin: "0 auto", padding: "0 16px" }}>

        {/* Header */}
        <div style={{ padding: "max(16px, env(safe-area-inset-top)) 0 16px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.04em", color: C.text }}>Training Log</div>
            <div style={{ fontSize: 13, color: C.muted, marginTop: 2 }}>Uke {weekNum()}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {saveStatus === "saving" && <span style={{ fontSize: 11, color: C.muted }}>lagrer…</span>}
            {saveStatus === "saved" && <span style={{ fontSize: 11, color: C.green }}>✓</span>}
            {saveStatus === "error" && <span style={{ fontSize: 11, color: C.red }}>!</span>}
            <button onClick={onSettings} style={{ width: 34, height: 34, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, cursor: "pointer" }}>
              <Settings size={15} />
            </button>
          </div>
        </div>

        {/* Active session banner */}
        {session && (
          <div style={{ background: "#0a1929", border: `1px solid ${C.blue}33`, borderRadius: 16, overflow: "hidden", marginBottom: 20 }}>
            <div style={{ height: 3, background: `linear-gradient(90deg, ${C.blue}, #34aadc)` }} />
            <div style={{ padding: "14px 16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: C.blue, boxShadow: `0 0 6px ${C.blue}` }} />
                  <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: C.blue }}>Økt pågår</span>
                </div>
                <span style={{ fontSize: 22, fontWeight: 800, color: C.text, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>{fmtElapsed(elapsed)}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: C.text, letterSpacing: "-0.02em", marginBottom: 2 }}>{program[session.day].label}</div>
              <div style={{ fontSize: 13, color: C.muted, marginBottom: 10 }}>{program[session.day].sub}</div>
              <div style={{ height: 4, background: C.inner, borderRadius: 2, marginBottom: 6 }}>
                <div style={{ height: "100%", width: `${(session.exercises.filter(isExDone).length / session.exercises.length) * 100}%`, background: C.blue, borderRadius: 2, transition: "width 0.4s ease" }} />
              </div>
              <div style={{ fontSize: 11, color: C.muted, marginBottom: 12 }}>{session.exercises.filter(isExDone).length} av {session.exercises.length} øvelser</div>
              <div style={{ display: "flex", gap: 8 }}>
                <Btn onClick={onContinue} color="red" className="flex-1 py-3 rounded-xl text-sm">Fortsett økt →</Btn>
                <button onClick={onAbandon} style={{ padding: "10px 14px", borderRadius: 12, fontSize: 12, fontWeight: 600, background: C.inner, color: C.muted, border: `1px solid ${C.border}`, cursor: "pointer" }}>Avslutt</button>
              </div>
            </div>
          </div>
        )}

        {/* Workout cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          {days.map(day => {
            const d = program[day], last = lastFor(day), alerts = getAlerts(program, day);
            const isActive = session?.day === day, blocked = !!session && !isActive;
            return (
              <div key={day} style={{ background: C.card, border: `1px solid ${isActive ? C.blue + "55" : C.border}`, borderRadius: 16, overflow: "hidden", position: "relative" }}>
                {isActive && <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: C.blue }} />}
                <div style={{ padding: "14px 16px", paddingLeft: isActive ? 20 : 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 16, fontWeight: 800, color: C.text, letterSpacing: "-0.02em" }}>{d.label}</div>
                      <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>{d.sub}</div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {last ? <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: C.muted }}><Clock size={10} />{fmtDate(last.startedAt)}</div>
                        : <div style={{ fontSize: 11, color: C.dim }}>Ikke logget</div>}
                      <div style={{ fontSize: 11, color: C.dim, marginTop: 2 }}>{d.exercises.length} øvelser</div>
                    </div>
                  </div>
                  {alerts.length > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderRadius: 10, marginBottom: 10, background: C.green + "15", border: `1px solid ${C.green}30` }}>
                      <TrendingUp size={12} style={{ color: C.green }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: C.green }}>{alerts.length} øvelse{alerts.length > 1 ? "r" : ""} klar for økning</span>
                    </div>
                  )}
                  <Btn onClick={isActive ? onContinue : () => onStart(day)} color={blocked ? "gray" : "red"} disabled={blocked} className="w-full py-3 rounded-xl text-sm">
                    {isActive ? "Fortsett økt" : blocked ? "Annen økt pågår" : "Start økt"}
                  </Btn>
                </div>
              </div>
            );
          })}
        </div>

        {/* Nav */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[[<List size={18} />, "Program", onProgram], [<Clock size={18} />, "Historikk", onHistory], [<TrendingUp size={18} />, "Progresjon", onProgression]].map(([icon, lbl, fn]) => (
            <button key={lbl} onClick={fn} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, padding: "14px 8px", borderRadius: 14, background: C.card, color: C.muted, border: `1px solid ${C.border}`, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>
              {icon}{lbl}
            </button>
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
    <div style={{ minHeight: "100vh", paddingBottom: 32, background: C.bg, color: C.text }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
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
      <div className="max-w-lg mx-auto p-4 space-y-3" style={{ paddingTop: 20 }}>
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
function HistoryView({ logs, program, onBack, onDeleteLog, onConfirmDelete }) {
  const [filter, setFilter] = useState("all");
  const [csvOpen, setCsvOpen] = useState(false);
  const filtered = filter === "all" ? logs : logs.filter(l => l.day === filter);
  return (
    <div style={{ minHeight: "100vh", paddingBottom: 32, background: C.bg, color: C.text }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={onBack} className="p-2 rounded-xl" style={{ background: C.card }}><ArrowLeft size={20} /></button>
          <span className="font-black text-lg">Historikk</span>
        </div>
      </div>
      <div className="max-w-lg mx-auto p-4" style={{ paddingTop: 20 }}>
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
                  <div className="flex items-center gap-3">
                    <div className="font-mono text-xs" style={{ color: C.muted }}>{fmtDate(log.startedAt)}</div>
                    <div onClick={() => onConfirmDelete(i)} style={{ padding: 8, cursor: "pointer", color: C.dim }}>
                      <X size={16} />
                    </div>
                  </div>
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
// Muscle group mapping
const MUSCLE_MAP = {
  bench: ["Bryst","Triceps","Foran delts"],
  deadlift: ["Rygg","Gluteus","Hamstrings"],
  hip_thrust_m: ["Gluteus","Hamstrings"],
  cable_row: ["Rygg","Biceps"],
  lat_m: ["Side delts"], lat_f: ["Side delts"],
  tri_push: ["Triceps"],
  calves: ["Legg"], calves_f: ["Legg"],
  squat: ["Quadriceps","Gluteus"],
  leg_curl_w: ["Hamstrings"],
  dips: ["Bryst","Triceps"],
  ohp: ["Delts","Triceps"],
  pullups_bw: ["Rygg","Biceps"],
  face_pulls: ["Bak delts"],
  wpullups: ["Rygg","Biceps"],
  cs_row: ["Rygg","Biceps"],
  bss: ["Quadriceps","Gluteus"],
  incline_db: ["Bryst","Foran delts"],
  biceps_curl_f: ["Biceps"],
};

function MiniChart({ points, field, color, height = 48 }) {
  if (!points || points.length < 2) return null;
  const vals = points.map(p => p[field]).filter(v => v != null && !isNaN(v));
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals);
  const range = max - min || 1;
  const w = 180, h = height, pad = 4;
  const pts = vals.map((v, i) => {
    const x = pad + (i / (vals.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? `M${p[0]},${p[1]}` : `L${p[0]},${p[1]}`)).join(" ");
  const areaPath = path + ` L${pts[pts.length-1][0]},${h} L${pts[0][0]},${h} Z`;
  return (
    <svg width={w} height={h} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id={"g"+field} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#g${field})`} />
      <path d={path} stroke={color} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3 : 1.5}
          fill={i === pts.length - 1 ? color : color + "88"} />
      ))}
    </svg>
  );
}

function VolumeChart({ logs, program }) {
  // Count sets per muscle group from last 4 weeks
  const cutoff = Date.now() - 28 * 24 * 3600 * 1000;
  const setsByMuscle = {};
  logs.filter(l => new Date(l.startedAt).getTime() > cutoff).forEach(log => {
    const d = program[log.day];
    if (!d) return;
    log.exercises.forEach(ex => {
      const muscles = MUSCLE_MAP[ex.id] || [];
      let sets = 0;
      if (ex.type === "top_set" && ex.confirmed) sets = 1 + (ex.drops || []).filter(d => d.confirmed).length;
      else if (ex.type === "rep_range") sets = (ex.reps || []).length;
      muscles.forEach(m => { setsByMuscle[m] = (setsByMuscle[m] || 0) + sets; });
    });
  });
  const entries = Object.entries(setsByMuscle).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return <div className="text-center py-8 text-sm" style={{ color: C.muted }}>Logg noen økter for å se volum.</div>;
  const maxSets = entries[0][1];
  const colors = ["#e53e3e","#dd6b20","#d69e2e","#38a169","#3182ce","#805ad5","#d53f8c","#00b5d8"];
  return (
    <div className="space-y-2">
      {entries.map(([muscle, sets], i) => (
        <div key={muscle}>
          <div className="flex justify-between mb-1">
            <span className="text-sm font-semibold">{muscle}</span>
            <span className="font-mono text-sm font-bold" style={{ color: colors[i % colors.length] }}>{sets} sett</span>
          </div>
          <div className="h-2 rounded-full" style={{ background: C.inner }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${(sets/maxSets)*100}%`, background: colors[i % colors.length] }} />
          </div>
        </div>
      ))}
      <div className="text-xs mt-2" style={{ color: C.dim }}>Siste 4 uker</div>
    </div>
  );
}

function ProgressionView({ logs, program, onBack }) {
  const days = ["monday", "wednesday", "friday"];
  const [selDay, setSelDay] = useState("monday");
  const [selEx, setSelEx] = useState(null);
  const [tab, setTab] = useState("exercises"); // "exercises" | "volume"

  // Build per-exercise history
  const exHistory = {};
  [...logs].reverse().forEach(log => {
    const d = program[log.day];
    if (!d) return;
    log.exercises.forEach(ex => {
      const cfg = d.exercises.find(e => e.id === ex.id); if (!cfg) return;
      if (ex.type === "checkbox") return;
      if (!exHistory[ex.id]) exHistory[ex.id] = { name: cfg.name, type: ex.type, bodyweight: cfg.bodyweight, points: [] };
      const date = fmtDate(log.startedAt);
      if (ex.type === "top_set" && ex.confirmed) {
        exHistory[ex.id].points.push({ date, weight: ex.topWeight, reps: ex.actualReps });
      } else if (ex.type === "rep_range") {
        const reps = ex.reps || [];
        const avg = reps.length ? Math.round(reps.reduce((a,b)=>a+b,0) / reps.length * 10) / 10 : 0;
        const total = reps.reduce((a,b)=>a+b,0);
        exHistory[ex.id].points.push({ date, weight: ex.bodyweight ? 0 : ex.weight, reps: avg, total, repsRaw: reps });
      }
    });
  });

  const dayExercises = program[selDay].exercises.filter(e => e.type !== "checkbox");
  const selected = selEx ? exHistory[selEx] : null;

  return (
    <div style={{ minHeight: "100vh", paddingBottom: 32, background: C.bg, color: C.text }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button onClick={selEx ? () => setSelEx(null) : onBack} className="p-2 rounded-xl" style={{ background: C.card }}>
            <ArrowLeft size={20} />
          </button>
          <span className="font-black text-lg flex-1">{selEx ? (selected?.name || "Progresjon") : "Progresjon"}</span>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4">
        {!selEx ? (
          <>
            {/* Tab bar */}
            <div className="flex gap-2 mb-4 p-1 rounded-xl" style={{ background: C.inner }}>
              {[["exercises","Øvelser"],["volume","Volum"]].map(([id, label]) => (
                <button key={id} onClick={() => setTab(id)}
                  className="flex-1 py-2 rounded-lg text-sm font-bold transition-all"
                  style={{ background: tab === id ? C.card : "transparent", color: tab === id ? C.text : C.muted }}>
                  {label}
                </button>
              ))}
            </div>

            {tab === "volume" ? (
              <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                <div className="text-xs uppercase tracking-widest mb-4 font-bold" style={{ color: C.muted }}>Sett per muskelgruppe</div>
                <VolumeChart logs={logs} program={program} />
              </div>
            ) : (
              <>
                {/* Day tabs */}
                <div className="flex gap-2 mb-4">
                  {days.map((day, i) => (
                    <button key={day} onClick={() => { setSelDay(day); setSelEx(null); }}
                      className="px-4 py-1.5 rounded-lg text-sm font-bold"
                      style={{ background: selDay === day ? C.red : C.card, color: "#fff", border: `1px solid ${C.border}` }}>
                      {["A","B","C"][i]}
                    </button>
                  ))}
                </div>

                {/* Exercise list */}
                <div className="space-y-2">
                  {dayExercises.map(cfg => {
                    const hist = exHistory[cfg.id];
                    const pts = hist?.points || [];
                    const latest = pts[pts.length - 1];
                    const first = pts[0];
                    const isTopSet = cfg.type === "top_set";
                    const weightDiff = latest && first ? +(latest.weight - first.weight).toFixed(1) : 0;
                    const repsDiff = latest && first && !isTopSet ? +(latest.reps - first.reps).toFixed(1) : 0;
                    const improved = weightDiff > 0 || repsDiff > 0;
                    return (
                      <button key={cfg.id} onClick={() => setSelEx(cfg.id)}
                        className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left"
                        style={{ background: C.card, border: `1px solid ${C.border}` }}>
                        <div className="flex-1 min-w-0 mr-3">
                          <div className="font-bold text-sm truncate">{cfg.name}</div>
                          <div className="font-mono text-xs mt-0.5" style={{ color: C.muted }}>
                            {pts.length === 0 && "Ingen data ennå"}
                            {pts.length > 0 && !cfg.bodyweight && (
                              isTopSet
                                ? `${latest.weight}kg × ${latest.reps}r · ${pts.length} økter`
                                : `${latest.weight}kg · snitt ${latest.reps}r · ${pts.length} økter`
                            )}
                            {pts.length > 0 && cfg.bodyweight && `BW · snitt ${latest.reps}r · ${pts.length} økter`}
                          </div>
                          {pts.length >= 2 && (weightDiff !== 0 || repsDiff !== 0) && (
                            <div className="flex gap-3 mt-1">
                              {!cfg.bodyweight && weightDiff !== 0 && (
                                <span className="text-xs font-bold" style={{ color: weightDiff > 0 ? C.green : C.red }}>
                                  {weightDiff > 0 ? "+" : ""}{weightDiff}kg
                                </span>
                              )}
                              {!isTopSet && repsDiff !== 0 && (
                                <span className="text-xs font-bold" style={{ color: repsDiff > 0 ? C.green : C.red }}>
                                  {repsDiff > 0 ? "+" : ""}{repsDiff}r snitt
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {pts.length >= 2 && <MiniChart points={pts} field={cfg.bodyweight ? "reps" : "weight"} color={improved ? C.green : C.muted} height={36} />}
                          <ChevronRight size={16} style={{ color: C.dim }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        ) : (
          /* Detail view */
          selected && (
            <div className="space-y-4">
              {selected.points.length === 0 ? (
                <div className="text-center py-16 text-sm" style={{ color: C.muted }}>Ingen data logget ennå.</div>
              ) : (
                <>
                  {/* Summary cards */}
                  <div className="grid grid-cols-3 gap-2">
                    {selected.type === "top_set" ? [
                      ["Start", selected.points[0].weight + " kg"],
                      ["Nå", selected.points[selected.points.length-1].weight + " kg"],
                      ["Økt", (weightDiff => (weightDiff > 0 ? "+" : "") + weightDiff + " kg")(+(selected.points[selected.points.length-1].weight - selected.points[0].weight).toFixed(1))],
                    ] : [
                      ["Vekt nå", selected.bodyweight ? "BW" : selected.points[selected.points.length-1].weight + " kg"],
                      ["Rep snitt", selected.points[selected.points.length-1].reps + ""],
                      ["Vol nå", (selected.points[selected.points.length-1].total || 0) + " reps"],
                    ].map(([label, val]) => (
                      <div key={label} className="rounded-xl p-3 text-center" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                        <div className="font-mono font-black text-lg" style={{ color: C.text }}>{val}</div>
                        <div className="text-xs mt-1" style={{ color: C.muted }}>{label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Weight chart */}
                  {!selected.bodyweight && selected.points.length >= 2 && (
                    <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                      <div className="text-xs uppercase tracking-widest mb-3 font-bold" style={{ color: C.muted }}>Vekt</div>
                      <div className="flex justify-center">
                        <MiniChart points={selected.points} field="weight" color={C.red} height={80} />
                      </div>
                      <div className="flex justify-between mt-2">
                        <span className="font-mono text-xs" style={{ color: C.dim }}>{selected.points[0].date}</span>
                        <span className="font-mono text-xs" style={{ color: C.dim }}>{selected.points[selected.points.length-1].date}</span>
                      </div>
                    </div>
                  )}

                  {/* Reps chart for rep_range */}
                  {selected.type === "rep_range" && selected.points.length >= 2 && (
                    <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
                      <div className="text-xs uppercase tracking-widest mb-3 font-bold" style={{ color: C.muted }}>Reps (snitt per økt)</div>
                      <div className="flex justify-center">
                        <MiniChart points={selected.points} field="reps" color={C.green} height={80} />
                      </div>
                      <div className="flex justify-between mt-2">
                        <span className="font-mono text-xs" style={{ color: C.dim }}>{selected.points[0].date}</span>
                        <span className="font-mono text-xs" style={{ color: C.dim }}>{selected.points[selected.points.length-1].date}</span>
                      </div>
                    </div>
                  )}

                  {/* Log table */}
                  <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                    <div className="px-4 py-2.5" style={{ background: C.inner }}>
                      <span className="text-xs uppercase tracking-widest font-bold" style={{ color: C.muted }}>Alle logger</span>
                    </div>
                    {[...selected.points].reverse().map((p, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3" style={{ background: C.card, borderTop: `1px solid ${C.border}` }}>
                        <span className="font-mono text-xs" style={{ color: C.muted }}>{p.date}</span>
                        <div className="flex items-center gap-3">
                          {!selected.bodyweight && <span className="font-mono font-bold text-sm" style={{ color: C.text }}>{p.weight} kg</span>}
                          <span className="font-mono text-xs" style={{ color: C.muted }}>
                            {selected.type === "top_set" ? `× ${p.reps} reps` : p.repsRaw ? p.repsRaw.join("/") : `snitt ${p.reps}`}
                          </span>
                          {selected.type === "rep_range" && p.total != null && (
                            <span className="font-mono text-xs px-2 py-0.5 rounded" style={{ background: C.inner, color: C.dim }}>{p.total} tot</span>
                          )}
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
    <div style={{ minHeight: "100vh", paddingBottom: 32,background:C.bg, color:C.text}}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
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
            {!bodyweight && <Row label="Startvekt (kg)"><NumAdj value={weight} onChange={setWeight} step={2.5} allowStepChange={true}/></Row>}
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
    <div style={{ minHeight: "100vh", paddingBottom: 32, background: C.bg, color: C.text }}>
      <div style={{ position: "sticky", top: 0, zIndex: 50, padding: "max(12px, env(safe-area-inset-top)) 16px 12px", background: C.bg, borderBottom: `1px solid ${C.border}` }}>
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
            <Row label={form.addedWeight ? "Tilleggsvekt (kg)" : "Vekt (kg)"}><NumAdj value={form.topWeight} onChange={v => upd("topWeight", v)} step={form.increment || 2.5} allowStepChange={true} /></Row>
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
            {!form.bodyweight && <Row label="Vekt (kg)"><NumAdj value={form.weight} onChange={v => upd("weight", v)} step={2.5} min={0} allowStepChange={true} /></Row>}
            <Row label="Antall sett"><NumAdj value={form.numSets} onChange={v => { const lr = [...form.lastReps]; while (lr.length < v) lr.push(form.minReps); while (lr.length > v) lr.pop(); setForm(f => ({ ...f, numSets: v, lastReps: lr })); }} step={1} min={1} /></Row>
            <Row label="Min reps"><NumAdj value={form.minReps} onChange={v => upd("minReps", v)} step={1} min={1} /></Row>
            <Row label="Max reps (mål)"><NumAdj value={form.maxReps} onChange={v => upd("maxReps", v)} step={1} min={form.minReps + 1} /></Row>
            {!form.bodyweight && <Row label="Vektøkning per steg"><NumAdj value={form.increment} onChange={v => upd("increment", v)} step={1.25} min={0} /></Row>}
          </div>
        )}
        {form.type === "rep_range" && (
          <div className="rounded-xl p-4" style={{ background: C.card, border: `1px solid ${C.border}` }}>
            <div className="text-xs uppercase tracking-widest mb-3" style={{ color: C.muted }}>Siste reps</div>
            <div className="flex gap-2">
              {form.lastReps.map((r, i) => (
                <div key={i} className="flex-1 flex flex-col items-center py-3 rounded-xl gap-2" style={{ background: C.inner, border: `1px solid ${C.border}` }}>
                  <div className="text-xs font-bold" style={{ color: C.muted }}>S{i + 1}</div>
                  <RepBtn value={r} onChange={v => updRep(i, v)} />
                </div>
              ))}
            </div>
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
  const [syncStatus, setSyncStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(null);

  // Refs to always have latest state in async/closure contexts
  const programRef = useRef(program);
  const logsRef = useRef(logs);
  const sessionRef = useRef(session);
  useEffect(() => { programRef.current = program; }, [program]);
  useEffect(() => { logsRef.current = logs; }, [logs]);
  useEffect(() => { sessionRef.current = session; }, [session]); // "" | "syncing" | "ok" | "fail"

  const getGsUrl = () => { try { return localStorage.getItem("wt-gs-url") || ""; } catch { return ""; } };

  const syncToGoogle = async (prog, lg, sess) => {
    const url = getGsUrl();
    if (!url) return;
    try {
      await fetch(url, {
        method: "POST",
        body: JSON.stringify({ program: prog, logs: lg, session: sess }),
        headers: { "Content-Type": "text/plain" }
      });
    } catch {}
  };

  const manualSyncToGoogle = async () => {
    const url = getGsUrl();
    if (!url) return;
    setSyncStatus("syncing");
    try {
      const res = await fetch(url, {
        method: "POST",
        body: JSON.stringify({ program: programRef.current, logs: logsRef.current, session: sessionRef.current }),
        headers: { "Content-Type": "text/plain" }
      });
      const text = await res.text();
      setSyncStatus(text.includes('"ok":true') || res.ok ? "ok" : "fail");
    } catch { setSyncStatus("fail"); }
    setTimeout(() => setSyncStatus(""), 3000);
  };
  const restoreFromGoogle = async () => {
    const url = getGsUrl();
    if (!url) return;
    setSyncStatus("syncing");
    try {
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok && json.data) {
        const d = json.data;
        if (d.program) setProgram(d.program);
        if (d.logs) setLogs(d.logs);
        setSession(null);
        await saveAll({ program: d.program || program, logs: d.logs || logs, session: null });
        setSyncStatus("ok");
      } else { setSyncStatus("fail"); }
    } catch { setSyncStatus("fail"); }
    setTimeout(() => setSyncStatus(""), 3000);
  };

  // Load once on mount
  useEffect(() => {
    (async () => {
      try {
        const data = await loadAll();
        if (data && data.program) {
          // Migrate leg_curl_m → hip_thrust_m
          if (data.program.monday) {
            data.program.monday.exercises = data.program.monday.exercises.map(ex =>
              ex.id === "leg_curl_m"
                ? { id: "hip_thrust_m", name: "Hip Thrusts", type: "rep_range", weight: 60, numSets: 3, minReps: 6, maxReps: 10, lastReps: [8,8,8], increment: 5 }
                : ex
            );
          }
          // Migrate: add Biceps Curls and Calves to Friday if missing
          if (data.program.friday) {
            const ids = data.program.friday.exercises.map(e => e.id);
            if (!ids.includes("biceps_curl_f")) data.program.friday.exercises.push({ id: "biceps_curl_f", name: "Biceps Curls", type: "rep_range", weight: 12, numSets: 3, minReps: 6, maxReps: 12, lastReps: [8,8,8], increment: 1 });
            if (!ids.includes("calves_f")) data.program.friday.exercises.push({ id: "calves_f", name: "Calves", type: "rep_range", weight: 90, numSets: 3, minReps: 8, maxReps: 14, lastReps: [10,10,10], increment: 5 });
          }
          setProgram(data.program);
          setLogs(data.logs || SEED_LOGS);
          if (data.session) setSession(data.session);
        } else {
          setProgram(JSON.parse(JSON.stringify(BASE_PROGRAM)));
          setLogs(SEED_LOGS);
        }
      } catch(e) {
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
      if (ex.type === "top_set") {
        // Use weight from session in case user adjusted it during session
        const sessionWeight = sx.topWeight !== undefined ? sx.topWeight : ex.topWeight;
        const sc = sx.confirmed ? (ex.successCount || 0) + 1 : (ex.successCount || 0);
        return accepted[ex.id]
          ? { ...ex, topWeight: sessionWeight + ex.increment, successCount: 0 }
          : { ...ex, topWeight: sessionWeight, successCount: sc };
      }
      if (ex.type === "rep_range") {
        // Use weight from session in case user adjusted it during session
        const sessionWeight = sx.weight !== undefined ? sx.weight : ex.weight;
        const base = { ...ex, lastReps: sx.reps, weight: sessionWeight };
        return accepted[ex.id] ? { ...base, weight: sessionWeight + ex.increment } : base;
      }
      return ex;
    });
    setLogs(newLogs); setProgram(next); setSession(null);
    persist(next, newLogs, null);
    syncToGoogle(next, newLogs, completed); // pass completed session
    setView("home");
  };

  const doAddExercise = (day, ex) => {
    const next = JSON.parse(JSON.stringify(programRef.current));
    next[day].exercises.push(ex);
    setProgram(next);
    persist(next, logsRef.current, sessionRef.current);
    setView("overview"); setAddTarget(null);
  };

  const doReorder = (day, fromIdx, toIdx) => {
    const next = JSON.parse(JSON.stringify(programRef.current));
    const [moved] = next[day].exercises.splice(fromIdx, 1);
    next[day].exercises.splice(toIdx, 0, moved);
    setProgram(next);
    persist(next, logsRef.current, sessionRef.current);
  };

  const doDelete = (day, exId) => {
    const next = JSON.parse(JSON.stringify(programRef.current));
    next[day].exercises = next[day].exercises.filter(e => e.id !== exId);
    setProgram(next);
    persist(next, logsRef.current, sessionRef.current);
  };

  const doSaveEdit = (day, exId, updates) => {
    const next = JSON.parse(JSON.stringify(programRef.current));
    next[day].exercises = next[day].exercises.map(ex => ex.id === exId ? { ...ex, ...updates } : ex);
    setProgram(next);
    persist(next, logsRef.current, sessionRef.current);
    setView("overview"); setEditTarget(null);
  };

  if (loading) return <div style={{ minHeight: "100vh", minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", background: C.bg }}><div style={{ color: C.muted, fontSize: 14, fontFamily: "monospace" }}>Laster...</div></div>;
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "system-ui,-apple-system,sans-serif" }}>
      {view === "home" && <HomeView program={program} logs={logs} session={session} saveStatus={saveStatus} onStart={doStart} onContinue={() => setView("session")} onAbandon={() => { setSession(null); persist(program, logs, null); }} onProgram={() => setView("overview")} onHistory={() => setView("history")} onProgression={() => setView("progression")} onSettings={() => setView("settings")} />}
      {view === "session" && session && <SessionView session={session} program={program} saveStatus={saveStatus} onUpdate={doUpdateSession} onComplete={doComplete} onBack={() => setView("home")} />}
      {view === "overview" && <OverviewView program={program} onBack={() => setView("home")} onEdit={(day, exId) => { setEditTarget({ day, exId }); setView("edit"); }} onAdd={(day) => { setAddTarget(day); setView("add"); }} onReorder={doReorder} onDelete={doDelete} />}
      {view === "history" && <HistoryView logs={logs} program={program} onBack={() => setView("home")} onDeleteLog={(i) => { const deleted = logs[i]; const newLogs = logs.filter((_, idx) => idx !== i); setLogs(newLogs); persist(program, newLogs, session); deleteFromGoogle(deleted?.startedAt); }} onConfirmDelete={(i) => setConfirmDelete(i)} />}
      {view === "progression" && <ProgressionView logs={logs} program={program} onBack={() => setView("home")} />}
      {view === "edit" && editTarget && <EditView program={program} day={editTarget.day} exerciseId={editTarget.exId} onSave={doSaveEdit} onBack={() => { setView("overview"); setEditTarget(null); }} />}
      {view === "add" && addTarget && <AddExerciseView day={addTarget} program={program} onSave={doAddExercise} onBack={() => { setView("overview"); setAddTarget(null); }} />}
      {view === "settings" && <SettingsView onBack={() => setView("home")} onSyncNow={manualSyncToGoogle} onRestore={restoreFromGoogle} syncStatus={syncStatus} />}
      {confirmDelete !== null && (
        <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "flex-end", justifyContent: "center", padding: "16px 16px 40px 16px", background: "rgba(0,0,0,0.8)" }}>
          <div style={{ background: "#1c1c1c", border: "1px solid #444", borderRadius: 20, padding: 24, width: "100%", maxWidth: 480 }}>
            <div style={{ fontWeight: 900, fontSize: 17, marginBottom: 6, color: "#f7f7f7" }}>Slett økt?</div>
            <div style={{ color: "#a0aec0", fontSize: 14, marginBottom: 24 }}>Dette kan ikke angres.</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <button onClick={() => { const deleted = logs[confirmDelete]; const newLogs = logs.filter((_, idx) => idx !== confirmDelete); setLogs(newLogs); persist(program, newLogs, session); deleteFromGoogle(deleted?.startedAt); setConfirmDelete(null); }}
                style={{ width: "100%", background: "#e53e3e", color: "#fff", border: "none", borderRadius: 14, padding: "16px 0", fontWeight: 900, fontSize: 16, cursor: "pointer" }}>
                Slett økt
              </button>
              <button onClick={() => setConfirmDelete(null)}
                style={{ width: "100%", background: "#2a2a2a", color: "#a0aec0", border: "1px solid #444", borderRadius: 14, padding: "16px 0", fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
                Avbryt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
