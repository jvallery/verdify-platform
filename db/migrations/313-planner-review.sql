-- 313 (#1659, #1660, #1661; climate refactor packages 4.2 and 5.1): the planner becomes a daily reviewer with a table
-- of its own. Iris writes no climate value any more: once a day (after 07:00 America/Denver, for the day before) and
-- on a manual request it reads the daily record (310) and stores one review here through MCP review_write. A review
-- may carry a band edit proposal with the price it quotes; only the owner applies a band edit, in the band editor.
-- plan_journal, setpoint_plan, plan_delivery_log and planner_trigger_ledger keep every row and column (the public
-- site reads them, RULINGS C4); nothing writes them after this release.
-- Writers: the ingestor's review task inserts the daily row and records each delivery to Hermes (attempts, run id,
-- HTTP status, a fixed failure class, the run's end and its token usage); MCP's review_run inserts a manual request
-- and review_write stores the review. Readers: the ingestor (the task's state and the daily_review_missed alert, and
-- v_daily_record for the review's context) and MCP.
-- Seals: the new relation and the duties' grants on planner_review and v_daily_record move all three digests (the
-- ordinary digest of the api login and of the ingestor login, and fn_mcp_runtime_boundary_digest), so all three
-- receipts are re-sealed. The successor literals were measured by the rolled-back native qualification's probe
-- (tests/fixtures/313-planner-review-native-qualification.json); any other result stops the file (fail closed).
SET LOCAL search_path=pg_catalog,public,pg_temp;
LOCK TABLE public.schema_migrations,public.runtime_ordinary_login_attestation_receipts,
    public.mcp_runtime_boundary_receipt IN SHARE ROW EXCLUSIVE MODE;
DO $predecessor$
BEGIN
    IF current_user <> 'verdify'
        OR NOT EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations'
            AND seq=312 AND filename='db/migrations/312-operator-metrics-reads.sql'
            AND sha256='66e6bfe12302b2d2756514a2c9903f05e728b1326d6c21aee07362baeca7afa2'
            AND stamp_method='runner')
        OR EXISTS(SELECT 1 FROM public.schema_migrations WHERE source='db/migrations' AND seq>312)
        OR (SELECT count(*) FROM public.runtime_ordinary_login_attestation_receipts)<>2
        OR (SELECT count(*) FROM public.mcp_runtime_boundary_receipt)<>1
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM 'f4fa14a4bb8a9430922a717194b328e8104b8a7c34be2f25f9c556372e43667e'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM '41ad8abfea5bbfb587b882e69e08af3832dd33b9b1a1d536b3b48a95aadff443'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '16ece5c6457f67f7865da99a3534452d9d8c2b9f0bb35e58ff664030a489ad22'
        OR EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
        OR to_regclass('public.planner_review') IS NOT NULL
        OR to_regclass('public.v_daily_record') IS NULL
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_ingestor_runtime' AND NOT rolcanlogin)
        OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='verdify_mcp_runtime' AND NOT rolcanlogin)
    THEN RAISE EXCEPTION '313 refuses an unqualified predecessor'; END IF;
END $predecessor$;

CREATE TABLE public.planner_review (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_id           uuid NOT NULL UNIQUE,
    kind             text NOT NULL CHECK (kind IN ('daily', 'manual')),
    review_date      date NOT NULL,
    requested_at     timestamptz NOT NULL DEFAULT now(),
    requested_by     text NOT NULL CHECK (length(requested_by) BETWEEN 1 AND 200),
    status           text NOT NULL DEFAULT 'requested'
                     CHECK (status IN ('requested', 'delivered', 'written', 'failed')),
    attempts         integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
    delivered_at     timestamptz,
    hermes_run_id    text CHECK (hermes_run_id IS NULL OR length(hermes_run_id) BETWEEN 1 AND 200),
    gateway_status   integer CHECK (gateway_status IS NULL OR gateway_status BETWEEN 0 AND 999),
    failure          text CHECK (failure IS NULL OR failure IN ('gateway_rejected', 'gateway_unreachable',
                     'hermes_run_failed', 'hermes_run_cancelled', 'completed_without_review', 'attempts_exhausted')),
    run_finished_at  timestamptz,
    input_tokens     integer CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens    integer CHECK (output_tokens IS NULL OR output_tokens >= 0),
    total_tokens     integer CHECK (total_tokens IS NULL OR total_tokens >= 0),
    written_at       timestamptz,
    summary          text CHECK (summary IS NULL OR length(summary) BETWEEN 1 AND 4000),
    band_proposal    jsonb CHECK (band_proposal IS NULL OR jsonb_typeof(band_proposal) = 'object'),
    CHECK (status <> 'written' OR (written_at IS NOT NULL AND summary IS NOT NULL)),
    CHECK (status <> 'failed' OR failure IS NOT NULL)
);
CREATE UNIQUE INDEX planner_review_daily_uidx ON public.planner_review (review_date) WHERE kind = 'daily';
CREATE INDEX planner_review_open_idx ON public.planner_review (requested_at) WHERE status IN ('requested', 'delivered');
COMMENT ON TABLE public.planner_review IS
    'The daily review (313, climate refactor 5.1): one row per review request, daily or manual. The ingestor '
    'delivers it to Iris on Hermes and records the delivery; Iris stores the review with MCP review_write. A '
    'band_proposal is a proposal only: the owner applies a band edit in the band editor. Never read as a plan.';
