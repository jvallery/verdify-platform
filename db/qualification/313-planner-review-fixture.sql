-- Run only inside an explicit rollback-only transaction after exact 313 (#1659), as the superuser owner:
-- scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks the
-- review table's access is exact: the ingestor duty reads it and v_daily_record, inserts a request and updates only
-- the delivery columns; the MCP duty reads it, inserts a request and updates only the review columns; the api login
-- and PUBLIC reach nothing. As the owner it then walks one daily row through its lifecycle and proves the checks
-- refuse a second daily row for the same day, a written row without a summary and a failed row without a class.
-- The rollback discards all of it. The last line reports the result to the qualifier.
DO $fixture$
DECLARE
    ing text := 'verdify_ingestor_runtime';
    mcp text := 'verdify_mcp_runtime';
    rel text := 'public.planner_review';
    col text;
BEGIN
    IF NOT has_table_privilege(ing, rel, 'SELECT') OR NOT has_table_privilege(mcp, rel, 'SELECT')
        OR NOT has_table_privilege(ing, 'public.v_daily_record', 'SELECT')
        OR has_table_privilege(mcp, 'public.v_daily_record', 'SELECT')
        OR has_table_privilege(ing, rel, 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_table_privilege(mcp, rel, 'DELETE,TRUNCATE,REFERENCES,TRIGGER')
        OR has_table_privilege(ing, rel, 'INSERT') OR has_table_privilege(ing, rel, 'UPDATE')
        OR has_table_privilege(mcp, rel, 'INSERT') OR has_table_privilege(mcp, rel, 'UPDATE')
        OR has_table_privilege('verdify_api_runtime_login', rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
        OR has_table_privilege('public', rel, 'SELECT')
    THEN RAISE EXCEPTION '313 planner_review table access is not exact'; END IF;
    FOREACH col IN ARRAY ARRAY['run_id', 'kind', 'review_date', 'requested_by'] LOOP
        IF NOT has_column_privilege(ing, rel, col, 'INSERT') OR NOT has_column_privilege(mcp, rel, col, 'INSERT') THEN
            RAISE EXCEPTION '313 insert of % is missing', col;
        END IF;
    END LOOP;
    FOREACH col IN ARRAY ARRAY['id', 'requested_at', 'status', 'attempts', 'written_at', 'summary', 'band_proposal'] LOOP
        IF has_column_privilege(ing, rel, col, 'INSERT') OR has_column_privilege(mcp, rel, col, 'INSERT') THEN
            RAISE EXCEPTION '313 insert of % is granted', col;
        END IF;
    END LOOP;
    FOREACH col IN ARRAY ARRAY['status', 'attempts', 'delivered_at', 'hermes_run_id', 'gateway_status', 'failure',
                                'run_finished_at', 'input_tokens', 'output_tokens', 'total_tokens'] LOOP
        IF NOT has_column_privilege(ing, rel, col, 'UPDATE') THEN RAISE EXCEPTION '313 ingestor update of %', col; END IF;
    END LOOP;
    FOREACH col IN ARRAY ARRAY['run_id', 'kind', 'review_date', 'written_at', 'summary', 'band_proposal'] LOOP
        IF has_column_privilege(ing, rel, col, 'UPDATE') THEN RAISE EXCEPTION '313 ingestor may update %', col; END IF;
    END LOOP;
    FOREACH col IN ARRAY ARRAY['status', 'written_at', 'summary', 'band_proposal'] LOOP
        IF NOT has_column_privilege(mcp, rel, col, 'UPDATE') THEN RAISE EXCEPTION '313 mcp update of %', col; END IF;
    END LOOP;
    FOREACH col IN ARRAY ARRAY['run_id', 'kind', 'review_date', 'attempts', 'failure', 'input_tokens'] LOOP
        IF has_column_privilege(mcp, rel, col, 'UPDATE') THEN RAISE EXCEPTION '313 mcp may update %', col; END IF;
    END LOOP;
END $fixture$;

DO $lifecycle$
DECLARE
    rid uuid := '00000000-0000-4000-8000-000000000313';
BEGIN
    INSERT INTO public.planner_review (run_id, kind, review_date, requested_by)
    VALUES (rid, 'daily', DATE '1999-01-01', 'qualify');
    UPDATE public.planner_review SET status = 'delivered', attempts = 1, delivered_at = now(),
           hermes_run_id = 'run_qualify', gateway_status = 202 WHERE run_id = rid;
    UPDATE public.planner_review SET status = 'written', written_at = now(), summary = 'Qualification review.',
           band_proposal = '{"anchors": {"band_temp_low_sr": 60}, "price": "row", "reason": "qualify"}'
     WHERE run_id = rid;
    BEGIN
        INSERT INTO public.planner_review (run_id, kind, review_date, requested_by)
        VALUES (gen_random_uuid(), 'daily', DATE '1999-01-01', 'qualify');
        RAISE EXCEPTION '313 accepted a second daily row';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    INSERT INTO public.planner_review (run_id, kind, review_date, requested_by)
    VALUES (gen_random_uuid(), 'manual', DATE '1999-01-01', 'qualify');
    BEGIN
        UPDATE public.planner_review SET status = 'written' WHERE kind = 'manual' AND review_date = DATE '1999-01-01';
        RAISE EXCEPTION '313 accepted a written row without a summary';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE public.planner_review SET status = 'failed' WHERE kind = 'manual' AND review_date = DATE '1999-01-01';
        RAISE EXCEPTION '313 accepted a failed row without a class';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    DELETE FROM public.planner_review WHERE review_date = DATE '1999-01-01';
END $lifecycle$;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('ingestor_reads_and_inserts_and_updates_delivery_only', 'ingestor_reads_daily_record',
                               'mcp_reads_and_inserts_and_updates_review_only', 'api_and_public_denied',
                               'daily_lifecycle', 'one_daily_row_per_day', 'written_needs_summary',
                               'failed_needs_class'),
    'all_passed', true)::text;
