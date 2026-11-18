// SPDX-License-Identifier: MIT
/**
 * A band anchor's setting key in words. The settings catalog labels these keys from the registry ("Band Temp Low SR"),
 * which is a key in capitals, not words: wherever a band anchor is named to a person (a band save's list in Activity,
 * the reviewer's proposal in Review, a finding), it reads "temperature low edge at sunrise".
 *
 * The keys are `band_<temp|vpd>_<low|high|target>_<sr|sm|ss|mid>`: the sixteen edges the controller holds and the
 * eight middle lines the older form stored, which the law does not read ("target" is a retired word: words.md §3).
 */
const AXIS = { temp: "temperature", vpd: "VPD" } as const;
const SIDE = { low: "low edge", high: "high edge", target: "middle line" } as const;
const AT = { sr: "sunrise", sm: "solar noon", ss: "sunset", mid: "solar midnight" } as const;
const KEY = /^band_(temp|vpd)_(low|high|target)_(sr|sm|ss|mid)$/;

/** "temperature low edge at sunrise" for `band_temp_low_sr`; null for a key that is not a band anchor. */
export function bandAnchorWords(param: string): string | null {
  const match = KEY.exec(param);
  if (!match) return null;
  const axis = match[1] as keyof typeof AXIS;
  const side = match[2] as keyof typeof SIDE;
  const at = match[3] as keyof typeof AT;
  return `${AXIS[axis]} ${SIDE[side]} at ${AT[at]}`;
}

/** The unit a band anchor's value is in: °F for temperature, kPa for VPD; null for a key that is not a band anchor. */
export function bandAnchorUnit(param: string): "°F" | "kPa" | null {
  const match = KEY.exec(param);
  return match ? (match[1] === "temp" ? "°F" : "kPa") : null;
}
