"""ForecastHour — 1:1 onto the weather_forecast DB row.

25-field Open-Meteo hourly forecast (16-day horizon). Shared by forecast-sync.py
(writer), the daily review's context (reader) and generate-forecast-page.py
(renderer).
"""

from __future__ import annotations

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field


class ForecastHour(BaseModel):
    model_config = ConfigDict(extra="ignore")

    ts: AwareDatetime
    greenhouse_id: str = "vallery"
    fetched_at: AwareDatetime

    # Temperature + humidity
    temp_f: float | None = None
    rh_pct: float | None = Field(default=None, ge=0, le=100)
    dew_point_f: float | None = None
    feels_like_f: float | None = None
    vpd_kpa: float | None = Field(default=None, ge=0, le=20)

    # Precipitation
    precip_prob_pct: float | None = Field(default=None, ge=0, le=100)
    precip_in: float | None = Field(default=None, ge=0)
    rain_in: float | None = Field(default=None, ge=0)
    snow_in: float | None = Field(default=None, ge=0)

    # Radiation
    solar_w_m2: float | None = Field(default=None, ge=0, le=1500)
    direct_radiation_w_m2: float | None = Field(default=None, ge=0, le=1500)
    diffuse_radiation_w_m2: float | None = Field(default=None, ge=0, le=1500)
    uv_index: float | None = Field(default=None, ge=0, le=20)
    sunshine_duration_s: float | None = Field(default=None, ge=0, le=3600)
    et0_mm: float | None = Field(default=None, ge=0)

    # Wind
    wind_speed_mph: float | None = Field(default=None, ge=0, le=200)
    wind_dir_deg: float | None = Field(default=None, ge=0, le=360)
    wind_gust_mph: float | None = Field(default=None, ge=0, le=250)

    # Cloud
    cloud_cover_pct: float | None = Field(default=None, ge=0, le=100)
    cloud_cover_low_pct: float | None = Field(default=None, ge=0, le=100)
    cloud_cover_high_pct: float | None = Field(default=None, ge=0, le=100)

    # Other
    weather_code: int | None = None
    surface_pressure_hpa: float | None = None
    soil_temp_f: float | None = None
    visibility_m: float | None = Field(default=None, ge=0)
