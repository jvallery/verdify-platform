// SPDX-License-Identifier: MIT
import { describe, expect, test } from "vitest";
import { bandAnchorUnit, bandAnchorWords } from "./band-words";

describe("a band anchor's key in words", () => {
  test("each part of the key has its word", () => {
    expect(bandAnchorWords("band_temp_low_sr")).toBe("temperature low edge at sunrise");
    expect(bandAnchorWords("band_temp_high_sm")).toBe("temperature high edge at solar noon");
    expect(bandAnchorWords("band_vpd_low_ss")).toBe("VPD low edge at sunset");
    expect(bandAnchorWords("band_vpd_high_mid")).toBe("VPD high edge at solar midnight");
    expect(bandAnchorWords("band_temp_target_mid")).toBe("temperature middle line at solar midnight");
  });
  test("every one of the 24 keys reads in words, with its unit", () => {
    for (const axis of ["temp", "vpd"]) for (const side of ["low", "high", "target"]) for (const at of ["sr", "sm", "ss", "mid"]) {
      const key = `band_${axis}_${side}_${at}`;
      expect(bandAnchorWords(key)).toMatch(/^(temperature|VPD) (low edge|high edge|middle line) at (sunrise|solar noon|sunset|solar midnight)$/);
      expect(bandAnchorUnit(key)).toBe(axis === "temp" ? "°F" : "kPa");
    }
  });
  test("a key that is not a band anchor has no words here", () => {
    for (const key of ["band_track_fraction", "temp_low_sunrise", "dry_cost_limit_kwh_per_kg", "band_temp_low", ""]) {
      expect(bandAnchorWords(key)).toBeNull();
      expect(bandAnchorUnit(key)).toBeNull();
    }
  });
});
