-- 318 (#1633, host release 5; #1734, release 4 review C-9, R4PLANNER-02): the planner lessons that teach the retired
-- plan cycle are retired. Data only: 27 active planner_lessons rows name a setting the controller no longer has, or a
-- plan waypoint (setpoint_plan) the reviewer no longer writes, so the daily reviewer's lessons, lessons_search and
-- knowledge_search would teach it tactics it cannot use. Each row is set is_active = false; its text, category,
-- condition, confidence and validation history stay, so it is recoverable. The migrate hook does not keep the
-- NOTICE below (its runner output is captured and not printed), so the release's sync receipt records, read just
-- before the sync, which of the 27 ids are active: SELECT id, is_active FROM public.planner_lessons WHERE id IN
-- (<the 27>) ORDER BY id. 318 flips exactly those; the reversal is UPDATE public.planner_lessons SET is_active = true
-- WHERE id IN (<the ids the receipt shows active>), never the full list of 27, which could reactivate a row the
-- reviewer retired before 318 ran. Nothing is deleted, no row is rewritten, and no knowledge_embeddings row changes: fn_search_knowledge_embeddings
-- (296) and MCP's lessons and lessons_search read a lesson only while it is active and not superseded, so the retired
-- rows drop out of every read at commit, and embed-corpora (incremental) stops collecting them.
-- The 27 (re-derived on production 2026-11-17 from the 229 active rows; the review listed the first 17):
--   retired settings: 1 mister_engage_kpa (and a waypoint), 7 mister_engage_kpa / mister_all_kpa naming,
--   8 lead_rotate_s, 27 mist_max_closed_vent_s, 88 fog_escalation, 89 safety_max and SEALED_MIST,
--   94 vpd_target_* zone targets / mister_center_penalty / mister_vpd_weight, 98 mister_engage_kpa /
--   fog_escalation_kpa / mist_max_closed_vent_s, 102 mister_engage_kpa, 104 mister_engage_kpa / mister_all_kpa /
--   fog_escalation_kpa / d_cool_stage_2 / temp_hysteresis, 105 fog_time_window_end, 125, 128, 131, 134 and 174
--   fog_escalation, 139 d_cool_stage_2 / temp_hysteresis, 140 mister_all_kpa, 223 direct_wet_stress_latest_hour,
--   272 mister_engage_kpa / mister_all_kpa / fog_escalation_kpa, 277 min_fog_off and a waypoint;
--   plan waypoints only: 136, 141, 151, 162, 274, 296.
-- A row the reviewer already retired or superseded since then is left as it is. Seals: no catalog object changes, so
-- the api, ingestor and MCP seals stay 317's; the successor block asserts them and re-seals each receipt to the same
-- value. 318 chains from exact317 (its sha256 and seals are bound below; both move if 317's are re-measured).
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=317 AND filename='db/migrations/317-served-band-readers-and-relay-record.sql'
            AND sha256='d2feff14ff08e8b76f74310cc6fbe3990a4a8e397d1b2aeade3994ec8f2fb54c'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>317)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '46285cc61b12abcb6e08a3898941a837f0c9c8701761408d8af901e30a291d76'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '74023040d4e1cec522dc7cc0b51348c0898e7006da193b4a3b96613eac49ad4f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'd78c9a7e114bdece47f0a9f6768e3c3d869a1598dcfce38b1a668ef631551929'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- The lessons table keeps the columns this file and its readers use.
        OR (SELECT count(*) FROM pg_catalog.pg_attribute
             WHERE attrelid='public.planner_lessons'::regclass AND NOT attisdropped
               AND attname IN ('id', 'is_active', 'superseded_by', 'lesson', 'condition'))<>5
    THEN
        RAISE EXCEPTION '318 requires exact317 and its seals';
    END IF;
END $predecessor$;

DO $retire$
DECLARE
    retired integer;
    flipped text;
BEGIN
    WITH f AS (
        UPDATE public.planner_lessons
           SET is_active = false
         WHERE id IN (1, 7, 8, 27, 88, 89, 94, 98, 102, 104, 105, 125, 128, 131, 134, 136, 139, 140, 141, 151, 162, 174,
                      223, 272, 274, 277, 296)
           AND is_active IS TRUE
        RETURNING id)
    SELECT count(*)::integer, COALESCE(string_agg(f.id::text, ', ' ORDER BY f.id), '') INTO retired, flipped FROM f;
    RAISE NOTICE '318 retired % plan-cycle lessons, ids (%); the reversal sets is_active = true on these ids only',
        retired, flipped;
END $retire$;

-- Successor seals: no catalog object changed, so they are 317's; each receipt is re-sealed to the same value.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '46285cc61b12abcb6e08a3898941a837f0c9c8701761408d8af901e30a291d76'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '74023040d4e1cec522dc7cc0b51348c0898e7006da193b4a3b96613eac49ad4f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'd78c9a7e114bdece47f0a9f6768e3c3d869a1598dcfce38b1a668ef631551929'
    THEN RAISE EXCEPTION '318 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('46285cc61b12abcb6e08a3898941a837f0c9c8701761408d8af901e30a291d76','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '318 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('74023040d4e1cec522dc7cc0b51348c0898e7006da193b4a3b96613eac49ad4f','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '318 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('d78c9a7e114bdece47f0a9f6768e3c3d869a1598dcfce38b1a668ef631551929','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '318 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '318 receipts do not match the successor seals'; END IF;
END $successor$;
