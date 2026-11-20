# Notices

Faultline Bench is an independent implementation. It contains no source code, task content or datasets
copied from other projects, and it has no runtime dependencies.

The six built-in scenarios (starting code, hidden tests and reference solutions) were written for
Faultline Bench and are covered by this project's MIT license.

## Prior art we studied

We read these projects to learn how other benchmarks drive agent CLIs and parse their output. Command-line
flags and output formats of third-party CLIs are interface facts, not copied code. We thank the authors.

| Project | License | What we learned |
|---|---|---|
| [aws-samples/sample-agent-cost-bench](https://github.com/aws-samples/sample-agent-cost-bench) | MIT-0 (LICENSE file); pyproject says Apache-2.0 | Headless flags per CLI, JSON usage formats for Codex, OpenCode and Antigravity |
| [minghinmatthewlam/openbench](https://github.com/minghinmatthewlam/openbench) | MIT | Codex needs a closed stdin and `--skip-git-repo-check` in temp folders |
| [UiPath/coder_eval](https://github.com/UiPath/coder_eval) | Apache-2.0 | `opencode run` leaves a child process holding stdout open |
| [aabbcdl/AgentArena](https://github.com/aabbcdl/AgentArena) | MIT (LICENSE file); package.json says ISC | Local result inspection UX |
| [AniruddhaPKawarase/terminal-agent-bench](https://github.com/AniruddhaPKawarase/terminal-agent-bench) | MIT per pyproject (no LICENSE file) | Task layout with hidden tests |
| [usamadar/coding-agent-benchmark](https://github.com/usamadar/coding-agent-benchmark) | MIT | General reference |
| [codecrafters-io/ccbench](https://github.com/codecrafters-io/ccbench) | No license file (all rights reserved) | Read only; nothing reused |
