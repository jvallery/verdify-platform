# Supporting material for the 2026-11-15 control review

This directory holds the simulator and the result files behind
[`../greenhouse-control-effectiveness-review-2026-11-15.md`](../greenhouse-control-effectiveness-review-2026-11-15.md)
and behind the climate refactor plan that followed it,
[`../../design/climate-refactor-plan-2026-11-15.md`](../../design/climate-refactor-plan-2026-11-15.md).
Nothing here is imported, run or deployed by the product or by CI, and it can be deleted without affecting the
product. Like the rest of `docs/`, the directory is in the ingestor image's build context, and the daily content
refresh indexes the Markdown files under `docs/`.

## What is here

| Path | What it is |
|---|---|
| `sim/physics.h` | Lumped model of the house: three thermal nodes, air moisture with a sorption buffer and a wet-surface reservoir, a two-stage furnace lag, sensor lags. |
| `sim/fit_kernel.cpp`, `sim/fit.py` | Fits the model to the one-minute record with the recorded relay states and weather (output-error fit over two-day free-running windows, every fourth week held out). |
| `sim/closed_loop.cpp` | Closed-loop simulator. It compiles the production control headers in `firmware/lib` unchanged (mode state machine, equipment resolution, relay-conflict arbiter) and drives them at 5 s steps against the model. The relay layer that lives in the ESPHome YAML (minimum on and off times, the fog and vent interlock, the water budget, a reduced centre-mister pulse timer) is re-implemented here. It also holds the two-axis controller tested in the review (`struct Kiss`) and a `replay` mode that scores the recorded data against today's band with the same metric code. |
| `sim/firmware-lib-sim.patch` | The furnace-threshold and dry-out changes to `firmware/lib` tested in sections 9.5 and 9.7 of the review, as a diff against commit `ae486ddb` (85 lines). It is applied to a copy; the repository's firmware is not changed. Each change is behind a compile-time macro that defaults to today's behaviour. |
| `sim/scenarios.py`, `sim/robustness.py`, `sim/validate.py`, `sim/runner.py` | Scenario groups, the one-factor robustness runs, the comparison with the record (four windows, and the record scored by month), and a thin wrapper around the binary. |
| `sim/night_checks.py` | Three checks behind section 9.7 that need minute traces: the October nights that still miss the dry-out goal after step 2, how far the closed house's dew point follows a warmer night, and the VPD that outdoor air alone would give. |
| `sim/report_tables.py` | Builds every simulation table in the review from the files in `results/`. |
| `sim/extract.sh`, `sim/prep.py`, `sim/make_forcing.py` | Read-only extraction of the production tables to CSV, the one-minute grid, and the binary forcing file. The extraction was run before migration 309; one of its queries reads `achievable_envelope`, which that migration dropped, and is marked in the script. The simulator needs only the climate, relay and energy extracts. |
| `sim/params_*.json`, `sim/spec_*.json` | Fitted parameters and the bounds they were fitted with. `W2` is the cold-season model (winter 2025-26 with autumn 2026), used for October to April in both variants with a moisture-source scale of 0.95 (A) or 1.4 (B). `W1` is the cool-season fit (2026-09-28 to 2026-11-16) and `S1` the summer fit (2026-06-01 to 2026-09-16); they are used for May to September in variants A and B. `params_W2_fan2low.json` is `W2` with the second fan's flow set to the `W1` value, for the both-fans scenarios of section 9.7. |
| `results/scenarios_base.csv` | The scenarios of the review's headline, ladder, band and night-goal tables (groups `base`, `final`, `strict`, `patch`, `settings`, `step1`, `night`), both model variants, by year, season and month. |
| `results/scenarios_matrix.csv` | The planner-tunable sweeps and the wet, heat and cool variations (groups `tuned_oat`, `tuned_random`, `wet`, `heat`, `cool`), by year and season. |
| `results/robustness.csv` | The current firmware and the two-axis controller under nine one-factor changes to the physics. |
| `results/robustness_night.csv` | The steps to the overnight dry-out goal with the flow of both fans halved and doubled. |
| `results/validation.csv` | Recorded versus simulated behaviour for four windows of 2026 (UTC): 1 Oct to 6 Nov 18:00, 6 Nov 18:00 to 15 Nov 17:00, 12 to 25 Jul, 25 Jul to 13 Aug. |
| `results/measured_monthly.csv` | Measured compliance by month, 2026-05-25 to 2026-11-15, against the served band of the time, with the out-of-band minutes split into capacity-limited and control-limited. |
| `results/replay_monthly.csv` | The same record scored by the simulator's metric code against today's band (`validate.py replay`). This is the definition the simulated figures use; table A2 of the review compares on it. |
| `results/night_checks.csv` | The output of `night_checks.py`: one value per check, model variant and item. |
| `sim/band_edge_controller.h` | The plan's control law, as a reference implementation of about 170 lines. Its default constants are the law of section 4 of the plan; the members marked as study options (the effect check, fog forced at the 100 F limit, fog as a cooling stage, a second fan while drying, pre-staging and the hold-back while sun is on the house or forecast, `hold_f` / `hold_stack` / `hold_dry`) are off by default and are not part of it. It is not product code. |
| `sim/closed_loop2.cpp` | `closed_loop.cpp` with the law as a further controller (`controller=edge`) and its relay layer, three mister zones, a runtime-balanced lead fan, a drying meter (hours, water and heat carried out), totals of relay starts and run hours, perfect-foresight pre-staging and hold-back ahead of sun (`pre.sun_wm2`, `pre.sun_h`; a horizon of 0 hours is the present sun alone), degraded modes (no outdoor data, a wrong clock, no clock) and a bias on the outdoor reading (`outdoor.bias_dp_f`, `outdoor.bias_t_f`). Its model of today's firmware differs from `closed_loop.cpp` in one thing: humidity misting has no daytime window and no temperature limit, because the firmware has none. `mister.min_temp_f=65`, `mister.start_offset_min=120` and `mister.drydown_min=180` give the model of `closed_loop.cpp` again. |
| `sim/scenarios_plan.py`, `sim/robustness_plan.py` | The plan's scenario groups (`ref`, `law`, `ldeg`, `lprice`, `lecon`, `lpre`, `lrev`) and its one-factor robustness runs, which add a dead electric heater and a dead furnace. Group `lrev` holds the follow-up runs: higher stop lines for drying on spare heat (`edge.dt_stop`), a higher cost-limited start line, the electric heater's lines alone 0.5 and 1 F lower, the hold-back on the present sun and on the forecast, and the night VPD edge. |
| `sim/plan_tables.py` | Builds every table in the plan from `results/plan_scenarios.csv` and `results/plan_robustness.csv`. |
| `results/plan_scenarios.csv` | Every scenario of the plan, both model variants, by year and season; today's firmware (`fw_live`) and the law (`law`) by month as well. |
| `results/plan_robustness.csv` | Today's firmware, the review's step 2, the law and the law with the drying cost limit at 0.7 kWh per kg, under fifteen one-factor changes to the physics, by year and season. |

