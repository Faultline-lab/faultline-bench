# Faultline Bench: reuse plan

Written 2026-11-20 after reading the seven reference repositories in `references/` (shallow clones, unmodified).

## Decision in one paragraph

We reuse **knowledge, not code**. The references are Python projects with Docker, YAML configs and large
dependency trees, built for research teams. Faultline Bench v1 must install in one command and start in under a
minute, so it is a zero-dependency Node.js CLI, a different stack from every reference. What we took from them
is the hard-won interface knowledge: exact headless flags for each agent CLI, the shape of each CLI's JSON usage
output, and process quirks that cause hangs. Everything else (runner, grading, scenarios, report) is written
from scratch. No code, tasks or datasets were copied, so no third-party license obligations apply. Credits are
in `faultline-bench/NOTICE.md`.

## Licenses found

| Repo | License | Reuse allowed? |
|---|---|---|
| sample-agent-cost-bench (AWS) | MIT-0 in LICENSE, Apache-2.0 in pyproject (inconsistent) | Yes, either way |
| openbench | MIT | Yes |
| coder_eval (UiPath) | Apache-2.0 | Yes, with NOTICE |
| AgentArena | MIT in LICENSE, ISC in package.json | Yes |
| terminal-agent-bench | MIT in pyproject only, no LICENSE file | Treat as unclear: learn, don't copy |
| coding-agent-benchmark | MIT | Yes |
| ccbench | No license | No: all rights reserved, read only |

## Component by component

| Component | Decision | Source of the idea |
|---|---|---|
| Agent detection | Implemented independently (PATH scan, background version probe) | none needed |
| Claude Code invocation | Adapted flags: `-p --output-format json --dangerously-skip-permissions` | cost-bench, openbench |
| Codex invocation | Adapted flags: `exec --json --skip-git-repo-check --sandbox workspace-write`, stdin closed | openbench |
| OpenCode invocation | Adapted: `run --format json`, plus drain timeout for the leaked stdout pipe | coder_eval, cost-bench |
| Antigravity (agy) invocation | Adapted: needs `--add-dir <workspace>` or it writes elsewhere | cost-bench |
| Cursor Agent | Adapted: needs `--trust` | cost-bench |
| Usage parsers | Implemented independently from documented JSON shapes (Codex `turn.completed`, OpenCode `step_finish`, agy result object) | cost-bench docs |
| Task format | Independent: `scenario.json` + `repo/` + `hidden/` + `solution/` | inspired by terminal-agent-bench and coder_eval |
| Isolation | Independent: fresh copy + git baseline per attempt, hidden tests copied in after the agent stops | common pattern |
| Grading | Independent: `node --test` TAP output, pass/fail counts | none |
| Failure analysis | Independent: six categories (timeout, crash, no changes, broken code, wrong behavior, passed) | none |
| Reliability | Independent: repeat runs, consistency and pass-every-run rates | openbench's idea of repeated trials |
| Reports | Independent: one self-contained HTML file plus `results.json`, no CDN, no upload | AgentArena's local-first stance |
| Docker sandboxing, statistics, pricing tables | Not in v1 | cost-bench, openbench (later) |

## What v1 deliberately leaves out

Docker sandboxing, testing against the user's own repository, price tables for subscription users, statistical
significance tests, a live dashboard. Each is a candidate for v2 once v1 has users.
