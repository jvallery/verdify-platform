// SPDX-License-Identifier: MIT
import { lineDisplayName } from "../lib/lines";
import type { IrrigationLine } from "../lib/operator-api";
import { OperatorOnly } from "../lib/session";
import { useCommand } from "../lib/writes";
import { Button } from "./button";

/** API-IRR-13 `{line_id}`, then API-IRR-01 every 5 s until the latch is gone; 30 s with no change reads the line's reason, or "Not started". */
function ClearFault({ lineId }: { lineId: string }) {
  const command = useCommand({ operation: "API-IRR-13" });
  const note = command.phase === "waiting" ? "Waiting for the controller" : command.phase === "late" ? command.message : null;
  return <>
    <Button write busy={command.sending} onClick={() => void command.send({}, { line_id: lineId })}>Clear fault <span className="screen-reader">on {lineDisplayName(lineId)}</span></Button>
    {note && <span className="state-note" data-clear-note={lineId}>{note}</span>}
    {command.error && <span className="field-error" role="alert">{command.error.message}</span>}
  </>;
}

/**
 * Clear fault on a latched mister (SCR-01, SCR-04, US-WAT-22), for operators, one tap with no dialog. The operation names
 * only the mister zones L04, L07 and L09, and only a `mister_fault` has a latch to clear: a `backing_off` line shows its
 * end time and no Clear. With no irrigation engine reported there is no latch to clear, so it shows nothing. Changes
 * switched off disable it (`Button write`).
 */
export function ClearFaultButton({ line, engine }: { line: Pick<IrrigationLine, "line_id" | "kind" | "fault">; engine: boolean }) {
  if (!engine || line.kind !== "mister" || line.fault !== "mister_fault") return null;
  return <OperatorOnly><ClearFault lineId={line.line_id} /></OperatorOnly>;
}
