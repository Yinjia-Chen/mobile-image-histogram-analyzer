# Agent Guide - Histogram Delivery Harness

This repository uses a project-native agent workflow called **Histogram Delivery
Harness**. Its purpose is to help agents deliver the course project, not to
enforce a generic software-process template.

If another harness document conflicts with this file, follow this file first.

## Project Identity

This is a software-practice course project for a **mobile image histogram
analysis system**.

The core deliverable is an Android APK that runs offline and uses an Android
WebView shell plus H5 Canvas code to:

- select a local image;
- preview the image;
- compute grayscale values with `gray = red * 0.299 + green * 0.587 + blue * 0.114`;
- count all grayscale values from `0` to `255`;
- normalize counts to a `0-100` vertical range;
- draw a `256x100` black-and-white histogram;
- display generation time and keep the target below `300ms` where practical.

## Read Before Editing

Before non-trivial edits, read:

- `README.md`
- `docs/harness/histogram-delivery-harness.md`
- `docs/harness/skills/index.md`
- the current work order at `.agent/tmp/current-work-order.md` when it exists

Task-specific skills live under `docs/harness/skills/`. Read only the selected
skills unless the task clearly expands.

## Intake Workflow

For a new task, run:

```bash
npm run harness:intake -- --text "<latest user request>"
```

If no `--text` is supplied, the script reads `.agent/tmp/latest-request.md`.
It writes `.agent/tmp/current-work-order.md`.

Before editing, use the work order to identify:

- delivery lane;
- selected skills;
- relevant cases;
- files to inspect;
- proof commands or evidence to collect;
- scope boundaries.

## Delivery Lanes

Use the lane selected by intake:

- `assignment_contract`: task requirements, scope, grading, or deliverables.
- `histogram_algorithm`: grayscale formula, histogram statistics, normalization,
  Canvas drawing, or result accuracy.
- `mobile_shell`: Android WebView shell, APK packaging, local asset loading, or
  Android permissions.
- `performance_evidence`: timing, benchmark tables, image-size comparison,
  optimization proof, or the `300ms` target.
- `course_docs`: requirement/design/test/user-guide/PPT/report deliverables.
- `presentation_acceptance`: demo script, acceptance checklist, APK handoff, or
  defense material.
- `general_project`: small edits that do not touch a specialized lane.

## Hard Boundaries

- Do not add backend, database, login, cloud upload, or server deployment unless
  the user explicitly changes project scope.
- Do not replace the required grayscale formula with another formula for
  convenience or visual preference.
- Do not draw a visually pleasing chart that is not exactly based on 256 bins
  normalized to a `0-100` height.
- Do not hide slow performance by timing only the draw call while excluding
  pixel read, grayscale calculation, bin counting, normalization, and histogram
  rendering.
- Do not make the demo depend on network access.
- Do not let documentation claim a feature, optimization, APK, or test result
  that the repository cannot support with source files or recorded evidence.

## Verification

For harness or documentation changes:

```bash
npm run harness:verify
```

For implementation changes, also run the project-specific checks named by the
selected skill. If Android or web build scripts are added later, wire them into
`scripts/harness-verify.sh`.

## Evidence Discipline

This project is graded by working output, documents, team process, and defense.
When adding a feature or optimization, keep enough evidence for the final
report:

- input image type or size;
- device or emulator used;
- measured time;
- baseline versus optimized result when relevant;
- known limitations.

Evidence belongs in docs or test reports, not only in chat.

