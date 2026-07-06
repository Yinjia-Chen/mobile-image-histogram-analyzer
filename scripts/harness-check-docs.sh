#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "AGENTS.md"
  "README.md"
  "package.json"
  ".agent/routebook/task-types.json"
  ".agent/tmp/.gitkeep"
  "docs/harness/histogram-delivery-harness.md"
  "docs/harness/skills/index.md"
  "docs/harness/skills/assignment-contract.md"
  "docs/harness/skills/histogram-algorithm.md"
  "docs/harness/skills/mobile-webview-shell.md"
  "docs/harness/skills/performance-evidence.md"
  "docs/harness/skills/course-delivery-docs.md"
  "docs/harness/skills/presentation-acceptance.md"
  "docs/harness/cases/good/offline-apk-demo-first.md"
  "docs/harness/cases/bad/backend-scope-creep.md"
  "docs/harness/cases/bad/pretty-chart-wrong-scale.md"
  "scripts/harness-intake.mjs"
  "scripts/harness-check-docs.sh"
  "scripts/harness-verify.sh"
)

for file in "${required_files[@]}"; do
  if [ ! -f "$file" ]; then
    echo "Missing harness file: $file"
    exit 1
  fi
done

required_readme_terms=(
  "Android WebView"
  "H5 Canvas"
  "256x100"
  "300ms"
  "gray = red * 0.299 + green * 0.587 + blue * 0.114"
)

for term in "${required_readme_terms[@]}"; do
  if ! grep -Fq "$term" README.md; then
    echo "README.md missing assignment-critical term: $term"
    exit 1
  fi
done

required_lanes=(
  "assignment_contract"
  "histogram_algorithm"
  "mobile_shell"
  "performance_evidence"
  "course_docs"
  "presentation_acceptance"
)

for lane in "${required_lanes[@]}"; do
  if ! grep -Fq "\"$lane\"" .agent/routebook/task-types.json; then
    echo "Routebook missing lane: $lane"
    exit 1
  fi
done

if git ls-files '.agent/tmp/current-work-order.md' | grep -q .; then
  echo "Generated work orders should not be tracked: .agent/tmp/current-work-order.md"
  exit 1
fi

echo "Harness document check passed."

