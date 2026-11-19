// SPDX-License-Identifier: MIT
/** Review's own copy (dashboard v2 screens section 8): the words only this page renders. */

/** Row 6's disclosure, in the words of screens.md. */
export const REVIEWER_LIMITS_TITLE = "What the reviewer can and cannot do";
export const REVIEWER_LIMITS = [
  "It reads the daily record and writes one review.",
  "It writes no climate value.",
  "It may switch occupancy and a light's out-of-service switch, and it keeps its irrigation tools.",
] as const;
/** How a review is asked for outside the daily schedule (parity, "On demand"). */
export const ON_DEMAND = "A review outside the daily one can be asked for only through the reviewer's admin tool; its result shows here.";

/** A proposal changes nothing on its own (words.md, Proposal). */
export const PROPOSAL_APPLIES = "Nothing changes until the owner saves a band in the band editor.";
/** Beside Open in the band editor: the band is the owner's. */
export const OWNER_ONLY = "Only the owner saves a band.";
/** A review that put its proposal in its text and stored none. */
export const PROPOSAL_IN_TEXT = "This review put its proposal in the text of its summary, not as a band change the band editor can open. Read it in the summary above.";
export const NO_PROPOSAL = "This review proposed no band change.";

export const NO_REVIEWS = "No review has been written yet.";
export const NO_REVIEWS_DETAIL = "The reviewer reads the daily record after 07:00 each day and writes one review.";
