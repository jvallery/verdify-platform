// SPDX-License-Identifier: MIT
import { OperatorOnly } from "../../lib/session";
import { Details } from "../details";
import { RestartController } from "../run-by-hand";

export const RESTART_LABEL = "Restart the controller";
/** What a restart interrupts, said before the button. */
export const RESTART_INTERRUPTS = [
  "The controller stops and starts again, which takes about a minute.",
  "Until it is back, the equipment it drives waits: heat, fans, the vent, fog and the water lines.",
  "A run by hand ends, and so does a watering run in progress.",
  "The host reconnects on its own once the controller is back.",
] as const;

/**
 * Restart (screens section 10.2, row 7): for operators only, behind a disclosure that says first what a restart
 * interrupts. The button is the now lane's `RestartController`: API-IRR-12 `{kind: "restart"}`, "Restart sent" until
 * API-02 `controller.uptime_s` drops within 3 min, then "The controller restarted"; with changes switched off it is
 * disabled (`Button write`).
 */
export function RestartSection() {
  return <OperatorOnly>
    <section className="card sys-restart" aria-label={RESTART_LABEL}>
      <Details summary={RESTART_LABEL} className="sys-restart-details">
        <ul className="sys-restart-list">{RESTART_INTERRUPTS.map((line) => <li key={line}>{line}</li>)}</ul>
        <RestartController />
      </Details>
    </section>
  </OperatorOnly>;
}
