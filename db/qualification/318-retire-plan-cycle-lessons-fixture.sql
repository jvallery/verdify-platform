-- Run only inside an explicit rollback-only transaction after exact318 (#1633, host release 5; #1734), as the superuser
-- owner: scripts/qualify-migration-successor.py --native-fixture runs it at the end of its final session. It checks
-- that none of the 27 plan-cycle lessons is active, that each kept its text, that no active lesson names a retired
-- setting the review found, and that the MCP login's lesson reads and the knowledge search's lesson filter return none
-- of them. Every read is bounded.
-- The last line reports the result to the qualifier.
DO $lessons$
DECLARE
    retired constant integer[] := ARRAY[1, 7, 8, 27, 88, 89, 94, 98, 102, 104, 105, 125, 128, 131, 134, 136, 139, 140,
                                        141, 151, 162, 174, 223, 272, 274, 277, 296];
BEGIN
    IF EXISTS(SELECT 1 FROM public.planner_lessons WHERE id = ANY(retired) AND is_active IS TRUE) THEN
        RAISE EXCEPTION '318 left a plan-cycle lesson active';
    END IF;
    IF EXISTS(SELECT 1 FROM public.planner_lessons WHERE id = ANY(retired)
            AND (coalesce(lesson, '') = '' OR coalesce(condition, '') = '')) THEN
        RAISE EXCEPTION '318 lost a retired lesson''s text';
    END IF;
    IF EXISTS(SELECT 1 FROM public.planner_lessons WHERE is_active IS TRUE AND superseded_by IS NULL
            AND (condition || ' ' || lesson) ~* '(mister_engage_kpa|mister_all_kpa|fog_escalation|mist_max_closed_vent_s|safety_max|lead_rotate_s|d_cool_stage_2|vpd_target_(south|west|east|center)|fog_time_window_end|direct_wet_stress_latest_hour)') THEN
        RAISE EXCEPTION '318: an active lesson still names a retired setting';
    END IF;
END $lessons$;

SET SESSION AUTHORIZATION verdify_mcp_runtime_login;
DO $mcp$
BEGIN
    IF EXISTS(SELECT 1 FROM (SELECT id FROM public.planner_lessons
                              WHERE is_active = true AND superseded_by IS NULL LIMIT 1000) l
               WHERE l.id = ANY(ARRAY[1, 7, 8, 27, 88, 89, 94, 98, 102, 104, 105, 125, 128, 131, 134, 136, 139, 140,
                                      141, 151, 162, 174, 223, 272, 274, 277, 296])) THEN
        RAISE EXCEPTION '318: the MCP lesson read still returns a retired lesson';
    END IF;
    IF EXISTS(SELECT 1 FROM (SELECT e.source_id FROM public.knowledge_embeddings e
                               JOIN public.planner_lessons pl ON e.source_type = 'lesson' AND pl.id::text = e.source_id
                              WHERE pl.is_active IS TRUE AND pl.superseded_by IS NULL LIMIT 1000) k
               WHERE k.source_id::integer = ANY(ARRAY[1, 7, 8, 27, 88, 89, 94, 98, 102, 104, 105, 125, 128, 131, 134,
                                                      136, 139, 140, 141, 151, 162, 174, 223, 272, 274, 277, 296])) THEN
        RAISE EXCEPTION '318: the knowledge search''s lesson filter still admits a retired lesson';
    END IF;
END $mcp$;
RESET SESSION AUTHORIZATION;

SELECT 'QUALIFY native_fixture ' || json_build_object(
    'checks', json_build_array('plan_cycle_lessons_inactive', 'retired_text_kept', 'no_active_lesson_names_retired',
                               'mcp_lesson_read_excludes_them', 'knowledge_lesson_filter_excludes_them'),
    'all_passed', true)::text;
