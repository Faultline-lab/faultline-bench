'use strict';
// Runs before `npm pack` / `npm publish`: packs each scenario's hidden/ and solution/ into sealed.gz.
const { loadScenarios, sealScenario } = require('../src/scenarios');

for (const s of loadScenarios()) {
  sealScenario(s);
  console.log(`sealed ${s.id}`);
}
