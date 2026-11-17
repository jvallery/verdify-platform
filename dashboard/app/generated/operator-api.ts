// SPDX-License-Identifier: MIT
// Generated from docs/design/dashboard/openapi/dashboard-api.v1.yaml; run pnpm contract:write.
export interface paths {
    readonly "/auth/callback": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Finish sign-in
         * @description Exchanges the code with the client secret and verifier, verifies the ID token (sub, preferred_username, name, groups), maps groups to a role (operators wins), creates the session with INT-01 and sets __Host-verdify_session (HttpOnly, Secure, SameSite=Lax, Path=/, 12 h). No tokens reach the browser. The login cookie is cleared on every outcome; a refusal answers its status with the SCR-09 card (text/html) at the same URL.
         */
        readonly get: operations["BFF-02"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/auth/login": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Start sign-in
         * @description Sets the sealed __Host-verdify_login cookie (state, nonce, PKCE verifier and returnTo; AES-256-GCM; 10 min) and redirects to the authorization_endpoint discovered from issuer https://auth.vallery.net/application/o/verdify-dashboard/ (https://auth.vallery.net/application/o/authorize/) with client_id=verdify-dashboard, scope openid profile email groups and code_challenge_method=S256. A page without a session answers 302 to /auth/login?returnTo=<path> (for /, returnTo=%2F); MFA happens at Authentik. A refusal answers its status with the SCR-09 card (text/html) at the same URL.
         */
        readonly get: operations["BFF-01"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/auth/logout": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Sign out
         * @description Needs the exact Origin. Deletes the session (INT-02), clears the cookie and redirects to Authentik's end-session endpoint with post_logout_redirect_uri https://dashboard.verdify.ai/. With Authentik's discovery unavailable it still deletes and clears, then redirects to /.
         */
        readonly post: operations["BFF-03"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/healthz": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Liveness, static 200 (successful probes are not logged) */
        readonly get: operations["OPS-01"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/sessions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Create a session after the BFF verified the ID token
         * @description Returns the token once; dashboard_session keeps only its sha256. X-Authentik-* headers are ignored. A request that carries X-Dashboard-Session is refused (403): the proxy always sends that header and the BFF's session-create call never does, so no proxied user request can reach this route.
         */
        readonly post: operations["INT-01"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/internal/sessions/current": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Delete the session named by X-Dashboard-Session */
        readonly delete: operations["INT-02"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/metrics": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Open-alert gauge for Alertmanager paging (#1352)
         * @description Prometheus text. `verdify_alert_open{severity, alert_type}` counts the merged alerts with status `open`, the
         *     rows the Now count shows; Alertmanager pages the critical ones. `verdify_alert_metrics_up` is 0 when the read
         *     failed. No alert text, session or token.
         */
        readonly get: operations["OPS-04"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/readyz": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Readiness with the source revision */
        readonly get: operations["OPS-02"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/activity": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Every write by people, Iris, agents and the system, newest first */
        readonly get: operations["API-17"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/alerts": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Open alerts by severity then age, or recently resolved ones, repeats merged, each with its runbook */
        readonly get: operations["API-14"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/alerts/{id}/ack": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Acknowledge, with an optional note
         * @description Acknowledges every unacknowledged repeat of the alert's alert_type and sensor_id in one transaction, records the person and note on each and returns the merged row, so the open-alert count drops by one.
         */
        readonly post: operations["API-15"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/alerts/{id}/resolve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Resolve, with an optional note (never blocked)
         * @description Resolves every unresolved repeat of the alert's alert_type and sensor_id in one transaction, records the person and resolution on each and returns the merged row. An alert whose condition persists re-opens on the next monitor cycle.
         */
        readonly post: operations["API-16"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/band": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The house band in force and the reconstructed crop band
         * @description band is the history of the dispatcher's house band rows (setpoint_snapshot band_role): DERIVED from crop_band_anchors with the controller's formula, kept 90 days, null before that. crop is reconstructed from today's anchors over the whole window: fn_band_setpoints(ts) over the step series, which gives the same crop values as fn_band_timeline. Release C retired the zone bands (center, south, west, east): zones are probes, and the law has one band. The step matches the window: at least 5 min and at most 2,000 points. With achievable (house, windows up to 35 days; #1433), achievable adds the band the house can be expected to hold: at night the band widened to the expected VPD ribbon of a rolling 14-day indoor-dewpoint fit (verdify_schemas.vpd_envelope), by day the band itself, and each night graded against both bands.
         */
        readonly get: operations["API-06"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/band/preview": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Preview a house band anchor edit as the day's diurnal curve, before Save
         * @description Read-only; Save stays API-10. Overlays the draft value on the crop_band_anchors rows fn_crop_band_value reads and returns the current and draft curves at 10-min steps with its four-anchor harmonic: the param's axis's low, target and high. Release C retired the zone VPD targets and widths (zones are probes, and the law has one band). Codes: unknown_target (not a house band anchor), out_of_range (outside planner_effective_bounds).
         */
        readonly get: operations["API-19"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/band/profile": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The house band as stored and as drafted in the band editor, over one day, before Save
         * @description Read-only (#1334). Reads the 24 house anchors as fn_crop_band_value resolves them and overlays the draft: any simple temperature field recompiles the six temperature anchors from day (solar noon) and night (solar midnight) values with sunrise and sunset at their midpoint, so the curve is a pure sinusoid that never leaves its noon and midnight values; any VPD field does the same for the VPD anchors. The edge form does the same from the band's low and high edges: each low or high series given an edge field compiles from its day and night edges with sunrise and sunset halfway between them, on the push step, an edge left out keeping the band's own noon or midnight value, and a series given no edge keeps its anchors; a target whose curve would leave its new edges anywhere in the day moves to their midpoint at all four anchors in the draft, and one whose curve stays between them stays. One axis given in both forms is invalid_request, and the findings of an axis given as edges name the edge field (for band order, the edge the target crosses). Then each anchor= item sets one raw anchor (Advanced). Curves are the controller's four-anchor harmonic at 10-min steps of fn_solar_phase, so the draft is the curve the controller runs. findings with severity error are what API-24 refuses. The expected night VPD ribbon is a 14-day indoor dewpoint fit on quiet deep-night hours and the forecast; night_heat_kwh is 0.19 kW/°F over the forecast's night hours. Codes: unknown_target (anchor not a house band anchor), out_of_range (outside planner_effective_bounds), read_only (no complete anchor set).
         */
        readonly get: operations["API-23"];
        /**
         * Save the band editor's draft, every changed house anchor in one write
         * @description The same draft as API-23 (profile fields or edges, and Advanced anchors). In one transaction: each house anchor the draft changes (by more than half the push quantum, 0.1 °F or 0.01 kPa) is an API-10 write, its desired_state row with the manual flag and its crop_band_anchors rows, and one activity_log row, action band.write, target "house band", detail {desired_ids, changes [{param, desired_id, before, value}], anchor_rows, manual, profile, simple, edges, edges_simple}. Under the edge form a target whose curve would leave its new edges moves to their midpoint at all four anchors in the same write. One axis given in both forms is invalid_request. The dispatcher's anchor sync delivers the anchors; nothing talks to the controller. Codes: out_of_range (an API-23 error finding: band order, the 40/100 °F guardrails 5 °F outside the band, the 0.3-3.0 kPa VPD guardrails or the 0.74 kPa night floor; or an anchor outside its bounds), invalid_request (the draft changes nothing), read_only (Iris: the band is operator-owned), unknown_target, request_id_reused.
         */
        readonly put: operations["API-24"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/catalog": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** The crop catalog with plain names */
        readonly get: operations["API-CROP-05"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/locations": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Every zone, shelf and cell with its layout and water lines, and what each holds now
         * @description A zone or a shelf holds any number of plantings; a cell holds at most one at a time. Water lines are the irrigation lines that reach each shelf (shelf_water_lines).
         */
        readonly get: operations["API-CROP-01"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/plantings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Plantings, active first and newest first */
        readonly get: operations["API-CROP-02"];
        readonly put?: never;
        /**
         * Record a planting across the places named
         * @description positions are place texts (EAST-HYDRO-12, EAST-HYDRO-1..10, hydro 1-30, rail A top, west top 1-3, south floor, hanging, center); API-CROP-06 previews them. Codes: invalid_request (a place it cannot read), ambiguous_position (current lists the candidates), position_occupied (a requested cell is held at planted_at; replace ends or trims the occupant instead), request_id_reused. Writes records only: no setting, band or target changes (the grow-light window still follows the active crops' DLI targets, fn_lighting_policy).
         */
        readonly post: operations["API-CROP-07"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/plantings/{planting_id}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        /** One planting with every place it has been, its events and its harvests */
        readonly get: operations["API-CROP-03"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        /**
         * Correct a planting's variety, count (null is unknown), stage, notes or expected harvest
         * @description Only the fields sent change. Places change through API-CROP-08. Codes as API-CROP-07, and unknown_target.
         */
        readonly patch: operations["API-CROP-11"];
        readonly trace?: never;
    };
    readonly "/v1/crops/plantings/{planting_id}/harvest": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Record a harvest; partial unless final, which ends the planting as harvested */
        readonly post: operations["API-CROP-09"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/plantings/{planting_id}/move": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Move a planting; the old and new places both stay in its history
         * @description from_positions (default: every place it is now) close at moved_at and to_positions open then. Codes as API-CROP-07, plus planting_ended and unknown_target.
         */
        readonly post: operations["API-CROP-08"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/plantings/{planting_id}/notes": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Add a note to a planting's history (ended plantings too)
         * @description The crops service's annotate function, the one MCP annotate_planting uses: one crop_events note row and one activity_log row (action planting.note) in one transaction. Codes: unknown_target (no such planting), request_id_reused.
         */
        readonly post: operations["API-CROP-12"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/plantings/{planting_id}/remove": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * End a planting without a harvest (failed, removed or reconciled)
         * @description Every open place closes at `at`. Undo by recording the planting again.
         */
        readonly post: operations["API-CROP-10"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/positions/{label}/history": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Who has held one cell, current first */
        readonly get: operations["API-CROP-04"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/crops/resolve": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Preview what a place text means and which plantings hold those cells; writes nothing
         * @description A GET, so viewers can preview and DASHBOARD_WRITES_ENABLED never blocks it. Codes: invalid_request, ambiguous_position (current lists the candidates).
         */
        readonly get: operations["API-CROP-06"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/equipment": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Equipment now, runtime and cycles today, the grow lights' Lutron state and controller intent, and why */
        readonly get: operations["API-13"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/equipment/lights/{light}/{state}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Turn a grow light on or off through verdify-setpoint-server (Lutron)
         * @description Calls verdify-setpoint-server POST /lights/{light}/{state} (12 s cap) and records one activity_log row: light.on or light.off, target grow_light_main or grow_light_grow, detail {light, state, result, minutes}. A manual switch is timed like the Fans burst (#1335): minutes, 15 by default, from the row's ts; then the operator API sends the controller's intent through verdify-setpoint-server, recording one more light.on or light.off row (actor system light_timer, reason "Timer ended", detail.via timer), so the light is back on automatic within about 15 s of the end. During the minutes the controller can still switch the light when its own decision changes, which only brings automatic back early. 200 when setpoint-server saw Lutron reach the state. When Home Assistant or Lutron does not confirm: 503 unavailable, retryable, with result ha_failed, not_confirmed or timeout; the light may still switch late. The board's state comes only from API-13's Lutron readback. Back to automatic is API-10 on sw_gl_main_auto_mode or sw_gl_grow_auto_mode, which can send one command of its own (API-10). The call and its row hold the light's lock: a press waits up to 2.5 s for a Back to automatic resync that holds it, then goes ahead, so it reaches setpoint-server after that resync's command and wins. The writes flag gates it like every write, and it never touches the ESP32.
         */
        readonly post: operations["API-20"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/equipment/override": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Bursts and restart through manual_override (replaces the Home Assistant buttons)
         * @description fans, humidify and vent_bypass set only the controller's deadline latch for that burst to now + minutes; clear zeroes them; restart reboots the controller safely. It never changes occupancy. Now shows a burst from the controller's readback, not from this command. No MCP tool in MVP. Before the engine firmware: 503 unavailable.
         */
        readonly post: operations["API-IRR-12"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Lines, active runs, program sync and the engine flag, minutes today, limits, leak and occupancy
         * @description Polled every 15 s, and every 5 s while a program write is requested or a command is pending. Before the engine firmware, engine is false, program.src is null with its reason, and line states come from relay edges only.
         */
        readonly get: operations["API-IRR-01"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/clear-fault": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Clear a mister watchdog latch (irr_command clear_fault)
         * @description With line_id (L04, L07 or L09), clears that zone's D-IRP-19 latch; without it, every latch. There is no drip leak latch (Round 2 #3). Before the engine firmware: 503 unavailable.
         */
        readonly post: operations["API-IRR-13"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/lines/{line_id}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /**
         * Enable or disable a line with its check; VPD and Schedule flags on misters; caps; pause or resume; manual
         * @description line_id all accepts only paused_until (pause or resume every line). vpd_member and schedule_member are for L04, L07 and L09. Enabling a line with no check, or turning schedule_member on for the first time, needs checked true, which only the dashboard sends (check_required). Disabling stops everything on the line, VPD misting included. vpd_member true on a line that is and stays disabled is line_disabled: the controller acts on VPD membership only while the line is enabled. Pause, resume and the check never change manual; any other edit that omits it stores true (R3). Codes: out_of_range, check_required, line_disabled, unknown_target, request_id_reused; Iris only, on a manual line, manual.
         */
        readonly put: operations["API-IRR-08"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/lines/{line_id}/run": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Run now
         * @description Starts at once or is refused: line_busy, manifold_busy, cap_reached, line_disabled, line_paused, line_faulted, not_schedule_member (mist, until the controller runs #1343's firmware). Any wired, enabled line runs once (#1343), and fog (L11) runs once for minutes (#1343 follow-up), 503 unavailable until the controller runs the firmware that takes it. The master valve L03 takes no run of its own: it opens only with a fertilized relay (L02, L06, L08, L10), never with clean water (#1336). The API refuses what it can see in the newest irr_state (422); otherwise the line's irr_state shows whether it started. Before the engine firmware only L01 runs, through the btn_wall_clean bridge, for its configured irrig_wall_duration_min (minutes, if sent, must equal it); any other line is 503 unavailable and nothing is stored.
         */
        readonly post: operations["API-IRR-06"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/minutes": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Minutes, pulses and gallons per day by zone, line or cause (v_irrigation_minutes_daily), up to 400 days */
        readonly get: operations["API-IRR-10"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/runs": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Run ledger, newest first; windows up to 31 days */
        readonly get: operations["API-IRR-11"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/schedules": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Schedules with sync state, the 7-day week planned against actual, bounds per line kind and solar times */
        readonly get: operations["API-IRR-02"];
        readonly put?: never;
        /**
         * Create a schedule
         * @description Codes: out_of_range, too_close (30 min on one line), too_many_schedules (24), unknown_target, request_id_reused. A schedule on a disabled line, one over the line's daily cap, and a mist schedule on a zone with schedule_member off are all accepted; their occurrences end skipped or cap, with the reason in words.
         */
        readonly post: operations["API-IRR-03"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/schedules/{slot_id}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly slot_id: components["parameters"]["SlotId"];
            };
            readonly cookie?: never;
        };
        readonly get?: never;
        /**
         * Edit, enable or disable a schedule; set manual
         * @description Omitted fields keep their value, except manual: a REST edit that omits it stores true (R3). Same codes as API-IRR-03; Iris only, on a manual schedule, manual.
         */
        readonly put: operations["API-IRR-04"];
        readonly post?: never;
        /** Delete a schedule (its slot_id is never reused) */
        readonly delete: operations["API-IRR-05"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/irrigation/stop": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Stop one line, or every line when line_id is omitted
         * @description Never blocked, including by DASHBOARD_WRITES_ENABLED; never heap-deferred; sent ahead of any program push and re-sent until the relays read OFF (at most 2 min). Ends what is running now and disables nothing: VPD misting, survival fog and the next scheduled run can still start (disable the line to keep it off), and the dashboard's Stop result toast (VD-05) and the MCP tool description (VD-64, VD-61) say so. Before the engine firmware it works on one line or every line through the run-now bridge: it ends the legacy drip job (the sw_irrig_* enables) and turns the open wet relays off; their guards block only turn-on, so VPD misting may pulse again.
         */
        readonly post: operations["API-IRR-07"];
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/law": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * What the controller's climate law is doing now and why
         * @description From the newest law record, drying meter and constants hash in system_state (climate_law_state, climate_drying_meter, climate_law_constants, outdoor_source, lead_fan), the newest non-null diagnostics value per column over 15 min, the newest equipment_state row per relay with its start, the newest climate row, fn_band_setpoints(now()) for the host's band, v_desired_state_current for the owner's drying cost limit, today's daily_record row and the law constants this API build was generated from. Every threshold is computed from the band in use and those constants. A value the controller has not reported is null, never 0. Polled every 15 s by Climate, System and Now.
         */
        readonly get: operations["API-30"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/law/history": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The law's requests, latches, drying, outdoor source, drying price and band over a window
         * @description From the climate_law_state and outdoor_source rows in [from, to), compressed to change intervals in the database. A span of more than 180 s with no law record is unknown. cost and band use API-04's bucket ladder with at most 1,500 points. request.fan1 is at least one fan, request.fan2 both fans. Windows up to 31 days (else 422 window_too_large); the 10 s statement timeout is 503 query_timeout.
         */
        readonly get: operations["API-31"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/lighting": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The grow lights by day: on time, starts, the policy in force and qualified light minutes against target
         * @description Graphs → Lighting (#1357). One entry per America/Denver day the window touches, up to now, for main and grow: on time and starts from the Lutron readback over the whole day; the controller's readback of its ON threshold, hysteresis, start hour, cutoff hour and target light minutes in force at the day's end; and the qualified light minutes, v_lighting_minutes_status_now's rule for every day: each minute from the start hour to the cutoff (or now) counts once when its mean Tempest outdoor lux is at or above the ON threshold or the light was on. No DLI until the PAR meter (#1184). Windows up to 31 days.
         */
        readonly get: operations["API-22"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Signed-in user, role, writes flag and API revision */
        readonly get: operations["API-01"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/metrics": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Metric registry over every numeric climate column, controller vitals and the daily scorecard keys
         * @description Column names never come from the browser. Light carries the canopy PAR meter's `climate.ppfd_umol_m2_s` and `daily.dli_mol_m2_day` (#1184), which reads `v_dli_daily` and is null with its reason until a full local day of PPFD is covered.
         */
        readonly get: operations["API-03"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/now": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Now hero
         * @description Indoor and outdoor climate with ages, the band in force (the dispatcher's DERIVED band rows) with a verdict per metric, mode, Iris status, equipment running, bursts from the controller's readback, the leak flag, the open-alert count, source freshness with the ingestor heartbeat, the device writer and the greenhouse snapshot. The climate law's state carries the band the controller is using; review is the daily review's state today (as API-34's today); outdoor.source says where the outdoor reading comes from; controller carries the three health facts the shell's banner reads. Polled every 15 s; the shell banners read `freshness`, `writer`, `leak` and `alerts`. Water and occupancy come from API-IRR-01.
         */
        readonly get: operations["API-02"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/record/days": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The daily record per local day with its 7- and 30-day means
         * @description One row per America/Denver day, oldest first: compliance from daily_band_compliance, relay starts and run time from the daily relay record (v_dashboard_relay_day), utilities, water and drying from daily_record, and the alert counts from v_daily_scorecard. The means cover complete days only. Up to 400 days (else 422 window_too_large); the default is the 30 days ending today.
         */
        readonly get: operations["API-32"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/record/relay-check": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The controller's own relay counters against the stored daily relay record
         * @description From v_relay_counter_reconciliation_daily, newest day first.
         */
        readonly get: operations["API-33"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/reviews": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The daily reviewer's reviews, newest first, today's review state and the proposal waiting for the owner
         * @description From v_dashboard_review, the open daily_review_missed alert and the activity_log rows with action band.write. A proposal is waiting on the newest written review that carries one when no band.write followed its written_at; answered when one did; superseded when a newer written review exists. tokens.rise_pct compares the newest review with the 7-review mean of the reviews before it.
         */
        readonly get: operations["API-34"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/series": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Downsampled series for uPlot
         * @description time_bucket_gapfill over [from, to). The bucket is the smallest of 1 min, 5 min, 15 min, 1 h, 3 h and 1 d that gives at most `points` buckets. Over 31 days, or when `from` is older than the raw retention of a requested metric that has a daily binding, the bucket is 1 d and every metric with a daily binding reads `daily_summary` (its `source` says so, and so does the chart); `daily.*` keys read `v_daily_scorecard`, except `daily.dli_mol_m2_day`, which reads `v_dli_daily`. A request of `daily.*` keys alone is 1 d buckets on America/Denver days for any window. Windows up to 400 days (else 422 `window_too_large`); buckets before a metric's `retained_from` are beyond its retention, not gaps. An unknown key is 422 `unknown_target`; the 10 s statement timeout is 503 `query_timeout`.
         */
        readonly get: operations["API-04"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/settings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Every registry row with its device value, desired row and state, and the Band in force rows */
        readonly get: operations["API-09"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/settings/{param}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                /** @description tunable_registry name */
                readonly param: components["parameters"]["Param"];
            };
            readonly cookie?: never;
        };
        readonly get?: never;
        /**
         * Write a setting
         * @description Validates (known and writable, type and range, snap), then appends one desired_state row and one activity_log row in one transaction and wakes the dispatcher. Codes: unknown_target, read_only, out_of_range, request_id_reused. A crop_band anchor write also updates its crop_band_anchors rows; an irrigation_site setting is delivered in the irrigation program, not by the dispatcher (R12). Before the engine firmware an irrigation_site write is stored and reads requested with state_reason no_engine until a program compiled after it is confirmed. The Equipment page's Back to automatic (a new write of sw_gl_main_auto_mode or sw_gl_grow_auto_mode with value 1 and reason "Back to automatic"; the page sends manual false since #1335, so a light on Auto is not counted manual) also starts a resync in the operator API, so the light matches the controller when the page has closed (#1300). Once the write reads confirmed it leaves the page 22 s for its own API-20 command, then, holding the light's lock that API-20 shares, sends one when the write is still the newest and confirmed, no light command was recorded since it, the controller decided the light within 120 s and not as auto_disabled or time_invalid, no Turn on or Turn off started meanwhile, and the intent and the Lutron state are known and differ. Its activity_log row is API-20's (light.on or light.off under the writer, reason Back to automatic) with detail.via server_resync and detail.write_id. A resync lives in one operator API process, so a restart drops one still waiting; the BFF's writes flag does not reach it.
         */
        readonly put: operations["API-10"];
        readonly post?: never;
        /**
         * Release to auto
         * @description Appends a value = null row. The band or the dispatcher's default applies again; a writable setting with none of these returns to its registry default (TunableDef.default). manual is cleared.
         */
        readonly delete: operations["API-11"];
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/settings/{param}/history": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Desired rows and readback steps over a window (also the Graphs setting steps) */
        readonly get: operations["API-12"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/soil-targets": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Every probe zone's soil-moisture target (#1345)
         * @description One row per probe zone (south_1, south_2, west) from soil_moisture_targets (migration 303): wilt_pct, min_pct, max_pct and saturation_pct in percent, always 0 <= wilt < min < max < saturation <= 100; the note; the probe (climate column) and sensor it applies to and the crops.zone whose plantings let soil_dryout page; who last changed it, when and why. No crop name: targets are plant-agnostic.
         */
        readonly get: operations["API-SOIL-01"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/soil-targets/{zone}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        /**
         * Change one zone's soil-moisture thresholds or note (#1345)
         * @description A field left out keeps its stored value; the merged row must keep 0 <= wilt < min < max < saturation <= 100. One transaction: the soil_moisture_targets row (with updated_at, updated_by, updated_source and the reason) and one activity_log row, action soil_target.write, target the zone, detail {ref, zone, changed {field: {from, to}}}. The ingestor's soil_dryout rule pages on the new wilt_pct from its next cycle; nothing talks to the controller. Codes: out_of_range (a value outside 0-100 or the order broken), invalid_request (nothing to change), not_found (no such zone), request_id_reused.
         */
        readonly put: operations["API-SOIL-02"];
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/states": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Equipment on/off intervals for the lanes
         * @description From equipment_state, seeded with the state at `from` (fn_equip_at). Wet lines carry their cause from the run ledger. Unknown stays unknown. Windows up to 31 days. The grow lights have two lanes each: the Lutron readback (grow_light_main, grow_light_grow; unknown 600 s after its newest row) and the controller's switch intent (grow_light_main_intent, grow_light_grow_intent; Q-09), which the lanes compare with the readback (#1356).
         */
        readonly get: operations["API-05"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/system/controller": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * The controller's hardware budget now, against its limits
         * @description The newest non-null diagnostics value per column over 15 min, by the same SQL as the operator API's product metrics (CONTROLLER_SQL and HEALTH_SQL), with system_state ingestor_counters and climate_law_constants. limits are the hardware-budget thresholds from their one existing definition. Trends come from API-04.
         */
        readonly get: operations["API-35"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/system/data": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Whether telemetry is flowing, what was lost and what the gap log restored
         * @description From v_data_gaps_unreplayed, v_dashboard_gap_replay, the product metrics' FRESHNESS_SQL, FLOW_SQL and PROBES_SQL, system_state (ingestor_heartbeat, ingestor_counters, setpoint_snapshot_pass, dispatcher_stage) and diagnostics.gap_log_state, over the days ending now.
         */
        readonly get: operations["API-36"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/system/delivery": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Whether the controller took what the host pushed
         * @description From setpoint_changes in the window (by ts), system_state dispatcher_stage and setpoint_snapshot_pass, and the product metrics' DELIVERY_SQL and OLDEST_UNCONFIRMED_SQL, so the dashboard and the estate dashboard agree.
         */
        readonly get: operations["API-37"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/water/daily": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Daily water use from the site meter by line and cause, with no-valve water apart
         * @description One entry per America/Denver day, in whole gallons: the meter's day total, Verdify-valve water by line and by cause, and the water that ran while no Verdify valve was open (the hose, sink, hydro or a leak). The parts are attributed per run and can sit a gallon off the total; nothing is rescaled. A no_data day is null, never 0. There is no rate and no flow flag.
         */
        readonly get: operations["API-21"];
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description The house VPD band the house can be expected to hold, one point per step (#1433). At night (sunset to sunrise) the expected ribbon is es(T) − es(Td_in ± 0.674·RMSE) at the house temperature the step measured (ahead of now, the band's temperature), with Td_in from a rolling least-squares fit of indoor dewpoint on indoor temperature, outdoor temperature and outdoor dewpoint over the 14 days of deep-night hours with no vent, fan, fog or mister before the night's local noon (before now for a night ahead); outdoor values are measured up to now and forecast after. The achievable band is the band in force (else the crop band) with its low edge dropped to the ribbon's p25 and its high edge raised to its p75 where they lie outside; by day, and with no fit, it is the band. */
        readonly AchievableColumns: {
            /** @description Days of deep-night hours each night's fit reads */
            readonly days: number;
            /** @description Expected night VPD, p75 */
            readonly expected_high: components["schemas"]["NullableNumbers"];
            /** @description Expected night VPD, p25; null by day or without a fit */
            readonly expected_low: components["schemas"]["NullableNumbers"];
            /** @description Each night in the window graded at the step against the served band and the achievable band */
            readonly nights: readonly components["schemas"]["AchievableNight"][];
            readonly vpd_high: components["schemas"]["NullableNumbers"];
            readonly vpd_low: components["schemas"]["NullableNumbers"];
        };
        readonly AchievableFit: {
            /** @description Deep-night hours the fit used */
            readonly hours: number;
            /** @description Root-mean-square dewpoint error, °F */
            readonly rmse_f: number;
        };
        readonly AchievableNight: {
            /** @description Share of graded steps inside the achievable band */
            readonly achievable_in_pct: number | null;
            /** @description Share below the achievable band's low edge */
            readonly below_achievable_pct: number | null;
            /** @description Share below the served band's low edge */
            readonly below_served_pct: number | null;
            /** @description The rolling dewpoint fit the night used; null with fewer than 24 hours */
            readonly fit: components["schemas"]["AchievableFit"] | null;
            /** @description Night steps with a measured house VPD and a band */
            readonly graded: number;
            /**
             * Format: date
             * @description America/Denver date of the night's evening
             */
            readonly night: string;
            /** @description Share of graded steps inside the served band */
            readonly served_in_pct: number | null;
        };
        readonly ActivityEntry: {
            /**
             * @example setting.write
             * @example setting.release
             * @example plan.write
             * @example alert.ack
             * @example irrigation.schedule.update
             */
            readonly action: string;
            readonly actor: components["schemas"]["Actor"];
            /** Format: date-time */
            readonly confirmed_at?: string | null;
            /** @description Before and after, e.g. {"before": 1.6, "value": 1.55, "requested": 1.53, "manual": {"before": false, "after": true}}; a plan lists its changes; trigger_id when an agent gave one */
            readonly detail?: Record<string, unknown>;
            /**
             * Format: uuid
             * @description Set when the write landed while an experiment was armed; nothing is refused
             */
            readonly experiment_id?: string | null;
            readonly id: number;
            readonly reason?: string | null;
            /**
             * Format: uuid
             * @description The Idempotency-Key or MCP request_id
             */
            readonly request_id?: string | null;
            /** @description Readback outcome of a setting or program write */
            readonly state?: components["schemas"]["ReadbackState"] | null;
            /** @description Param, plan id, alert id, line or slot id */
            readonly target: string;
            /** Format: date-time */
            readonly ts: string;
        };
        readonly ActivityPage: components["schemas"]["Page"] & {
            readonly items: readonly components["schemas"]["ActivityEntry"][];
        };
        /** @description Who wrote (R4). system is the platform itself, for example the forecast action engine */
        readonly Actor: {
            /** @description Authentik username, iris, the agent name (admin for the admin MCP token) or forecast-engine */
            readonly name: string;
            /**
             * @example dashboard
             * @example iris
             * @example agent:steward
             * @example agent:admin
             */
            readonly source: string;
        };
        /** @description One alert_log row, or one merged row for repeats of one alert_type and sensor_id */
        readonly Alert: {
            /** Format: date-time */
            readonly acknowledged_at?: string | null;
            /** @description Username or agent */
            readonly acknowledged_by?: string | null;
            /**
             * @example leak_detected
             * @example irrigation_fence_breach
             * @example irrigation_run_missed
             * @example irrigation_line_faulted
             * @example setpoint_unconfirmed
             */
            readonly alert_type: string;
            /**
             * @example water
             * @example system
             */
            readonly category: string;
            /** @description Repeats of this alert_type and sensor_id merged into the row */
            readonly count?: number;
            /** @description As stored, e.g. line_id or equipment */
            readonly details?: Record<string, unknown>;
            /** Format: date-time */
            readonly first_seen_at: string;
            /** @description The oldest unresolved repeat's id, stable while new repeats merge (a resolved merged row: its oldest repeat's); API-15 and API-16 act on every repeat of its alert_type and sensor_id */
            readonly id: number;
            /**
             * Format: date-time
             * @description Newest of the merged repeats
             */
            readonly last_seen_at?: string | null;
            readonly message: string;
            readonly metric_value?: number | null;
            readonly notes?: string | null;
            readonly resolution?: string | null;
            /** Format: date-time */
            readonly resolved_at?: string | null;
            readonly resolved_by?: string | null;
            /** @description Markdown from the alert runbook table */
            readonly runbook?: string | null;
            /** @enum {string} */
            readonly severity: "critical" | "warning" | "info";
            /**
             * @description disposition; a merged row is open while any of its repeats is unacknowledged
             * @enum {string}
             */
            readonly status: "open" | "acknowledged" | "resolved" | "false_positive" | "suppressed";
            readonly threshold_value?: number | null;
            readonly zone?: string | null;
        };
        readonly AlertPage: components["schemas"]["Page"] & {
            readonly items: readonly components["schemas"]["Alert"][];
        };
        readonly BandColumns: {
            readonly temp_high: components["schemas"]["NullableNumbers"];
            readonly temp_low: components["schemas"]["NullableNumbers"];
            readonly vpd_high: components["schemas"]["NullableNumbers"];
            readonly vpd_low: components["schemas"]["NullableNumbers"];
        };
        readonly BandCurve: {
            readonly high: components["schemas"]["NullableNumbers"];
            readonly low: components["schemas"]["NullableNumbers"];
            readonly target: components["schemas"]["NullableNumbers"];
        };
        /** @description A band's four edges at one moment */
        readonly BandEdges: {
            /** @description °F */
            readonly temp_high_f: number;
            /** @description °F */
            readonly temp_low_f: number;
            /** @description kPa */
            readonly vpd_high_kpa: number;
            /** @description kPa */
            readonly vpd_low_kpa: number;
        };
        /** @description Per axis, true when the sunrise and sunset anchors of its low and high series are the midpoint of their noon and midnight values on the push step, so the eight edges describe the band in full */
        readonly BandEdgesSimple: {
            readonly temp: boolean;
            readonly vpd: boolean;
        };
        /** @description Where the law's rules switch on, as offsets from the band's edges, for the preview to draw (the law constants) */
        readonly BandLawLines: {
            /** @description Cooling comes on above temp_high plus this, °F */
            readonly cool_on_above_high_f: number;
            /** @description Drying is wanted below vpd_low plus this, kPa */
            readonly dry_on_above_vpd_low_kpa: number;
            /** @description The second fan comes on above temp_high plus this, °F */
            readonly fan2_on_above_high_f: number;
            /** @description The fogger comes on above vpd_high plus this, kPa */
            readonly fog_on_above_vpd_high_kpa: number;
            /** @description The electric heater comes on below temp_low plus this, °F */
            readonly heat1_on_above_low_f: number;
            /** @description The furnace comes on below temp_low plus this, °F */
            readonly heat2_on_above_low_f: number;
            /** @description The misters join above vpd_high plus this, kPa */
            readonly mist_on_above_vpd_high_kpa: number;
        };
        readonly BandPosition: {
            readonly high: number | null;
            readonly low: number | null;
            /** @enum {string} */
            readonly verdict: "in" | "above" | "below" | "unavailable";
        };
        /** @description API-19: the band over one day as stored (current) and with the draft value (draft), one point per step_s */
        readonly BandPreview: {
            readonly current: components["schemas"]["BandCurve"];
            /**
             * Format: date
             * @description America/Denver day
             */
            readonly day: string;
            readonly draft: components["schemas"]["BandCurve"];
            readonly param: string;
            /** @constant */
            readonly step_s: 600;
            /** @description Epoch seconds */
            readonly t: readonly number[];
            /**
             * @example °F
             * @example kPa
             */
            readonly unit: string;
        };
        /** @description The house band in the editor's terms: day (solar noon) and night (solar midnight) values */
        readonly BandProfile: {
            /** @description °F */
            readonly temp_day: number;
            /** @description °F */
            readonly temp_night: number;
            /** @description ± °F */
            readonly temp_width_day: number;
            /** @description ± °F */
            readonly temp_width_night: number;
            /** @description kPa */
            readonly vpd_above_day: number;
            /** @description kPa */
            readonly vpd_above_night: number;
            /** @description kPa */
            readonly vpd_below_day: number;
            /** @description kPa */
            readonly vpd_below_night: number;
            /** @description kPa */
            readonly vpd_day: number;
            /** @description kPa */
            readonly vpd_night: number;
        };
        /** @description The band's low and high edges at solar noon (day) and solar midnight (night), as the anchors hold them */
        readonly BandProfileEdges: {
            /** @description temp_high at solar noon, °F */
            readonly temp_high_day: number;
            /** @description temp_high at solar midnight, °F */
            readonly temp_high_night: number;
            /** @description temp_low at solar noon, °F */
            readonly temp_low_day: number;
            /** @description temp_low at solar midnight, °F */
            readonly temp_low_night: number;
            /** @description vpd_high at solar noon, kPa */
            readonly vpd_high_day: number;
            /** @description vpd_high at solar midnight, kPa */
            readonly vpd_high_night: number;
            /** @description vpd_low at solar noon, kPa */
            readonly vpd_low_day: number;
            /** @description vpd_low at solar midnight, kPa */
            readonly vpd_low_night: number;
        };
        /** @description The simple fields or edges to change; a field left out keeps the band's own value. An axis is given either as a target with its width or as edges, never both */
        readonly BandProfilePatch: {
            readonly temp_day?: number | null;
            /** @description Edge form: the high edge at solar noon, °F */
            readonly temp_high_day?: number | null;
            /** @description Edge form: the high edge at solar midnight, °F */
            readonly temp_high_night?: number | null;
            /** @description Edge form: the low edge at solar noon, °F */
            readonly temp_low_day?: number | null;
            /** @description Edge form: the low edge at solar midnight, °F */
            readonly temp_low_night?: number | null;
            readonly temp_night?: number | null;
            readonly temp_width_day?: number | null;
            readonly temp_width_night?: number | null;
            readonly vpd_above_day?: number | null;
            readonly vpd_above_night?: number | null;
            readonly vpd_below_day?: number | null;
            readonly vpd_below_night?: number | null;
            readonly vpd_day?: number | null;
            /** @description Edge form: the VPD high edge at solar noon, kPa */
            readonly vpd_high_day?: number | null;
            /** @description Edge form: the VPD high edge at solar midnight, kPa */
            readonly vpd_high_night?: number | null;
            /** @description Edge form: the VPD low edge at solar noon, kPa */
            readonly vpd_low_day?: number | null;
            /** @description Edge form: the VPD low edge at solar midnight, kPa */
            readonly vpd_low_night?: number | null;
            readonly vpd_night?: number | null;
        };
        /** @description API-23: the house band as stored (current) and drafted, one point per step_s */
        readonly BandProfilePreview: {
            /** @description The anchors a Save would write */
            readonly changed: readonly string[];
            readonly current: components["schemas"]["BandProfileState"];
            /**
             * Format: date
             * @description America/Denver day
             */
            readonly day: string;
            readonly draft: components["schemas"]["BandProfileState"];
            readonly envelope: {
                readonly days: number;
                readonly dewpoint_p10_f: number;
                readonly hours: number;
                readonly rmse_f: number;
            } | null;
            readonly findings: readonly {
                /**
                 * @example band_order
                 * @example guardrail
                 * @example night_floor
                 * @example overshoot
                 * @example dewpoint_unreached
                 * @example night_floor_unachievable
                 */
                readonly code: string;
                readonly detail: string;
                readonly field: string;
                /** @enum {string} */
                readonly severity: "error" | "warning";
            }[];
            /** @description The day's outdoor forecast on t; every step of an hour holds that hour's newest issue */
            readonly forecast: {
                /**
                 * Format: date-time
                 * @description The newest fetched_at behind the values
                 */
                readonly issued_at: string | null;
                /** @description Outdoor forecast temperature, °F */
                readonly temp: components["schemas"]["NullableNumbers"];
                /** @description Outdoor forecast VPD, kPa */
                readonly vpd: components["schemas"]["NullableNumbers"];
            };
            readonly guardrails: {
                /** @description The control law dries the house below vpd_low plus this */
                readonly dry_on_above_vpd_low_kpa: number;
                readonly margin_f: number;
                /** @description The control law's minimum temperature band width at every point of the day */
                readonly min_width_f: number;
                /** @description The control law's minimum VPD band width at every point of the day */
                readonly min_width_kpa: number;
                /** @description The drying line (vpd_low + dry_on_above_vpd_low_kpa) stays at or above this all night */
                readonly night_vpd_floor_kpa: number;
                readonly temp_max_f: number;
                readonly temp_min_f: number;
                readonly vpd_max_kpa: number;
                readonly vpd_min_kpa: number;
            };
            readonly law_lines: components["schemas"]["BandLawLines"];
            /** @description The last 24 h of the measured house average on t, by America/Denver clock time: a step before now holds today's 10-min bucket, a later step yesterday's */
            readonly measured: {
                /** @description Per step, the bucket its values come from; null if none */
                readonly at: readonly (number | null)[];
                /** @description climate.temp_avg, °F */
                readonly temp: components["schemas"]["NullableNumbers"];
                /** @description climate.vpd_avg, kPa */
                readonly vpd: components["schemas"]["NullableNumbers"];
                /** @description Epoch seconds at the end of the bucket holding now */
                readonly window_end: number;
                /** @description Epoch seconds of the oldest bucket read */
                readonly window_start: number;
            };
            readonly night_heat_kwh: {
                readonly current: number | null;
                readonly draft: number | null;
            };
            /** @description By series, how far the draft curve leaves its anchor range */
            readonly overshoot: {
                readonly [key: string]: number;
            };
            /** @constant */
            readonly step_s: 600;
            readonly sun: {
                readonly solar_midnight: number | null;
                readonly solar_noon: number | null;
                /** @description Epoch seconds */
                readonly sunrise: number | null;
                readonly sunset: number | null;
            };
            /** @description Epoch seconds */
            readonly t: readonly number[];
            readonly temp: {
                readonly current: components["schemas"]["BandCurve"];
                readonly draft: components["schemas"]["BandCurve"];
            };
            readonly vpd: {
                readonly current: components["schemas"]["BandCurve"];
                readonly draft: components["schemas"]["BandCurve"];
                readonly expected_high: components["schemas"]["NullableNumbers"];
                readonly expected_low: components["schemas"]["NullableNumbers"];
            };
        };
        readonly BandProfileState: {
            /** @description The 24 band_<series>_<anchor> values */
            readonly anchors: {
                readonly [key: string]: number;
            };
            readonly edges: components["schemas"]["BandProfileEdges"];
            readonly edges_simple: components["schemas"]["BandEdgesSimple"];
            readonly profile: components["schemas"]["BandProfile"];
            /** @description True when sunrise and sunset are the midpoint of noon and midnight */
            readonly simple: boolean;
        };
        readonly BandSave: {
            /** @description Advanced: raw house anchors */
            readonly anchors?: {
                readonly [key: string]: number;
            };
            /** @default true */
            readonly manual?: boolean;
            readonly profile?: components["schemas"]["BandProfilePatch"];
            readonly reason?: string;
        };
        /** @description One point per step_s */
        readonly BandTimeline: {
            /** @description Asked for with achievable: the house's achievable VPD band and grades; null otherwise, for a zone or past 35 days */
            readonly achievable?: components["schemas"]["AchievableColumns"] | null;
            /** @description In force (DERIVED band rows of the requested zone); null beyond 90 days */
            readonly band: components["schemas"]["BandColumns"];
            /** @description Reconstructed from today's anchors (API-06 says how) */
            readonly crop: components["schemas"]["BandColumns"];
            /** Format: date-time */
            readonly from: string;
            readonly step_s: number;
            /** @description Epoch seconds */
            readonly t: readonly number[];
            /** Format: date-time */
            readonly to: string;
        };
        readonly BandWrite: {
            readonly changed: readonly components["schemas"]["DesiredSetting"][];
        };
        readonly Catalog: {
            readonly items: readonly components["schemas"]["CatalogEntry"][];
        };
        readonly CatalogEntry: {
            readonly category?: string | null;
            readonly name: string;
            readonly slug: string;
        };
        readonly CellView: {
            readonly label: string;
            readonly layout_col?: number | null;
            readonly layout_group?: string | null;
            readonly layout_row?: number | null;
            readonly mount_type?: string | null;
            readonly number?: number | null;
            readonly occupant?: components["schemas"]["Occupant"] | null;
        };
        /** @description A physical line (#1336): Wall drip (every wall and shelf), Center drip, and the Center, South and West misters, each with a clean and a fertilized variant mapped to its relay. Fog is a climate device, not a physical line */
        readonly Circuit: {
            readonly circuit_id: components["schemas"]["CircuitId"];
            readonly clean: components["schemas"]["CircuitVariant"];
            readonly fertilized: components["schemas"]["CircuitVariant"];
            /** @enum {string} */
            readonly kind: "drip" | "mister";
            readonly name: string;
            /** @enum {string} */
            readonly zone: "wall" | "center" | "south" | "west";
        };
        /** @enum {string} */
        readonly CircuitId: "wall_drip" | "center_drip" | "center_mister" | "south_mister" | "west_mister";
        /** @description One variant of a physical line: its relay, or line_id null and wired false when that valve has no relay (shown, never scheduled or run). master_valve: L03 opens with it, fertilized only (#1336) */
        readonly CircuitVariant: {
            readonly enabled: boolean;
            readonly line_id: components["schemas"]["LineId"] | null;
            readonly master_valve: boolean;
            readonly running: boolean;
            readonly variant: components["schemas"]["Variant"];
            readonly wired: boolean;
        };
        /** @description An irrigation_command row: pending until the ingestor marks it sent, just before it calls the device (sent at most once), or failed when not sent within 2 min. Relay edges and irr_state show the outcome */
        readonly Command: {
            readonly actor: components["schemas"]["Actor"];
            /** @description The request body as stored */
            readonly args?: Record<string, unknown>;
            /** Format: uuid */
            readonly command_id: string;
            /** Format: date-time */
            readonly created_at: string;
            /** @enum {string} */
            readonly kind: "run" | "stop" | "clear_fault" | "override";
            /** @description Null means every line */
            readonly line_id: string | null;
            readonly reason?: string | null;
            /** Format: date-time */
            readonly sent_at?: string | null;
            /** @enum {string} */
            readonly status: "pending" | "sent" | "failed";
        };
        readonly Conflict: {
            readonly cell: string;
            readonly crop: string;
            readonly planting_id: number;
            /** Format: date-time */
            readonly since: string;
            /** Format: date-time */
            readonly until?: string | null;
        };
        /** @description ESP32 diagnostics; a reset of uptime_s confirms a restart */
        readonly Controller: {
            readonly firmware_version?: string | null;
            /**
             * @description The gap log's state (diagnostics.gap_log_state), as LawAlone.gap_log words it: armed, not_armed_yet, nvs_small, nvs_full, nvs_slow or nvs_error; a newer state is sent as stored. Null until reported
             * @example armed
             * @example nvs_full
             */
            readonly gap_log?: string | null;
            /** @description kB, as stored in diagnostics.heap_bytes */
            readonly heap_free_kb?: number | null;
            readonly heap_largest_block_kb?: number | null;
            /** @description The lowest free heap in the last minute, kB (diagnostics.heap_min_free_minute_kb, newest non-null over 15 min) */
            readonly heap_minute_low_kb?: number | null;
            /** Format: date-time */
            readonly observed_at?: string | null;
            readonly reset_reason?: string | null;
            /** @description Restarts the controller has counted (diagnostics.restart_count); null until it reports one */
            readonly restart_count?: number | null;
            readonly rssi_dbm?: number | null;
            readonly uptime_s?: number | null;
        };
        /** @description API-35: the controller's hardware budget, from the newest non-null diagnostics value per column over 15 min. Null means not reported in that window, never 0 */
        readonly ControllerHealth: {
            /**
             * @description As LawBand.source
             * @example onchip_curve
             */
            readonly band_source: string | null;
            readonly clock: {
                /** @description Time syncs missed */
                readonly misses: number | null;
                readonly sync_age_s: number | null;
                readonly valid: boolean | null;
            };
            readonly firmware: {
                readonly matches: boolean | null;
                /** @description The firmware the ingestor expects (system_state ingestor_counters) */
                readonly pinned: string | null;
                /** @description The firmware the controller runs */
                readonly version: string | null;
            };
            /**
             * @description As LawAlone.gap_log
             * @example armed
             */
            readonly gap_log: string | null;
            /** @description kB */
            readonly heap: {
                readonly free_kb: number | null;
                readonly largest_block_kb: number | null;
                readonly largest_block_minute_low_kb: number | null;
                /** @description The lowest since the restart */
                readonly min_free_kb: number | null;
                /** @description The lowest in the last minute */
                readonly minute_low_kb: number | null;
            };
            /** @description The hardware-budget thresholds from their one existing definition */
            readonly limits: {
                /** @description Free heap under this is critical */
                readonly heap_critical_kb: number;
                /** @description Free heap under this for 2 min warns */
                readonly heap_warning_kb: number;
                /** @description The largest free block a firmware update needs */
                readonly largest_block_kb: number;
                /** @description A control loop slower than this warns */
                readonly loop_worst_ms: number;
                /** @description The gap log arms with at least this share of storage free */
                readonly nvs_arm_free_pct: number;
                /** @description The gap log stops under this share free */
                readonly nvs_stop_free_pct: number;
                /** @description Storage writes slower than this stop the gap log */
                readonly nvs_write_ms: number;
                /** @description The free heap a firmware update needs */
                readonly ota_free_kb: number;
                /** @description Free stack under this warns */
                readonly stack_free_b: number;
            };
            readonly loop: {
                /** @description The least free stack seen */
                readonly stack_free_min_b: number | null;
                /** @description The slowest control loop in the last minute */
                readonly worst_ms: number | null;
            };
            /** @description The controller's settings storage */
            readonly nvs: {
                readonly free_entries: number | null;
                readonly used_entries: number | null;
                readonly write_worst_ms: number | null;
            };
            /** Format: date-time */
            readonly observed_at: string | null;
            readonly probes: {
                readonly active: number | null;
                readonly degraded: boolean | null;
                /**
                 * @description The controller's probe summary as it sends it
                 * @example OK
                 * @example North INVALID, South STALE
                 */
                readonly health: string | null;
            };
            readonly restarts: {
                /** Format: date-time */
                readonly booted_at: string | null;
                readonly count: number | null;
                /** @example Software reset */
                readonly reset_reason: string | null;
            };
            readonly uptime_s: number | null;
            readonly wifi: {
                /** @description Connections to the controller's API */
                readonly api_clients: number | null;
                readonly disconnects: number | null;
                readonly rssi_dbm: number | null;
            };
        };
        /** @description API-32: one row per America/Denver day, oldest first, with the 7- and 30-day means and the periods before and since the law */
        readonly DailyRecord: {
            /** @description The 30 days before law_started, leaving out days with a band edit (activity_log band.write); null when law_started is null */
            readonly baseline: components["schemas"]["RecordPeriod"] | null;
            /** @description Ascending by date */
            readonly days: readonly components["schemas"]["RecordDay"][];
            /** Format: date */
            readonly from: string;
            /**
             * Format: date
             * @description The local day of the controller's first law record; null when none is stored
             */
            readonly law_started: string | null;
            /** @description The means the reviewer and the owner compare against, over complete days only; null with no complete day */
            readonly means: {
                readonly d7: components["schemas"]["RecordMeans"] | null;
                readonly d30: components["schemas"]["RecordMeans"] | null;
            };
            /** Format: date-time */
            readonly server_time: string;
            /** @description The days from the day after law_started through yesterday, band-edit days left out as in baseline; null until one of those days is complete (ended and its record stored) */
            readonly since_law: components["schemas"]["RecordPeriod"] | null;
            /**
             * Format: date
             * @description Inclusive local day
             */
            readonly to: string;
        };
        /** @description API-36: whether telemetry is flowing, what was lost and what the gap log restored */
        readonly DataContinuity: {
            /** @description Per local day, oldest first */
            readonly by_day: readonly {
                /** Format: date */
                readonly date: string;
                /** @description Seconds of outages not restored */
                readonly outage_s: number;
                /** @description Minutes the gap log restored */
                readonly replayed_min: number;
            }[];
            /** Format: date-time */
            readonly from: string;
            /**
             * @description As LawAlone.gap_log
             * @example armed
             */
            readonly gap_log: string | null;
            readonly ingestor: {
                readonly heartbeat_age_s: number | null;
                /**
                 * Format: date-time
                 * @description The ingestor_counters row
                 */
                readonly observed_at: string | null;
                readonly payloads_rejected: number | null;
                readonly reconnects: number | null;
                readonly replay_failures: number | null;
                /** @description Rows that failed validation */
                readonly rows_rejected: {
                    readonly [key: string]: number;
                } | null;
            };
            /** @description Telemetry outages the gap log has not restored (v_data_gaps_unreplayed), newest first, at most 200 */
            readonly outages: readonly {
                readonly duration_s: number;
                /** Format: date-time */
                readonly end: string;
                /**
                 * @description Why the ingestor lost telemetry, as stored
                 * @example ingestor_restart
                 * @example ingestor_process_restart
                 */
                readonly reason: string;
                /** Format: date-time */
                readonly start: string;
                /**
                 * @description What the ingestor saved when it came back, as stored
                 * @example snapshot_taken
                 * @example snapshot_incomplete
                 */
                readonly status: string;
            }[];
            readonly probes: readonly {
                /** @description Seconds since its newest reading; 7200 means not seen in 2 h */
                readonly age_s: number | null;
                /**
                 * Format: date-time
                 * @description For a probe not seen in 2 h, the time of its newest reading in the last 30 days; null when it has none in 30 days, and null for a probe seen in the last 2 h, whose age already says it
                 */
                readonly last_seen_at: string | null;
                /** @example climate.temp_north */
                readonly sensor: string;
            }[];
            /** @description The quarters of one-minute records the controller replayed from its gap log, newest first, at most 200 */
            readonly replayed: readonly {
                /** @description The controller boot the quarter belongs to */
                readonly boot: number;
                readonly climate_rows: number;
                /** Format: date-time */
                readonly first_at: string;
                /** Format: date-time */
                readonly last_at: string;
                /** @description The quarter's number within that boot */
                readonly qseq: number;
                /** Format: date-time */
                readonly received_at: string;
                readonly transition_rows: number;
            }[];
            readonly tables: readonly {
                readonly last_row_age_s: number | null;
                /** @description Rows written in the last 5 minutes */
                readonly rows_5m: number | null;
                /**
                 * @example climate
                 * @example diagnostics
                 * @example equipment_state
                 */
                readonly table: string;
            }[];
            /** Format: date-time */
            readonly to: string;
        };
        /** @description API-37: whether the controller took what the host pushed (setpoint_changes in the window) */
        readonly Delivery: {
            readonly by_status: readonly {
                readonly count: number;
                /**
                 * @description Who pushed the change
                 * @example band
                 * @example manual
                 * @example plan
                 * @example esp32
                 * @example none
                 */
                readonly source: string;
                /**
                 * @description Where its delivery stands
                 * @example confirmed
                 * @example failed
                 * @example observed
                 * @example pending
                 * @example cancelled
                 * @example superseded
                 */
                readonly status: string;
            }[];
            /**
             * @description The dispatcher's stage, as it reports it
             * @example ordinary
             * @example paced 12/40
             */
            readonly dispatcher_stage: string | null;
            /** @description Settings with a failed push in the window, worst first, at most 50 */
            readonly failing: readonly {
                readonly failed: number;
                readonly label: string;
                /** Format: date-time */
                readonly last_confirmed_at: string | null;
                /** Format: date-time */
                readonly last_failed_at: string;
                readonly param: string;
            }[];
            /** Format: date-time */
            readonly from: string;
            /** @description From push to readback confirmation */
            readonly latency: {
                readonly confirmed: number;
                readonly p50_s: number | null;
                readonly p95_s: number | null;
            };
            /** @description Age of the oldest push still waiting; 0 when nothing waits */
            readonly oldest_unconfirmed_s: number | null;
            /** @description The newest readback pass (system_state setpoint_snapshot_pass) */
            readonly readback_pass: {
                /** Format: date-time */
                readonly at: string | null;
                readonly of: number | null;
                readonly stored: number | null;
            };
            /** Format: date-time */
            readonly to: string;
        };
        /** @description The newest desired_state row for a setting and its readback state. value null means released. */
        readonly DesiredSetting: {
            readonly actor: components["schemas"]["Actor"];
            /** Format: date-time */
            readonly confirmed_at?: string | null;
            /** Format: date-time */
            readonly created_at: string;
            readonly id: number;
            /** @description Iris skips the setting while true */
            readonly manual: boolean;
            /** @description The flag before this write (write responses) */
            readonly manual_before?: boolean | null;
            readonly param: string;
            readonly reason?: string | null;
            /** @description Submitted value when snapping changed it (write responses) */
            readonly snapped_from?: number | null;
            readonly state: components["schemas"]["ReadbackState"];
            readonly state_reason?: components["schemas"]["StateReason"] | null;
            /** @description Stored value after snapping */
            readonly value: number | null;
        };
        readonly Equipment: {
            /** @description What holds fog (L11) off */
            readonly fog_block_reason?: components["schemas"]["ReasonState"];
            readonly items: readonly {
                /** @description Grow lights only: the controller's newest reason for its intent (gl_main_reason, gl_grow_reason), for example plant_lux_low, plant_hysteresis_hold, outside_window or auto_disabled; null while the controller is not reporting or before any reason row (#1335) */
                readonly auto_reason?: string | null;
                /** @description From collapsed ON/OFF edges */
                readonly cycles_today?: number | null;
                /**
                 * @example fan1
                 * @example heat2
                 * @example mister_center
                 * @example grow_light_main
                 */
                readonly equipment: string;
                /** @enum {string} */
                readonly group: "climate" | "water" | "light";
                /**
                 * @description Grow lights only: the controller's intent (grow_light_main_intent, grow_light_grow_intent)
                 * @enum {string|null}
                 */
                readonly intent?: "on" | "off" | "unknown" | null;
                readonly label: string;
                readonly line_id?: string | null;
                /**
                 * Format: date-time
                 * @description Grow lights only: when the API-20 manual switch goes back to automatic (its activity_log row's ts plus detail.minutes, the light timer's rule), while that is still ahead; null with no timer running
                 */
                readonly manual_until?: string | null;
                /** Format: date-time */
                readonly observed_at: string | null;
                readonly runtime_today_s?: number | null;
                /**
                 * Format: date-time
                 * @description Start of the current run of equal states
                 */
                readonly since?: string | null;
                /**
                 * @description The newest row while the controller is online; unknown only while it is offline or there is no row. For the vent, on means open; for the grow lights, the Lutron readback
                 * @enum {string}
                 */
                readonly state: "on" | "off" | "unknown";
            }[];
            /** @description What holds the misters off */
            readonly moisture_block_reason?: components["schemas"]["ReasonState"];
        };
        /** @description How old a source is. A sensor source is stale when its age exceeds twice its cadence; the ingestor heartbeat (cadence 60 s) after 180 s; a change-only source (equipment_state, irr_state) only while the controller is offline; a source never seen is stale */
        readonly Freshness: {
            readonly age_s: number | null;
            readonly cadence_s?: number;
            /** Format: date-time */
            readonly observed_at: string | null;
            readonly stale: boolean;
        };
        readonly HarvestRecord: {
            readonly id: number;
            readonly notes?: string | null;
            readonly operator?: string | null;
            /** Format: date-time */
            readonly ts?: string | null;
            readonly unit_count?: number | null;
            readonly weight_kg?: number | null;
        };
        /** @description The host's band at one moment (fn_band_setpoints); an edge it cannot compute is null */
        readonly HostBandEdges: {
            /** @description °F */
            readonly temp_high_f: number | null;
            /** @description °F */
            readonly temp_low_f: number | null;
            /** @description kPa */
            readonly vpd_high_kpa: number | null;
            /** @description kPa */
            readonly vpd_low_kpa: number | null;
        };
        /** @enum {string} */
        readonly IrrigationCause: "vpd" | "schedule" | "run_now" | "feed" | "prewet" | "flush" | "fallback" | "unknown";
        readonly IrrigationLine: {
            /** @description The one-time physical check (D-IRP-07, D-IRP-08), recorded on the dashboard; null until someone records it */
            readonly check: null | {
                /** Format: date-time */
                readonly checked_at: string;
                readonly checked_by: string;
                readonly note?: string | null;
            };
            readonly clean_partner?: string | null;
            /** @description 0 means none */
            readonly daily_cap_min: number;
            readonly enabled: boolean;
            /**
             * @description D-IRP-19 watchdog: a back-off, or a latch until midnight or a clear
             * @enum {string|null}
             */
            readonly fault?: "backing_off" | "mister_fault" | null;
            /** Format: date-time */
            readonly fault_until?: string | null;
            /** @enum {string} */
            readonly kind: "drip" | "mister" | "fert_drip" | "fert_mister" | "master" | "fog";
            readonly last_outcome?: null | {
                /** Format: date-time */
                readonly at: string;
                readonly outcome: components["schemas"]["RunOutcome"];
                readonly reason?: string | null;
            };
            /** @description The newest run on the line that opened a valve: relay-edge runs, joined to their ledger row when there is one; the run in progress and VPD episodes included */
            readonly last_water?: null | {
                /** Format: date-time */
                readonly at: string;
                readonly cause: components["schemas"]["IrrigationCause"];
                readonly open_s: number;
                readonly pulses?: number | null;
                readonly purpose?: components["schemas"]["RunPurpose"];
            };
            readonly line_id: components["schemas"]["LineId"];
            /** @description Iris skips this line while true */
            readonly manual: boolean;
            /** @description The flag before this write (write responses) */
            readonly manual_before?: boolean | null;
            /**
             * @description The line's display name, the words a person reads (#1341); line_id stays the machine key
             * @example Wall drip
             */
            readonly name: string;
            readonly next_run?: components["schemas"]["NextRun"] | null;
            /** @description That row's reason; null when the line is not paused or none was given */
            readonly pause_reason?: string | null;
            /** @description Who set the current paused_until: the newest activity_log row with action irrigation.line.update, target the line or all, whose detail sets paused_until. Null when the line is not paused */
            readonly paused_by?: components["schemas"]["Actor"] | null;
            /** Format: date-time */
            readonly paused_until: string | null;
            /** @description True for L05 and L06 (Round 2b E): schedulable, no bring-up now; shown reserved while disabled */
            readonly reserved: boolean;
            /** @description Misters only; confirmed by the program hash */
            readonly schedule_member?: boolean | null;
            readonly state: components["schemas"]["LineState"];
            /** @description This line's fields against the program hash */
            readonly sync: components["schemas"]["ReadbackState"];
            /** @description Every purpose (the cap counts all of it); climate_minutes and climate_pulses are the VPD and fallback misting inside it */
            readonly today?: {
                readonly climate_minutes?: number | null;
                readonly climate_pulses?: number | null;
                /** @description Whole gallons */
                readonly gal?: number | null;
                readonly minutes?: number | null;
                readonly pulses?: number | null;
            };
            /** @description Misters L04, L07 and L09 only; confirmed by the program hash */
            readonly vpd_member?: boolean | null;
            readonly vpd_reserve_min?: number | null;
            /**
             * @description Own probe, peer mean or house average (D-IRP-13)
             * @enum {string|null}
             */
            readonly vpd_source?: "own" | "peer" | "house" | null;
            /**
             * @description The line's place: supply for L03, house for L11. Minutes by zone use fog for L11 and leave L03 out
             * @enum {string}
             */
            readonly zone: "wall" | "center" | "south" | "west" | "supply" | "house";
        };
        readonly IrrigationStatus: {
            /** @description The run on each manifold */
            readonly active_runs: readonly {
                readonly cause: components["schemas"]["IrrigationCause"];
                /** Format: date-time */
                readonly ends_at?: string | null;
                readonly line_id: components["schemas"]["LineId"];
                /** @enum {string} */
                readonly manifold: "drip" | "mister";
                readonly pulses_done?: number | null;
                readonly pulses_total?: number | null;
                readonly slot_id?: number | null;
                /** Format: date-time */
                readonly started_at: string;
            }[];
            /** @description The five physical lines over the relays (#1336) */
            readonly circuits: readonly components["schemas"]["Circuit"][];
            /** @description The live controller connection has the irrigation engine (irr_command); false before the engine firmware */
            readonly engine: boolean;
            /** @description degraded_only slots are running (D-IRP-12) */
            readonly fallback_active: boolean;
            /** @description irr_state (published on transitions) */
            readonly freshness: components["schemas"]["Freshness"];
            readonly leak: components["schemas"]["Leak"];
            /** @description Per-line duty and drip caps are on each line (today.minutes against daily_cap_min) */
            readonly limits: {
                readonly saf4_gal: components["schemas"]["UsedOfMax"];
                readonly soft_budget_gal: components["schemas"]["UsedOfMax"];
            };
            /** @description L01-L11 */
            readonly lines: readonly components["schemas"]["IrrigationLine"][];
            readonly occupancy: components["schemas"]["Occupancy"];
            readonly program: components["schemas"]["ProgramSync"];
            /** Format: date-time */
            readonly server_time: string;
            /** @description Valve-open minutes today by zone: wall, center, south and west, and fog for L11's humidification. L03's supply minutes are never in zone totals. Partial day */
            readonly today: {
                /** @description The site's mist and fog today (#1348): VPD and fallback misting plus fog; null on a day with no data */
                readonly climate?: {
                    /** @description Whole gallons */
                    readonly gal?: number | null;
                    readonly minutes?: number | null;
                    readonly pulses?: number | null;
                };
                /** @description The VPD and fallback misting inside each zone's minutes (#1348), with the same nulls; fog is all climate */
                readonly climate_zones?: {
                    readonly [key: string]: number | null;
                };
                /** Format: date */
                readonly date: string;
                readonly zones: {
                    readonly [key: string]: number | null;
                };
            };
        };
        /** @description What the controller needs to keep running without the host */
        readonly LawAlone: {
            readonly clock: {
                /** @description Seconds since its last time sync */
                readonly sync_age_s: number | null;
                /** @description The controller's clock is set (diagnostics.sntp_valid) */
                readonly valid: boolean | null;
            };
            /**
             * @description The gap log that keeps a record while the host is away (diagnostics.gap_log_state): armed, not armed yet since the restart, or off because storage is too small, full, too slow or failing
             * @enum {string|null}
             */
            readonly gap_log: "armed" | "not_armed_yet" | "nvs_small" | "nvs_full" | "nvs_slow" | "nvs_error" | null;
            readonly host: {
                /** @description The ingestor is connected to the controller */
                readonly connected: boolean | null;
                /** @description Age of the ingestor's heartbeat */
                readonly heartbeat_age_s: number | null;
            };
            readonly probes: {
                /** @description Probes the controller reads (diagnostics.active_probe_count) */
                readonly active: number | null;
                /** @description The controller runs on fewer probes than it should (diagnostics.sensor_degraded_active) */
                readonly degraded: boolean | null;
            };
        };
        /** @description The band the controller is using now (the law record's b field), and how it compares with the host's */
        readonly LawBand: {
            /** @description The controller's band and the host's differ by more than 1.0 °F or 0.10 kPa on an edge (the band_device_db_divergence rule); null when either is missing */
            readonly differs: boolean | null;
            /** @description The band the host computes for now (fn_band_setpoints(now())); null when it cannot */
            readonly host: components["schemas"]["HostBandEdges"] | null;
            /** @description The controller's band check changed the band it received (the record's br field) */
            readonly repaired: boolean | null;
            /**
             * @description Where the controller takes its band from (diagnostics.band_source): its own diurnal curve from the pushed anchors, the corridor, or the older dispatcher push
             * @enum {string|null}
             */
            readonly source: "onchip_curve" | "corridor" | "dispatcher_legacy" | null;
            /** @description °F */
            readonly temp_high_f: number | null;
            /** @description °F */
            readonly temp_low_f: number | null;
            /** @description kPa */
            readonly vpd_high_kpa: number | null;
            /** @description kPa */
            readonly vpd_low_kpa: number | null;
        };
        readonly LawConstants: {
            /** @description The hash of the law constants the controller reports (system_state climate_law_constants) */
            readonly hash: string | null;
            /** @description The two hashes are equal; null while the controller has not reported one */
            readonly matches: boolean | null;
            /** Format: date-time */
            readonly observed_at: string | null;
            /** @description The hash of the constants this API build was generated from */
            readonly release_hash: string;
        };
        /** @description Drying: venting with drier outdoor air when the house is too humid. running: drying runs; refused: the house wants drying and the law refuses it, for refused_reason; not_wanted: the house is dry enough; unknown: no law record */
        readonly LawDrying: {
            /** @description The decision chain in the order the law refuses, so the first check that fails is refused_reason (no_outdoor leaves outdoor_drier null). warm_enough and worth_it decide only the start: both are true while a run is on */
            readonly checks: readonly {
                /** @enum {string} */
                readonly id: "humid" | "not_cooling" | "furnace_off" | "outdoor_drier" | "warm_enough" | "worth_it";
                readonly ok: boolean | null;
            }[];
            /** @description kWh of heat per kg of water removed (the record's e field); null when the controller reports no price (no outdoor data) */
            readonly cost_kwh_per_kg: number | null;
            /** @description The drying cost limit in force on the controller (the record's lim field) */
            readonly limit_kwh_per_kg: number | null;
            /**
             * @description owner: a desired_state row for dry_cost_limit_kwh_per_kg exists; default: the controller's compiled value
             * @enum {string}
             */
            readonly limit_source: "owner" | "default";
            /** @description The controller's drying counters since its last restart (system_state climate_drying_meter) */
            readonly meter: {
                /** @description Heat carried out with it */
                readonly heat_wh: number | null;
                /** Format: date-time */
                readonly observed_at: string | null;
                /** @description Seconds drying was wanted and did not run */
                readonly refused_seconds: number | null;
                /** @description Seconds drying ran with the vent open */
                readonly seconds: number | null;
                /** @description Grams of water carried out */
                readonly water_g: number | null;
            };
            /** @description Drying needs the house above this: the band low plus the drying temperature margin */
            readonly min_temp_f: number | null;
            /** @description The air latch: outdoor air holds less water than indoor air */
            readonly outdoor_drier: boolean | null;
            /**
             * @description The record's dr field: the first refusal while drying is wanted and not running; humidity_invalid or no_temperature whenever those inputs are missing; none otherwise
             * @enum {string|null}
             */
            readonly refused_reason: "none" | "no_outdoor" | "cooling" | "furnace" | "not_drier" | "too_cold" | "cost" | "humidity_invalid" | "no_temperature" | null;
            /** @enum {string} */
            readonly state: "running" | "refused" | "not_wanted" | "unknown";
            /** @description Drying stops above this VPD: vpd_low plus the drying-off margin */
            readonly stop_above_kpa: number | null;
            /** @description Today's daily_record row; null before it is written */
            readonly today: null | {
                readonly heat_wh: number | null;
                /** @description A restart lost meter counts today */
                readonly lower_bound: boolean | null;
                readonly runs: number | null;
                readonly seconds: number | null;
                readonly water_g: number | null;
            };
            /** @description The dry latch: the house is humid enough to want drying */
            readonly wanted: boolean | null;
            /** @description Drying is wanted below this VPD: vpd_low plus the drying-on margin */
            readonly wanted_below_kpa: number | null;
        };
        /** @description API-31: the law's decisions over [from, to). A span of more than 180 s with no law record is unknown */
        readonly LawHistory: {
            /** @description The band the controller used, per bucket */
            readonly band: {
                /** @enum {integer} */
                readonly bucket_s: 60 | 300 | 900 | 3600 | 10800 | 86400;
                /** @description Bucket starts, epoch seconds */
                readonly t: readonly number[];
                readonly temp_high_f: components["schemas"]["NullableNumbers"];
                readonly temp_low_f: components["schemas"]["NullableNumbers"];
                readonly vpd_high_kpa: components["schemas"]["NullableNumbers"];
                readonly vpd_low_kpa: components["schemas"]["NullableNumbers"];
            };
            /** @description The spans in which the controller's band check changed the band it received */
            readonly band_repaired: readonly {
                /** Format: date-time */
                readonly end: string;
                /** Format: date-time */
                readonly start: string;
            }[];
            /** @description The drying price and the limit in force, per bucket; null where no record reports one */
            readonly cost: {
                /** @enum {integer} */
                readonly bucket_s: 60 | 300 | 900 | 3600 | 10800 | 86400;
                readonly cost_kwh_per_kg: components["schemas"]["NullableNumbers"];
                readonly limit_kwh_per_kg: components["schemas"]["NullableNumbers"];
                /** @description Bucket starts, epoch seconds */
                readonly t: readonly number[];
            };
            /** @description Drying's state over the window, as change intervals */
            readonly drying: readonly {
                /** Format: date-time */
                readonly end: string;
                /** @description The refusal reason while refused (LawDrying.refused_reason's values); null otherwise */
                readonly reason: string | null;
                /** Format: date-time */
                readonly start: string;
                /** @enum {string} */
                readonly state: "running" | "refused" | "not_wanted" | "unknown";
            }[];
            /**
             * Format: date-time
             * @description The oldest law record; earlier spans have none
             */
            readonly first_record_at: string | null;
            /** Format: date-time */
            readonly from: string;
            /** @description One per request and per latch, in the fixed order of LawLane.key */
            readonly lanes: readonly components["schemas"]["LawLane"][];
            readonly outdoor_source: readonly {
                /** Format: date-time */
                readonly end: string;
                /** @enum {string} */
                readonly source: "station" | "intake" | "none" | "unknown";
                /** Format: date-time */
                readonly start: string;
            }[];
            /** Format: date-time */
            readonly to: string;
        };
        /** @description What the law is reading */
        readonly LawInputs: {
            /** @description Indoor dew point, °F */
            readonly dew_point_f: number | null;
            /**
             * Format: date-time
             * @description The climate row the readings come from
             */
            readonly observed_at: string | null;
            readonly outdoor: {
                readonly dew_point_f: number | null;
                readonly rh_pct: number | null;
                /**
                 * @description Where the outdoor reading comes from (system_state outdoor_source): the weather station, the intake probe, or none
                 * @enum {string|null}
                 */
                readonly source: "station" | "intake" | "none" | null;
                readonly temp_f: number | null;
            };
            /** @description Indoor relative humidity */
            readonly rh_pct: number | null;
            /** @description The control temperature, °F (climate.temp_control) */
            readonly temp_f: number | null;
            /** @description The control VPD, kPa (climate.vpd_control) */
            readonly vpd_kpa: number | null;
        };
        readonly LawLane: {
            /** @enum {string} */
            readonly group: "request" | "latch";
            readonly intervals: readonly {
                /** Format: date-time */
                readonly end: string;
                /** Format: date-time */
                readonly start: string;
                /** @enum {string} */
                readonly state: "on" | "off" | "unknown";
            }[];
            /**
             * @description request.fan1 is at least one fan, request.fan2 both fans
             * @enum {string}
             */
            readonly key: "request.heat1" | "request.heat2" | "request.vent" | "request.fog" | "request.mist" | "request.fan1" | "request.fan2" | "request.cooling" | "request.drying" | "request.hot" | "request.cold" | "latch.h1" | "latch.h2" | "latch.cool" | "latch.cool2" | "latch.wet" | "latch.mist" | "latch.dry" | "latch.air" | "latch.run";
        };
        readonly LawRelay: {
            /** @enum {string} */
            readonly equipment: "heat1" | "heat2" | "vent" | "fan1" | "fan2" | "fog" | "mister_any";
            /**
             * Format: date-time
             * @description Start of the current run of equal states
             */
            readonly since: string | null;
            /**
             * @description The newest equipment_state row; unknown while the controller is not reporting
             * @enum {string}
             */
            readonly state: "on" | "off" | "unknown";
        };
        /** @description One rule of the law with its thresholds, latch, request and the relays it drives */
        readonly LawRule: {
            /**
             * @description The rule turns on when the signal goes below or above on_at
             * @enum {string}
             */
            readonly direction: "below" | "above";
            /** @description Set only when the host can prove it: requested with the relay off inside its minimum off time (min_off), or not requested with the relay on inside its minimum on time (min_on); null otherwise. Nothing is proven for a relay a manual run holds (or may hold, while its flag is unknown), for the fogger off unless the controller names its minimum off time as the reason, or for the fogger on outside the protection limits, where the irrigation engine can run it */
            readonly hold: null | {
                /** @enum {string} */
                readonly kind: "min_off" | "min_on";
                readonly remaining_s: number;
            };
            /** @enum {string} */
            readonly id: "heat1" | "heat2" | "cooling" | "second_fan" | "fog" | "mist" | "drying" | "hot_limit" | "cold_limit";
            /** @description The rule's latch bit (h1, h2, cool, cool2, wet, mist, dry); hot_limit and cold_limit have no latch and carry their request bits */
            readonly latched: boolean | null;
            /** @description Turns off back past this, in the signal's unit */
            readonly off_at: number | null;
            /** @description Turns on past this, in the signal's unit, from the band in use and the constants */
            readonly on_at: number | null;
            /** @description The relays this rule drives */
            readonly relays: readonly components["schemas"]["LawRelay"][];
            /** @description The law's request after its own gates (heat1, heat2, cooling, fans>=2, fog, mist, drying, hot, cold) */
            readonly requested: boolean | null;
            /**
             * @description The reading the rule watches: temperature (°F) or VPD (kPa)
             * @enum {string}
             */
            readonly signal: "temp" | "vpd";
        };
        /** @description The climate law's newest state record while it is fresh (its 60 s heartbeat, at most 120 s old). Latches and requests are named in bit order; drying is running, refused (the house wants drying and none runs, with the controller's first reason) or not_wanted. */
        readonly LawState: {
            /** @description The band the controller is using now (the record's b field); null when the record carries none */
            readonly band?: components["schemas"]["BandEdges"] | null;
            /** @description True when the controller's band check changed the band it received */
            readonly band_repaired: boolean;
            /** @enum {string} */
            readonly drying: "running" | "refused" | "not_wanted";
            /** @description kWh of heat per kg of water; null without outdoor data or when the outdoor air is not drier */
            readonly drying_cost_kwh_per_kg: number | null;
            /** @description The drying cost limit in force on the controller */
            readonly drying_cost_limit_kwh_per_kg: number;
            /**
             * @description The controller's reason while no run is on: why a wanted run is refused, or why drying is held
             * @example cost
             * @example not_drier
             * @example no_outdoor
             * @example humidity_invalid
             * @example no_temperature
             */
            readonly drying_refused_reason: string | null;
            readonly latches: readonly ("h1" | "h2" | "cool" | "cool2" | "wet" | "mist" | "dry" | "air" | "run")[];
            /** Format: date-time */
            readonly observed_at: string;
            readonly requests: readonly ("heat1" | "heat2" | "vent" | "fog" | "mist" | "fan1" | "fan2" | "cooling" | "drying" | "hot" | "cold")[];
        };
        /** @description The law's timing constants and safety limits, from the generated constants module */
        readonly LawTiming: {
            /** @description Everything heats below this, °F */
            readonly cold_limit_f: number;
            readonly fog_min_off_s: number;
            readonly fog_min_on_s: number;
            readonly furnace_boot_wait_s: number;
            /** @description Everything cools above this, °F */
            readonly hot_limit_f: number;
            readonly mist_gap_s: number;
            readonly mist_pulse_s: number;
            readonly relay_min_off_s: number;
            readonly relay_min_on_s: number;
        };
        /** @description API-30: what the controller's climate law is doing now and why. Thresholds come from the band in use and the law constants this API build was generated from, never from a typed value. Null means the controller has not reported it, never 0 */
        readonly LawView: {
            readonly alone: components["schemas"]["LawAlone"];
            readonly band: components["schemas"]["LawBand"];
            readonly constants: components["schemas"]["LawConstants"];
            readonly drying: components["schemas"]["LawDrying"];
            readonly inputs: components["schemas"]["LawInputs"];
            /**
             * @description The fan the law starts first (system_state lead_fan); null until the controller says
             * @enum {string|null}
             */
            readonly lead_fan: "fan1" | "fan2" | null;
            /**
             * Format: date-time
             * @description The newest law record's time; null with no law record
             */
            readonly observed_at: string | null;
            /** @description The newest law record is at most 120 s old (the rule control_proof.law_fresh uses) */
            readonly reporting: boolean;
            /** @description One per rule, in this fixed order: heat1, heat2, cooling, second_fan, fog, mist, drying, hot_limit, cold_limit */
            readonly rules: readonly components["schemas"]["LawRule"][];
            /** Format: date-time */
            readonly server_time: string;
            readonly timing: components["schemas"]["LawTiming"];
        };
        /** @description leak_detected: flow on the one site meter with every Verdify valve closed, so also the hose, sink or hydro. It raises the leak alert ("Water flowing with every Verdify valve closed") and nothing else: nothing latches, and the engine firmware forces nothing off (Round 2 #3, Q-05). Until that release the current firmware keeps its fog, mister and drip interlock. The flow banner shows while alert_id is set and reads "Flow stopped at HH:MM" once stopped_at is set, never an all clear */
        readonly Leak: {
            readonly active: boolean | null;
            /** @description The open leak_detected alert's merged-row id (Alert.id); null when none is open */
            readonly alert_id: number | null;
            /** @description Whole-gallon meter, so 0 or about 1 in practice */
            readonly flow_gpm?: number | null;
            /** @description Whole gallons */
            readonly gal_last_10min?: number | null;
            /** Format: date-time */
            readonly since?: string | null;
            /**
             * Format: date-time
             * @description When flow fell under 0.1 gal/min for two meter readings while that alert is open; null while flow continues
             */
            readonly stopped_at: string | null;
        };
        /** @description API-20: a grow-light switch that Lutron confirmed. A failure is a 503 Problem with its result */
        readonly LightCommand: {
            /** @description The activity_log row (light.on or light.off) */
            readonly activity_id: number;
            /** @enum {string} */
            readonly light: "main" | "grow";
            /**
             * @description setpoint-server saw Lutron reach the state
             * @enum {string}
             */
            readonly result: "confirmed";
            /** @enum {string} */
            readonly state: "on" | "off";
        };
        /** @description API-22: each grow-light circuit by America/Denver day, oldest first */
        readonly LightingDays: {
            readonly circuits: readonly {
                readonly days: readonly {
                    /** @description The window's cutoff, local hour */
                    readonly cutoff_hour: number | null;
                    /** Format: date */
                    readonly date: string;
                    /** @description OFF threshold: ON plus the hysteresis */
                    readonly lux_off: number | null;
                    /** @description ON threshold, outdoor lux */
                    readonly lux_on: number | null;
                    /** @description Seconds the Lutron readback was on in the day */
                    readonly on_s: number;
                    /** @description Today: counted up to now */
                    readonly partial: boolean;
                    /** @description Minutes in the window with enough outdoor light or the light on; null without a policy readback */
                    readonly qualified_min: number | null;
                    /** @description The photoperiod window's start, local hour; null without a readback */
                    readonly start_hour: number | null;
                    /** @description OFF to ON edges in the day */
                    readonly starts: number;
                    /** @description Target qualified light minutes */
                    readonly target_min: number | null;
                    /** @description Minutes of the window counted so far */
                    readonly window_min: number | null;
                }[];
                /** @example grow_light_main */
                readonly equipment: string;
                readonly label: string;
                /** @enum {string} */
                readonly light: "main" | "grow";
            }[];
            /** Format: date-time */
            readonly from: string;
            /** Format: date-time */
            readonly to: string;
        };
        /** @description Stop or clear-fault target; omit line_id for every line */
        readonly LineCommand: {
            readonly line_id?: components["schemas"]["LineId"];
            readonly reason?: string;
        };
        /** @description L01-L11 */
        readonly LineId: string;
        readonly LineState: {
            readonly cause?: components["schemas"]["IrrigationCause"] | null;
            /** @enum {string} */
            readonly code: "idle" | "running" | "waiting" | "blocked" | "paused" | "disabled" | "unknown";
            /** Format: date-time */
            readonly ends_at?: string | null;
            /**
             * Format: date-time
             * @description irr_state or relay edge
             */
            readonly observed_at?: string | null;
            /** @description Waiting or blocked reason in words, e.g. someone inside (Frigate) */
            readonly reason?: string | null;
            readonly slot_id?: number | null;
        };
        readonly LineUpdate: {
            /** @description Optional; dashboard only */
            readonly check_note?: string;
            /** @description Dashboard only (MCP tools do not take it); records checked_by and checked_at */
            readonly checked?: boolean;
            readonly daily_cap_min?: number;
            readonly enabled?: boolean;
            /** @description Iris skips the line while true. A REST definition edit (enabled, vpd_member, schedule_member, daily_cap_min or vpd_reserve_min) that omits it stores true (the dashboard default, R3); a body with none of those (only paused_until, the check or a reason) never changes it; MCP definition edits default false */
            readonly manual?: boolean;
            /**
             * Format: date-time
             * @description Null or now resumes; VPD misting carries on
             */
            readonly paused_until?: string | null;
            readonly reason?: string;
            /** @description L04, L07 and L09 only; on for the first time needs the check */
            readonly schedule_member?: boolean;
            /** @description L04, L07 and L09 only */
            readonly vpd_member?: boolean;
            /** @description At most daily_cap_min */
            readonly vpd_reserve_min?: number;
        };
        /** @description The location tree with what each place holds now: zone- and shelf-level plantings and each cell's occupant. */
        readonly Locations: {
            readonly active_plantings: number;
            readonly cell_count: number;
            readonly occupied_cells: number;
            /** Format: date-time */
            readonly server_time: string;
            readonly zones: readonly components["schemas"]["ZoneView"][];
        };
        readonly Me: {
            readonly display_name?: string | null;
            /** @enum {string} */
            readonly role: "operator" | "viewer";
            /** @description Operator API build commit */
            readonly source_revision: string;
            readonly username: string;
            /** @description Set by the BFF from DASHBOARD_WRITES_ENABLED (the operator API returns true) */
            readonly writes_enabled: boolean;
        };
        readonly MetricDef: {
            readonly cadence_s: number;
            /** @description Has a daily_summary binding, used over 31 days and beyond raw retention */
            readonly daily: boolean;
            /**
             * @example house climate
             * @example zones
             * @example water and soil
             * @example light
             * @example outdoor
             * @example controller
             * @example power
             * @example daily
             */
            readonly group: string;
            /**
             * @example climate.temp_avg
             * @example climate.vpd_avg
             * @example climate.flow_gpm
             * @example diagnostics.heap_free_kb
             */
            readonly key: string;
            readonly label: string;
            readonly note?: string | null;
            /** @enum {string} */
            readonly provenance: "MEASURED" | "DERIVED" | "PLANNED" | "MANUAL" | "AI";
            /** @description Raw retention: climate 365, diagnostics 180, setpoint_snapshot 90 */
            readonly retention_days: number;
            readonly unit: string;
            readonly zone?: string | null;
        };
        /** @description A period with coverage no_data has no rows; draw a gap, never 0 */
        readonly MinutesReport: {
            /** Format: date */
            readonly from: string;
            /** @enum {string} */
            readonly group_by: "zone" | "line" | "cause";
            readonly periods: readonly {
                /**
                 * @description Today and outage days are partial
                 * @enum {string}
                 */
                readonly coverage: "complete" | "partial" | "no_data";
                /** Format: date */
                readonly start: string;
            }[];
            /** @description The purpose filter applied; null for both */
            readonly purpose?: components["schemas"]["RunPurpose"] | null;
            /** @description Always split by cause, purpose and chemistry so charts can stack */
            readonly rows: readonly {
                readonly cause: components["schemas"]["IrrigationCause"];
                /** @enum {string} */
                readonly chemistry: "clean" | "fert";
                /** @description Whole gallons */
                readonly gal?: number | null;
                /** @description Zone (wall, center, south, west, and fog for L11's humidification), line id or cause. L03's supply minutes appear only by line or cause, never in zone totals */
                readonly group: string;
                readonly minutes: number;
                /** Format: date */
                readonly period: string;
                readonly pulses?: number | null;
                readonly purpose?: components["schemas"]["RunPurpose"];
            }[];
            /** Format: date */
            readonly to: string;
        };
        readonly NextRun: {
            readonly label?: string | null;
            readonly line_id: components["schemas"]["LineId"];
            /** @description Planned valve-open minutes */
            readonly minutes?: number | null;
            readonly slot_id: number;
            /** Format: date-time */
            readonly start_at: string;
        };
        readonly Now: {
            /** @description The one open-alert count every surface shows (nav, Now, Activity, API-14, MCP alerts): the unacknowledged (disposition open) v_open_alerts rows with repeats of one alert_type and sensor_id counted once (a merged row counts while any of its repeats is unacknowledged), by severity. It equals the rows with status open that API-14 returns (verdify_services.alerts.open_count) */
            readonly alerts: {
                readonly critical: number;
                readonly info: number;
                readonly open: number;
                readonly warning: number;
            };
            /** @description The band in force now: the dispatcher's newest band rows for zone house (DERIVED); rh_pct is null when there is no RH band */
            readonly band: {
                /**
                 * Format: date-time
                 * @description ts of the newest house band rows, for the band's age; null with no rows
                 */
                readonly observed_at?: string | null;
                readonly rh_pct: components["schemas"]["BandPosition"] | null;
                readonly temp_f: components["schemas"]["BandPosition"];
                readonly vpd_kpa: components["schemas"]["BandPosition"];
            };
            readonly controller?: components["schemas"]["Controller"];
            /** @description ingestor is the heartbeat: one system_state row (ingestor_heartbeat) every 60 s from the ingestor's own loop, stale after 180 s. Heartbeat stale: the ingestor is not running, and the controller keeps running on its own. Heartbeat fresh and climate older than 300 s: the controller is not reporting */
            readonly freshness: {
                readonly climate: components["schemas"]["Freshness"];
                readonly diagnostics: components["schemas"]["Freshness"];
                readonly ingestor: components["schemas"]["Freshness"];
                readonly readback: components["schemas"]["Freshness"];
            };
            /** @description Latest actual reservoir samples, independently timestamped; polled with Now, not chart averages. */
            readonly hydroponics?: {
                readonly ec_us_cm: components["schemas"]["Reading"];
                readonly ph: components["schemas"]["Reading"];
                readonly stale_after_s: number;
                readonly water_temp_f: components["schemas"]["Reading"];
            } | null;
            readonly indoor: {
                readonly rh_pct: components["schemas"]["Reading"];
                readonly temp_f: components["schemas"]["Reading"];
                readonly vpd_kpa: components["schemas"]["Reading"];
            };
            /** @description The climate law's state record while it is fresh; null before the law build or while the record is stale (release C retired mode and iris; law and review replace them) */
            readonly law?: components["schemas"]["LawState"] | null;
            readonly leak: components["schemas"]["Leak"];
            readonly outdoor: {
                readonly rh_pct: components["schemas"]["Reading"];
                /**
                 * @description Where the controller's outdoor reading comes from (system_state outdoor_source): the weather station, the intake probe, or none; null when the controller has not said
                 * @enum {string|null}
                 */
                readonly source?: "station" | "intake" | "none" | null;
                readonly temp_f: components["schemas"]["Reading"];
            };
            /** @description Running bursts, from the controller's readback (fan_burst_active, fog_burst_active, vent_bypass_active), never from the command alone */
            readonly overrides: readonly {
                /**
                 * Format: date-time
                 * @description ON edge plus the command's minutes; null for a push-button burst
                 */
                readonly ends_at: string | null;
                /** @description Why the controller holds it off, e.g. from fog_block_reason */
                readonly held_reason?: string | null;
                /** @enum {string} */
                readonly kind: "fans" | "humidify" | "vent_bypass";
                /**
                 * Format: date-time
                 * @description The readback's ON edge
                 */
                readonly since: string;
            }[];
            /** @description The daily review today, as API-34's today, with written_at of the newest written review and whether a band proposal waits for the owner; null when the review projection cannot be read */
            readonly review?: null | {
                /** @description The daily_review_missed alert is open */
                readonly missed: boolean;
                /** @description A written review's band proposal waits for the owner */
                readonly proposal_waiting: boolean;
                /**
                 * Format: date
                 * @description The local day the review covers
                 */
                readonly review_date: string;
                /**
                 * @description As ReviewPage.today.status
                 * @enum {string}
                 */
                readonly status: "written" | "delivered" | "requested" | "failed" | "due" | "not_due";
                /**
                 * Format: date-time
                 * @description The newest written review's written_at
                 */
                readonly written_at: string | null;
            };
            /** @description Equipment commanded on now */
            readonly running: readonly {
                readonly cause?: components["schemas"]["IrrigationCause"] | null;
                /**
                 * @example heat1
                 * @example mister_center
                 */
                readonly equipment: string;
                readonly line_id?: string | null;
                /** Format: date-time */
                readonly since: string | null;
            }[];
            /** Format: date-time */
            readonly server_time: string;
            /** @description The greenhouse snapshot (#1346): the newest 3-5 sentence summary the local Cortex model wrote from the current conditions (CronJob verdify-greenhouse-brief); null when none was written in the last 2 h */
            readonly snapshot?: components["schemas"]["Snapshot"] | null;
            /** @description Device writer health (Round 2 #1): the writer-health tile and the stuck-delivery banner. age_s is the setpoints pipeline age (v_data_pipeline_health source setpoints: the newest setpoint push or device-reported change). stuck is true while the setpoint_delivery_stuck alert is open. differing counts settings whose effective value has differed from the newest readback for more than 10 min, leaving out clamped ones */
            readonly writer: {
                readonly age_s: number | null;
                readonly differing: number;
                /** Format: date-time */
                readonly last_at?: string | null;
                /** Format: date-time */
                readonly oldest_since?: string | null;
                readonly stuck: boolean;
            };
        };
        readonly NullableNumbers: readonly (number | null)[];
        /** @description Frigate occupancy as the ingestor pushes it to the controller, from Home Assistant's binary_sensor.greenhouse_zone_person_occupancy polled every 300 s (the only occupancy input). occupied null means unknown, and unknown never holds mist (D-IRP-10). */
        readonly Occupancy: {
            /** @description occupancy_inhibit; false means the occupancy mist hold is off */
            readonly hold_enabled?: boolean | null;
            readonly occupied: boolean | null;
            /**
             * Format: date-time
             * @description Last person detection
             */
            readonly seen_at: string | null;
        };
        readonly Occupant: {
            readonly count?: number | null;
            readonly crop: string;
            readonly planting_id: number;
            /** Format: date-time */
            readonly since: string;
            readonly variety?: string | null;
        };
        readonly Occurrence: {
            readonly line_id: components["schemas"]["LineId"];
            /** @description Set when done; unknown when no outcome reached the platform */
            readonly outcome?: components["schemas"]["RunOutcome"] | null;
            /** Format: date-time */
            readonly planned_start: string;
            /** @description Why skipped, blocked or missed, in words, e.g. line disabled. A pause reads 'line paused by <name>: <reason>', the reason left out when none was given. A planned one may carry a note: only while VPD sensing is degraded, ends at the daily cap */
            readonly reason?: string | null;
            readonly run_id?: string | null;
            readonly slot_id: number;
            /** @enum {string} */
            readonly status: "planned" | "skipped" | "blocked" | "running" | "done";
        };
        readonly OverrideRequest: {
            /** @enum {string} */
            readonly kind: "fans" | "humidify" | "vent_bypass" | "clear" | "restart";
            /** @description Needed for fans, humidify and vent_bypass */
            readonly minutes?: number;
            readonly reason?: string;
        };
        /** @description Cursor page; each list schema adds items */
        readonly Page: {
            /** @description Pass as cursor; null on the last page */
            readonly next_cursor: string | null;
        };
        /** @description One occupancy range: the zone, the shelf and the cell (each null above the level given), and when. */
        readonly Place: {
            readonly cell?: string | null;
            readonly count?: number | null;
            readonly shelf?: string | null;
            /** Format: date-time */
            readonly since: string;
            /** Format: date-time */
            readonly until?: string | null;
            readonly zone: string;
        };
        /** @description A planting as the Crops page and the agents show it. cells are its open cells; places its open occupancy at every level; count null is unknown. */
        readonly Planting: {
            readonly active: boolean;
            readonly cells?: readonly string[];
            readonly count?: number | null;
            readonly crop: string;
            readonly crop_catalog_slug?: string | null;
            readonly end_reason?: string | null;
            /** Format: date-time */
            readonly ended_at?: string | null;
            readonly id: number;
            readonly notes?: string | null;
            readonly places?: readonly components["schemas"]["Place"][];
            /** Format: date */
            readonly planted_date: string;
            readonly recorded_by?: components["schemas"]["Actor"] | null;
            readonly shelves?: readonly string[];
            readonly stage?: string | null;
            readonly variety?: string | null;
            readonly where?: string | null;
            readonly zones?: readonly string[];
        };
        /** @description A new planting (API-CROP-07, MCP record_planting). crop is a catalog slug or name (lettuce, basil) or a free name; count is the number of plants, unknown when omitted; count_per_cell is stored on each cell's occupancy. planted_at defaults to now; a date means local midnight. replace ends or trims whatever holds a requested cell instead of refusing with position_occupied. */
        readonly PlantingCreate: {
            readonly count?: number | null;
            readonly count_per_cell?: number | null;
            readonly crop: string;
            readonly notes?: string | null;
            readonly planted_at?: string | null;
            readonly positions: readonly string[];
            readonly reason?: string | null;
            /** @default false */
            readonly replace?: boolean;
            /** @enum {string|null} */
            readonly stage?: "seed" | "germination" | "seedling" | "vegetative" | "flowering" | "fruiting" | "harvest" | "cleared" | null;
            readonly variety?: string | null;
        };
        /** @description A planting with every place it has been, its events (newest first) and its harvests. */
        readonly PlantingDetail: {
            readonly active: boolean;
            readonly cells?: readonly string[];
            readonly count?: number | null;
            readonly crop: string;
            readonly crop_catalog_slug?: string | null;
            readonly end_reason?: string | null;
            /** Format: date-time */
            readonly ended_at?: string | null;
            readonly events?: readonly components["schemas"]["PlantingEvent"][];
            readonly harvests?: readonly components["schemas"]["HarvestRecord"][];
            readonly history?: readonly components["schemas"]["Place"][];
            readonly id: number;
            readonly notes?: string | null;
            readonly places?: readonly components["schemas"]["Place"][];
            /** Format: date */
            readonly planted_date: string;
            readonly recorded_by?: components["schemas"]["Actor"] | null;
            readonly shelves?: readonly string[];
            readonly stage?: string | null;
            readonly variety?: string | null;
            readonly where?: string | null;
            readonly zones?: readonly string[];
        };
        /** @description End a planting without a harvest (API-CROP-10, MCP remove_planting): every open place closes at at. */
        readonly PlantingEnd: {
            readonly at?: string | null;
            /** @enum {string} */
            readonly end_reason: "failed" | "removed" | "reconciled";
            readonly note?: string | null;
            readonly reason?: string | null;
        };
        readonly PlantingEvent: {
            readonly count?: number | null;
            readonly detail?: Record<string, unknown> | null;
            readonly event_type: string;
            readonly id: number;
            readonly notes?: string | null;
            readonly operator?: string | null;
            readonly source?: string | null;
            /** Format: date-time */
            readonly ts?: string | null;
        };
        /** @description Record a harvest (API-CROP-09, MCP harvest_planting). Partial by default: the planting stays. Cells in positions are cleared; final ends the planting as harvested. */
        readonly PlantingHarvest: {
            readonly count?: number | null;
            /** @default false */
            readonly final?: boolean;
            readonly harvested_at?: string | null;
            readonly notes?: string | null;
            readonly positions?: readonly string[] | null;
            readonly reason?: string | null;
            readonly weight_kg?: number | null;
        };
        readonly PlantingList: {
            readonly items: readonly components["schemas"]["Planting"][];
        };
        /** @description Move a planting (API-CROP-08, MCP move_planting): from_positions (default: everywhere it is now) close at moved_at and to_positions open then. Both ranges stay in history. */
        readonly PlantingMove: {
            readonly from_positions?: readonly string[] | null;
            readonly moved_at?: string | null;
            readonly reason?: string | null;
            /** @default false */
            readonly replace?: boolean;
            readonly to_positions: readonly string[];
        };
        /** @description A note on a planting's history (API-CROP-12, MCP annotate_planting); ended plantings take notes too. */
        readonly PlantingNote: {
            readonly note: string;
            readonly reason?: string | null;
        };
        /** @description Edit a planting's record (API-CROP-11): only the fields sent change. count null means unknown. */
        readonly PlantingPatch: {
            readonly count?: number | null;
            /** Format: date */
            readonly expected_harvest?: string | null;
            readonly notes?: string | null;
            readonly reason?: string | null;
            /** @enum {string|null} */
            readonly stage?: "seed" | "germination" | "seedling" | "vegetative" | "flowering" | "fruiting" | "harvest" | "cleared" | null;
            readonly variety?: string | null;
        };
        /** @description Who has held one cell: the current occupant first, then the rest newest first. */
        readonly PositionHistory: {
            readonly items: readonly components["schemas"]["Tenure"][];
            readonly label: string;
            readonly shelf: string;
            readonly zone: string;
        };
        /** @description RFC 9457 problem details. The UI maps code to words and shows an unknown code raw. */
        readonly Problem: {
            readonly code: components["schemas"]["ProblemCode"];
            /** @description Current stored or device value */
            readonly current?: number | string | boolean | null;
            /** @description In plain words */
            readonly detail?: string;
            /** @description Request field at fault, e.g. on_s */
            readonly field?: string;
            readonly max?: number | null;
            readonly min?: number | null;
            /** @description The request id (the Idempotency-Key on a write), as logged */
            readonly request_id?: string;
            /**
             * @description API-20 only, with unavailable: Home Assistant failed the call, Lutron did not reach the state, or no answer within 12 s
             * @enum {string}
             */
            readonly result?: "ha_failed" | "not_confirmed" | "timeout";
            /** @description When a retry may succeed (line_busy, manifold_busy), if known */
            readonly retry_after_s?: number | null;
            readonly retryable: boolean;
            readonly status: number;
            readonly title: string;
            /**
             * Format: uri-reference
             * @default about:blank
             */
            readonly type?: string;
        };
        /**
         * @description Stable codes shared with MCP (architecture §5.3, irrigation §4.3 and §4.7). manual is for Iris only. position_occupied, ambiguous_position and planting_ended are the plantings' refusals (API-CROP-06 to -11). study_state, the retired planner study's (API-28), was removed in release C
         * @enum {string}
         */
        readonly ProblemCode: "invalid_request" | "unauthenticated" | "forbidden" | "origin_mismatch" | "not_found" | "writes_disabled" | "query_timeout" | "unavailable" | "window_too_large" | "unknown_target" | "read_only" | "out_of_range" | "manual" | "request_id_reused" | "check_required" | "too_close" | "too_many_schedules" | "line_disabled" | "line_paused" | "line_faulted" | "not_schedule_member" | "line_busy" | "manifold_busy" | "cap_reached" | "position_occupied" | "ambiguous_position" | "planting_ended";
        /** @description The compiled program against the controller (irr_program_id); confirmed when the device hash matches */
        readonly ProgramSync: {
            /** @description First 16 hex of the applied sha256 */
            readonly applied_hash?: string | null;
            readonly applied_revision?: number | null;
            /** Format: date-time */
            readonly confirmed_at?: string | null;
            /** @description compile_program() over the tables now */
            readonly desired_sha256: string;
            /**
             * Format: date-time
             * @description Retries after 1, 5 and 15 min
             */
            readonly next_retry_at?: string | null;
            /** Format: date-time */
            readonly pushed_at?: string | null;
            /** @description Why there is no program on the controller, e.g. engine not on controller */
            readonly reason?: string | null;
            readonly reject_code?: string | null;
            /** @description Newest pushed revision */
            readonly revision?: number | null;
            /**
             * @description null before the engine firmware; rom = the built-in program
             * @enum {string|null}
             */
            readonly src: "nvs" | "rom" | null;
            readonly state: components["schemas"]["ReadbackState"];
        };
        /**
         * @description Computed on every read (architecture §5.5); display only. A dispatcher clamp reads not_confirmed at once, with state_reason clamped (release C retired held, which a clamp or an armed experiment read). Irrigation items and the irrigation_site settings use requested, confirmed and not_confirmed against the controller's program hash; before the engine firmware they stay requested. not_confirmed is only a request at least 5 min old the readback does not match; a setting nobody requested with no readback reads no_readback (#1333).
         * @enum {string}
         */
        readonly ReadbackState: "requested" | "confirmed" | "not_confirmed" | "no_readback" | "overridden" | "released";
        readonly Readiness: {
            /**
             * @description BFF only; reported, not gating
             * @enum {string}
             */
            readonly authentik?: "reachable" | "unreachable";
            /**
             * @description BFF only; reported, not gating
             * @enum {string}
             */
            readonly operator_api?: "reachable" | "unreachable";
            readonly source_revision: string;
            /** @enum {string} */
            readonly status: "ready" | "not_ready";
        };
        readonly Reading: {
            /** Format: date-time */
            readonly observed_at: string | null;
            /** @description Why value is null, in words */
            readonly reason?: string | null;
            readonly value: number | null;
        };
        /** @description The newest system_state row of one controller reason entity. The UI words the code and shows an unknown one raw */
        readonly ReasonState: {
            /** @description Null while the controller is not reporting, or with no row */
            readonly code: string | null;
            /**
             * Format: date-time
             * @description The newest row's ts, kept while code is null
             */
            readonly observed_at: string | null;
            /**
             * Format: date-time
             * @description When the current value began, from the collapsed values; null while code is null
             */
            readonly since: string | null;
        };
        /** @description The day's compliance with the served band (daily_band_compliance), in percent of graded minutes */
        readonly RecordBand: {
            /** @description Minutes above the band with every cooling stage running */
            readonly above_full_cooling_min: number | null;
            readonly both_day_pct: number | null;
            readonly both_night_pct: number | null;
            /** @description Temperature and VPD both in band */
            readonly both_pct: number | null;
            /** @description Minutes with a reading and a band */
            readonly graded_min: number | null;
            /** @description The night dried out */
            readonly night_dried: boolean | null;
            /** @description Night minutes the house spent drying out */
            readonly night_dryout_min: number | null;
            readonly temp_above_pct: number | null;
            readonly temp_below_pct: number | null;
            readonly temp_pct: number | null;
            readonly vpd_above_pct: number | null;
            readonly vpd_below_pct: number | null;
            readonly vpd_pct: number | null;
        };
        readonly RecordDay: {
            /** @description Alerts raised that day by severity (v_daily_scorecard); null with no row */
            readonly alerts: {
                readonly critical: number;
                readonly info: number;
                readonly warning: number;
            } | null;
            /** @description daily_band_compliance; null with no row */
            readonly band: components["schemas"]["RecordBand"] | null;
            readonly climate_run_s: number | null;
            /** @description The six climate relays together (heat1, heat2, fan1, fan2, vent, fog) */
            readonly climate_starts: number | null;
            /** @description The local day has ended and its record is stored */
            readonly complete: boolean;
            /** @description Share of the day the relay counters were sampled */
            readonly counter_sample_pct: number | null;
            /** Format: date */
            readonly date: string;
            readonly drying: components["schemas"]["RecordDrying"] | null;
            readonly energy: {
                /** @description Share of the day the meter reported */
                readonly coverage_pct: number | null;
                /** @description The 24-hour figure; null under 70 % meter coverage */
                readonly kwh: number | null;
                /** @description What the meter reported */
                readonly kwh_partial: number | null;
            };
            readonly gas: {
                /** @description Estimated from furnace run time; gas is not metered */
                readonly therms_est: number | null;
            };
            /** @description By equipment (heat1, heat2, fan1, fan2, vent, fog, mister_center, mister_south, mister_west, drip_wall, drip_center), from the daily relay record; null with no row */
            readonly relays: {
                readonly [key: string]: {
                    /** @description Runs whose missing edge the record repaired */
                    readonly repaired_runs: number;
                    readonly run_s: number;
                    readonly starts: number;
                };
            } | null;
            readonly water: {
                /** @description The meter covered the whole day */
                readonly complete: boolean | null;
                /** @description Water for the plants: wetting plus wall irrigation and fertigation (daily_record.planning_water_gal) */
                readonly crop_gal: number | null;
                /** @description Water with no Verdify valve open (the hose */
                readonly house_gal: number | null;
                /** @description The site meter's day total */
                readonly total_gal: number | null;
                /** @description Fog and mister water */
                readonly wetting_gal: number | null;
            };
        };
        readonly RecordDrying: {
            /** @description Gas furnace starts soon after a drying run */
            readonly furnace_starts_after: number | null;
            readonly heat_wh: number | null;
            /** @description A restart lost meter counts that day */
            readonly lower_bound: boolean | null;
            /** @description Seconds drying was refused, by the refusal reason (LawDrying.refused_reason's values) */
            readonly refused_s: {
                readonly [key: string]: number;
            } | null;
            readonly runs: number | null;
            readonly seconds: number | null;
            /** @description Seconds the house wanted drying */
            readonly wanted_s: number | null;
            readonly water_g: number | null;
        };
        /** @description Means over complete days only */
        readonly RecordMeans: {
            readonly both_pct: number | null;
            readonly climate_run_h: number | null;
            readonly climate_starts: number | null;
            readonly crop_gal: number | null;
            /** @description How many complete days the mean covers */
            readonly days: number;
            readonly drying_h: number | null;
            readonly heat1_run_h: number | null;
            readonly heat2_run_h: number | null;
            readonly kwh: number | null;
            /** @description Nights that dried out among those days */
            readonly nights_dried: number | null;
            readonly temp_pct: number | null;
            readonly therms_est: number | null;
            readonly vpd_pct: number | null;
        };
        /** @description A fixed period of local days, from and to inclusive, and its means over its complete days less the days on which the house band was changed. A period with no such day has means.days 0 and every mean null; a real figure, zero included, always comes with days above 0, so a reader tells the two apart by days */
        readonly RecordPeriod: {
            /** @description The days in the period left out because the house band was changed on them (band edits) */
            readonly excluded_days: number;
            /** Format: date */
            readonly from: string;
            /** @description Over the period's complete days that are not left out; days 0 with every mean null when there are none */
            readonly means: components["schemas"]["RecordMeans"];
            /**
             * Format: date
             * @description Inclusive local day
             */
            readonly to: string;
        };
        /** @description API-33: the controller's own relay counters against the stored daily relay record, newest day first */
        readonly RelayCheck: {
            readonly days: readonly {
                /** @description Controller restarts that day */
                readonly boots: number | null;
                /**
                 * @description complete: counters cover the whole day; partial: counters cover part of it (a restart or their first day); no_record: no stored record for the day; record_early: the record was computed before the day ended
                 * @enum {string}
                 */
                readonly comparison: "complete" | "partial" | "no_record" | "record_early";
                /** Format: date */
                readonly date: string;
                readonly relays: readonly {
                    /** @description The fans only; the controller counts no run time for the others */
                    readonly counter_run_s: number | null;
                    readonly counter_starts: number | null;
                    /**
                     * @example heat1
                     * @example fan1
                     */
                    readonly equipment: string;
                    readonly record_run_s: number | null;
                    readonly record_starts: number | null;
                    readonly run_s_difference: number | null;
                    readonly starts_difference: number | null;
                }[];
            }[];
        };
        /** @description What a place text means and what holds those cells at at. Nothing is written. */
        readonly Resolution: {
            /** Format: date-time */
            readonly at: string;
            readonly cells: readonly string[];
            readonly conflicts?: readonly components["schemas"]["Conflict"][];
            readonly places: readonly components["schemas"]["ResolvedPlace"][];
            readonly where: string;
        };
        readonly ResolvedPlace: {
            readonly cell?: string | null;
            readonly shelf?: string | null;
            readonly zone: string;
        };
        /** @description One planner_review row (v_dashboard_review) */
        readonly Review: {
            readonly attempts: number;
            /** Format: date-time */
            readonly delivered_at: string | null;
            /**
             * @description Why a failed review failed (verdify_schemas.review.ReviewFailure)
             * @enum {string|null}
             */
            readonly failure: "gateway_rejected" | "gateway_unreachable" | "hermes_run_failed" | "hermes_run_cancelled" | "completed_without_review" | "attempts_exhausted" | null;
            readonly id: number;
            readonly input_tokens: number | null;
            /**
             * @description daily: the ingestor wakes the reviewer after 07:00; manual: asked for on demand
             * @enum {string}
             */
            readonly kind: "daily" | "manual";
            readonly output_tokens: number | null;
            readonly proposal: components["schemas"]["ReviewProposal"] | null;
            /**
             * @description waiting: this is the newest written review with a proposal and no band.write followed its written_at; answered: a band.write followed it; superseded: a newer written review exists. Null without a proposal
             * @enum {string|null}
             */
            readonly proposal_state: "waiting" | "answered" | "superseded" | null;
            /** Format: date-time */
            readonly requested_at: string;
            /** @example ingestor */
            readonly requested_by: string;
            /**
             * Format: date
             * @description The local day reviewed
             */
            readonly review_date: string;
            /** Format: date-time */
            readonly run_finished_at: string | null;
            /** @enum {string} */
            readonly status: "requested" | "delivered" | "written" | "failed";
            /** @description The review in words */
            readonly summary: string | null;
            readonly total_tokens: number | null;
            /** Format: date-time */
            readonly written_at: string | null;
        };
        readonly ReviewPage: components["schemas"]["Page"] & {
            /** @description Newest first */
            readonly items: readonly components["schemas"]["Review"][];
            /** @description The written review whose band proposal waits for the owner; null when none does */
            readonly proposal_waiting: null | {
                /** Format: date */
                readonly review_date: string;
                readonly review_id: number;
            };
            /** @description Today's review: due from 07:00 local, late after 10:00. written, delivered, requested and failed are the newest review's status for the day; due when it has none yet and expected_after has passed; not_due before then */
            readonly today: {
                /**
                 * @description Local time the review is due from
                 * @constant
                 */
                readonly expected_after: "07:00";
                /**
                 * @description Local time after which it is late
                 * @constant
                 */
                readonly late_after: "10:00";
                /** @description The daily_review_missed alert is open */
                readonly missed: boolean;
                /**
                 * Format: date
                 * @description The local day the review covers (yesterday)
                 */
                readonly review_date: string;
                /** @enum {string} */
                readonly status: "written" | "delivered" | "requested" | "failed" | "due" | "not_due";
            };
            /** @description The reviewer's token use */
            readonly tokens: {
                /** @description How many finished reviews before the newest mean_7 averages; 0 when mean_7 is null */
                readonly count_7: number;
                /** @description How many finished reviews before the newest mean_30 averages; 0 when mean_30 is null */
                readonly count_30: number;
                /** @description The newest review's total tokens */
                readonly last: number | null;
                readonly mean_7: number | null;
                readonly mean_30: number | null;
                /** @description The newest review against the 7-review mean of the reviews before it */
                readonly rise_pct: number | null;
            };
        };
        /** @description A band edit the review proposes (verdify_schemas.review.BandProposal); the owner applies it or not */
        readonly ReviewProposal: {
            readonly changes: readonly {
                /** @description The stored value now */
                readonly current: number | null;
                readonly label: string;
                /** @example band_temp_low_sr */
                readonly param: string;
                readonly proposed: number;
                /**
                 * @description The row's registry unit; null for a row the registry gives no unit (the zone priorities)
                 * @example °F
                 * @example kPa
                 */
                readonly unit: string | null;
            }[];
            /** @description The price-list rows the review quotes, as it stored them */
            readonly price: string;
            readonly reason: string | null;
        };
        /** @description One run: a drip run, a fertilizer stage or a mist episode, from relay edges joined to its irrigation_ledger row. Listed once it has ended; the run in progress is in API-IRR-01 */
        readonly Run: {
            /** @description Null when the controller started it */
            readonly actor?: components["schemas"]["Actor"] | null;
            readonly cause: components["schemas"]["IrrigationCause"];
            /** @enum {string} */
            readonly chemistry: "clean" | "fert";
            /**
             * Format: uuid
             * @description The run-now command that started it
             */
            readonly command_id?: string | null;
            /** Format: date-time */
            readonly ended_at?: string | null;
            /** @description Whole gallons from the one site meter (it also counts the hose, sink and hydro); informational. 0 when the run moved no water; null without meter data */
            readonly gal?: number | null;
            readonly line_id: components["schemas"]["LineId"];
            /** @description 0 for skipped, missed and cap occurrences */
            readonly open_s: number;
            /** @description From the ledger; unknown when its outcome never reached the platform. A run with no ledger row (a VPD episode, or a run before the engine firmware) reads ok */
            readonly outcome: components["schemas"]["RunOutcome"];
            readonly pulses?: number | null;
            readonly purpose?: components["schemas"]["RunPurpose"];
            readonly reason?: string | null;
            readonly run_id: string;
            readonly schedule_label?: string | null;
            readonly slot_id?: number | null;
            /** Format: date-time */
            readonly started_at: string;
            readonly zone: string;
        };
        /**
         * @description unknown: no outcome reached the platform (it aged out of irr_events while the ingestor was disconnected); a gap, never missed, and it raises no alert. The controller never sends it
         * @enum {string}
         */
        readonly RunOutcome: "ok" | "short" | "stopped" | "preempted" | "skipped" | "missed" | "cap" | "unknown";
        readonly RunPage: components["schemas"]["Page"] & {
            readonly items: readonly components["schemas"]["Run"][];
        };
        /**
         * @description What water was for (#1348). irrigation: schedule, run_now, feed, prewet, flush (and unknown) on drips or misters. climate: VPD and fallback misting, and every fog (L11) run. SAF-4 and the zone caps count both. The server always sends it; the fields stay optional in the contract so a client reads a server from before #1348 by the same rule
         * @enum {string}
         */
        readonly RunPurpose: "irrigation" | "climate";
        /** @description Drips: minutes. Fertilizer drips (L02, L06): minutes, prewet_s, flush_s. Misters: on_s, count, gap_s. Fertilizer misters (L08, L10): on_s, count and gap_s within the mister bounds, plus prewet_s and flush_s. Fog (L11): minutes, 1-30. Before the engine firmware only L01 runs, for its configured irrig_wall_duration_min */
        readonly RunRequest: {
            readonly count?: number;
            readonly flush_s?: number;
            readonly gap_s?: number;
            /** @description Drips 1-120; fog 1-30 */
            readonly minutes?: number;
            readonly on_s?: number;
            readonly prewet_s?: number;
            readonly reason?: string;
        };
        readonly Schedule: components["schemas"]["ScheduleInput"] & {
            /** @description The flag before this write (write responses) */
            readonly manual_before?: boolean | null;
            readonly slot_id: number;
            readonly sync: components["schemas"]["ReadbackState"];
            /** Format: date-time */
            readonly updated_at: string;
            readonly updated_by: components["schemas"]["Actor"];
        };
        readonly ScheduleAgenda: {
            /** @description Per line kind (drip, mister, fert_drip, fert_mister), from verdify_schemas/irrigation.py, so editors and agents see the limits */
            readonly bounds: {
                readonly [key: string]: {
                    readonly [key: string]: {
                        readonly max: number;
                        readonly min: number;
                    };
                };
            };
            readonly counts: {
                /** @constant */
                readonly max_schedules: 24;
                readonly schedules: number;
            };
            /** @description By planned start; the week view draws them per line and day */
            readonly occurrences: readonly components["schemas"]["Occurrence"][];
            readonly schedules: readonly components["schemas"]["Schedule"][];
            /** @description Per local day in the window, from verdify_schemas/solar.py, for previews */
            readonly solar: readonly {
                /** Format: date */
                readonly date: string;
                /** Format: date-time */
                readonly solar_noon: string;
                /** Format: date-time */
                readonly sunrise: string;
                /** Format: date-time */
                readonly sunset: string;
            }[];
        };
        readonly ScheduleCreate: components["schemas"]["ScheduleInput"] & {
            /**
             * @description Omitted on a REST create means true (the dashboard default); MCP creates default false
             * @default true
             */
            readonly manual?: boolean;
        };
        /** @description The weekdays the schedule runs on */
        readonly ScheduleDays: readonly ("mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun")[];
        /** @description Bounds per irrigation §4.3, checked per line kind on submit; values snap to whole seconds and minutes */
        readonly ScheduleInput: {
            /** @description The physical line (#1336), with variant, instead of line_id; the API stores the variant's relay. An edit may give variant alone to switch clean and fertilized on the same physical line */
            readonly circuit_id?: components["schemas"]["CircuitId"];
            /**
             * @description Pulses in a mist window; drips use 1
             * @default 1
             */
            readonly count?: number;
            readonly days?: components["schemas"]["ScheduleDays"];
            /**
             * @description L04, L07, L09 only (D-IRP-12)
             * @default false
             */
            readonly degraded_only?: boolean;
            /** @default true */
            readonly enabled?: boolean;
            /**
             * @description Fertilizer lines only
             * @default 0
             */
            readonly flush_s?: number;
            /**
             * @description Mister gap 30-600; drips 0
             * @default 0
             */
            readonly gap_s?: number;
            readonly label?: string;
            /** @description L01, L02, L04-L10 (not L03 or L11) */
            readonly line_id?: string;
            /**
             * @description Iris skips the schedule while true. A REST create or edit that omits it stores true (the dashboard default, R3); MCP writes default false
             * @default true
             */
            readonly manual?: boolean;
            /** @description Seconds per run or pulse; misters 10-90; fertilizer the feed */
            readonly on_s?: number;
            /**
             * @description Fertilizer lines only
             * @default 0
             */
            readonly prewet_s?: number;
            readonly reason?: string;
            readonly start?: components["schemas"]["ScheduleStart"];
            readonly variant?: components["schemas"]["Variant"];
        };
        readonly ScheduleStart: {
            /** @description Local HH:MM when kind is clock */
            readonly clock?: string;
            /** @enum {string} */
            readonly kind: "clock" | "sunrise" | "solar_noon" | "sunset";
            /**
             * @description Solar kinds
             * @default 0
             */
            readonly offset_min?: number;
        };
        /** @description uPlot columns. A bucket with no data is null, never 0; count gives coverage. */
        readonly Series: {
            /** @enum {integer} */
            readonly bucket_s: 60 | 300 | 900 | 3600 | 10800 | 86400;
            /** Format: date-time */
            readonly from: string;
            /** @description The data_gaps rows (telemetry outages the ingestor recorded, kept with no retention) that overlap [from, to), oldest first. A null run inside one is that outage; a null run with none has no known reason */
            readonly gaps?: readonly {
                /** Format: date-time */
                readonly end: string;
                /** @description As stored, e.g. ingestor_restart; the UI words it and shows an unknown one raw */
                readonly reason: string | null;
                /** Format: date-time */
                readonly start: string;
            }[];
            /** @description By metric key */
            readonly series: {
                readonly [key: string]: components["schemas"]["SeriesColumns"];
            };
            /** Format: date-time */
            readonly server_time: string;
            /** @description Bucket starts, epoch seconds */
            readonly t: readonly number[];
            /** Format: date-time */
            readonly to: string;
            /**
             * Format: date-time
             * @description Newest sample included
             */
            readonly watermark: string | null;
        };
        readonly SeriesColumns: {
            readonly avg: components["schemas"]["NullableNumbers"];
            readonly count: readonly number[];
            /**
             * Format: date-time
             * @description forecast.temp_f, forecast.rh_pct and forecast.vpd_kpa only: the newest weather_forecast.fetched_at used; null when the window holds no forecast row
             */
            readonly issued_at?: string | null;
            readonly max: components["schemas"]["NullableNumbers"];
            readonly min: components["schemas"]["NullableNumbers"];
            /** @description daily.* keys only, one per bucket: why a null bucket is null ('band grade kept 3 days', the water day's v_water_meter_daily quality, 'no meter data', or v_dli_daily's unavailable_reason such as 'source_coverage_low'); null where the bucket has a value or no reason is known */
            readonly reason?: readonly (string | null)[];
            /**
             * Format: date-time
             * @description Older buckets are beyond retention_days, not gaps
             */
            readonly retained_from?: string | null;
            /**
             * @description daily_summary: daily summaries, and the chart says so; forecast: weather_forecast, the newest issue per hour
             * @enum {string}
             */
            readonly source: "raw" | "daily_summary" | "scorecard" | "forecast";
        };
        readonly SessionCreate: {
            /** @description name claim */
            readonly display_name?: string | null;
            /** @enum {string} */
            readonly role: "operator" | "viewer";
            /** @description preferred_username */
            readonly username: string;
        };
        readonly SessionToken: {
            /** Format: date-time */
            readonly expires_at: string;
            /** @description 32 random bytes, base64url; becomes __Host-verdify_session */
            readonly token: string;
        };
        /** @description One tunable_registry row, or a read-only Band in force row, as the Settings screen shows it */
        readonly Setting: {
            /**
             * @description What the dispatcher applies now (release C retired plan, which no setting has read since climate refactor 4.2)
             * @enum {string}
             */
            readonly applied_from: "manual" | "desired" | "band" | "default";
            /** @enum {string} */
            readonly control_class: "planner_policy" | "scheduled_policy" | "controller_safety" | "crop_band" | "irrigation_site" | "readback_context" | "retired";
            readonly desired: components["schemas"]["DesiredSetting"] | null;
            /**
             * @description What reads the setting on this build: controller, the connected controller's control loop; host, a host task (the lighting schedule, the dispatcher or the alerts); none, stored and echoed but read by nothing. Derived from the registry and one reviewed list, guarded by a test
             * @enum {string}
             */
            readonly effect?: "controller" | "host" | "none";
            /**
             * @description band_in_force is the "Band in force" group: the dispatcher's DERIVED band rows (band_<zone>_<role>), house and per zone, read-only
             * @enum {string}
             */
            readonly group: "planner_policy" | "scheduled_policy" | "controller_safety" | "crop_band" | "site_water_caps" | "read_only" | "band_in_force";
            /** @description Operator text (verdify_schemas.setting_help, #1332); MCP settings serves the same */
            readonly help?: components["schemas"]["SettingHelp"] | null;
            /** @enum {string} */
            readonly kind: "numeric" | "switch" | "enum";
            /** @description For a registry row, TunableDef.label (VD-29), filled from the setting's entity name in firmware/greenhouse/tunables.yaml and drift-tested */
            readonly label: string;
            readonly max?: number | null;
            /** @description planner_effective_bounds (registry intersected with the firmware clamp) */
            readonly min?: number | null;
            /** @description Enum settings only */
            readonly options?: readonly {
                readonly label: string;
                readonly value: number;
            }[];
            /** @example gl_main_lux_threshold */
            readonly param: string;
            /**
             * @description Why a read-only row cannot be written (#1333): the tunable_registry READ_ONLY_REASONS key, no_anchor_row (a crop-band row with no crop_band_anchors row) or band_in_force (derived band rows); null on a writable row
             * @enum {string|null}
             */
            readonly read_only_kind?: "band_in_force" | "legacy_wide_limit" | "zone_vpd_target" | "activity_mirror" | "band_owner" | "retired" | "readback_context" | "no_entity" | "no_anchor_row" | "unknown" | null;
            /** @example legacy wide limit; not the band while the controller runs its on-chip curve */
            readonly read_only_reason?: string | null;
            /** @description Newest readback; for irrigation_site rows the value in the applied program */
            readonly readback: components["schemas"]["Reading"] | null;
            /**
             * @description cfg_* sensor, a native number, switch or equipment_state mirror, the irrigation program hash (irrigation_site), or none
             * @enum {string}
             */
            readonly readback_via: "cfg" | "entity" | "program" | "none";
            /** @description The writable settings a derived row is computed from (the crop-band anchors behind a Band in force row, the main-light schedule behind the activity mirror); empty otherwise */
            readonly source_params?: readonly string[];
            /** @description Of the newest write, else of the applied value against the readback */
            readonly state: components["schemas"]["ReadbackState"];
            /** @description The registry step (from tunables.yaml; equal to ENTITY_GRIDS for the 48 policy fields) */
            readonly step?: number | null;
            /** @description For a registry row, TunableDef.unit (VD-29), filled from the same firmware entity and drift-tested; null when the setting has no unit */
            readonly unit?: string | null;
            /** @description false with read_only_reason; the irrigation_site rows are writable before the engine firmware too (their writes wait, state_reason no_engine) */
            readonly writable: boolean;
        };
        /** @description What a setting is and what changing it does to the controller (#1332). One source for the dashboard, MCP and the lab ai-tunables page. raise and lower are null on a read-only row; for a switch they say what turning it on and off does. */
        readonly SettingHelp: {
            /** @description An interaction or safety note */
            readonly caution?: string | null;
            /** @description What the controller does with it */
            readonly effect: string;
            /**
             * @description A hard safety limit (Safety Min, Safety Max and the VPD pair): the dashboard shows caution and asks to confirm before saving
             * @default false
             */
            readonly guardrail?: boolean;
            /** @description What happens when the value goes down (a switch turned off) */
            readonly lower?: string | null;
            /** @description What happens to the greenhouse when the value goes up (a switch turned on) */
            readonly raise?: string | null;
            /** @description The setting's entry on the lab ai-tunables reference page */
            readonly reference_url?: string | null;
            /** @description One line */
            readonly summary: string;
        };
        readonly SettingHistory: {
            /** @description Oldest first, from the row in force at from */
            readonly desired: readonly components["schemas"]["DesiredSetting"][];
            /** Format: date-time */
            readonly from: string;
            readonly max?: number | null;
            readonly min?: number | null;
            readonly param: string;
            /** @description cfg_* readback change points */
            readonly readback: readonly components["schemas"]["TimedValue"][];
            /** Format: date-time */
            readonly to: string;
            readonly unit?: string | null;
        };
        readonly SettingWrite: {
            /**
             * @description Iris skips the setting while true. The dashboard default (R3); MCP set_setting defaults false. A write stores exactly the flag it carries
             * @default true
             */
            readonly manual?: boolean;
            readonly reason?: string;
            /** @description Switches 0 or 1, enums the option value; snapped to step */
            readonly value: number;
        };
        readonly ShelfView: {
            readonly cells?: readonly components["schemas"]["CellView"][];
            readonly display_order?: number | null;
            readonly kind: string;
            readonly label_short?: string | null;
            readonly name: string;
            readonly plantings?: readonly components["schemas"]["Occupant"][];
            readonly slug: string;
            readonly tier?: number | null;
            readonly wall?: string | null;
            readonly water_lines?: readonly components["schemas"]["WaterLine"][];
        };
        /** @description Read-only text for people, never an input to a plan. stale: as_of is more than 30 min old (old) or a later attempt failed or was rejected (failed); show it muted with "as of". outdated: a band verdict or the open-alert count changed since it was written; never show it */
        readonly Snapshot: {
            /**
             * Format: date-time
             * @description The newer of generated_at and the last run that found the same conditions
             */
            readonly as_of: string;
            /** Format: date-time */
            readonly generated_at: string;
            /** @example llm.primary.longctx */
            readonly model: string;
            readonly outdated: boolean;
            readonly stale: boolean;
            /** @enum {string|null} */
            readonly stale_reason: "old" | "failed" | null;
            readonly text: string;
        };
        /** @description One probe zone's soil-moisture target (API-SOIL-01, */
        readonly SoilTarget: {
            readonly max_pct: number;
            readonly min_pct: number;
            readonly notes?: string | null;
            /** @description The crops.zone whose open plantings let soil_dryout page */
            readonly occupancy_zone?: string | null;
            /** @description The climate column the probe writes */
            readonly probe?: string | null;
            readonly reason?: string | null;
            readonly saturation_pct: number;
            /** @example soil.west */
            readonly sensor_id?: string | null;
            /** Format: date-time */
            readonly updated_at?: string | null;
            readonly updated_by?: components["schemas"]["Actor"] | null;
            /** @description soil_dryout pages when the live probe stays below this for over 2 h in the day */
            readonly wilt_pct: number;
            /**
             * @example south_1
             * @example south_2
             * @example west
             */
            readonly zone: string;
        };
        readonly SoilTargets: {
            readonly targets: readonly components["schemas"]["SoilTarget"][];
        };
        /** @description The thresholds or note to change; at least one. The merged row must stay ordered. */
        readonly SoilTargetWrite: {
            readonly max_pct?: number | null;
            readonly min_pct?: number | null;
            readonly notes?: string | null;
            readonly reason?: string;
            readonly saturation_pct?: number | null;
            readonly wilt_pct?: number | null;
        };
        readonly StateLanes: {
            /** Format: date-time */
            readonly from: string;
            readonly lanes: readonly {
                /**
                 * @example fan1
                 * @example mister_center
                 * @example leak_detected
                 */
                readonly equipment: string;
                /** @enum {string} */
                readonly group: "climate" | "water" | "light" | "flag";
                readonly intervals: readonly {
                    readonly cause?: components["schemas"]["IrrigationCause"] | null;
                    /**
                     * Format: date-time
                     * @description Clamped to the window or now
                     */
                    readonly end: string;
                    /** Format: date-time */
                    readonly start: string;
                    /** @enum {string} */
                    readonly state: "on" | "off" | "unknown";
                }[];
                readonly label?: string;
                readonly line_id?: string | null;
            }[];
            /** Format: date-time */
            readonly to: string;
        };
        /** @description Why a value is not confirmed, when the platform knows (architecture §5.5): clamped (a dispatcher clamp; applied_value), deferred (controller heap low), push_failed (setpoint_changes.delivery_status after the request), writer_down (the ingestor heartbeat is older than 180 s: "Ingestor not running since HH:MM"), controller_not_reporting (heartbeat fresh, newest climate row older than 300 s: "Controller not reporting since HH:MM"), no_engine (an irrigation_site write stored before the engine firmware: "applies with the irrigation firmware"; it stays requested) or no_match ("Sent HH:MM; no matching readback yet"). since gives each HH:MM */
        readonly StateReason: {
            /** @description What the dispatcher sent instead, when clamped */
            readonly applied_value?: number | null;
            /** @enum {string} */
            readonly code: "clamped" | "deferred" | "push_failed" | "writer_down" | "controller_not_reporting" | "no_engine" | "no_match";
            /** @description In words, e.g. the guard that clamped it or the push status */
            readonly detail?: string | null;
            /**
             * Format: date-time
             * @description When the reason began, null when not known. writer_down: the newest ingestor heartbeat. controller_not_reporting: the newest climate row. no_match, push_failed and deferred: the push the request went out in (the "Sent HH:MM" time). clamped: the clamp row. no_engine: the stored write
             */
            readonly since?: string | null;
        };
        /** @description One planting's time in a cell; until null while it is there. */
        readonly Tenure: {
            readonly count?: number | null;
            readonly crop: string;
            readonly planting_id: number;
            /** Format: date-time */
            readonly since: string;
            /** Format: date-time */
            readonly until?: string | null;
            readonly variety?: string | null;
        };
        readonly TimedValue: {
            /** Format: date-time */
            readonly at: string;
            readonly value: number | null;
        };
        readonly UsedOfMax: {
            readonly max: number | null;
            readonly used: number | null;
        };
        /** @enum {string} */
        readonly Variant: "clean" | "fertilized";
        readonly WaterLine: {
            readonly line_id: string;
            readonly name: string;
            readonly note?: string | null;
        };
        /** @description API-21: daily water use in whole gallons. There is no rate and no flow flag */
        readonly WaterUse: {
            /** @description One per America/Denver day, oldest first. On a no_data day every value is null, never 0 */
            readonly days: readonly {
                /** @description Verdify-valve gallons by IrrigationCause */
                readonly by_cause: {
                    readonly [key: string]: number;
                } | null;
                /** @description Verdify-valve gallons by line id */
                readonly by_line: {
                    readonly [key: string]: number;
                } | null;
                /** @description Verdify-valve gallons by RunPurpose (#1348): irrigation and climate */
                readonly by_purpose?: {
                    readonly [key: string]: number;
                } | null;
                /**
                 * @description From v_water_meter_daily quality: ok is complete; unavailable, or no row, is no_data; anything else is partial
                 * @enum {string}
                 */
                readonly coverage: "complete" | "partial" | "no_data";
                /** Format: date */
                readonly date: string;
                /** @description The site meter's day total (main_pulse) */
                readonly meter_gal: number | null;
                /** @description Meter water while no Verdify valve was open: the hose, sink, hydro or a leak */
                readonly no_valve_gal: number | null;
            }[];
            /** Format: date */
            readonly from: string;
            /**
             * Format: date
             * @description Inclusive local day: today, a partial day
             */
            readonly to: string;
        };
        readonly ZoneView: {
            readonly name: string;
            readonly plantings?: readonly components["schemas"]["Occupant"][];
            readonly shelves?: readonly components["schemas"]["ShelfView"][];
            readonly slug: string;
        };
    };
    responses: {
        /** @description Stored for the device writer: pending until sent (at most once), or failed if not sent within 2 min. Relay edges and the line's irr_state show what happened. */
        readonly Accepted: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/json": components["schemas"]["Command"];
            };
        };
        /** @description Validation or refusal; code says why and nothing was stored or sent */
        readonly Invalid: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                /**
                 * @example {
                 *       "title": "Out of range",
                 *       "status": 422,
                 *       "code": "out_of_range",
                 *       "detail": "Must be 0.50-2.50 kPa",
                 *       "retryable": false,
                 *       "field": "value",
                 *       "min": 0.5,
                 *       "max": 2.5,
                 *       "current": 1.6
                 *     }
                 */
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description Error; see the Errors rule in the API description */
        readonly Problem: {
            headers: {
                readonly [name: string]: unknown;
            };
            content: {
                readonly "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: {
        readonly AlertId: number;
        /** @description next_cursor from the previous page */
        readonly Cursor: string;
        /** @description Window start (inclusive) */
        readonly From: string;
        /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
        readonly IdempotencyKey: string;
        readonly Limit: number;
        readonly LineId: components["schemas"]["LineId"];
        /** @description tunable_registry name */
        readonly Param: string;
        readonly PlantingId: number;
        readonly Reason: string;
        readonly SlotId: number;
        /** @description Window end (exclusive) */
        readonly To: string;
    };
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    readonly "BFF-02": {
        readonly parameters: {
            readonly query?: {
                readonly code?: string;
                readonly error?: string;
                readonly state?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description To returnTo, with the session cookie set and the login cookie cleared */
            readonly 302: {
                headers: {
                    readonly Location?: string;
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Sign-in did not complete (state mismatch, a missing, expired or tampered login cookie, an Authentik error or a refused code exchange); no session cookie */
            readonly 400: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/html": string;
                };
            };
            /** @description No access: signed in, but in neither verdify-dashboard-operators nor verdify-dashboard-viewers; no INT-01 call */
            readonly 403: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/html": string;
                };
            };
            /** @description Sign-in is unavailable: Authentik (discovery or the token endpoint) cannot be reached, or INT-01 fails; no session cookie */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/html": string;
                };
            };
        };
    };
    readonly "BFF-01": {
        readonly parameters: {
            readonly query?: {
                /** @description Same-origin relative path; anything else becomes / */
                readonly returnTo?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description To Authentik */
            readonly 302: {
                headers: {
                    readonly Location?: string;
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            /** @description Sign-in is unavailable: Authentik cannot be reached (existing sessions keep working) */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/html": string;
                };
            };
        };
    };
    readonly "BFF-03": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description To the Authentik end-session endpoint, or to / while its discovery is unavailable */
            readonly 303: {
                headers: {
                    readonly Location?: string;
                    readonly "Set-Cookie"?: string;
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            readonly 403: components["responses"]["Problem"];
        };
    };
    readonly "OPS-01": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        /** @constant */
                        readonly status?: "ok";
                    };
                };
            };
        };
    };
    readonly "INT-01": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["SessionCreate"];
            };
        };
        readonly responses: {
            /** @description Created */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SessionToken"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "INT-02": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Deleted */
            readonly 204: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "OPS-04": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "text/plain": string;
                };
            };
        };
    };
    readonly "OPS-02": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Ready */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Readiness"];
                };
            };
            /** @description Not ready */
            readonly 503: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Readiness"];
                };
            };
        };
    };
    readonly "API-17": {
        readonly parameters: {
            readonly query?: {
                /** @description Prefix match, e.g. irrigation. or setting.write */
                readonly action?: string;
                readonly actor?: string;
                /** @description next_cursor from the previous page */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly from?: string;
                readonly limit?: components["parameters"]["Limit"];
                /** @description dashboard, iris, system, agent (any agent) or agent:<name> */
                readonly source?: string;
                /** @description Exact target, e.g. L01 or gl_main_lux_threshold */
                readonly target?: string;
                readonly to?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ActivityPage"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-14": {
        readonly parameters: {
            readonly query?: {
                /** @description next_cursor from the previous page */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: components["parameters"]["Limit"];
                /** @description open (default) = every v_open_alerts row, acknowledged ones included. recent = open plus those resolved in the last 24 h. Repeats of one alert_type and sensor_id come back as one row with count and first and last seen; a merged row has status open while any of its repeats is unacknowledged. The rows with status open are the one open-alert count (API-02 alerts.open) */
                readonly status?: "open" | "recent";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["AlertPage"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-15": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly id: components["parameters"]["AlertId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": {
                    readonly note?: string;
                };
            };
        };
        readonly responses: {
            /** @description The acknowledged alert */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Alert"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-16": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly id: components["parameters"]["AlertId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": {
                    readonly resolution?: string;
                };
            };
        };
        readonly responses: {
            /** @description The resolved alert */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Alert"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-06": {
        readonly parameters: {
            readonly query: {
                /** @description The house's achievable VPD band and its nightly grades (#1433); windows up to 35 days */
                readonly achievable?: boolean;
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
                /** @description house: the law has one band, and zones are probes */
                readonly zone?: "house";
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["BandTimeline"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-19": {
        readonly parameters: {
            readonly query: {
                /** @description America/Denver day; default today */
                readonly day?: string;
                /** @description A house band anchor: band_<series>_<anchor> */
                readonly param: string;
                /** @description The draft value, in the setting's unit */
                readonly value: number;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["BandPreview"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-23": {
        readonly parameters: {
            readonly query?: {
                /** @description Advanced: one raw house anchor as param:value, repeatable */
                readonly anchor?: readonly string[];
                /** @description America/Denver day; default today */
                readonly day?: string;
                /** @description Temperature target at solar noon, °F */
                readonly temp_day?: number;
                /** @description Edge form: the high edge at solar noon, °F */
                readonly temp_high_day?: number;
                /** @description Edge form: the high edge at solar midnight, °F */
                readonly temp_high_night?: number;
                /** @description Edge form: the low edge at solar noon, °F */
                readonly temp_low_day?: number;
                /** @description Edge form: the low edge at solar midnight, °F */
                readonly temp_low_night?: number;
                /** @description Temperature target at solar midnight, °F */
                readonly temp_night?: number;
                /** @description ± °F around the day target */
                readonly temp_width_day?: number;
                /** @description ± °F around the night target */
                readonly temp_width_night?: number;
                /** @description kPa above the day target */
                readonly vpd_above_day?: number;
                /** @description kPa above the night target */
                readonly vpd_above_night?: number;
                /** @description kPa below the day target */
                readonly vpd_below_day?: number;
                /** @description kPa below the night target */
                readonly vpd_below_night?: number;
                /** @description VPD target at solar noon, kPa */
                readonly vpd_day?: number;
                /** @description Edge form: the VPD high edge at solar noon, kPa */
                readonly vpd_high_day?: number;
                /** @description Edge form: the VPD high edge at solar midnight, kPa */
                readonly vpd_high_night?: number;
                /** @description Edge form: the VPD low edge at solar noon, kPa */
                readonly vpd_low_day?: number;
                /** @description Edge form: the VPD low edge at solar midnight, kPa */
                readonly vpd_low_night?: number;
                /** @description VPD target at solar midnight, kPa */
                readonly vpd_night?: number;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["BandProfilePreview"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-24": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["BandSave"];
            };
        };
        readonly responses: {
            /** @description Stored; each changed anchor with state requested */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["BandWrite"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-05": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Catalog"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-01": {
        readonly parameters: {
            readonly query?: {
                /** @description Keep one zone (a zone slug) */
                readonly zone?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Locations"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-02": {
        readonly parameters: {
            readonly query?: {
                /** @description true keeps active plantings (default), false ended ones; omit with an empty value for both */
                readonly active?: boolean | null;
                readonly limit?: number;
                /** @description Planted or ended on or after this day */
                readonly since?: string;
                /** @description Plantings that were ever in this zone */
                readonly zone?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PlantingList"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-07": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PlantingCreate"];
            };
        };
        readonly responses: {
            /** @description Recorded */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Planting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-03": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PlantingDetail"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-11": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PlantingPatch"];
            };
        };
        readonly responses: {
            /** @description Stored */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Planting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-09": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PlantingHarvest"];
            };
        };
        readonly responses: {
            /** @description Recorded */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Planting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-08": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PlantingMove"];
            };
        };
        readonly responses: {
            /** @description Moved */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Planting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-12": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PlantingNote"];
            };
        };
        readonly responses: {
            /** @description Noted; the planting with the note in its history */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Planting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-10": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly planting_id: components["parameters"]["PlantingId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["PlantingEnd"];
            };
        };
        readonly responses: {
            /** @description Ended */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Planting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-04": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path: {
                readonly label: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["PositionHistory"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-CROP-06": {
        readonly parameters: {
            readonly query: {
                /** @description When (default now) */
                readonly at?: string;
                /** @description Leave this planting out of the conflicts (a move's own cells) */
                readonly planting?: number;
                readonly q: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Resolution"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-13": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Equipment"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-20": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly light: "main" | "grow";
                readonly state: "on" | "off";
            };
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": {
                    /**
                     * @description How long the manual switch lasts before the light goes back to automatic
                     * @default 15
                     */
                    readonly minutes?: number;
                    readonly reason?: string;
                };
            };
        };
        readonly responses: {
            /** @description Lutron reached the state */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LightCommand"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-12": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["OverrideRequest"];
            };
        };
        readonly responses: {
            readonly 202: components["responses"]["Accepted"];
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-01": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["IrrigationStatus"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-13": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["LineCommand"];
            };
        };
        readonly responses: {
            readonly 202: components["responses"]["Accepted"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-08": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly line_id: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["LineUpdate"];
            };
        };
        readonly responses: {
            /** @description The changed lines, sync requested */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly lines: readonly components["schemas"]["IrrigationLine"][];
                    };
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-06": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly line_id: components["parameters"]["LineId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["RunRequest"];
            };
        };
        readonly responses: {
            readonly 202: components["responses"]["Accepted"];
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-10": {
        readonly parameters: {
            readonly query: {
                readonly from: string;
                readonly group_by?: "zone" | "line" | "cause";
                /** @description Keep irrigation or climate rows only (#1348); omitted, both */
                readonly purpose?: components["schemas"]["RunPurpose"];
                /** @description Inclusive local day */
                readonly to: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["MinutesReport"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-11": {
        readonly parameters: {
            readonly query: {
                readonly cause?: components["schemas"]["IrrigationCause"];
                /** @description next_cursor from the previous page */
                readonly cursor?: components["parameters"]["Cursor"];
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                readonly limit?: components["parameters"]["Limit"];
                readonly line?: components["schemas"]["LineId"];
                readonly outcome?: components["schemas"]["RunOutcome"];
                /** @description Keep irrigation or climate runs only (#1348); omitted, both */
                readonly purpose?: components["schemas"]["RunPurpose"];
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RunPage"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-02": {
        readonly parameters: {
            readonly query?: {
                /** @description Days ahead from the start of today */
                readonly days?: number;
                /** @description Past days of occurrences with their outcomes */
                readonly past_days?: number;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ScheduleAgenda"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-03": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ScheduleCreate"];
            };
        };
        readonly responses: {
            /** @description Created, sync requested until the controller's program hash matches */
            readonly 201: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Schedule"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-04": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly slot_id: components["parameters"]["SlotId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["ScheduleInput"];
            };
        };
        readonly responses: {
            /** @description Stored, sync requested */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Schedule"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-05": {
        readonly parameters: {
            readonly query?: {
                readonly reason?: components["parameters"]["Reason"];
            };
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly slot_id: components["parameters"]["SlotId"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description Deleted; the program banner shows the push */
            readonly 204: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content?: never;
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-IRR-07": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: {
            readonly content: {
                readonly "application/json": components["schemas"]["LineCommand"];
            };
        };
        readonly responses: {
            readonly 202: components["responses"]["Accepted"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-30": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LawView"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-31": {
        readonly parameters: {
            readonly query: {
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LawHistory"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-22": {
        readonly parameters: {
            readonly query: {
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["LightingDays"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-01": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Me"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-03": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["MetricDef"][];
                    };
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-02": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Now"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-32": {
        readonly parameters: {
            readonly query?: {
                /** @description First local day; default 29 days before to */
                readonly from?: string;
                /** @description Last local day, inclusive; default today */
                readonly to?: string;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DailyRecord"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-33": {
        readonly parameters: {
            readonly query?: {
                /** @description Days ending today, today included */
                readonly days?: 7 | 14 | 30;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["RelayCheck"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-34": {
        readonly parameters: {
            readonly query?: {
                /** @description next_cursor from the previous page */
                readonly cursor?: components["parameters"]["Cursor"];
                readonly limit?: number;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ReviewPage"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-04": {
        readonly parameters: {
            readonly query: {
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                /** @description Metric key from API-03; repeat for up to 8 */
                readonly metric: readonly string[];
                readonly points?: number;
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Series"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-09": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": {
                        readonly items: readonly components["schemas"]["Setting"][];
                        /** Format: date-time */
                        readonly server_time: string;
                    };
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-10": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                /** @description tunable_registry name */
                readonly param: components["parameters"]["Param"];
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["SettingWrite"];
            };
        };
        readonly responses: {
            /** @description Stored, with state requested (or no_readback); snapped_from when snapping changed the value, manual_before when the flag changed */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DesiredSetting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-11": {
        readonly parameters: {
            readonly query?: {
                readonly reason?: components["parameters"]["Reason"];
            };
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                /** @description tunable_registry name */
                readonly param: components["parameters"]["Param"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description The release row (value null, state released) */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DesiredSetting"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-12": {
        readonly parameters: {
            readonly query: {
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
            };
            readonly header?: never;
            readonly path: {
                /** @description tunable_registry name */
                readonly param: components["parameters"]["Param"];
            };
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SettingHistory"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-SOIL-01": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SoilTargets"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-SOIL-02": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: {
                /** @description Optional on every write; stored as request_id on the write's activity_log row and logged as the request id. The same key and payload return the stored result with the header Idempotency-Replayed: true; the same key with a different payload is 422 request_id_reused. */
                readonly "Idempotency-Key"?: components["parameters"]["IdempotencyKey"];
            };
            readonly path: {
                readonly zone: string;
            };
            readonly cookie?: never;
        };
        readonly requestBody: {
            readonly content: {
                readonly "application/json": components["schemas"]["SoilTargetWrite"];
            };
        };
        readonly responses: {
            /** @description Stored */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["SoilTarget"];
                };
            };
            readonly 422: components["responses"]["Invalid"];
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-05": {
        readonly parameters: {
            readonly query: {
                /** @description Only these lanes; default all */
                readonly equipment?: readonly string[];
                /** @description Window start (inclusive) */
                readonly from: components["parameters"]["From"];
                /** @description Window end (exclusive) */
                readonly to: components["parameters"]["To"];
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["StateLanes"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-35": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["ControllerHealth"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-36": {
        readonly parameters: {
            readonly query?: {
                /** @description Days ending now */
                readonly days?: 1 | 7 | 30;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["DataContinuity"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-37": {
        readonly parameters: {
            readonly query?: {
                /** @description Hours ending now */
                readonly hours?: 24 | 168;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["Delivery"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
    readonly "API-21": {
        readonly parameters: {
            readonly query?: {
                /** @description Days ending today, today included */
                readonly days?: 30 | 90;
            };
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly requestBody?: never;
        readonly responses: {
            /** @description OK */
            readonly 200: {
                headers: {
                    readonly [name: string]: unknown;
                };
                content: {
                    readonly "application/json": components["schemas"]["WaterUse"];
                };
            };
            readonly default: components["responses"]["Problem"];
        };
    };
}