In the result files `set` is the model variant (A or B, section 9.1 of the review) and `period` is `year`,
`winter` (October to April), `summer` (May to September) or a month. The three `dryout_*` columns score the
overnight dry-out goal of 2026-11-05 as the nightly grade does (migration 305), but from one-minute samples and
with today's band at every date: `dryout_nights` is the number of nights with at least 300 scored minutes
between 00:00 and 06:00 local time, `dryout_min_night` the mean minutes of those 360 at or above
`max(vpd_low, 0.74 kPa)`, and `dryout_pass_pct` the share of nights with at least 240.

## How to reproduce

All steps are single-process and small (under 1.5 GB of memory; the fits take one to three minutes, a one-year
closed-loop run takes about one second). The extraction reads the production database through
`scripts/verdify-db.sh` with a read-only transaction and a statement timeout; run it one query at a time.

```sh
# bash or sh (the compiler variables rely on word splitting)
cd docs/reviews/control-review-2026-11-15/sim
mkdir -p ../data && ./extract.sh            # CSV extracts into ../data (about 600 MB)
python prep.py && python make_forcing.py    # grid_1min.pkl, forcing.bin
clang++ -O2 -std=c++17 -shared -fPIC -o libfit.dylib fit_kernel.cpp
CXX="clang++ -O2 -std=c++17 -Wno-c99-designator"
$CXX -I ../../../../firmware/lib -o closed_loop closed_loop.cpp

# patched copy of firmware/lib for the section 9.5 scenarios
mkdir -p fwpatch/firmware && cp -R ../../../../firmware/lib fwpatch/firmware/lib
(cd fwpatch && patch -p1 < ../firmware-lib-sim.patch)
P="-I fwpatch/firmware/lib"
DRY="-DSIM_DRYOUT_START_MARGIN_F=0.5f -DSIM_DRYOUT_FREE_REST"
FUR="-DSIM_HEAT2_ON_ABOVE_LOW_F=0.5f -DSIM_HEAT2_OFF_SHIFT_F=0.5f"
$CXX $P $DRY -o closed_loop_p0 closed_loop.cpp                           # dry-out from band low + 0.5 F, free rest
$CXX $P $FUR -o closed_loop_p1 closed_loop.cpp                           # furnace on at low + 0.5 F, off at low + 3.0 F
$CXX $P $DRY $FUR -o closed_loop_p2 closed_loop.cpp                      # both
$CXX $P $DRY $FUR -DSIM_DRYOUT_DAY=1 -o closed_loop_p3 closed_loop.cpp   # both, dry-out by day as well
M=-DSIM_DRYOUT_TARGET_MARGIN_KPA                                         # the dry-out works to this much above the floor
$CXX $P $M=0.05f -o closed_loop_m05 closed_loop.cpp                      # today's rules, target floor + 0.05 kPa
$CXX $P $DRY $FUR -DSIM_DRYOUT_DAY=1 $M=0.05f -o closed_loop_p3m05 closed_loop.cpp
$CXX $P $DRY $FUR -DSIM_DRYOUT_DAY=1 $M=0.10f -o closed_loop_p3m10 closed_loop.cpp
F2=-DSIM_DRYOUT_BOTH_FANS=1                                              # both fans during a dry-out pulse
$CXX $P $DRY $FUR -DSIM_DRYOUT_DAY=1 $F2 -o closed_loop_p3f2 closed_loop.cpp
$CXX $P $DRY $FUR -DSIM_DRYOUT_DAY=1 $F2 $M=0.05f -o closed_loop_p3m05f2 closed_loop.cpp

python scenarios.py base base final strict patch settings step1 night   # results_base.csv
python scenarios.py matrix tuned_oat tuned_random wet heat cool
python robustness.py                                        # results_robust.csv
python robustness.py night                                  # results_robust_night.csv (needs the p3, p3m05 and p3f2 binaries)
python validate.py replay results_replay.csv                # the record by month, scored against today's band
python night_checks.py                                      # results_night_checks.csv (needs closed_loop_p3)
python report_tables.py ../results tables                   # the review's tables, from the committed results

# the climate refactor plan
$CXX -I ../../../../firmware/lib -o closed_loop2 closed_loop2.cpp
$CXX $P $DRY $FUR -DSIM_DRYOUT_DAY=1 -o closed_loop2_p3 closed_loop2.cpp # the review's step 2, for comparison
python scenarios_plan.py ref ref                            # results_ref.csv
python scenarios_plan.py law law ldeg                       # results_law.csv
python scenarios_plan.py lpp lprice lpre                    # results_lpp.csv
python scenarios_plan.py lecon lecon                        # results_lecon.csv
python scenarios_plan.py lrev lrev                          # results_lrev.csv
python robustness_plan.py                                   # results_robust3.csv
python plan_tables.py ../results tables_plan                # the plan's tables, from the committed results
```

