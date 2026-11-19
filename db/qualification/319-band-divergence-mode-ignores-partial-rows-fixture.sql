-- Run only inside an explicit rollback-only transaction after exact319 (#1770, host release 6; #1633, #1734), as the
-- superuser owner: scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It
-- checks that v_band_device_divergence kept migration 250's 28 columns and types, its owner, grants and comment, that its
-- mode read skips a diagnostics row with no band_source, and that its mode equals the newest band_source of the
-- 15-minute window (mapped as before), read by the ingestor runtime login. Every read is bounded; nothing is written.
-- The last line reports the result to the qualifier.
DO $view$
DECLARE
    expected_mode text;
    seen_mode text;
BEGIN
    IF (SELECT md5(string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod), ',' ORDER BY a.attnum))
          FROM pg_catalog.pg_attribute a
         WHERE a.attrelid = 'public.v_band_device_divergence'::regclass AND a.attnum > 0 AND NOT a.attisdropped)
        IS DISTINCT FROM 'd6966498f79f6ce6226acfa0d93962f4' THEN
        RAISE EXCEPTION '319 changed the view''s columns';
    END IF;
    IF (SELECT relowner::regrole::text || '|' || relacl::text FROM pg_catalog.pg_class
         WHERE oid = 'public.v_band_device_divergence'::regclass)
        IS DISTINCT FROM 'verdify|{verdify=arwdDxt/verdify,verdify_ingestor_runtime=r/verdify}' THEN
        RAISE EXCEPTION '319 changed the view''s owner or grants';
    END IF;
    IF md5(obj_description('public.v_band_device_divergence'::regclass, 'pg_class'))
        IS DISTINCT FROM '3cb4993bcfcce153277a9cc8e6bc5d04' THEN
        RAISE EXCEPTION '319 changed the view''s comment';
    END IF;
    IF pg_catalog.pg_get_viewdef('public.v_band_device_divergence'::regclass, true)
        !~ 'd\.band_source IS NOT NULL' THEN
        RAISE EXCEPTION '319: the mode read does not skip a row with no band_source';
    END IF;
    SELECT CASE WHEN b.band_source IN ('onchip_curve', 'dispatcher_legacy') THEN b.band_source ELSE 'unobservable' END
      INTO expected_mode
      FROM (SELECT (SELECT d.band_source FROM public.diagnostics d
                     WHERE d.greenhouse_id = 'vallery' AND d.ts BETWEEN now() - interval '15 minutes' AND now()
                       AND d.band_source IS NOT NULL
                     ORDER BY d.ts DESC LIMIT 1) AS band_source) b;
    SELECT v.band_source INTO seen_mode FROM public.v_band_device_divergence v;
    IF seen_mode IS DISTINCT FROM expected_mode THEN
        RAISE EXCEPTION '319: the view reads % but the newest band_source of the window is %', seen_mode, expected_mode;
    END IF;
END $view$;

SET SESSION AUTHORIZATION verdify_ingestor_runtime_login;
DO $ingestor$
BEGIN
    IF (SELECT count(*) FROM public.v_band_device_divergence) <> 1 THEN
        RAISE EXCEPTION '319: the ingestor runtime does not read one divergence row';
    END IF;
END $ingestor$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('view_columns_unchanged', 'view_owner_and_grants_unchanged', 'view_comment_unchanged',
                               'mode_read_skips_partial_rows', 'mode_is_newest_band_source',
                               'ingestor_runtime_reads_one_row'),
    'all_passed', true)::text;
