// SPDX-License-Identifier: MIT
/**
 * The Band page's named fixtures (dashboard v2, screens 2.2). Each is a patch over the base `in-band` world, written the
 * way control.mjs's are. index.mjs registers this map once, through `registerFixtures`, as `"band.mjs": BAND`.
 *
 * The live house band (operations.mjs `LIVE_HOUSE_BAND`) has sunrise and sunset set apart from the halfway point on both
 * axes, so with no fixture the editor opens both axes as their eight anchors. This one stores the same noon and midnight
 * edges with sunrise and sunset halfway between, on the push step, so API-23 answers `edges_simple` true on both axes
 * and the editor opens as its eight edge fields.
 *
 * @type {Readonly<Record<string, (world: any) => void>>}
 */
export const FIXTURES = {
  "band-edges-simple": (world) => {
    // Per series: sunrise, solar noon, sunset, solar midnight (sunrise and sunset the midpoint, half to even on the step).
    const series = {
      temp_low: [66.2, 71.8, 66.2, 60.7], temp_target: [72.2, 78.8, 72.2, 65.7], temp_high: [78.2, 85.8, 78.2, 70.7],
      vpd_low: [0.8, 0.86, 0.8, 0.74], vpd_target: [0.94, 1.04, 0.94, 0.83], vpd_high: [1.33, 1.39, 1.33, 1.27],
    };
    for (const [name, values] of Object.entries(series)) {
      ["sr", "sm", "ss", "mid"].forEach((anchor, index) => { world.bandStored[`band_${name}_${anchor}`] = values[index]; });
    }
  },
};