`results/plan_scenarios.csv` is `results_ref.csv`, `results_law.csv`, `results_lpp.csv`, `results_lecon.csv` and
`results_lrev.csv` together, and `results/plan_robustness.csv` is `results_robust3.csv`, with the numbers rounded to five decimals
and the monthly rows kept only for `fw_live` and `law`. `plan_tables.py` run on them reproduces the plan's tables
exactly. A scenario of the plan is four runs of about one second; the whole set is 106 scenarios and 60
robustness runs.

The review's own result files (`scenarios_base.csv`, `scenarios_matrix.csv`, `robustness.csv`,
`robustness_night.csv`, `night_checks.csv`) were made with `closed_loop.cpp`, whose model of today's firmware
allows humidity misting only from 120 minutes after sunrise to 180 minutes before sunset and at 65 F or above.
The firmware has no such limits. `closed_loop2.cpp` and the plan's result files correct that: today's firmware
moves from 71.8 / 60.6 % to 70.5 / 59.6 % of the year in band and from 125 / 132 to 135 / 142 relay starts a
day, and the review's steps 1 and 2 move by 0.1 point or less. The review's files are kept as they were made,
and the review carries a dated note.

The pulse-end interlock fix of section 9.5 is a simulator option (`fw.rest_exempt=1` in `closed_loop.cpp`), not
part of the patch: it changes what the relay arbiter is told during the first seconds of the rest phase.

