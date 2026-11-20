'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCENARIO_ROOT = path.join(__dirname, '..', 'scenarios');

/**
 * A scenario is a folder:
 *   scenario.json  { id, title, category, difficulty, suites: ["quick","full"], timeoutSec, task }
 *   repo/          starting snapshot the agent works in (identical for every agent)
 *   hidden/        grading tests, copied in only AFTER the agent finishes
 *   solution/      reference solution, used by the built-in "oracle" agent to validate the scenario
 */
function loadScenarios(root = SCENARIO_ROOT) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, 'scenario.json')))
    .map((d) => {
      const dir = path.join(root, d.name);
      const meta = JSON.parse(fs.readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
      return {
        suites: ['full'],
        timeoutSec: 600,
        difficulty: 'medium',
        ...meta,
        id: meta.id || d.name,
        dir,
      };
    })
    .sort((a, b) => (a.order || 99) - (b.order || 99) || a.id.localeCompare(b.id));
}

function selectScenarios(all, { suite, ids }) {
  if (ids && ids.length) {
    const picked = ids.map((id) => {
      const s = all.find((x) => x.id === id);
      if (!s) throw new Error(`Unknown scenario "${id}". Run "faultline list" to see them.`);
      return s;
    });
    return picked;
  }
  const name = suite || 'quick';
  const picked = all.filter((s) => s.suites.includes(name));
  if (!picked.length) throw new Error(`No scenarios in suite "${name}". Use quick or full.`);
  return picked;
}

module.exports = { SCENARIO_ROOT, loadScenarios, selectScenarios };
