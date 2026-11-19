// SPDX-License-Identifier: MIT
import { Details } from "../details";

/** What each column of the daily record counts and what it does not (screens 6.1 row 4). */
export const RECORD_NOTES: readonly string[] = [
  "In band is the share of the day's graded minutes the house spent inside the band: both temperature and VPD, or each on its own.",
  "A night is dried when the night's VPD reached the drying line for long enough between midnight and 06:00.",
  "Starts count how many times a relay turned on; run time is how long it was on. A run that crossed midnight is booked to the day it started.",
  "Electricity is the metered figure for the whole day. Under 70 % meter coverage it is left blank and the day reads “partial”.",
  "Gas is estimated from the furnace's run time; it is not metered.",
  "Crop water is misting, fog and irrigation. It does not count the hose.",
  "The price paid for drying is the heat it spent over the water it removed. It is left blank on a day a restart lost meter counts.",
  "Today's row is so far: it fills in through the day and is complete after midnight.",
];

/**
 * Days, row 4: the notes, the explanation that comes last and starts collapsed (design-system section 3, Order). It
 * reads nothing, so it has no loading, stale or error state.
 */
export function RecordNotes() {
  return <Details className="card rc-notes-card" summary="What the record counts">
    <ul className="rc-notes">{RECORD_NOTES.map((note) => <li key={note}>{note}</li>)}</ul>
  </Details>;
}