COMMENT ON COLUMN public.planner_review.failure IS
    'A fixed class only, never provider or model text.';
COMMENT ON COLUMN public.planner_review.band_proposal IS
    '{"anchors": {band row: value}, "price": the price-list rows quoted, "reason": why}; validated by '
    'verdify_schemas.review.BandProposal before it is stored.';

GRANT SELECT ON public.planner_review TO verdify_ingestor_runtime;
GRANT INSERT (run_id, kind, review_date, requested_by) ON public.planner_review TO verdify_ingestor_runtime;
GRANT UPDATE (status, attempts, delivered_at, hermes_run_id, gateway_status, failure, run_finished_at,
    input_tokens, output_tokens, total_tokens) ON public.planner_review TO verdify_ingestor_runtime;
GRANT SELECT ON public.v_daily_record TO verdify_ingestor_runtime;
GRANT SELECT ON public.planner_review TO verdify_mcp_runtime;
GRANT INSERT (run_id, kind, review_date, requested_by) ON public.planner_review TO verdify_mcp_runtime;
GRANT UPDATE (status, written_at, summary, band_proposal) ON public.planner_review TO verdify_mcp_runtime;

-- Successor seals, measured by the rolled-back native qualification's probe: all three digests move and all three
-- receipts are re-sealed; any other result stops the file and rolls it back.
DO $successor$
BEGIN
    IF encode(public.fn_runtime_ordinary_boundary_digest('verdify_api_runtime_login'),'hex') IS DISTINCT FROM '4a39a38fcb5cebc8aa5385b8569db3969fece16210e5c505188624c1b84f6820'
        OR encode(public.fn_runtime_ordinary_boundary_digest('verdify_ingestor_runtime_login'),'hex') IS DISTINCT FROM 'ca2eea00fdfbbef0ddc34a8d29471d5ffc98c299e17b0772f9ee583fdb5e831f'
        OR encode(public.fn_mcp_runtime_boundary_digest(),'hex') IS DISTINCT FROM '5b31cf1e74b78963e266cfd22dc3867a7972dbb53eff209f3c121781fb90f8dc'
    THEN RAISE EXCEPTION '313 refuses an unqualified successor'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('4a39a38fcb5cebc8aa5385b8569db3969fece16210e5c505188624c1b84f6820','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_api_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '313 missing api receipt'; END IF;
    UPDATE public.runtime_ordinary_login_attestation_receipts SET boundary_sha256=decode('ca2eea00fdfbbef0ddc34a8d29471d5ffc98c299e17b0772f9ee583fdb5e831f','hex'), captured_at=clock_timestamp() WHERE login_name='verdify_ingestor_runtime_login';
    IF NOT FOUND THEN RAISE EXCEPTION '313 missing ingestor receipt'; END IF;
    UPDATE public.mcp_runtime_boundary_receipt SET boundary_sha256=decode('5b31cf1e74b78963e266cfd22dc3867a7972dbb53eff209f3c121781fb90f8dc','hex') WHERE singleton;
    IF NOT FOUND THEN RAISE EXCEPTION '313 missing mcp receipt'; END IF;
    IF EXISTS(SELECT 1 FROM public.runtime_ordinary_login_attestation_receipts r
            WHERE r.boundary_sha256 IS DISTINCT FROM public.fn_runtime_ordinary_boundary_digest(r.login_name))
        OR NOT EXISTS(SELECT 1 FROM public.mcp_runtime_boundary_receipt WHERE singleton
            AND boundary_sha256=public.fn_mcp_runtime_boundary_digest())
    THEN RAISE EXCEPTION '313 receipts do not match the successor seals'; END IF;
END $successor$;
