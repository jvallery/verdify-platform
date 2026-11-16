"""Scenarios for the climate refactor plan: the band-edge law (band_edge_controller.h) beside today's firmware, the
review's step 2 patch and the review's two-axis controller, all in closed_loop2.

Same weather year, band, physics sets (A / B) and season split as scenarios.py. Single process, about 8 s per scenario.
Usage: scenarios_plan.py <tag> <group> [group ...]   ->  results_<tag>.csv"""

import os
import sys
import time

SIM = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SIM)
import pandas as pd  # noqa: E402
import runner  # noqa: E402
import scenarios as S2  # noqa: E402

YEAR = S2.YEAR
EDGE_BASE = {}  # the law's constants are the defaults of band_edge_controller.h


def run_scn(name, ctrl, season_cfg, kv):
    res = []
    kv = dict(kv)
    binary = kv.pop("binary", "closed_loop2")
    winter_params = kv.pop("winter_params", None)
    sets = kv.pop("sets", S2.SETS)
    for set_name, sdef in sets.items():
        dfs = {}
        for season in ("winter", "summer"):
            params, cs = sdef[season]
            if season == "winter" and winter_params:
                params = winter_params
            cfg = {}
            if ctrl == "fw":
                which = season if season_cfg == "seasonal" else ("winter" if season_cfg == "autumn" else "summer")
                cfg.update(S2.AUTUMN if which == "winter" else S2.SUMMER)
            elif ctrl == "kiss":
                cfg.update(S2.KISS_BASE)
            else:
                cfg.update(EDGE_BASE)
            cfg.update(kv)
            dfs[season] = runner.run(name, ctrl, params, **YEAR, canopy=cs, dryout_from=0, binary=binary, **cfg)
        c = S2.combine(dfs["winter"], dfs["summer"])
        c.insert(0, "set", set_name)
        c.insert(0, "scenario", name)
        res.append(c)
    return pd.concat(res, ignore_index=True)


def F(name, season_cfg="seasonal", **kv):  # today's firmware
    return (name, "fw", season_cfg, kv)


def K(name, **kv):  # the earlier two-axis controller
    return (name, "kiss", "seasonal", kv)


def E(name, **kv):  # the band-edge law
    return (name, "edge", "seasonal", kv)


