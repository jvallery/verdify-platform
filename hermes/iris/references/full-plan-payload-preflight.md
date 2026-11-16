# Review checklist

The plan cycle is retired (climate refactor, 2026-11-16): there is no `set_plan`, `set_tunable` or
`acknowledge_trigger`, and no plan to validate. This file keeps its name so an installed skill that lists it still
resolves. Use it through `skill_view(name="greenhouse-planning-mcp", file_path="references/full-plan-payload-preflight.md")`.

1. Read the wake-up: the record of the reviewed day and the seven days before, the band in force, the law's drying
   record, alerts, the forecast and the band price list.
2. Read more only where a question stays open (`history`, `alerts`, the irrigation reads, `scorecard`, `lessons_search`).
3. Write the review in plain text, at most 4000 characters: time in band against the seven days before; relay starts,
   run hours, electricity, gas and water; drying wanted and refused, by reason; anything the owner must act on.
4. Propose at most one band edit, only one the price list prices, with its values, the price-list row quoted as written
   and the season. The owner applies it or does not.
5. Call `review_write(trigger_id=<run id>, summary=..., band_proposal=...)` exactly once and read its result.
