-- Run only inside an explicit rollback-only transaction after exact312 (#1633, package 6), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. The dashboard login
-- (the operator API's) attests, reads every column of daily_band_compliance, daily_record and v_dashboard_energy, finds
-- a power-meter row in the last hour, and still has no privilege on energy itself; energy's ACL keeps exactly its
-- verdify, ingestor and MCP entries. Nothing outside the rollback is written. The last line reports the result.
DO $acl$
BEGIN
    IF (SELECT array_agg(DISTINCT r.rolname ORDER BY r.rolname)
          FROM aclexplode((SELECT c.relacl FROM pg_class c WHERE c.oid='public.energy'::regclass)) a
          JOIN pg_roles r ON r.oid = a.grantee)
       IS DISTINCT FROM ARRAY['verdify','verdify_ingestor_runtime','verdify_mcp_runtime']::name[]
    THEN RAISE EXCEPTION '312 energy ACL moved'; END IF;
END $acl$;

-- SET SESSION AUTHORIZATION needs the superuser owner; the rollback undoes it.
SET SESSION AUTHORIZATION verdify_dashboard_runtime_login;
DO $dashboard$
BEGIN
    IF verdify_dashboard_runtime.fn_attest_login() IS NOT TRUE THEN
        RAISE EXCEPTION '312 dashboard login does not attest';
    END IF;
    IF has_table_privilege(current_user, 'public.energy', 'SELECT') THEN
        RAISE EXCEPTION '312 dashboard login reads energy directly';
    END IF;
    PERFORM * FROM public.daily_band_compliance b WHERE b.date >= (now() AT TIME ZONE 'America/Denver')::date - 3;
    PERFORM * FROM public.daily_record d WHERE d.date >= (now() AT TIME ZONE 'America/Denver')::date - 3;
    PERFORM * FROM public.v_dashboard_energy e WHERE e.ts > now() - interval '1 hour';
    IF NOT FOUND THEN RAISE EXCEPTION '312 dashboard login read no power-meter row in the last hour'; END IF;
END $dashboard$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('energy_acl_unchanged', 'dashboard_login_attests', 'dashboard_login_no_energy_table',
                               'dashboard_login_reads_compliance', 'dashboard_login_reads_daily_record',
                               'dashboard_login_reads_meter_last_hour'),
    'all_passed', true,
    'attested', json_build_object('dashboard', true))::text;
