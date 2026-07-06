# Project Custom Subagents

This directory defines project-scoped Codex custom agents for the mobile image
histogram course project.

Codex discovers custom agents from `.codex/agents/*.toml`. Each file defines one
agent with a focused role, description, and developer instructions. These agents
are intended for explicit subagent workflows, especially read-heavy exploration,
review, testing, and evidence collection.

## Agent Roster

| Agent | Use for |
| --- | --- |
| `assignment-guardian` | Scope control, assignment mapping, task-list impact, acceptance evidence |
| `mobile-shell-builder` | Android WebView shell, local asset loading, image selection, APK path |
| `h5-histogram-algorithmist` | Canvas pixels, grayscale formula, 256 bins, 0-100 normalization, 256x100 drawing |
| `performance-evidence-analyst` | Timing boundary, benchmark rows, 300ms target evidence |
| `qa-acceptance-verifier` | Offline demo verification, algorithm fixtures, APK/install acceptance checks |
| `course-delivery-writer` | Requirements/design/test/user-guide/report/PPT consistency |

## How To Ask Codex To Use Them

Use explicit delegation. Good prompts:

```text
Use subagents for the next implementation plan. Spawn assignment-guardian,
mobile-shell-builder, and h5-histogram-algorithmist. Wait for all three, then
summarize a phased plan mapped to T-10 through T-20.
```

```text
Review the current implementation with subagents. Spawn h5-histogram-algorithmist
for algorithm correctness, qa-acceptance-verifier for acceptance gaps, and
performance-evidence-analyst for timing boundaries. Wait for all and summarize
findings by severity.
```

```text
Prepare final delivery with subagents. Spawn course-delivery-writer and
qa-acceptance-verifier. Wait for both, then list missing evidence before I submit.
```

## Operating Rules

- Subagents are not automatic. Ask for them explicitly.
- Use parallel subagents mostly for reading, reviewing, testing, and evidence
  gathering.
- For write-heavy work, keep one primary implementer and use other agents as
  reviewers to reduce edit conflicts.
- Keep all agents aligned with `AGENTS.md` and the Histogram Delivery Harness.
- Do not use subagents to bypass approvals, sandbox rules, or project scope.

## Source Notes

This setup follows the Codex custom agent shape described in the official Codex
manual: project-scoped agents live under `.codex/agents/`, and each TOML file
defines `name`, `description`, and `developer_instructions`.
