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

### Fixed

- Ctrl+C and SIGTERM now clean up temporary work directories and never delete a
  user-supplied `--workdir`.
- The report no longer links to a matrix cell for pairs with no attempts.

## [0.1.0]

### Added

- Initial release.

[Unreleased]: https://github.com/Faultline-lab/faultline-bench/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Faultline-lab/faultline-bench/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Faultline-lab/faultline-bench/releases/tag/v0.1.0
