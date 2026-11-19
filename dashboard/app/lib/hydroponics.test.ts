// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { parseSeries } from "./operator-api";
import { RESERVOIR_METRICS, hydroAnswer, hydroPlotSeries, latestHydroInterval, probeAge, reservoirValue, type ReservoirNow } from "./hydroponics";

function series(values: (number | null)[]) {
  const parsed = parseSeries({ from: "2026-11-14T00:00:00Z", to: "2026-11-14T01:00:00Z", bucket_s: 300,
    t: values.map((_, i) => 1794614400 + i * 300), series: { "climate.hydro_ph": { avg: values, min: values, max: values, count: values.map((v) => v === null ? 0 : 1), source: "raw", retained_from: null } },
    watermark: null, server_time: "2026-11-14T01:00:00Z", gaps: [],
  });
  if (!parsed) throw new Error("Invalid series fixture");
  return parsed;
}

test("missing readings stay missing, including an entirely absent metric", () => {
  expect(latestHydroInterval(null, "climate.hydro_ph")).toBeNull();
  expect(latestHydroInterval(series([null, null]), "climate.hydro_ph")).toBeNull();
  expect(latestHydroInterval(series([6.1]), "climate.absent_metric")).toBeNull();
});

test("the latest recorded interval retains its own timestamp across trailing gaps and preserves real zero", () => {
  expect(latestHydroInterval(series([6.1, 6.2, null]), "climate.hydro_ph")).toEqual({ value: 6.2, at: 1794614700 });
  expect(latestHydroInterval(series([6.1, 0, null]), "climate.hydro_ph")).toEqual({ value: 0, at: 1794614700 });
});


test("joins sparse reservoir samples without inventing values and preserves outages", () => {
  const sparse = series([6.1, null, 6.3]);
  const plot = hydroPlotSeries(sparse, "climate.hydro_ph")!;
  expect(plot.t).toEqual([sparse.t[0], sparse.t[2]]);
  expect(plot.series["climate.hydro_ph"].avg).toEqual([6.1, 6.3]);
  expect(sparse.series["climate.hydro_ph"].avg).toEqual([6.1, null, 6.3]);
  const outage = { ...sparse, gaps: [{ start: new Date(sparse.t[1] * 1000).toISOString(), end: new Date(sparse.t[2] * 1000).toISOString(), reason: "ingestor_restart" }] };
  expect(hydroPlotSeries(outage, "climate.hydro_ph")!.t).toEqual(sparse.t);
});

test("retains long gaps, leading and trailing nulls, zero and all-missing windows", () => {
  for (const values of [[null, 6.1, null], [6.1, null, null, 6.3], [null, null]]) {
    const source = series(values);
    expect(hydroPlotSeries(source, "climate.hydro_ph")!.t).toEqual(source.t);
  }
  expect(hydroPlotSeries(series([0, null, 6.3]), "climate.hydro_ph")!.series["climate.hydro_ph"].avg).toEqual([0, 6.3]);
});

test("the probe's age is its newest channel's, overdue past the API's limit; no battery channel is read", () => {
  const now = Date.parse("2026-11-02T17:42:00Z");
  const reading = (minutes: number | null) => ({ value: minutes === null ? null : 6.1, observed_at: minutes === null ? null : new Date(now - minutes * 60_000).toISOString() });
  expect(probeAge({ ph: reading(3), ec_us_cm: reading(20), water_temp_f: reading(null), stale_after_s: 600 }, now)).toEqual({ at: "2026-11-02T17:39:00.000Z", age_s: 180, stale: false });
  expect(probeAge({ ph: reading(12), ec_us_cm: reading(30), water_temp_f: reading(null), stale_after_s: 600 }, now)).toMatchObject({ age_s: 720, stale: true });
  expect(probeAge({ ph: reading(null), ec_us_cm: reading(null), water_temp_f: reading(null), stale_after_s: 600 }, now)).toEqual({ at: null, age_s: null, stale: true });
  expect(probeAge(null, now)).toEqual({ at: null, age_s: null, stale: true });
  expect(RESERVOIR_METRICS.some((key) => /battery|tds|orp/.test(key))).toBe(false);
});

test("Hydroponics' answer first (design review A4), with conductivity in whole µS/cm", () => {
  const now = Date.parse("2026-11-02T17:42:00Z");
  const at = new Date(now - 3 * 60_000).toISOString();
  const hydro: ReservoirNow = { ph: { value: 6.12, observed_at: at }, ec_us_cm: { value: 1889.4, observed_at: at }, water_temp_f: { value: 68.2, observed_at: at }, stale_after_s: 900 };
  expect(reservoirValue(1889.4, "µS/cm")).toBe("1,889\u00a0µS/cm");
  expect(reservoirValue(null, "µS/cm")).toBe(reservoirValue(null, "°F"));
  expect(hydroAnswer(hydro, now).replaceAll("\u00a0", " ")).toBe("The reservoir reads pH 6.1, 1,889 µS/cm and 68.2 °F, 3 min ago.");
  expect(hydroAnswer(hydro, now + 60 * 60_000).replaceAll("\u00a0", " ")).toMatch(/^The reservoir probe is overdue: it last reported .+ ago, reading pH 6\.1, 1,889 µS\/cm and 68\.2 °F\.$/);
  expect(hydroAnswer(null, now)).toBe("The reservoir probe has not reported in the last 24 hours.");
});
