# Faultline Bench

Faultline Bench is a free, open-source, local-first Command-Line Interface (CLI) that compares AI coding agents on identical tasks. The tool evaluates Claude Code, Codex CLI, Gemini CLI, OpenCode, and Antigravity CLI. It also experimentally supports Cursor Agent, Qwen Code, GitHub Copilot CLI, Amp, Aider, and Goose. You can also evaluate custom CLIs using `--agent-cmd`. Each agent solves identical coding problems in isolated workspaces so you can find the best AI coding agent for your codebase.

## Quick start

Faultline Bench requires Node.js 18+ and git.

Install the CLI globally with npm:

```bash
npm install -g faultline-bench
```

Start the interactive benchmark:

```bash
faultline
```

You can also run `npx faultline-bench` to test agents without global installation.

## What happens when you run it

When you execute `faultline`, the runner guides you through four steps:

1. **Detects installed agents**: Faultline Bench inspects your `PATH` for supported agent executables and reads their versions.
2. **Prompts for selection**: You select which detected agents to evaluate, or select all available agents.
3. **Executes the quick suite**: Each chosen agent attempts a default suite of 3 coding tasks in isolated workspaces.
4. **Opens the report**: Faultline Bench writes an HTML report and JSON summary, then opens the HTML report in your browser.

## Scenarios

Faultline Bench includes six built-in coding scenarios:

| Scenario ID | What it tests | Difficulty | Suite |
|---|---|---|---|
| `pagination-off-by-one` | Fixes 1-based pagination indexing, empty list handling, and page bounds | easy | quick, full |
| `duration-parser` | Implements duration parser and formatter across time units from milliseconds to days | easy | quick, full |
| `lru-cache` | Adds Least Recently Used (LRU) eviction, capacity limits, and eviction callbacks | medium | quick, full |
| `invoice-rounding` | Fixes floating-point cent-rounding and formatting bugs across two modules | medium | full |
| `csv-parser` | Rewrites CSV parser to pass RFC 4180 tests for quotes, delimiters, and line breaks | medium | full |
| `event-emitter` | Extends event emitter with once listeners, listener counts, and snapshot emit isolation | hard | full |

## How scoring works

Faultline Bench evaluates each agent through automated, isolated test runs:

- **Hidden tests**: The runner copies verification tests into the workspace only after the agent process stops. Agents cannot inspect hidden tests while working on the task.
- **Solved status**: An attempt counts as Solved only when all hidden tests pass.
- **Test pass rate**: The report records the percentage of passing hidden tests across all attempts for each scenario.
- **Median time**: The runner records duration in milliseconds for each attempt and reports the median across all attempts.
- **Tokens and cost**: The benchmark extracts token usage and dollar costs only when the agent CLI reports them in its output. If an agent does not output usage metrics, cost remains omitted.
- **Consistency**: You can pass `--repeat <n>` to run each scenario multiple times and measure consistency across repeated trials.

### Failure categories

When an attempt does not pass, Faultline Bench assigns one of five failure categories:

- **`tests_failed` (Wrong behavior)**: The agent modified files, but one or more hidden tests failed.
- **`broken_code` (Code does not load)**: The code contains syntax errors or crashes during test execution.
- **`no_changes` (Made no changes)**: The agent exited with code 0 without modifying any files.
- **`agent_error` (Agent crashed or refused)**: The agent exited with a non-zero code and made no file changes.
- **`timeout` (Timed out)**: The agent failed to complete before the time limit expired.

## Supported agents

Faultline Bench includes pre-configured adapters for popular coding agent CLIs. Each agent runs in headless mode using non-interactive flags:

| Agent | ID | Binary | Invocation flags | Status |
|---|---|---|---|---|
| Claude Code | `claude` | `claude` | `-p <prompt> --output-format json --dangerously-skip-permissions` | Supported |
| Codex CLI | `codex` | `codex` | `exec --json --skip-git-repo-check --sandbox workspace-write <prompt>` | Supported |
| Gemini CLI | `gemini` | `gemini` | `-p <prompt> --yolo --output-format json` | Supported (flags not yet verified on a live install) |
| OpenCode | `opencode` | `opencode` | `run --standalone --auto --format json <prompt>` | Supported |
| Antigravity CLI | `agy` | `agy`, `antigravity` | `-p <prompt> --output-format json --add-dir <workspace> --print-timeout 30m --dangerously-skip-permissions` | Supported |
| Qwen Code | `qwen` | `qwen` | `-p <prompt> --yolo` | Experimental |
| Cursor Agent | `cursor` | `cursor-agent` | `-p --force --trust --output-format json <prompt>` | Experimental |
| GitHub Copilot CLI | `copilot` | `copilot` | `-p <prompt> --allow-all-tools` | Experimental |
| Amp | `amp` | `amp` | `-x <prompt> --dangerously-allow-all` | Experimental |
| Aider | `aider` | `aider` | `--yes-always --no-auto-commits --no-check-update --message <prompt>` | Experimental |
| Goose | `goose` | `goose` | `run -t <prompt>` | Experimental |

