// SPDX-License-Identifier: MIT
import { chartLinks } from "../charts/uplot-chart";
import { EquipmentView } from "../components/record/equipment-view";
import { answerText, checkAnswer, checkDays, equipmentAnswer } from "../components/record/record-model";
import { RecordPage } from "../components/record/record-page";
import { useRecordWindow } from "../components/record/use-record";
import { panelRead, useRelayCheckRead } from "../lib/queries";
import { viewMeta } from "../lib/sections";

/**
 * Record → Equipment (screens 6.3, parity R-02, R-03): starts and run time per relay, day by day, from API-32's
 * `relays`, and the counter check from API-33 over the last 7 or 30 days.
 */
export const meta = () => viewMeta("record-equipment");
export const links = () => chartLinks();

export default function RecordEquipment() {
  const window = useRecordWindow();
  const check = panelRead(useRelayCheckRead({ days: checkDays(window.days) }));
  const record = window.read.data;
  const relays = equipmentAnswer(record?.means.d7 ?? null, record?.means.d30 ?? null);
  const counters = checkAnswer(check.data);
  return <RecordPage view="record-equipment" window={window} answer={answerText(record, relays && counters ? `${relays} ${counters}` : relays)}>
    <EquipmentView read={window.read} check={check} days={window.days} />
  </RecordPage>;
}
