// SPDX-License-Identifier: MIT
/**
 * Climate → Drying's blocks read from API-30 (screens §2.3): the verdict with the price against the limit, the drying
 * meter since the controller's last restart, and how drying works.
 */
import { formatValue } from "../../lib/format";
import type { LawView } from "../../lib/operator-api";
import type { PanelRead } from "../../lib/queries";
import { useApiDown } from "../../lib/session";
import { words } from "../../lib/words";
import { StatusBadge } from "../badge";
import { Card } from "../card";
import { cls } from "../common";
import { finite } from "../data/viz";
import { Details } from "../details";
import { Kv } from "../kv";
import { EmptyState, Panel } from "../panel";
import { capital, dryingVerdict, kilograms, kilowattHours, runTime, verdictTone } from "./law";
import { lawPanelState } from "./law-blocks";

const UNIT = "kWh/kg";

/** The bar's scale: from 0 to past the larger of the price and the limit, at least 1 kWh/kg, so both marks fit. */
export function priceScale(cost: number | null | undefined, limit: number | null | undefined): number {
  const largest = Math.max(finite(cost) ? cost : 0, finite(limit) ? limit : 0);
  return Math.max(1, Math.ceil(largest * 1.25 * 10) / 10);
}
const pct = (value: number, max: number) => `${Math.round(Math.min(100, Math.max(0, (value / max) * 100)) * 100) / 100}%`;

/** "Price 0.82 kWh/kg against the limit 0.70 kWh/kg": what the bar draws, in words. */
export function priceWords(cost: number | null | undefined, limit: number | null | undefined): string {
  const against = finite(limit) ? `the limit ${formatValue(limit, UNIT)}` : "a limit that is not reported";
  return finite(cost) ? `Price ${formatValue(cost, UNIT)} against ${against}` : `No price: no outdoor reading; ${against}`;
}

/**
 * The price against the limit on one bar (screens §2.3 block 1): the price the controller computes now as a fill from 0,
 * the limit as a labelled mark. With no price the track is hatched and says "no outdoor reading". Over the limit the
 * fill is `--warn`; under it the accent. The same numbers sit beside it in words.
 */
export function PriceBar({ cost, limit }: { cost: number | null | undefined; limit: number | null | undefined }) {
  const apiDown = useApiDown();
  const max = priceScale(cost, limit);
  const over = finite(cost) && finite(limit) && cost > limit;
  return <svg className={cls("price-bar", apiDown && "is-neutral", !finite(cost) && "is-unknown")} width="100%" height="34" aria-hidden="true" focusable="false">
    <rect className="price-track" x="0" y="8" width="100%" height="10" rx="5" />
    {finite(cost) ? <rect className={cls("price-fill", over && "is-over")} x="0" y="8" width={pct(cost, max)} height="10" rx="5" />
      : <text className="price-none" x="50%" y="16" textAnchor="middle">no outdoor reading</text>}
    {finite(limit) && <>
      <line className="price-limit" x1={pct(limit, max)} x2={pct(limit, max)} y1="3" y2="23" />
      <text className="price-limit-label" x={pct(limit, max)} y="33" textAnchor={limit / max > 0.85 ? "end" : "middle"}>Limit {formatValue(limit, UNIT)}</text>
    </>}
  </svg>;
}

/** Block 1, Now: the verdict, then the price against the limit, then today's drying so far. */
export function DryingNowPanel({ read }: { read: PanelRead<LawView> }) {
  const view = read.data;
  const drying = view?.drying;
  const verdict = drying ? dryingVerdict(drying) : null;
  const today = drying?.today;
  return <Panel title="Drying now" thing="the drying decision" state={lawPanelState(read)} observedAt={view?.observed_at} onRetry={read.retry}
    empty={<EmptyState message="The controller has not reported its climate law yet." />} link={{ to: "/climate", label: "The decision" }}>
    {drying && verdict && <>
      <p className="drying-verdict"><StatusBadge status={verdictTone(drying.state)}>{verdict}</StatusBadge></p>
      <p className="drying-price">{priceWords(drying.cost_kwh_per_kg, drying.limit_kwh_per_kg)}.</p>
      <PriceBar cost={drying.cost_kwh_per_kg} limit={drying.limit_kwh_per_kg} />
      {today && <p className="meta">Today so far: {runTime(today.seconds)} of drying in {today.runs ?? "—"} {today.runs === 1 ? "run" : "runs"}, {kilograms(today.water_g)} of water
        removed for {kilowattHours(today.heat_wh)} of heat{today.lower_bound ? " (at least: a restart lost part of the count)" : ""}.</p>}
    </>}
  </Panel>;
}

