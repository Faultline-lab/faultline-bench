'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const SEALED = 'sealed.gz';

const SCENARIO_ROOT = path.join(__dirname, '..', 'scenarios');

/**
 * A scenario is a folder:
 *   scenario.json  { id, title, category, difficulty, suites: ["quick","full"], timeoutSec, task }
 *   repo/          starting snapshot the agent works in (identical for every agent)
 *   hidden/        grading tests, copied in only AFTER the agent finishes
 *   solution/      reference solution, used by the built-in "oracle" agent to validate the scenario
 *
 * In the published package, hidden/ and solution/ ship packed into one gzip file (sealed.gz), so the
 * grading tests are not lying around as plain text an agent could grep for. This is sealing, not secrecy.
 */

function readDirFiles(root, rel = '') {
  const out = {};
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) Object.assign(out, readDirFiles(root, r));
    else out[r] = fs.readFileSync(path.join(root, r)).toString('base64');
  }
  return out;
}

/** Returns { 'relative/path': base64 } for a scenario's hidden tests or solution. */
function readPart(scenario, part) {
  const dir = path.join(scenario.dir, part);
  if (fs.existsSync(dir)) return readDirFiles(dir);
  const sealed = path.join(scenario.dir, SEALED);
  if (fs.existsSync(sealed)) return JSON.parse(zlib.gunzipSync(fs.readFileSync(sealed)).toString('utf8'))[part] || {};
  return {};
}

function writePart(files, dest) {
  for (const [rel, b64] of Object.entries(files)) {
    const target = path.join(dest, ...rel.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(b64, 'base64'));
  }
  return Object.keys(files);
}

function sealScenario(scenario) {
  const data = { hidden: readDirFiles(path.join(scenario.dir, 'hidden')), solution: readDirFiles(path.join(scenario.dir, 'solution')) };
  fs.writeFileSync(path.join(scenario.dir, SEALED), zlib.gzipSync(JSON.stringify(data)));
}
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

module.exports = { SCENARIO_ROOT, loadScenarios, selectScenarios, readPart, writePart, sealScenario };
