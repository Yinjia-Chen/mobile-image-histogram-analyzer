# Project Skills Index

These skills are not a universal knowledge base. They are compact onboarding
guides for agents working on this exact course project.

Run intake first:

```bash
npm run harness:intake -- --text "<request>"
```

Then read the selected skills and related cases from the generated work order.

## Active Skills

| Skill | Use When | Protects |
| --- | --- | --- |
| `assignment-contract.md` | task requirements, scope, grading, deadlines, deliverables | course-fit and scope control |
| `histogram-algorithm.md` | grayscale formula, 256 bins, normalization, Canvas histogram, accuracy | result correctness |
| `mobile-webview-shell.md` | Android shell, WebView, APK, offline local loading, permissions | installable mobile delivery |
| `performance-evidence.md` | timing, benchmark design, optimization, 300ms target | measurable performance proof |
| `course-delivery-docs.md` | requirements/design/test/report/PPT/user guide | document consistency and grading |
| `presentation-acceptance.md` | demo path, acceptance checklist, defense script | smooth final demonstration |

## Selection Rules

- Prefer one primary skill and at most two supporting skills.
- If algorithm code and performance timing both change, read
  `histogram-algorithm.md` before `performance-evidence.md`.
- If Android packaging and H5 code both change, keep the boundary clear:
  Android owns the shell and local asset bridge; H5 owns image processing.
- If documents mention implemented behavior, verify the source or evidence first.

## Default Verification

```bash
npm run harness:verify
```

Implementation tasks may require extra checks named by the selected skill.

