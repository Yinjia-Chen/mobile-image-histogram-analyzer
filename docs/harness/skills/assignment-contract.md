---
name: assignment-contract
lane: assignment_contract
---

# Assignment Contract Skill

Use this when interpreting requirements, defining scope, or mapping work to
course deliverables.

## Source Of Truth

- `README.md`
- `docs/S0512333 软件开发实践3-考核作业要求即任务书-2026.docx`
- `docs/产物-项目选题报告.docx`

## Non-Negotiable Requirements

- Mobile program: Android APK is the chosen route.
- Input: user selects or uploads a local image.
- Output: `256x100` black-and-white histogram.
- Formula: `gray = red * 0.299 + green * 0.587 + blue * 0.114`.
- Performance: show histogram generation speed and aim for under `300ms`.
- Scoring cares about result accuracy and timing.

## Scope Guardrails

- Keep backend, login, database, and cloud storage out of scope.
- Treat extra features as optional only after the core demo path is stable.
- Favor demonstrable reliability over broad functionality.
- Keep final deliverables aligned with the course task: APK, source, documents,
  tests, usage guide, and defense material.

## Useful Output

When a task changes scope, leave a short note answering:

- Which task-book requirement does this support?
- Which deliverable will show it?
- What is intentionally out of scope?

