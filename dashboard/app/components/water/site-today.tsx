// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import type { IrrigationStatus } from "../../lib/operator-api";
import { OperatorOnly } from "../../lib/session";
import { BACKUP_TERM, BUDGET_HELP, BUDGET_PARAM, BUDGET_TERM, SAF4_HELP, SAF4_PARAM, SAF4_PRIMARY, SAF4_TERM, flowWords, occupancyWords, settingUrl } from "../../lib/water";
import { cls } from "../common";
import { Meter, meterWords } from "../data/meter";
import { useNow } from "../freshness";
import { InfoTip } from "../info-tip";

/** Where each limit's Change leads: the setting's drawer in Settings, which saves it through API-10 (#1182). */
export const SAF4_LINK = settingUrl(SAF4_PARAM);
export const BUDGET_LINK = settingUrl(BUDGET_PARAM);

/** "Change" beside a limit, for an operator: a link to the setting's drawer, named for a screen reader. */
function Change({ to, name }: { to: string; name: string }) {
  return <OperatorOnly><Link className="wat-site-change" to={to} data-write-control="true">Change<span className="screen-reader"> the {name.toLowerCase()} in Settings</span></Link></OperatorOnly>;
}

/**
 * Site today (screens section 3.1, #1349), Water → Today's aside: the daily mist and fog limit, the hard limit nothing
 * is exempt from, and the soft daily budget the owner sets, each as a meter in whole gallons with its value, Change (for
 * an operator; it opens the setting's drawer) and an info tip; then water with no Verdify valve open, occupancy and backup
 * misting, each in words with its `[data-limit]`. A count the API does not have reads "—", never 0; a flow or backup
 * misting that is the news carries its colour on its words. On a phone it holds the limit, the flow and occupancy, so the
 * first line card stays near the fold: the soft budget and backup misting (`.wat-site-quiet`) show there only once they
 * are the news. The panel frame, its states and its age are the board's.
 */
export function SiteToday({ status, today }: { status: Pick<IrrigationStatus, "limits" | "leak" | "occupancy" | "fallback_active">; today: string }) {
  const now = useNow();
  const flow = flowWords(status.leak);
  const { saf4_gal: saf4, soft_budget_gal: budget } = status.limits;
  const budgetReached = meterWords(budget.used, budget.max, "gal").over !== null;
  return <ul className="wat-site-list">
    <li className="wat-site-meter" data-limit="saf4">
      <span className="wat-site-term">{SAF4_TERM}<InfoTip term={SAF4_TERM}><p>{SAF4_HELP}</p></InfoTip><span className="wat-site-primary meta">{SAF4_PRIMARY}</span><Change to={SAF4_LINK} name={SAF4_TERM} /></span>
      <Meter label={`${SAF4_TERM}, gallons today`} unit="gal" value={saf4.used} cap={saf4.max} domain="water" showWords />
      <p className="meta wat-site-note">Nothing is exempt from this limit.</p>
    </li>
    <li className={cls("wat-site-meter", !budgetReached && "wat-site-quiet")} data-limit="budget">
      <span className="wat-site-term">{BUDGET_TERM}<InfoTip term={BUDGET_TERM}><p>{BUDGET_HELP}</p></InfoTip><Change to={BUDGET_LINK} name={BUDGET_TERM} /></span>
      <Meter label={`${BUDGET_TERM}, gallons today`} unit="gal" value={budget.used} cap={budget.max} domain="water" showWords />
      <p className="meta wat-site-note">The owner sets this budget.</p>
    </li>
    <li data-limit="flow" className={cls(flow.tone && `limit-${flow.tone}`)}>{flow.text}</li>
    <li data-limit="occupancy">{occupancyWords(status.occupancy, now, today)}</li>
    <li data-limit="fallback" className={cls(status.fallback_active ? "limit-warn" : "wat-site-quiet")}>{status.fallback_active ? `${BACKUP_TERM}: on, VPD sensing is degraded` : `${BACKUP_TERM}: off`}</li>
  </ul>;
}
