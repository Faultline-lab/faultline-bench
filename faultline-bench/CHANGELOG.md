# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-27

### Added

- Parser, harness, CLI, report and runner tests, run by `npm test`.
- CI on Ubuntu, macOS and Windows with Node 18.20, 20 and 22.
- README covering install, usage, outcomes and privacy.
- Package metadata: author, homepage and repository.
- Startup check for Node 18.19 or later.
- Startup check for `git`, with a clear message when it is missing.

### Changed

- Agent failures are classified as `agent_error` and record the reason.
- The agy agent's timeout follows `--timeout`.
- The HTML report gives each repeat its own anchor and links logs with `file://` URLs.
- The report shows each agent's final message instead of raw JSON output; the full raw log stays linked.
- `faultline run` refuses to start real agents with auto-approve when not attached to a terminal unless `--yes` is given (`oracle` and `noop` still run).
- Options that need a value (`--agents`, `--timeout`, ...) now fail with a clear message instead of swallowing the next flag; unknown short flags are reported as options.
- A `.gitignore` in every scenario keeps `node_modules` out of diffs and change counts.
- `CHANGELOG.md` ships in the package, and a tag-driven release workflow publishes to npm with provenance.

### Fixed

- Ctrl+C and SIGTERM now clean up temporary work directories and never delete a
  user-supplied `--workdir`.
- The report no longer links to a matrix cell for pairs with no attempts.
- OpenCode now works in the scenario copy: it takes its project directory from `PWD`, so agents are started with `PWD` set to the workspace. Before this, it worked in the directory Faultline was started from and never changed the scenario.
- On Windows, CLIs installed as PowerShell `.cmd` shims (such as `cursor-agent`) are launched without `cmd.exe` quoting, which broke the prompt.
- An agent that cannot be started is reported as `agent could not be started: <reason>`.

## [0.1.0]

### Added

- Initial release.

[Unreleased]: https://github.com/Faultline-lab/faultline-bench/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Faultline-lab/faultline-bench/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Faultline-lab/faultline-bench/releases/tag/v0.1.0
