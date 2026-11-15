// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { parseSeries } from "./operator-api";
import { hydroPlotSeries, latestHydroInterval } from "./hydroponics";

function series(values: (number | null)[]) {
  return parseSeries({ from: "2026-11-14T00:00:00Z", to: "2026-11-14T01:00:00Z", bucket_s: 300,
    t: values.map((_, i) => 1794614400 + i * 300), series: { "climate.hydro_ph": { avg: values, min: values, max: values, count: values.map((v) => v === null ? 0 : 1), source: "raw", retained_from: null } },
    watermark: null, server_time: "2026-11-14T01:00:00Z", gaps: [],
  });
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
