'use strict';

// Pure scoring functions over attempt records. No I/O.

const comb = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

// Probability that at least one of k samples (without replacement) passes.
const passAtK = (n, c, k) => (k < 1 || k > n ? null : 1 - comb(n - c, k) / comb(n, k));

// Probability that all k samples pass.
const passHatK = (n, c, k) => (k < 1 || k > n ? null : comb(c, k) / comb(n, k));

// Wilson score 95% interval.
const wilson = (passes, total, z = 1.96) => {
  if (!total) return null;
  const p = passes / total;
  const z2 = z * z;
  const center = (p + z2 / (2 * total)) / (1 + z2 / total);
  const half = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / (1 + z2 / total);
  return [Math.max(0, center - half), Math.min(1, center + half)];
};

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const known = (v) => typeof v === 'number' && Number.isFinite(v);

function summarizeAgent(attempts) {
  const graded = attempts.filter((a) => a.passed !== null);
  const byScenario = new Map();
  for (const a of graded) {
    const s = byScenario.get(a.scenario) || { n: 0, c: 0 };
    s.n++;
    if (a.passed) s.c++;
    byScenario.set(a.scenario, s);
  }
  const ids = [...byScenario.keys()];
  const stats = [...byScenario.values()];
  const rates = stats.map((s) => s.c / s.n);
  const passes = sum(stats.map((s) => s.c));
  const maxK = stats.length ? Math.min(...stats.map((s) => s.n)) : 0;

  const passAt = {};
  const passHat = {};
  for (let k = 1; k <= maxK; k++) {
    passAt[k] = mean(stats.map((s) => passAtK(s.n, s.c, k)));
    passHat[k] = mean(stats.map((s) => passHatK(s.n, s.c, k)));
  }

  let sem = null;
  if (rates.length >= 2) {
    const m = mean(rates);
    const variance = sum(rates.map((r) => (r - m) ** 2)) / (rates.length - 1);
    sem = Math.sqrt(variance / rates.length);
  }

  const costs = graded.map((a) => a.costUsd);
  const tokens = graded.flatMap((a) => [a.inputTokens, a.outputTokens]);
  const durations = graded.map((a) => a.durationMs);

  return {
    runs: graded.length,
    solveRate: mean(rates),
    passAtK: passAt,
    passHatK: passHat,
    flakyScenarios: ids.filter((_, i) => stats[i].c > 0 && stats[i].c < stats[i].n),
    alwaysPass: ids.filter((_, i) => stats[i].c === stats[i].n),
    alwaysFail: ids.filter((_, i) => stats[i].c === 0),
    solveRateCI: wilson(passes, graded.length),
    sem,
    costPerSolve: passes && costs.every(known) ? sum(costs) / passes : null,
    timePerSolveMs: passes ? sum(durations) / passes : null,
    medianDurationMs: median(durations),
    totalTokens: tokens.length && tokens.every(known) ? sum(tokens) : null,
    harnessErrors: attempts.length - graded.length,
  };
}

function summarizeAll(attempts) {
  const byAgent = {};
  for (const a of attempts) (byAgent[a.agent] ||= []).push(a);
  const out = {};
  for (const [agent, list] of Object.entries(byAgent)) out[agent] = summarizeAgent(list);
  return out;
}

module.exports = { passAtK, passHatK, wilson, summarizeAgent, summarizeAll };
