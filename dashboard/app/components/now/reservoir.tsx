// SPDX-License-Identifier: MIT
/**
 * Reservoir on Now (dashboard v2 screens §1 block 8; design review B11): pH, conductivity and the water temperature as
 * three tiles, then one observation line for the three (A2): when the probe last sampled, and "overdue" past
 * `stale_after_s`. A tile's value never wraps: its unit sits in the label where it would ("Conductivity, µS/cm"), and
 * conductivity has no decimals. A channel with no value reads "—" with the API's reason. It shares the shell's API-02
 * poll; the values are probe samples, independent of the climate readings. "Hydroponics ›" leads to the reservoir page.
 */
import type { ReactNode } from "react";
import { formatNumber, formatValue } from "../../lib/format";
import type { Now } from "../../lib/operator-api";
import { useShellNow } from "../../lib/shell";
import { cls } from "../common";
import { AgeLabel, useNow } from "../freshness";
import { Panel, type PanelState } from "../panel";

type Hydro = NonNullable<Now["hydroponics"]>;
type Channel = { readonly key: "ph" | "ec_us_cm" | "water_temp_f"; readonly label: string; readonly value: (value: number | null | undefined) => string };
/** The three channels, each with a value that stands alone without wrapping. */
export const RESERVOIR_CHANNELS: readonly Channel[] = [
  { key: "ph", label: "pH", value: (value) => formatNumber(value, 1) },
  { key: "ec_us_cm", label: "Conductivity, µS/cm", value: (value) => formatNumber(value, 0) },
  { key: "water_temp_f", label: "Water temperature", value: (value) => formatValue(value, "°F") },
];
export const RESERVOIR_WAITING = "Waiting for reservoir readings";
export const RESERVOIR_CADENCE = "the probe samples about every 5\u00a0min";
export const RESERVOIR_BY_HAND = "Nutrients and pH are adjusted by hand.";

/** The oldest sample the tiles show, and whether it is past `stale_after_s` at `clock`; null with no sample at all. */
export function reservoirSample(hydro: Hydro | null | undefined, clock: number): { readonly at: string; readonly stale: boolean } | null {
  if (!hydro) return null;
  const times = RESERVOIR_CHANNELS.map(({ key }) => hydro[key])
    .filter((reading) => reading.value !== null && Number.isFinite(reading.value) && reading.observed_at && Number.isFinite(Date.parse(reading.observed_at)))
    .map((reading) => reading.observed_at as string)
    .sort((a, b) => Date.parse(a) - Date.parse(b));
  if (!times.length) return null;
  return { at: times[0], stale: clock - Date.parse(times[0]) > hydro.stale_after_s * 1000 };
}

export function ReservoirReadings() {
  const shell = useShellNow();
  const clock = useNow();
  const hydro = shell.error ? null : shell.data?.hydroponics ?? null;
  const state: PanelState = shell.error ? "error" : !shell.data ? "loading" : "ready";
  const sample = reservoirSample(hydro, clock);
  const reason = hydro ? RESERVOIR_CHANNELS.map(({ key }) => hydro[key].reason).find((text): text is string => Boolean(text)) : null;
  let line: ReactNode = reason ?? RESERVOIR_WAITING;
  if (sample) line = <><AgeLabel observedAt={sample.at} stale={sample.stale} />{sample.stale ? " · sample overdue" : ` · ${RESERVOIR_CADENCE}`}</>;
  return <Panel id="reservoir" title="Reservoir" thing="the reservoir" state={state} reserve="sm" errorText="Reservoir read unavailable."
    link={{ to: "/hydroponics", label: <>Hydroponics<span className="screen-reader">: water quality and planting</span></>, name: "Hydroponics: water quality and planting" }}>
    <dl className="now-reservoir">{RESERVOIR_CHANNELS.map((channel) => {
      const reading = hydro?.[channel.key];
      const stale = !reading?.observed_at || clock - Date.parse(reading.observed_at) > (hydro?.stale_after_s ?? 600) * 1000;
      const missing = reading ? reading.value === null || !Number.isFinite(reading.value) : true;
      return <div key={channel.key} data-reservoir={channel.key} data-stale={stale}>
        <dt>{channel.label}</dt>
        <dd className={cls(stale && "value-muted")}>{channel.value(reading?.value)}</dd>
        {missing && sample && reading?.reason && <dd className="meta">{reading.reason}</dd>}
      </div>;
    })}</dl>
    <p className={cls("meta now-reservoir-line", sample?.stale && "now-reservoir-overdue")} data-reservoir="sample">{line}</p>
    <p className="meta now-reservoir-note">{RESERVOIR_BY_HAND}</p>
  </Panel>;
}
