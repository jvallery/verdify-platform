// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { parseSeries } from "./operator-api";
import { latestHydroInterval } from "./hydroponics";

function series(values: (number | null)[]) {
  return parseSeries({ from: "2026-11-14T00:00:00Z", to: "2026-11-14T01:00:00Z", bucket_s: 300,
    t: values.map((_, i) => 1794614400 + i * 300), series: { "climate.hydro_ph": { avg: values, min: values, max: values, count: values.map((v) => v === null ? 0 : 1), source: "raw", retained_from: null } },
    watermark: null, server_time: "2026-11-14T01:00:00Z", gaps: [],
  });
}

test("missing readings stay missing, including an entirely absent metric", () => {
  expect(latestHydroInterval(null, "climate.hydro_ph")).toBeNull();
  expect(latestHydroInterval(series([null, null]), "climate.hydro_ph")).toBeNull();
  expect(latestHydroInterval(series([6.1]), "climate.hydro_orp_mv")).toBeNull();
});

test("the latest recorded interval retains its own timestamp across trailing gaps and preserves real zero", () => {
  expect(latestHydroInterval(series([6.1, 6.2, null]), "climate.hydro_ph")).toEqual({ value: 6.2, at: 1794614700 });
  expect(latestHydroInterval(series([6.1, 0, null]), "climate.hydro_ph")).toEqual({ value: 0, at: 1794614700 });
});
