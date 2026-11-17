"""System-infrastructure row schemas.

- SensorRegistry: hardware inventory + calibration metadata
- ESP32LogRow: remote log line aggregated from the controller
- DataGap: backfill bookkeeping — tracks every interval where telemetry
  stopped (ingestor restart, network drop, ESP32 reboot, etc.)
- UtilityCost: monthly invoice reconciliation for electric/gas/water
"""

from __future__ import annotations

from datetime import date as DateType
from decimal import Decimal
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class SensorRegistry(BaseModel):
    """sensor_registry table row."""

    model_config = ConfigDict(extra="ignore")

    sensor_id: str = Field(..., min_length=1)
    entity_id: str | None = None
    type: str = Field(..., min_length=1)
    zone: str | None = None
    position: str | None = None
    source_table: str = Field(..., min_length=1)
    source_column: str | None = None
    unit: str | None = None
    expected_interval_s: int = Field(..., ge=1)
    active: bool = True
    notes: str | None = None
    description: str | None = None
    installed_date: DateType | None = None
    created_at: AwareDatetime | None = None
    updated_at: AwareDatetime | None = None


ESP32LogLevel = Literal["VERBOSE", "DEBUG", "CONFIG", "INFO", "WARN", "ERROR", "FATAL"]


class ESP32LogRow(BaseModel):
    """esp32_logs hypertable row — remote log line from the ESP32."""

    model_config = ConfigDict(extra="ignore")

    ts: AwareDatetime
    level: str
    tag: str | None = None
    message: str = Field(..., min_length=1)


# replayed: the controller's gap log replayed the whole gap (migration 321, ingestor gap_replay).
DataGapStatus = Literal["pending", "backfilled", "replayed", "unrecoverable", "ignored"]


class DataGap(BaseModel):
    """data_gaps table row — interval where telemetry went dark."""

    model_config = ConfigDict(extra="ignore")

    id: int | None = None
    start_ts: AwareDatetime
    end_ts: AwareDatetime
    duration_s: float = Field(..., ge=0)
    reason: str = "ingestor_restart"
    backfill_status: DataGapStatus = "pending"
    created_at: AwareDatetime | None = None


UtilityCategory = Literal["electric", "gas", "water", "other"]


class UtilityCost(BaseModel):
    """utility_cost table row — one row per category per month."""

    model_config = ConfigDict(extra="ignore")

    id: int | None = None
    month: DateType
    category: str = Field(..., min_length=1)
    amount_usd: Decimal = Field(..., ge=0)
    kwh: Decimal | None = Field(default=None, ge=0)
    gallons: Decimal | None = Field(default=None, ge=0)
    notes: str | None = None
    created_at: AwareDatetime | None = None
    updated_at: AwareDatetime | None = None
