// SPDX-License-Identifier: MIT
import { expect, test } from "vitest";
import { deviceState, hostState } from "./states";

const READING = { ingestorRunning: true, controllerReporting: true };

test("a device block loads, fails on its own, goes stale with the shell's reason, else is ready", () => {
  expect(deviceState({ data: null, failed: false, pending: true }, READING)).toBe("loading");
  expect(deviceState({ data: {}, failed: true, pending: false }, READING)).toBe("error");
  expect(deviceState({ data: {}, failed: false, pending: false }, { ingestorRunning: false, controllerReporting: false })).toBe("ingestor_down");
  expect(deviceState({ data: {}, failed: false, pending: false }, { ingestorRunning: true, controllerReporting: false })).toBe("controller_not_reporting");
  expect(deviceState({ data: {}, failed: false, pending: false }, { ingestorRunning: null, controllerReporting: null })).toBe("ready");
});

test("a host block loads, fails, is empty when its test says so, else is ready", () => {
  expect(hostState({ data: null, failed: false, pending: true })).toBe("loading");
  expect(hostState({ data: [1], failed: true, pending: false })).toBe("error");
  expect(hostState({ data: [] as number[], failed: false, pending: false }, (rows) => rows.length === 0)).toBe("empty");
  expect(hostState({ data: [1], failed: false, pending: false }, (rows) => rows.length === 0)).toBe("ready");
});