P3 = dict(binary="closed_loop2_p3", fw__rest_exempt=1)
GROUPS = {}
# ---- references: today's firmware and settings, the review's step 1 (settings), step 2 (patched firmware), step 3 (two-axis)
GROUPS["ref"] = [
    F("fw_live"),
    F("fw_settings_300", **S2.SET_300),
    F("fwp_all_day_best", season_cfg="summer", **dict(P3, **dict(S2.CONT, **S2.FW_BEST))),
    K("kiss_strict_minabove0.5", **dict(S2.KISS_REC, kiss__dehum_min_above_low=0.5, **S2.STRICT)),
]
# ---- the law, its options and one-at-a-time sensitivities
GROUPS["law"] = [
    E("law"),
    E("law_e0.5", edge__e_max=0.5),
    E("law_e0.7", edge__e_max=0.7),
    E("law_e1.0", edge__e_max=1.0),
    E("law_eall", edge__e_max=1000),
    E("law_nodry", edge__dry=0),
    E("law_mist0", edge__mist_zones=0),
    E("law_mist1", edge__mist_zones=1),
    E("law_lead_fixed", edge__lead_by_runtime=0),
    E("law_h1_not_first", edge__h1_on=1.0, edge__h1_off=2.0),  # reference: the electric heater not ahead of the furnace
    E("s_furnace_off2.5_h1_3.0", edge__h2_off=2.5, edge__h1_on=3.0, edge__h1_off=4.0, edge__dt_start=3.0),
    E("s_furnace_off3.5_h1_4.0", edge__h2_off=3.5, edge__h1_on=4.0, edge__h1_off=5.0, edge__dt_start=4.0),
    E("s_h1_4.0", edge__h1_on=4.0, edge__h1_off=5.0, edge__dt_start=4.0),
    E("s_furnace_on0.25", edge__h2_on=0.25),
    E("s_fog_exit0.10", edge__w_off=0.10),
    E("s_fog_exit0.20", edge__w_off=0.20),
    E("s_fog_min60", dwell__fog_on=60, dwell__fog_off=60),
    E("s_fog_min180", dwell__fog_on=180, dwell__fog_off=180),
    E("s_air_min180", dwell__fan_on=180, dwell__fan_off=180, dwell__vent_on=180, dwell__vent_off=180),
    E("s_air_min120", dwell__fan_on=120, dwell__fan_off=120, dwell__vent_on=120, dwell__vent_off=120),
    E("s_cool_exit1.5", edge__c_off=1.5),
    E("s_cool_exit3.0", edge__c_off=3.0),
    E("s_fan2_at0.5", edge__c2_on=0.5),
    E("s_fan2_at3.0", edge__c2_on=3.0),
    E("s_mist_at0.20", edge__m_on=0.20),
    E("s_mist_at0.40", edge__m_on=0.40, edge__m_off=0.15),
    E("s_dry_exit0.15", edge__d_off=0.15),
    E("s_dry_on0.10", edge__d_on=0.10),
    E("s_dry_on0.00", edge__d_on=0.0),
    E("s_dewpoint_2_2", edge__dp_margin_f=2, edge__dp_stop_f=2),
    E("s_dewpoint_4_1", edge__dp_margin_f=4, edge__dp_stop_f=1),
    E("e0.7_gas_from1.5", edge__e_max=0.7, edge__dt_start_gas=1.5),
    E("e0.7_gas_from2.0", edge__e_max=0.7, edge__dt_start_gas=2.0),
    E(
        "s_stack_low", edge__h2_off=2.0, edge__h1_on=2.5, edge__h1_off=3.5, edge__dt_start=2.5
    ),  # the whole heating stack 1 F lower
    E("s_h1_wide", edge__h1_on=1.5, edge__h1_off=3.5),  # the electric heater with a 2 F swing
    E("s_heat_min180", dwell__heat_on=180, dwell__heat_off=180),
    E("s_dry_two_fans", edge__dry_two_fans=1),
    E("s_evap_cool1.5", edge__ec_on=1.5),
    E("s_evap_cool0.5", edge__ec_on=0.5),
    E("s_no_fog_below_low", edge__wet_tmin=0.0),
]
# ---- degraded modes held for the whole year: no outdoor data, a wrong clock, no clock (today's firmware beside the law)
GROUPS["ldeg"] = [
    E("law_offline", outdoor__ok=0),
    E("law_offline_effect", outdoor__ok=0, edge__effect_check=1),
    E("law_out_dp-2", outdoor__bias_dp_f=-2),
    E("law_out_dp-4", outdoor__bias_dp_f=-4),
    E("law_out_dp+2", outdoor__bias_dp_f=2),
    E("law_clock+60", clock__err_min=60),
    E("law_clock-60", clock__err_min=-60),
    E("law_clock+117", clock__err_min=117),
    E("law_clock-180", clock__err_min=-180),
    E("law_clock-360", clock__err_min=-360),
    E("law_noclock", clock__valid=0),
    E("law_noclock_offline", clock__valid=0, outdoor__ok=0),
    F("fw_offline", outdoor__ok=0),
    F("fw_clock+117", clock__err_min=117),
    F("fw_clock-180", clock__err_min=-180),
    F("fw_frozen_noon", clock__frozen_noon=1),
    F("fw_frozen_noon_offline", clock__frozen_noon=1, outdoor__ok=0),
]
# ---- what each band edge costs (the law on an edited band; compliance is against the edited band)
A_LO, A_TG, A_HI = (62.5, 73.79, 72.0, 60.7), (67.5, 78.79, 77.0, 65.7), (72.5, 83.79, 82.0, 70.7)
A_VLO, A_VHI = (0.755, 0.862, 0.845, 0.738), (1.185, 1.292, 1.275, 1.168)


def anch(base, d):
    return ",".join(f"{b + x:g}" for b, x in zip(base, d, strict=False))


def tband(d, low_only=False, high_only=False):
    kv = {}
    if not high_only:
        kv["band__temp_low"] = anch(A_LO, d)
    if not low_only:
        kv["band__temp_high"] = anch(A_HI, d)
    if not low_only and not high_only:
        kv["band__temp_target"] = anch(A_TG, d)
    return kv


