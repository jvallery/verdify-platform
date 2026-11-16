#!/usr/bin/env python3
"""planner-dry: render the daily review's prompt locally, with no database and no API call (climate refactor 5.1).

Run via `make planner-dry`. It renders the daily and the manual review from tests/fixtures/review_context.json and
an empty context, prints the size of each and fails (exit 1) when an invariant breaks:

  1. each prompt names its run id, the review date and review_write, and says no climate value is written;
  2. it carries the band price list (both seasons, every row of plan section 5.7) and every record column;
  3. it never names a retired plan tool (set_plan, set_tunable, acknowledge_trigger, plan_evaluate);
  4. it stays under PROMPT_MAX_CHARS, so a review cannot crowd the model's context.
"""

from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ingestor"))

import review_prompt as rp  # noqa: E402

PROMPT_MAX_CHARS = 40_000
RETIRED_TOOLS = ("set_plan", "set_tunable", "acknowledge_trigger", "plan_evaluate", "plan_status")


def check(prompt: str, run_id: str, review_date: date) -> list[str]:
    problems = []
    for needle in (run_id, review_date.isoformat(), "review_write", "No agent writes a climate value"):
        if needle not in prompt:
            problems.append(f"missing {needle!r}")
    for row in (*rp.PRICE_LIST_YEAR, *rp.PRICE_LIST_WINTER):
        if "| " + " | ".join(row) + " |" not in prompt:
            problems.append(f"price list row missing: {row[0]}")
    for tool in RETIRED_TOOLS:
        if tool in prompt:
            problems.append(f"names retired tool {tool}")
    if len(prompt) > PROMPT_MAX_CHARS:
        problems.append(f"{len(prompt)} chars > {PROMPT_MAX_CHARS}")
    return problems


def main() -> int:
    fixture = json.loads((ROOT / "tests/fixtures/review_context.json").read_text())
    failures = 0
    for kind, context in (("daily", fixture), ("manual", fixture), ("daily", {})):
        run_id = "00000000-0000-4000-8000-000000000001"
        review_date = date(2026, 11, 16)
        prompt = rp.build_review_prompt(run_id=run_id, kind=kind, review_date=review_date, context=context)
        if context:
            missing = [c for c in rp.RECORD_COLUMNS if c not in prompt]
            if missing:
                print(f"FAIL {kind}: record columns missing {missing}")
                failures += 1
        problems = check(prompt, run_id, review_date)
        label = f"{kind}{'' if context else ' (empty context)'}"
        if problems:
            failures += 1
            print(f"FAIL {label}: {'; '.join(problems)}")
        else:
            print(f"ok   {label}: {len(prompt)} chars (~{len(prompt) // 4} tokens)")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