Scenario names follow the review's steps: `fw_live` is today's firmware and settings, `fw_dryout_600_300` step
1a, `fw_wet3_300` the three wetting constants alone, `fw_settings_300` step 1, `fwp_all_day_best` step 2 (with
no mister budget; `fwp_all_day_best_300` keeps the 300-gallon budget), `kiss_strict_minabove0.5` the two-axis
controller. Band scenarios pass the four anchors of an edge as `band.vpd_low=sunrise,noon,sunset,midnight`. The
`_cap30` scenarios repeat steps 1a and 1 with the dry-out's nightly energy cap at 30 kWh instead of 10. In the
`night` group, `_tlow_night+2` and `+4` raise the temperature low edge at the solar-midnight and sunrise anchors,
and `_target+0.05` and `+0.10` make the dry-out work to that much above the floor (the `m05`, `p3m05` and `p3m10`
binaries). `_fans2` runs both fans during a dry-out pulse (the `p3f2` and `p3m05f2` binaries); `_lowflow` repeats
it with `params_W2_fan2low.json`, the cold-season parameters with the second fan's flow at the cool-season fit's
value (0.077 kg/s instead of 0.318). `_nbias+0.05`, `+0.10` and `+0.15` set the controller's `night_vpd_bias_kpa`
(`band.night_vpd_bias_kpa` in `closed_loop.cpp`): it lifts the band the controller works to at night and leaves
the band the run is graded against alone, as in production, where the graded band is the dispatcher's audit row.
`_oct-apr` applies it from October to April only (`winter_cfg` in `scenarios.py`).

Rebuilt from these sources on 2026-11-15, the `patch` and `settings` groups matched `results/scenarios_base.csv`
to the rounding, and so did all six groups when the `dryout_*` columns were added. After the both-fans switch was
added to the patch, every patched binary was rebuilt and the `patch` and `night` groups came out identical. After
the night bias was added to `closed_loop.cpp`, all ten binaries were rebuilt and the `base`, `step1` and `night`
groups came out identical, as did `robustness.py night` and `night_checks.py`. The fits are reproduced with the
environment variables at the top of `fit.py` (`FIT_SPEC`, `FIT_FROM`, `FIT_TO`, `FIT_H_SLOW=2880`,
`FIT_H1_OFF_BEFORE=2026-05-23` for the cold-season model). The files in `results/` are the scenario outputs with
the numbers rounded to five decimals; `scenarios_matrix.csv` keeps the year and season rows only.

## Limits

- The model is fitted to this house as it was in 2026. The moisture source is not measured; the two model
  variants bracket the cool-season night humidity of the record (sections 9.1 and 9.2 of the review). Scored the
  same way, single months of the record differ from the simulated current firmware by up to 30 points.
- Mid-November to April results are projections: there is no record of today's house in winter with a working
  electric heater.
- Gas use is modelled from burner run time at the nameplate input; the furnace is not metered.
- Air exchange is the least certain part of the fit: the first fan's flow and the vent-only exchange end at the
  lower bound of all three fits, and the second fan's flow comes out between 0.08 and 0.32 kg/s.
  `results/robustness_night.csv` repeats the dry-out steps with the fan flow halved and doubled.
- The mister water budget is a setting the firmware clamps to 100 to 300 gallons. Scenarios with
  `mister.water_budget_gal=100000` therefore describe a firmware change, not a setting.
- The simulated gains are not validated in the house. Section 10.1 of the review is the first test.
- In `closed_loop2.cpp` the simulation of today's firmware always passes fan 1 as the lead fan, so its split of
  hours between the two fans means nothing; the plan's tables show the fans together. The law's lead fan is
  chosen by accumulated run seconds, as the plan specifies.
- The physics charges a running fan its full air exchange whether or not the vent is open. Today's firmware runs
  the lead fan with the vent closed in its cold-protection mode, so in the gas-outage case of
  `robustness_plan.py` its coldest temperature is not comparable with the law's. With the furnace's heat set to
  0.1 % the furnace column counts relay time, not gas.
- The simulation has no sensor noise, no occupancy holds, no irrigation interlocks on the fogger and no manual
  overrides. Under the law the simulator rotates the mister zones and opens them itself; the irrigation engine's
  ranking and grants are not modelled. Outdoor data is present or absent for a whole run, so the 600 s age limit
  is never exercised.