GROUPS["lprice"] = [
    E("p_t_all-2", band__temp_shift=-2),
    E("p_t_all+2", band__temp_shift=2),
    E("p_t_sr-2", **tband((-2, 0, 0, 0))),
    E("p_t_sm-2", **tband((0, -2, 0, 0))),
    E("p_t_ss-2", **tband((0, 0, -2, 0))),
    E("p_t_mid-2", **tband((0, 0, 0, -2))),
    E("p_lo_sm-2", **tband((0, -2, 0, 0), low_only=True)),
    E("p_lo_ss-2", **tband((0, 0, -2, 0), low_only=True)),
    E("p_lo_day-2", **tband((0, -2, -2, 0), low_only=True)),
    E("p_lo_day-4", **tband((0, -4, -4, 0), low_only=True)),
    E("p_lo_night+2", **tband((2, 0, 0, 2), low_only=True)),
    E("p_hi_day+2", **tband((0, 2, 2, 0), high_only=True)),
    E("p_vhi_all+0.10", band__vpd_high_shift=0.10),
    E("p_vhi_day+0.10", band__vpd_high=anch(A_VHI, (0, 0.10, 0.10, 0))),
]
# ---- combined band edits: what a slightly wider band buys (the law and today's firmware on the same edited band)
ECON1 = dict(band__temp_low=anch(A_LO, (0, -2, -2, 0)), band__vpd_high_shift=0.10)
ECON2 = dict(ECON1, band__temp_high=anch(A_HI, (0, 2, 2, 0)))
ECON3 = dict(ECON2, band__temp_low=anch(A_LO, (0, -4, -4, 0)))
GROUPS["lecon"] = [
    E("econ1", **ECON1),
    E("econ2", **ECON2),
    E("econ3", **ECON3),
    F("fw_econ1", **ECON1),
    F("fw_econ2", **ECON2),
    F("fw_econ3", **ECON3),
]
# ---- forecast pre-staging with perfect foresight (an upper bound on its value)
GROUPS["lpre"] = [
    E("pre_heat_d25_h12", pre__heat_delta_f=25, pre__heat_h=12),
    E("pre_heat_s5_d25_h12", pre__heat_delta_f=25, pre__heat_h=12, edge__pre_heat_shift_f=5),
    E("pre_heat_s5_d25_h12_err8", pre__heat_delta_f=25, pre__heat_h=12, edge__pre_heat_shift_f=5, pre__err_f=8),
    E("pre_cool_d-5_h8", pre__cool_delta_f=-5, pre__cool_h=8),
    E("pre_cool_d0_h6", pre__cool_delta_f=0, pre__cool_h=6),
    E("pre_cool_d5_h6", pre__cool_delta_f=5, pre__cool_h=6),
    E("pre_cool_d0_h6_err8", pre__cool_delta_f=0, pre__cool_h=6, pre__err_f=8),
    E("pre_dry_d10_h6", pre__dry_delta_f=10, pre__dry_h=6),
    E("pre_dry_d10_h10", pre__dry_delta_f=10, pre__dry_h=10),
    E("pre_dry_d20_h10", pre__dry_delta_f=20, pre__dry_h=10),
]

# ---- follow-ups to the second review of the plan: a higher stop line for drying on spare heat, the cost-limited start line
#      at a limit of 0, a forecast hold-back (the electric heater's lines lower while the sun is forecast within the horizon)
#      and the price of leaving dry nights alone
HOLD = dict(pre__sun_wm2=300, pre__sun_h=3)
GROUPS["lrev"] = [
    E("law_dstop1.5", edge__dt_stop=1.5),
    E("law_dstop2.0", edge__dt_stop=2.0),
    E("law_dstop3.0", edge__dt_stop=3.0),
    E("law_gas_from1.5", edge__dt_start_gas=1.5),
    E("hold_sun_h3_f2", **HOLD, edge__hold_f=2),
    E("hold_sun_h3_f2_stack", **HOLD, edge__hold_f=2, edge__hold_stack=1),
    E("hold_sun_h3_f1_stack", **HOLD, edge__hold_f=1, edge__hold_stack=1),
    E("hold_sun_h6_f2_stack", **dict(HOLD, pre__sun_h=6), edge__hold_f=2, edge__hold_stack=1),
    E("p_vhi_night+0.30", band__vpd_high=anch(A_VHI, (0.30, 0, 0, 0.30))),
    # the electric heater's lines lower with the furnace's swing and the drying start line left alone: at every hour, and ahead of sun only
    E("s_h1_3.0", edge__h1_on=3.0, edge__h1_off=4.0),
    E("s_h1_2.5", edge__h1_on=2.5, edge__h1_off=3.5),
    E("hold_sun_h3_f0.5_heater", **HOLD, edge__hold_f=0.5, edge__hold_dry=0),
    E("hold_sun_h3_f1_heater", **HOLD, edge__hold_f=1, edge__hold_dry=0),
    E("hold_sun_h0_f1_heater", **dict(HOLD, pre__sun_h=0), edge__hold_f=1, edge__hold_dry=0),
    E("hold_sun_h0_f1_stack", **dict(HOLD, pre__sun_h=0), edge__hold_f=1, edge__hold_stack=1),
]


def main():
    tag = sys.argv[1]
    out = []
    t0 = time.time()
    for grp in sys.argv[2:]:
        for name, ctrl, season_cfg, kv in GROUPS[grp]:
            df = run_scn(name, ctrl, season_cfg, kv)
            df.insert(1, "group", grp)
            out.append(df)
    res = pd.concat(out, ignore_index=True)
    path = f"{SIM}/results_{tag}.csv"
    res.to_csv(path, index=False)
    print(f"{len(out)} scenarios, {time.time() - t0:.0f} s -> {path}")


if __name__ == "__main__":
    main()
