# The daily reviewer: inputs, outputs and what it cannot write

Iris, the Hermes agent `verdify-hermes-iris`, is the greenhouse's daily reviewer. It is woken once a day and on
a manual request, reads the record of a day, and stores one review. It writes no climate value: the controller
decides climate alone with the band-edge law and its compiled constants
([plan](../design/climate-refactor-plan-2026-11-15.md) sections 3, 4 and 7; issues #1646, #1659, #1660, #1661).
The settings left on the host are the operator's: the house band and the drying cost limit (owner only, from the
dashboard), the operator switches, irrigation and lighting. An agent, Iris included, may write only the operator
switches.

- Behaviour and wording: [greenhouse-playbook.md](greenhouse-playbook.md) (the file keeps its old name), packaged
  into the `greenhouse-planning-mcp` skill by `scripts/gen-iris-inventory-cm.py`
  (`deploy/k8s/components/hermes-iris/iris-inventory.yaml`).
- Background facts about the house: [greenhouse-reference.md](greenhouse-reference.md).
- Prompt: `ingestor/review_prompt.py` (`REVIEW_PROMPT_VERSION`). `make planner-dry` renders it from a fixture with
  no database and no model call and checks its invariants.
- Delivery and context: `ingestor/tasks/heartbeat.py` (the `daily_review` task).
- Tools: `mcp/server.py` (`review_run`, `review_write`) and `verdify_schemas/review.py`.
- Table: `planner_review`, migration `db/migrations/313-planner-review.sql`.

---

## 1. When it runs

The ingestor's `daily_review` task runs every 60 s. Two kinds of request exist, and nothing else wakes Iris:

| Kind | Requested by | When |
|---|---|---|
| `daily` | the ingestor | at or after 07:00 America/Denver, when no `daily` row exists for yesterday; it reviews yesterday. The daily record of yesterday is final after its 00:32 refresh. One daily row per day (unique index on `review_date` where `kind = 'daily'`). |
| `manual` | MCP `review_run(review_date?)`, admin audience only | on request; the ingestor delivers it within a minute. `review_date` defaults to yesterday and may not be in the future. |

Delivery posts the run to Hermes (`POST /v1/runs`, the Iris key already mounted in the ingestor) and polls its
status and token use. A failed delivery is retried every 10 minutes, at most 6 attempts, then the row is
`failed` with `attempts_exhausted`. A delivered run with no terminal status after 60 minutes is
`hermes_run_failed`. The table is the state: a restarted ingestor carries on from it.

The `irrigation_changed` and `desired_state_changed` notifications wake the ingestor's irrigation sync and the
dispatcher, never Iris. With one review a day, Iris acts on irrigation once a day and on a manual request (plan
section 7).

## 2. Inputs

The context is built in Python by `gather_review_context` in `ingestor/tasks/heartbeat.py`. Each part degrades to
"not available" on its own.