/** Block 5 (side): the controller's drying meter since its last restart, as it counts it. */
export function MeterPanel({ read }: { read: PanelRead<LawView> }) {
  const meter = read.data?.drying.meter;
  const state = lawPanelState(read, false);
  return <Panel title="Meter since the last restart" thing="the drying meter" state={state === "ready" && meter && meter.observed_at === null ? "empty" : state}
    observedAt={meter?.observed_at} onRetry={read.retry} empty={<EmptyState message="The drying meter has not reported since the controller started." />}
    foot="The controller's own count; it starts again at zero after every restart.">
    {meter && <Kv items={[
      { key: "time", term: "Drying", value: runTime(meter.seconds) },
      { key: "water", term: "Water removed", value: kilograms(meter.water_g) },
      { key: "heat", term: "Heat spent", value: kilowattHours(meter.heat_wh) },
      { key: "price", term: "Price paid", value: finite(meter.heat_wh) && finite(meter.water_g) && meter.water_g > 0 ? formatValue(meter.heat_wh / meter.water_g, UNIT) : null, reason: "no water removed yet" },
      { key: "refused", term: "Wanted but refused", value: runTime(meter.refused_seconds) },
    ]} />}
  </Panel>;
}

/**
 * Block 6 (disclosure): the decision in the law's order and why each refusal exists, with the thresholds for the band in
 * force when API-30 has them.
 */
export function HowDryingWorks({ view }: { view: LawView | null }) {
  const drying = view?.drying;
  const at = (value: number | null | undefined, unit: string, fallback: string) => (finite(value) ? formatValue(value, unit) : fallback);
  return <Card className="drying-how">
    <Details summary="How drying works">
      <p>Drying opens the vent and runs the lead fan to carry moist air out and let drier outdoor air in. The controller decides every second, in this order:</p>
      <ol className="drying-steps">
        <li><strong>{capital(words("drying_check", "humid"))}.</strong> Drying is wanted when VPD falls below {at(drying?.wanted_below_kpa, "kPa", "a line just above the band's low VPD edge")} and
          stops once it is back above {at(drying?.stop_above_kpa, "kPa", "a line a little higher")}.</li>
        <li><strong>{capital(words("drying_check", "outdoor_drier"))}.</strong> Outdoor air must hold less water than the air inside, or venting would bring
          moisture in. Without an outdoor reading the controller cannot tell, so it refuses.</li>
        <li><strong>{capital(words("drying_check", "worth_it"))}.</strong> Venting loses heat that electric heat must make up. The controller divides that heat by the
          water the vent carries out and refuses when the price is above the drying cost limit, which the owner sets.</li>
        <li><strong>{capital(words("drying_check", "warm_enough"))}.</strong> Venting cools the house, so drying waits until it is at least {at(drying?.min_temp_f, "°F", "a little above the band's low edge")}.</li>
        <li><strong>{capital(words("drying_check", "not_cooling"))}.</strong> Cooling already has the vent and the fans, so drying does not run while the house is
          being cooled.</li>
        <li><strong>{capital(words("drying_check", "furnace_off"))}.</strong> The furnace runs when the house is near its low edge; venting then would blow its
          heat outside.</li>
      </ol>
      <p>Without a humidity or a temperature reading the controller cannot judge the air, and drying is refused too. Every refused
        second is counted, by reason, in the daily record.</p>
    </Details>
  </Card>;
}
