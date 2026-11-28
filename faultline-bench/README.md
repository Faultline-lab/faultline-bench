# Faultline Bench

Find the best AI coding agent for your codebase. Faultline Bench runs agent CLIs such as Claude Code, Codex CLI, Gemini CLI, OpenCode, Antigravity CLI and Cursor Agent on 6 tasks, grades them with hidden tests, and writes a local HTML report.

**Warning:** Agents run with auto-approve flags enabled inside a throwaway temporary copy of each scenario, and they can still execute commands on your machine. Every run uses your own AI subscriptions or API credits.

## Prerequisites

Install the runtime, version control, and at least one supported agent CLI before you run a benchmark:

- **Node.js 18.19 or newer**: runs the CLI and grades solutions with `node --test`
- **Git**: required; it records a baseline in each temporary workspace and captures diffs (the run stops with a clear message if git is missing)
- **At least one agent CLI**: installed and signed in

Faultline Bench includes primary adapters for `claude` (Claude Code), `codex` (Codex CLI), `gemini` (Gemini CLI), `opencode` (OpenCode), and `agy` or `antigravity` (Antigravity CLI).

Experimental adapters support `qwen` (Qwen Code), `cursor` (`cursor-agent`), `copilot` (GitHub Copilot CLI), `amp` (Amp), `aider` (Aider), and `goose` (Goose).

## Run your first benchmark

Start the interactive runner with `npx` to detect installed CLIs, choose agents and a suite, and open the HTML report:

```bash
npx faultline-bench
```

Run a non-interactive comparison across all 6 scenarios with 3 repeats per task to measure reliability:

```bash
faultline run --agents claude,codex --suite full --repeat 3
```

You can also inspect your environment before starting a run:

- **Detect installed CLIs**: `faultline detect` lists supported agent binaries found on your `PATH`
- **List built-in scenarios**: `faultline list` prints every scenario ID, category, difficulty, and suite

## Command-line options

Faultline Bench accepts options on `faultline` and `faultline run`, and supports `detect`, `list`, and `help` subcommands.

| Option | Description |
| --- | --- |
| `--agents <ids>` | Comma list of agent IDs such as `claude,codex`, or `all` for every installed CLI |
| `--suite <name>` | Built-in suite to run: `quick` (3 tasks, default), `full` (6 tasks) or `visual` (3 simulations you can see) |
| `--scenarios <ids>` | Comma list of specific scenario IDs to run instead of a suite |
| `--repeat <n>` | Times to run each scenario to measure consistency (`1` to `20`, default `1`) |
| `--timeout <sec>` | Per-task timeout in seconds (`10` to `7200`; defaults per scenario to `420s` to `540s`) |
| `--model <agent=model>` | Override the model for an agent, such as `--model claude=sonnet` (repeatable) |
| `--agent-cmd <spec>` | Register a custom agent command template as `"name=mycli --yes -p {prompt}"` (repeatable) |
| `--parallel <n>` | Maximum agents to run concurrently (`1` to `16`, default: all selected agents) |
| `--out <dir>` | Directory for reports and logs (default `./faultline-results/<run>`) |
| `--workdir <dir>` | Root directory for temporary scenario workspaces (overrides `FAULTLINE_WORKDIR`) |
| `-y`, `--yes` | Skip interactive selection and confirmation prompts |
| `--no-open` | Skip opening `report.html` automatically when the run finishes |
| `-h`, `--help` | Print usage help and exit |
| `-v`, `--version` | Print the CLI version and exit |

## Built-in benchmark scenarios

Each attempt starts from a fresh copy of the scenario with a `TASK.md`. Hidden grading tests are added only after the agent finishes:

| ID | Kind | Difficulty | Suites |
| --- | --- | --- | --- |
| `pagination-off-by-one` | bug fix | easy | `quick`, `full` |
| `duration-parser` | implement from spec | easy | `quick`, `full` |
| `lru-cache` | feature on existing code | medium | `quick`, `full` |
| `invoice-rounding` | multi-file bug fix | medium | `full` |
| `csv-parser` | make tests pass | medium | `full` |
| `event-emitter` | feature + edge cases | hard | `full` |
| `spinning-hexagon` | physics simulation | hard | `visual` |
| `engine-sim` | engineering simulation | hard | `visual` |
| `raytracer` | graphics | hard | `visual` |

