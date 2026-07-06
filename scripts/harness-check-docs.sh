#!/usr/bin/env bash
set -euo pipefail

required_files=(
  "AGENTS.md"
  "README.md"
  "package.json"
  ".agent/routebook/task-types.json"
  ".agent/tmp/.gitkeep"
  "docs/研发/tasks-list.md"
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
  "tasks-list.md"
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

check_intake_lane() {
  local request="$1"
  local expected_lane="$2"

  node scripts/harness-intake.mjs --dry-run --expect-lane "$expected_lane" --text "$request" >/dev/null
}

check_intake_lane "准备做技术设计，放在 docs/研发/tech-design.md，主流程技术方案为主，性能优化不作为主要流程" "course_docs"
check_intake_lane "同步其他文档状态，不要把性能优化作为主要流程点，性能优化后续单独文档推进" "course_docs"
check_intake_lane "T-13 完成了，更新 tasks-list.md 的任务状态" "course_docs"
check_intake_lane "T-20 被阻塞了，先同步任务清单里的 blocked 状态" "course_docs"
check_intake_lane "优化直方图生成速度，准备 300ms 以内的测试证据和 benchmark 记录" "performance_evidence"
check_intake_lane "实现灰度化公式和 256x100 直方图绘制" "histogram_algorithm"

if git ls-files '.agent/tmp/current-work-order.md' | grep -q .; then
  echo "Generated work orders should not be tracked: .agent/tmp/current-work-order.md"
  exit 1
fi

echo "Harness document check passed."