When you pass `--model <agent>=<model>`, Faultline Bench forwards `--model <model>` or `-m <model>` to the matching agent command.

You can also evaluate any unlisted CLI with `--agent-cmd`:

```bash
faultline run --agent-cmd "myagent=myagent --yes -p {prompt}"
```

## Options reference

Faultline Bench provides four top-level commands:

- **`faultline`**: Starts the interactive runner to detect agents, prompt for selections, and open results.
- **`faultline run [options]`**: Runs the benchmark with command-line options.
- **`faultline detect`**: Lists coding agent CLIs detected on your PATH.
- **`faultline list`**: Lists all built-in scenarios.

### Run options

You can pass these options to `faultline run`:

| Option | Description |
|---|---|
| `--agents <ids>` | Comma-separated agent IDs, e.g. `claude,codex` (`"all"` selects every installed agent) |
| `--suite <name>` | Benchmark suite: `quick` (3 tasks, default) or `full` (6 tasks) |
| `--scenarios <ids>` | Run specific scenarios instead of a suite |
| `--repeat <n>` | Run each task `n` times to measure reliability (default: `1`) |
| `--timeout <sec>` | Per-task time limit in seconds (default: per scenario, 7 to 9 minutes) |
| `--model <agent=model>` | Set a model for an agent, e.g. `--model claude=sonnet` (repeatable) |
| `--agent-cmd <spec>` | Add any CLI: `"name=mycli --yes -p {prompt}"` (repeatable) |
| `--parallel <n>` | Number of agents to run simultaneously (default: all selected) |
| `--workdir <dir>` | Where temporary task copies go (default: system temp; also `FAULTLINE_WORKDIR`) |
| `--out <dir>` | Directory where the report is written (default: `./faultline-results/<run>`) |
| `-y, --yes` | Skip confirmation prompts |
| `--no-open` | Do not open the HTML report when done |

## Safety

Running autonomous coding agents requires sensible precautions:

- **Auto-approve flags**: Agents run with flags that bypass confirmation prompts, such as `--dangerously-skip-permissions` or `--yolo`.
- **Throwaway copies**: Every attempt runs inside a temporary directory with a git baseline. Agent changes do not alter original scenario files.
- **Local machine execution**: Agents execute commands on your computer using their standard tool permissions. Run benchmarks only in environments you trust.
- **Subscription and credit usage**: Runs consume your own subscriptions or API credits with model providers.
- **Zero telemetry**: Faultline Bench contains no analytics, collects no telemetry, and uploads nothing to remote servers.
- **Workspace directory control**: You can set the `FAULTLINE_WORKDIR` environment variable or use `--workdir <dir>` to choose where temporary copies go.

## Adding your own scenario

In v1, custom scenarios live in a clone of this repository. Place each scenario in a directory under `faultline-bench/scenarios/<scenario-id>/` and run `node bin/faultline.js` from that folder. Use this layout:

```text
scenarios/my-scenario/
├── scenario.json
├── repo/
├── hidden/
└── solution/
```

The files serve distinct purposes:

- **`scenario.json`**: Defines scenario metadata including `id`, `title`, `category`, `difficulty`, `suites`, `timeoutSec`, and task instructions in `task`.
- **`repo/`**: Contains the starter codebase copied into the agent workspace, including package configuration and initial tests.
- **`hidden/`**: Stores validation tests copied into `.faultline-hidden/` after the agent finishes. The runner executes these tests with `node --test` to score the attempt.
- **`solution/`**: Contains the reference solution files.

Verify your scenario without consuming AI credits using the built-in reference oracle:

```bash
faultline run --agents oracle --scenarios my-scenario
```

The oracle pseudo-agent copies files from `solution/` directly into the workspace. This confirms that hidden tests pass against the reference solution.

## License

Faultline Bench is licensed under the MIT License. See [LICENSE](LICENSE) for terms.

See [NOTICE.md](NOTICE.md) for details on architecture independence and studied prior art.