| Input | Source | Notes |
|---|---|---|
| The daily record | `v_daily_record`, the reviewed day and the 7 days before it | served-band compliance, starts and run hours per relay, utilities (kWh, therms, water), drying figures, lost-OFF hours (plan section 10; #1668) |
| The house band in force | `crop_band_anchors`, the 16 edge anchors as the dispatcher reads them | |
| The law's state over the day | `system_state` `climate_law_state`: minutes with drying wanted, split by the refusal reason `dr`; the newest `climate_drying_meter` | "not reported" when the day has no state rows |
| Alerts | `alert_log`, the last 24 h by type and severity, with the count still open | |
| Forecast | `weather_forecast`, the next 72 h, one line per day (min and max temperature, min RH) | |
| Band price list | plan section 5.7, committed text in the prompt | a proposal quotes its simulated price from it |

During the run Iris may read more through its MCP tools: `climate`, `history`, `forecast`, `scorecard`,
`equipment_state`, `get_setpoints`, `alerts`, `settings`, `activity`, `irrigation_status`, `irrigation_schedule`,
`irrigation_history`, `lessons`, `lessons_search`, `knowledge_search` and the crop and position reads.
`get_setpoints` takes the served band from `fn_band_setpoints`, the one band source for host readers.

Its toolset is the `include` list in `deploy/k8s/components/hermes-iris/hermes-config.yaml`: 28 tools, the reads,
the irrigation tools, the lessons and `review_write`. It has no `query`, no `set_setting` and no `review_run`.

## 3. Outputs

### 3.1 The review

`review_write(trigger_id, summary, band_proposal?)` stores the review on the open row whose `run_id` equals
`trigger_id` (the run id from the wake-up's audit header), once. It writes no setting and no band. A second call, or
an unknown run id, answers `not_found`.

`planner_review` (migration 313), one row per request:

| Column | Meaning |
|---|---|
| `run_id` | the review's run id, unique; passed by Iris as `trigger_id` to `review_write` and to the irrigation writes |
| `kind`, `review_date` | `daily` or `manual`; the America/Denver day reviewed |
| `requested_at`, `requested_by` | `ingestor` for a daily row, the MCP caller for a manual one |
| `status` | `requested`, `delivered`, `written` or `failed` |
| `attempts`, `delivered_at`, `hermes_run_id`, `gateway_status` | delivery to Hermes |
| `failure` | a fixed class only: `gateway_rejected`, `gateway_unreachable`, `hermes_run_failed`, `hermes_run_cancelled`, `completed_without_review`, `attempts_exhausted` |
| `run_finished_at`, `input_tokens`, `output_tokens`, `total_tokens` | from the Hermes run status (#1661) |
| `written_at`, `summary` | the review (1 to 4000 characters) |
| `band_proposal` | optional: `{"anchors": {"<band row>": <value>, ...}, "price": "<price-list rows quoted>", "reason": "<why>"}` |

A band proposal is a proposal only. Its anchors must be band rows within their registry range
(`verdify_schemas/review.py`). The owner applies it in the dashboard's band editor, or does not; no tool applies
it.

### 3.2 Irrigation

Iris keeps the irrigation tools every agent uses, with the dashboard's checks
([irrigation section 8.2](../design/dashboard/irrigation.md#82-mcp-tools-one-surface-for-every-agent)): the writes
`irrigation_schedule_set`, `irrigation_line_set`, `irrigation_run`, `irrigation_stop` and
`irrigation_clear_fault`, and the reads `irrigation_status`, `irrigation_schedule` and `irrigation_history`. The
writes that take `trigger_id` and `planner_instance` only log them; the review passes its own run id. An item a
person marked manual is refused to Iris with `manual` and stays as the person left it; other agents may still
change it or clear the mark, logged with who did it (last write wins; plan section 12.4).

### 3.3 Memory

`planner_lessons` is the reviewer's memory, read with `lessons` and `lessons_search` and kept with
`lessons_manage`. Lessons are not injected into the context.

## 4. What the reviewer and other agents cannot write

- **Climate values.** No MCP tool writes one. `set_setting` is not in Iris's audience or toolset; for a named
  agent it changes only an operator switch (`AGENT_SETTABLE_PARAMS`: the occupancy inhibit and the two light
  circuits' out-of-service switches) and answers `forbidden` for every other row, the band rows and the drying cost
  limit included (`tests/test_dashboard_db_mcp_settings.py`, `tests/test_law_owner_only_settings.py`).
- **The band and the drying cost limit.** Owner only (`OWNER_ONLY_PARAMS`): written only from the dashboard under
  a signed-in operator. The house band has no agent write tool; `band_profile` and `band_profile_preview` read it
  and evaluate a draft.
- **Plans.** Nothing writes `plan_journal`, `setpoint_plan`, `plan_delivery_log` or `planner_trigger_ledger`, every
  `setpoint_plan` row is inactive, and no read or push treats a plan as in force. The tables stay because the public
  site reads them (plan section 8.10).

## 5. Health

`daily_review_missed` (warning, `sensor_id = 'system.daily_review'`) opens when, at or after 10:00 America/Denver,
no daily row for yesterday has `status = 'written'`. Its details carry the row's `review_date`, `status`,
`attempts` and `failure`. It resolves when the review is written, a manual review of the same day included. The
dashboard's Iris tile on `/now` reads it: `ok` with no open alert, `failed` for a failed review, `missed`
otherwise.

Read the newest reviews from any kubectl host:

```bash
scripts/verdify-db.sh prod -c "SELECT kind, review_date, status, attempts, failure, written_at,
  band_proposal IS NOT NULL AS proposal, total_tokens FROM planner_review ORDER BY requested_at DESC LIMIT 7;"
```

Request a review again for a day (admin audience): MCP `review_run(review_date='YYYY-MM-DD')`, then read the row
above until it is `written`.
