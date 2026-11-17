-- 320 (dashboard read model): the operator API reads the daily review, the per-relay daily record and the gap-replay
-- ledger. The operator API reads as verdify_dashboard_runtime, which can read none of the three tables:
--   planner_review       313's daily reviews: status, delivery, token use, summary and band proposal;
--   daily_relay_record   310's per-day starts, run time and repaired runs for each of the 11 relays (317's columns);
--   gap_replay_quarters  314's ledger of the gap-log quarters the controller replayed after a disconnect.
-- Each is read through a column projection owned by verdify and granted SELECT to verdify_dashboard_runtime alone:
-- v_dashboard_review, v_dashboard_relay_day and v_dashboard_gap_replay. The three tables already carry ACL entries for
-- verdify_ingestor_runtime (and planner_review for verdify_mcp_runtime), so the ordinary digest (309) and the MCP digest
-- hash their whole relacl and a grant on a table itself would move the seals. The views leave every table's ACL as it
-- is, and have no api, ingestor, MCP or PUBLIC entry and no protected name, so no digest takes them in. planner_review's
-- run_id, hermes_run_id and gateway_status stay out of the projection. No runtime seal moves and no receipt is
-- re-sealed. Both blocks pin exact319's seals. No data changes. Rollback: a later migration drops the three views.
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=319 AND filename='db/migrations/319-band-divergence-mode-ignores-partial-rows.sql'
            AND sha256='6ea156b44640b7ceb3255126584a57676e1fd7139f35358a3f17e8412d3e9f77'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>319)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'b227cdf249d50b28bd110be2e994aa58ef27b546dc508b56b912093d790e70fd'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '12d74c04e3f189f324dba042cfe0948bd794be63f64b84dc12e0dcdc8a51828c'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='verdify_dashboard_runtime' AND NOT rolcanlogin)
        -- The three tables are verdify's, carry every projected column, and give the dashboard duty nothing.
        OR EXISTS(SELECT 1 FROM pg_class c
            WHERE c.oid IN ('public.planner_review'::regclass, 'public.daily_relay_record'::regclass,
                            'public.gap_replay_quarters'::regclass)
              AND (c.relkind <> 'r' OR pg_get_userbyid(c.relowner) <> 'verdify'))
        OR (SELECT count(*) FROM pg_attribute t
             WHERE t.attrelid='public.planner_review'::regclass AND t.attnum>0 AND NOT t.attisdropped
               AND t.attname IN ('id','kind','review_date','requested_at','requested_by','status','attempts',
                                 'delivered_at','failure','run_finished_at','input_tokens','output_tokens',
                                 'total_tokens','written_at','summary','band_proposal'))<>16
        OR (SELECT count(*) FROM pg_attribute t
             WHERE t.attrelid='public.daily_relay_record'::regclass AND t.attnum>0 AND NOT t.attisdropped
               AND t.attname IN ('date','greenhouse_id','equipment','starts','run_s','event_run_s','repaired_runs',
                                 'computed_at'))<>8
        OR (SELECT count(*) FROM pg_attribute t
             WHERE t.attrelid='public.gap_replay_quarters'::regclass AND t.attnum>0 AND NOT t.attisdropped
               AND t.attname IN ('boot','qseq','first_ts','last_ts','climate_rows','transition_rows','format_version',
                                 'received_at'))<>8
        OR EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
            WHERE c.oid IN ('public.planner_review'::regclass, 'public.daily_relay_record'::regclass,
                            'public.gap_replay_quarters'::regclass)
              AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime'))
        OR EXISTS(SELECT 1 FROM pg_attribute t CROSS JOIN LATERAL aclexplode(t.attacl) a
            WHERE t.attrelid IN ('public.planner_review'::regclass, 'public.daily_relay_record'::regclass,
                                 'public.gap_replay_quarters'::regclass)
              AND t.attnum > 0
              AND a.grantee=(SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime'))
        OR to_regclass('public.v_dashboard_review') IS NOT NULL
        OR to_regclass('public.v_dashboard_relay_day') IS NOT NULL
        OR to_regclass('public.v_dashboard_gap_replay') IS NOT NULL
    THEN RAISE EXCEPTION '320 refuses an unqualified predecessor'; END IF;
    -- The three tables' table and column ACLs as they stand; the successor block requires the same.
    PERFORM pg_catalog.set_config('verdify_migration_320.base_acls', (
        SELECT md5(string_agg(c.relname || ':' || coalesce(c.relacl::text, '') || ':'
                   || coalesce((SELECT string_agg(t.attname || '=' || t.attacl::text, ',' ORDER BY t.attnum)
                                  FROM pg_attribute t
                                 WHERE t.attrelid = c.oid AND t.attnum > 0 AND t.attacl IS NOT NULL), ''),
                   ';' ORDER BY c.relname))
          FROM pg_class c
         WHERE c.oid IN ('public.planner_review'::regclass, 'public.daily_relay_record'::regclass,
                         'public.gap_replay_quarters'::regclass)), true);
END $predecessor$;

CREATE VIEW public.v_dashboard_review AS
SELECT r.id, r.kind, r.review_date, r.requested_at, r.requested_by, r.status, r.attempts, r.delivered_at,
       r.failure, r.run_finished_at, r.input_tokens, r.output_tokens, r.total_tokens, r.written_at, r.summary,
       r.band_proposal
  FROM public.planner_review r;
COMMENT ON VIEW public.v_dashboard_review IS
    'The daily reviews for the operator API (320): status, delivery, failure class, token use, summary and band '
    'proposal per planner_review row. verdify''s, SELECT to verdify_dashboard_runtime alone, so planner_review''s own '
    'ACL (and with it the api, ingestor and MCP seals) is unchanged.';

CREATE VIEW public.v_dashboard_relay_day AS
SELECT d.date, d.greenhouse_id, d.equipment, d.starts, d.run_s, d.event_run_s, d.repaired_runs, d.computed_at
  FROM public.daily_relay_record d;
COMMENT ON VIEW public.v_dashboard_relay_day IS
    'The per-relay daily record for the operator API (320): starts, run time and repaired runs per local day and '
    'relay. verdify''s, SELECT to verdify_dashboard_runtime alone, so daily_relay_record''s own ACL (and with it the '
    'api and ingestor seals) is unchanged.';

CREATE VIEW public.v_dashboard_gap_replay AS
SELECT q.boot, q.qseq, q.first_ts, q.last_ts, q.climate_rows, q.transition_rows, q.format_version, q.received_at
  FROM public.gap_replay_quarters q;
COMMENT ON VIEW public.v_dashboard_gap_replay IS
    'The replayed gap-log quarters for the operator API (320): the span each quarter covers and the rows it restored. '
    'verdify''s, SELECT to verdify_dashboard_runtime alone, so gap_replay_quarters''s own ACL (and with it the api '
    'and ingestor seals) is unchanged.';

REVOKE ALL ON public.v_dashboard_review, public.v_dashboard_relay_day, public.v_dashboard_gap_replay FROM PUBLIC;
GRANT SELECT ON public.v_dashboard_review, public.v_dashboard_relay_day, public.v_dashboard_gap_replay
    TO verdify_dashboard_runtime;

DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'b227cdf249d50b28bd110be2e994aa58ef27b546dc508b56b912093d790e70fd'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '12d74c04e3f189f324dba042cfe0948bd794be63f64b84dc12e0dcdc8a51828c'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM 'aa26302d0e3a0931a5f91ce9f23c660a5a240cb59de1a4d5605f38638b534718'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        -- Each view is verdify's and carries exactly its owner's entry and one non-grantable SELECT for the dashboard
        -- duty: no PUBLIC entry and no other runtime.
        OR EXISTS(SELECT 1 FROM pg_class c
            WHERE c.oid IN ('public.v_dashboard_review'::regclass, 'public.v_dashboard_relay_day'::regclass,
                            'public.v_dashboard_gap_replay'::regclass)
              AND (c.relkind <> 'v' OR pg_get_userbyid(c.relowner) <> 'verdify'
                   OR NOT EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = c.relowner)
                   OR EXISTS(SELECT 1 FROM aclexplode(c.relacl) a WHERE a.grantee = 0)
                   OR (SELECT count(*) FROM aclexplode(c.relacl) a WHERE a.grantee <> c.relowner) <> 1
                   OR NOT EXISTS(SELECT 1 FROM aclexplode(c.relacl) a
                       WHERE a.grantee=(SELECT oid FROM pg_roles WHERE rolname='verdify_dashboard_runtime')
                         AND a.privilege_type='SELECT' AND NOT a.is_grantable)))
        OR EXISTS(SELECT 1 FROM pg_attribute t
            WHERE t.attrelid IN ('public.v_dashboard_review'::regclass, 'public.v_dashboard_relay_day'::regclass,
                                 'public.v_dashboard_gap_replay'::regclass)
              AND t.attnum > 0 AND t.attacl IS NOT NULL)
        -- The three tables' ACLs are the ones the predecessor block read.
        OR pg_catalog.current_setting('verdify_migration_320.base_acls', true) IS NULL
        OR pg_catalog.current_setting('verdify_migration_320.base_acls', true) IS DISTINCT FROM (
            SELECT md5(string_agg(c.relname || ':' || coalesce(c.relacl::text, '') || ':'
                       || coalesce((SELECT string_agg(t.attname || '=' || t.attacl::text, ',' ORDER BY t.attnum)
                                      FROM pg_attribute t
                                     WHERE t.attrelid = c.oid AND t.attnum > 0 AND t.attacl IS NOT NULL), ''),
                       ';' ORDER BY c.relname))
              FROM pg_class c
             WHERE c.oid IN ('public.planner_review'::regclass, 'public.daily_relay_record'::regclass,
                             'public.gap_replay_quarters'::regclass))
    THEN RAISE EXCEPTION '320 changed a runtime boundary'; END IF;
END $successor$;
