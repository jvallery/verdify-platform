// SPDX-License-Identifier: MIT
// Today on Now: the time-in-band line beside the title, from the daily record (API-32): today so far, yesterday and last
// night, each only when known; nothing at all reads null, never 0%.
import { expect, test } from "vitest";
import { inBandWords } from "./today";

test("in band today and yesterday with last night; each part only when known", () => {
  expect(inBandWords({ today: 91.6, yesterday: 88.4, nightDried: false, nightDryoutMin: null })).toBe("In band today 92% · yesterday 88% · Last night did not dry out");
  expect(inBandWords({ today: null, yesterday: 88.4, nightDried: null, nightDryoutMin: null })).toBe("In band yesterday 88%");
  expect(inBandWords({ today: null, yesterday: null, nightDried: true, nightDryoutMin: 40 })).toBe("Last night dried out for 40 min");
  expect(inBandWords({ today: null, yesterday: null, nightDried: null, nightDryoutMin: null })).toBeNull();
});