### Visual scenarios: see what each agent built

The `visual` suite has three simulations whose result you can look at, not only score:

- **`spinning-hexagon`**: balls bouncing under gravity inside a rotating hexagon. A wrong fix shows balls escaping (drawn in red) and energy blowing up.
- **`engine-sim`**: a single-cylinder four-stroke engine. The picture animates the piston, rod and crank and plots the pressure-volume loop and the torque curve.
- **`raytracer`**: a small ray tracer. The picture puts the agent's image next to the correct one with the share of matching pixels.

Hidden tests still decide pass or fail. After grading, Faultline also draws each attempt's result and the correct reference, and the report shows them side by side:

```bash
faultline run --agents claude,codex --suite visual
```


## Add a custom agent CLI

Pass `--agent-cmd` with a `name=command args {prompt}` specification to benchmark any CLI that accepts a prompt.

Faultline Bench splits the command on whitespace, substitutes `{prompt}` with the task instruction (or appends it if omitted), and extracts token and cost fields from any JSON printed to standard output.

Run a custom agent alongside built-in options:

```bash
faultline run --agent-cmd "myagent=mycli --yes -p {prompt}" --agents myagent
```

## Verify the harness with dry runs

Use the built-in `oracle` and `noop` pseudo-agents to test scenario workspaces and grading with zero AI calls:

- **`oracle`**: copies each scenario's reference `solution/` directory into the workspace so all hidden tests pass
- **`noop`**: makes no edits to confirm baseline failures and diff tracking

Run both dry-run agents against the default suite:

```bash
faultline run --agents oracle,noop
```

## Understand the report and failure categories

Each run writes a self-contained `report.html`, structured `results.json`, and per-attempt `.log`, `.diff`, and `.grade.txt` files under the `--out` directory.

The HTML report includes these views:

- **See the results** (visual scenarios): the reference picture, then every attempt's picture with a PASS or FAIL badge
- **Leaderboard**: ranks agents by solve rate (with a 95% interval), hidden test pass rate, median duration, reported tokens and cost, web lookups and failure breakdown. With `--repeat` above `1` it adds *Solved every run* (pass^k), *Solved at least once* (pass@k), *Same result every run*, flaky scenarios, and cost and time per solved task
- **Scenario matrix**: compares per-scenario solve counts and median durations across agents, linking directly to each attempt
- **Every attempt**: displays failing hidden test names, syntax-highlighted `git` diffs, the tail of agent output logs, exit codes, and a warning if the agent edited visible test files

Faultline Bench classifies every attempt into one of 6 outcomes:

| Category | Label | Meaning |
| --- | --- | --- |
| `passed` | Passed | All hidden tests ran and passed |
| `tests_failed` | Wrong behavior (tests fail) | Agent modified files and hidden tests ran, with at least 1 failure |
| `broken_code` | Code does not load / tests crash | Agent modified files, but hidden tests crashed or timed out |
| `no_changes` | Made no changes | Agent exited with code `0`, reported no error, and modified no files |
| `agent_error` | Agent crashed or refused | Agent exited non-zero, or its CLI reported an error, and it modified no files; the reason appears in the console and `results.json` |
| `timeout` | Timed out | Agent exceeded the per-task timeout and terminated |

## Keeping agents from looking up answers

The prompt does not name Faultline or say it is a test, the workspace folder and its git history use neutral names, and the prompt asks agents not to search the web. Where an agent CLI has a verified switch to turn off its web tools (currently Claude Code), Faultline uses it. Every attempt's output is also scanned for web tool calls and download commands; an attempt that looked something up gets a *looked up the web* badge and counts in the leaderboard's *Web lookups* column.

## Local execution and privacy

Faultline Bench itself has no accounts and no telemetry, and it uploads nothing. The agent CLIs you select send the scenario code to their own AI providers, as they normally do.

## License and prior art credits

Faultline Bench has zero runtime dependencies and uses the MIT license in [LICENSE](LICENSE). See [NOTICE.md](NOTICE.md) for prior-art acknowledgments and details on the CLI flags and usage formats studied from other open-source benchmarks.
