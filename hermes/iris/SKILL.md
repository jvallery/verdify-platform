---
name: greenhouse-planning-mcp
description: Verdify Iris daily review with audited MCP tools (the planner writes no climate value)
---

Use the bare skill name `greenhouse-planning-mcp` with `skill_view`. Read the wake-up's record first. Use the configured Verdify MCP allowlist only; never use a terminal, raw SQL or arbitrary filesystem access.

Required references:
- references/greenhouse-playbook.md (horticulture and greenhouse physics; its tuning workflows are retired with the plan cycle)
- references/full-plan-payload-preflight.md (the review checklist)

A review is done when `review_write` accepted it once for the wake-up's run id.
