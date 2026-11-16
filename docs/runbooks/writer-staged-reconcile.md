# Device writer: plain convergence (VD-62)

The ingestor is the only device writer. Since VD-62 its dispatcher converges
the controller to the desired values in ordinary paced passes. Nothing waits
for an approval file, a preview, halted-run custody or a forward handoff, and
no ordinary pass logs `blocked_stage` or `blocked_broad_restore`. The old
approval, rollback, recovered-confirmation and confirmed-halt procedures and
`scripts/prepare-writer-stage.py` are retired. Staging survives only in the C1
qualification overlay (below).

## How a pass converges

1. The dispatcher resolves every desired value (plan, band and defaults)
   through the unchanged fences: the registry clamp, the physics invariants,
   the VPD-high moisture guardrails, heap deferral, the writer Lease and
   `VERDIFY_DEVICE_WRITE_ENABLED`. A value is a change when it differs from the
   last push or from its current-generation cfg readback.
2. The drift probe and the C1 overlay see the full change set first. When
   neither owns the pass, the ordinary pass sends at most
   `MAX_RECONNECT_COMMANDS = 12` commands. When more than 12 changes remain,
   they go oldest difference first (`shared.delivery_differing_since`), then by
   parameter name. A value already sent on this connection that the controller
   has not taken goes after every value not yet sent (least recently sent
   first), so resends never crowd out new values.
3. A value sent on the same connection in the last 90 s whose readback has not
   caught up is not sent again (the `cfg_*` sensors publish every 30 s), so a
   woken pass never repeats the batch it just sent. A new desired value for
   that parameter is a new change and goes out in the next pass.
4. After a pass with no failed command the dispatcher completes its trigger
   (which also stops the next pass from reseeding the last-push cache from
   readbacks that have not caught up) and, while changes not yet sent on this
   connection remain, wakes the next pass on the task loop's next tick (the
   scheduler still starts a woken pass at most every 30 s), logging
   `action=wake`. When every remaining change awaits its readback, or was
   already sent on this connection and not taken, it does not wake (it logs
   `action=wait` when such resends are left over): those wait for the 300 s
   cadence or a readback drift, so values the controller never takes cannot
   keep it waking, however many there are or however slowly passes run.
5. A failed command leaves the trigger incomplete as before; the next pass runs
   on the 300 s cadence or the next drift. A reconnect reseeds the last-push
   cache from that connection's readbacks, so values a reboot reset go out
   again in batches of 12.

Each command keeps the `requested` → `queued` → `sent` → `confirmed`
lifecycle in `setpoint_changes`, and the ingestor's readback callbacks confirm
it. The `setpoint_changes` NOTIFY fast path is not used for convergence.

## Stage record

The dispatcher writes one `system_state` row with entity `dispatcher_stage`
whenever its stage changes (and once after each ingestor start):

| Value | Meaning |
|---|---|
| `ordinary` | Nothing left over after this pass |
| `paced <sent>/<pending>` | This pass sent `<sent>` of `<pending>` changes, for example `paced 12/20`; the rest go in the next passes |
| `held:c1` | The C1 qualification overlay owns the pass |
| `held:heap` | Heap deferral held every command (rows `deferred_heap_pressure`) |
| `held:lease` | The writer Lease was not held, so no command could be sent |
| `held:drift_probe` | A drift-probe phase in flight held this pass (at most its 4-minute confirmation deadline) |
| `held:readbacks` | The connection's readback replay is incomplete, so nothing was computed or sent. Normal for a few minutes after a connect; an inventory that stays empty never completes |

```bash
scripts/verdify-db.sh prod -c "SELECT ts, value FROM system_state WHERE entity = 'dispatcher_stage' ORDER BY ts DESC LIMIT 10"
```

## Stuck-delivery alert

