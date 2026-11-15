// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import { formatValue } from "../../lib/format";
import { useShellNow } from "../../lib/shell";
import { AgeLabel, useNow } from "../freshness";

/** Shares the shell poll. Values are probe samples, independent of climate and chart averaging. */
export function ReservoirReadings() {
  const shell = useShellNow();
  const clock = useNow();
  const hydro = shell.error ? null : shell.data?.hydroponics;
  return <section className="reservoir-now" aria-label="Reservoir now">
    <div className="workspace-heading"><div><p className="eyebrow">ROOT ENVIRONMENT</p><h2>Reservoir</h2></div><Link to="/hydroponics">Water quality & planting →</Link></div>
    <dl className="hydro-readings">{([
      ["ph", "pH", "pH"], ["ec_us_cm", "Electrical conductivity", "µS/cm"], ["water_temp_f", "Water temperature", "°F"],
    ] as const).map(([key, label, unit]) => {
      const reading = hydro?.[key];
      const stale = reading?.observed_at ? clock - Date.parse(reading.observed_at) > (hydro?.stale_after_s ?? 600) * 1000 : true;
      return <div key={key} data-stale={stale}><dt>{label}</dt><dd>{formatValue(reading?.value, unit)}<span className="meta">{reading?.observed_at ? <><AgeLabel observedAt={reading.observed_at} stale={stale} />{stale && " · sample overdue"}</> : shell.error ? "Reservoir read unavailable" : reading?.reason ?? "Waiting for reservoir readings"}</span></dd></div>;
    })}</dl>
    <p className="meta">Probe updates about every 5 minutes. Nutrients and pH are adjusted by hand.</p>
  </section>;
}
