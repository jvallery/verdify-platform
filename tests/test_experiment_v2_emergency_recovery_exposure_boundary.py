"""Cross-layer contract for baseline-only emergency recovery sealing."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "db/migrations/231-experiment-v2-emergency-recovery-zero-exposure.sql"


def test_finish_seals_only_from_zero_open_exposure() -> None:
    sql = MIGRATION.read_text()
    assert "recovered.event_kind = 'recovered'" in sql
    assert "v_receipt_count < 2" in sql
    assert "IF EXISTS (" in sql
    assert "closure.exposure_id IS NULL" in sql
    assert "requires zero open exposure before sealing" in sql
    assert "fn_experiment_v2_close_exposure" not in sql
    assert "TO verdify_experiment_lifecycle" in sql