`alert_monitor` raises `setpoint_delivery_stuck` (category `system`, `sensor_id`
`dispatcher`) from database tables alone (#1636): for every parameter, the newest
value the host asked for (`setpoint_changes`, any source but `esp32`; a superseded
or cancelled newest request does not count) against the controller's newest
readback in `setpoint_snapshot`, with the snapshot confirmation's own tolerance
(1 %, or 1 s for the second-valued mister and fog settings). A value not taken yet
differs from the first request after the last confirmed one; a value taken and
then lost (a restart reverts what the controller does not keep) differs from the
first readback after the last one that matched. Lighting values, band anchors and
operator switches count like any other. It is a warning after 15 minutes and
critical (it pages) after 45: "N settings not reaching the controller since HH:MM
UTC", with `differing`, up to 20 `params` and `oldest_since`. Escalation re-opens
an acknowledged row, so the page is not lost to an earlier acknowledgement. It
resolves when nothing differs. No dispatcher stage exempts it (the `held:c1`
exemption is gone), and an ingestor restart cannot hide it; if the read fails, an
open row stays open. A parameter with no readback in the last day is not judged,
and neither are the legacy band scalars (`temp_low`, `temp_high`, `vpd_low`,
`vpd_high`) while `diagnostics.band_source` is `onchip_curve` or `corridor`: the
controller does not use them then, and a restart leaves them on boot values. A
controller restart opens nothing for a value the dispatcher re-pushes within 15
minutes.
The dashboard's stuck-delivery banner reads this alert.

`plan_not_delivered` (warning, interim until plans end in packages 4.2 and 5.1)
backs it up: the newest `setpoint_plan` is over 30 minutes old and no `plan` or
`band` request was confirmed after it.

When it fires, read `dispatcher_stage`, then the writer logs and the device:

```bash
kubectl -n verdify-prod logs deploy/verdify-ingestor -c ingestor --since=30m \
  | grep -E 'writer_reconcile|writer_dispatch|writer_delivery|dispatcher_stage|writer_drift_probe|c1_qualification'
scripts/k3s-smoke.sh device-monitor
```

Paced passes log `writer_reconcile reason=paced ... action=paced`, then
`action=wake` or `action=wait`; `writer_reconcile ... action=incomplete` and an open
`esp32_push_failed` alert name failed commands.

## Halted-run files

At start-up, before the task loop, the ingestor renames (never deletes) every
`writer-stage-*.json` file (state, approval, preview, recovery and their
receipts), `writer-policy-hold.json`, and a `writer-drift-state.json` that is
not `complete` together with `writer-drift-approval.json`, into
`/srv/verdify/state/archived/<UTC yyyymmddThhmmssZ>/` on the retained
`verdify-ingestor-state` PVC. It logs one `halted_run_archive` line per file.
Nothing reads these files after VD-62; keep them as history.

`overlays/prod` still sets `VERDIFY_AUTONOMOUS_POLICY_STAGING=1` for ingestor
images released before VD-62; VD-62 images ignore it. Remove it in a separate
change once the release pin carries VD-62.

```bash
kubectl -n verdify-prod exec deploy/verdify-ingestor -c ingestor -- ls -R /srv/verdify/state/archived
```

## Staging that remains: the C1 qualification overlay

The C1 qualification overlay (`docs/runbooks/c1-qualification-overlay.md`) and
its restore to the ordinary base still stage, through `c1_overlay.choose()`,
`physical_fence()` and `finish()` with their own worksheet and state files
(`c1-qualification-*.json`). Each of its stages stays at or below 12 commands
and waits for durable confirmation. While it owns a pass the stage reads
`held:c1`.

## Verify after a release

After the ingestor restarts on a VD-62 image, with no operator action:

- `v_data_pipeline_health` `setpoints` age falls below 600 s;
- `dispatcher_stage` reads `ordinary` once convergence finishes;
- the ingestor logs no `blocked_stage` or `blocked_broad_restore` line:

```bash
kubectl -n verdify-prod logs deploy/verdify-ingestor -c ingestor --since=2h \
  | grep -cE 'action=(blocked_stage|blocked_broad_restore)'   # expect 0
```
