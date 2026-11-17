// SPDX-License-Identifier: MIT
/**
 * What the controller is doing (dashboard v2 screens §1 block 2): one or two sentences from the climate law's requests
 * and its drying decision (`lib/law-sentence.ts`), each relay that is on as a chip with how long it has been on, and
 * "Why ›" into the Climate law page. It reads the law, never a mode label.
 *
 * States: loading until API-02 first answers; failed while the data is out of reach or the ingestor or controller is
 * not reporting (what runs is then unknown, never "nothing"); stale while the answer waits for fresh data, the sentence
 * muted with its time; empty is the law's own "Holding the band. Nothing is running."
 */
import { duration } from "../../lib/format";
import { lawSentence } from "../../lib/law-sentence";
import type { NowAnswer } from "../../lib/now-answer";
import type { Now } from "../../lib/operator-api";
import { words } from "../../lib/words";
import { cls } from "../common";
import { useNow } from "../freshness";
import { Panel, type PanelState } from "../panel";
import { RUN_NAMES } from "../run-by-hand";
import { deviceUnknown } from "./status";

export const DOING_ID = "doing";
export const DOING_UNKNOWN = "Not known: there is no current controller report.";
const finite = (value: number | null | undefined): value is number => typeof value === "number" && Number.isFinite(value);

/** Each relay or line that is on, in words with how long: "Heat 1 (electric) · 12 min". */
export function runningChips(running: Now["running"], clock: number): { key: string; text: string }[] {
  return running.map((item) => {
    const since = item.since ? Date.parse(item.since) : Number.NaN;
    const on = Number.isFinite(since) ? ` · ${duration(Math.max(0, Math.floor((clock - since) / 1000)))}` : "";
    return { key: `${item.equipment}-${item.line_id ?? ""}`, text: `${words("equipment", item.equipment)}${on}` };
  });
}

export type DoingProps = { readonly now: Now | null; readonly answer: NowAnswer };

export function ControllerDoing({ now, answer }: DoingProps) {
  const clock = useNow();
  const unknown = deviceUnknown(answer);
  const state: PanelState = answer.kind === "loading" ? "loading" : "ready";
  const temp = now && finite(now.indoor.temp_f.value) && !answer.muted ? now.indoor.temp_f.value : null;
  const vpd = now && finite(now.indoor.vpd_kpa.value) && !answer.muted ? now.indoor.vpd_kpa.value : null;
  const byHand = now && !unknown ? now.overrides.filter((run) => !run.held_reason) : [];
  const said = now && !unknown ? lawSentence({ law: now.law, running: now.running, temp, vpd, byHand: byHand.map((run) => run.kind) }) : null;
  const chips = now && !unknown ? runningChips(now.running, clock) : [];
  return <Panel id={DOING_ID} title="What the controller is doing" thing="what the controller is doing" state={state} reserve="sm"
    link={{ to: "/climate", label: <>Why<span className="screen-reader">: the climate law</span></> }}>
    {unknown || !said
      ? <p className="state-note" data-doing="unknown">{DOING_UNKNOWN}</p>
      : <>
        <p className={cls("now-doing-text", answer.muted && "value-muted")} data-doing={said.kind}>{said.sentences.join(" ")}</p>
        {answer.muted && <p className="meta" data-doing="stale">As of the last data the page has; waiting for fresh data.</p>}
        {byHand.length > 0 && <p className="meta" data-doing="by-hand">By hand: {byHand.map((run) => RUN_NAMES[run.kind] ?? run.kind).join(", ")}</p>}
        {chips.length > 0 && <ul className="chips now-relays" aria-label="On now">
          {chips.map((chip) => <li key={chip.key}><span className="chip chip-static" data-chip="relay">{chip.text}</span></li>)}
        </ul>}
      </>}
  </Panel>;
}
