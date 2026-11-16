import { describe, expect, it } from "vitest";
import { lawDryingText } from "./hero";

const law = {
  observed_at: "2026-11-16T05:00:00Z", latches: ["dry"], requests: [], drying: "refused" as const,
  drying_refused_reason: "not_drier", drying_cost_kwh_per_kg: null, drying_cost_limit_kwh_per_kg: 0.7, band_repaired: false,
};

describe("the climate law's drying state (#1633 package 4.1)", () => {
  it("names a refusal with the controller's reason and the limit", () => {
    expect(lawDryingText(law)).toBe("Drying wanted, refused: not drier · cost no price of limit 0.70 kWh/kg");
  });
  it("shows a running run with its cost and a repaired band", () => {
    expect(lawDryingText({ ...law, drying: "running", drying_refused_reason: null, drying_cost_kwh_per_kg: 0.412, band_repaired: true }))
      .toBe("Drying run on · cost 0.41 of limit 0.70 kWh/kg · band repaired by the controller");
  });
  it("says when no drying is wanted", () => {
    expect(lawDryingText({ ...law, drying: "not_wanted", drying_refused_reason: null })).toMatch(/^No drying wanted/);
    expect(lawDryingText({ ...law, drying: "not_wanted", drying_refused_reason: "humidity_invalid" })).toMatch(/^No drying: humidity invalid/);
  });
});
