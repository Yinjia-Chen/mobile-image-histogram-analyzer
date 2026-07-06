# Histogram Delivery Harness

Histogram Delivery Harness is this repository's project-native agent pipeline.
It exists to move the course project from assignment requirements to a verifiable
Android APK and matching documentation.

It is intentionally local to this project. The harness optimizes for a small
team, a short course deadline, offline mobile execution, image-processing
correctness, performance evidence, and defense-ready documents.

## Operating Idea

The harness treats each request as a handoff inside a course project team:

```text
request
-> work order
-> task-list status check
-> delivery lane
-> selected project skills
-> focused implementation or document work
-> evidence collection
-> task-list update when completed or blocked
-> verification
-> optional doc/report update
```

The important artifact is the **work order**, not a generic task ticket. It
tells an agent which team lane it is serving and what evidence is needed for
course acceptance.

The companion progress ledger is `docs/研发/tasks-list.md`. When work completes
or becomes blocked, update the task list in the same turn so repository status
stays aligned with actual project progress.

## Why This Project Needs Its Own Harness

This project has unusual constraints compared with a normal web app:

- the final product is an Android APK, not a deployed website;
- the core algorithm is tiny but correctness-sensitive;
- the performance target is explicit: histogram generation should aim for
  `300ms` or less;
- the app must run offline and should not introduce server dependencies;
- documentation is worth a large part of the grade;
- the defense needs reproducible demo steps and explainable optimization
  evidence.

The harness therefore focuses on **assignment fidelity, algorithm proof,
mobile packaging, benchmark evidence, and document consistency**.

## Harness-Owned Files

- `AGENTS.md`: agent entry rules and hard boundaries.
- `.agent/routebook/task-types.json`: request-to-lane routing data.
- `.agent/tmp/latest-request.md`: optional raw request input.
- `.agent/tmp/current-work-order.md`: generated work order.
- `docs/研发/tasks-list.md`: living task ledger for progress and blockers.
- `docs/harness/skills/`: project-native skills.
- `docs/harness/cases/`: reusable good and bad cases.
- `scripts/harness-intake.mjs`: creates work orders.
- `scripts/harness-check-docs.sh`: checks harness and project-doc invariants.
- `scripts/harness-verify.sh`: current verification barrier.

## Team Lanes

### Assignment Contract

Owns task interpretation, grading constraints, scope control, and deliverable
mapping. This lane protects the project from drifting into a bigger but less
acceptable system.

### Histogram Algorithm

Owns grayscale calculation, 256-bin counting, normalization, Canvas drawing, and
accuracy checks. This lane protects the mathematical result.

### Mobile Shell

Owns Android WebView, APK packaging, offline local asset loading, file/image
selection, and Android-specific acceptance behavior.

### Performance Evidence

Owns timing boundaries, benchmark design, baseline/optimized comparison, and
defense-ready performance tables.

### Course Docs

Owns requirement, design, test, user-guide, report, and PPT consistency. This
lane prevents unsupported claims and keeps the course submission coherent.

### Presentation Acceptance

Owns the demo path: install APK, pick prepared images, generate histogram, show
time, explain correctness and optimization.

## Completion Standard

The harness is useful when it can answer:

1. Which course deliverable or app lane does this request affect?
2. Which project skill should an agent read before editing?
3. Which project-specific mistakes are known and avoidable?
4. What proof is needed: source check, APK behavior, benchmark, screenshot, or
   document update?
5. Which parts are out of scope for a course histogram APK?

## Verification Policy

Run:

```bash
npm run harness:verify
```

The first version verifies the harness itself and the assignment-critical README
claims. As `app/` and `web/` appear, extend the script with:

- Android build or Gradle checks;
- H5 syntax or unit tests;
- histogram algorithm fixture tests;
- offline boundary checks;
- benchmark evidence checks.
