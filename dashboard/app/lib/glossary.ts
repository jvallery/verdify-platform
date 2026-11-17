// SPDX-License-Identifier: MIT
/**
 * The one glossary (dashboard v2 words.md section 4): every term a page may let a reader look up, each a short
 * definition in the voice of words.md section 1 (plain words, who decides, exact numbers with units). A page's `Term`
 * opens an entry in place (a tap, never hover-only), Settings lists the whole table at `#glossary`, and Search finds
 * every term. A page that names a term defines it from here, never with its own copy.
 */

export type GlossaryEntry = {
  /** The words as a page shows them. */
  readonly term: string;
  readonly definition: string;
};

export const GLOSSARY = {
  vpd: {
    term: "VPD",
    definition: "Vapour pressure deficit: how strongly the air pulls water out of the leaves, in kPa. Low is damp and still; high is dry.",
  },
  band: {
    term: "Band",
    definition: "The range the house is held in: a low and a high edge for temperature and for VPD, changing through the solar day. The owner sets it; the controller holds the house inside it.",
  },
  edge: {
    term: "Edge",
    definition: "One side of the band: the low edge or the high edge, for temperature or for VPD.",
  },
  band_in_force: {
    term: "Band in force",
    definition: "The four edges the controller is using this minute, as it reports them.",
  },
  climate_law: {
    term: "Climate law",
    definition: "The controller's fixed rules that turn heat, fans, vent, fog and misters on and off at the band's edges, every second, with no help from the host.",
  },
  rule: {
    term: "Rule",
    definition: "One line of the climate law: electric heat, gas furnace, cooling, second fan, fog, misters, drying, hot limit or cold limit. Each turns on past one value and off past another.",
  },
  drying: {
    term: "Drying",
    definition: "Venting to carry moist air out when the outdoor air is drier and the price of drying is under the limit. The controller decides it every second.",
  },
  drying_price: {
    term: "Price of drying",
    definition: "The heat it costs to remove a kilogram of water from the house air, in kWh/kg, as the controller works it out from the indoor and outdoor air.",
  },
  drying_cost_limit: {
    term: "Drying cost limit",
    definition: "The most the owner will pay to dry, in kWh/kg. While the price is above it, the controller does not dry. It is the one price in the policy, and only the owner changes it.",
  },
  refused: {
    term: "Refused",
    definition: "Drying was wanted and not run, for one stated reason: it costs more than the limit, outdoor air is not drier, there is no outdoor reading, the house is too cold to vent, the house is being cooled, the gas furnace is running, or humidity or temperature cannot be read.",
  },
  protection_limit: {
    term: "Protection limit",
    definition: "The hot limit (100 °F) and the cold limit (40 °F). Past either, the controller cools or heats with everything it has, whatever else is asked.",
  },
  running_alone: {
    term: "Running alone",
    definition: "What the controller does without the host, its clock or its probes: it keeps the band it holds, falls back to the widest safe band without a clock, and keeps a gap log for the host.",
  },
  widest_safe_band: {
    term: "Widest safe band",
    definition: "The band the controller uses when it has no clock: the lowest low edge and the highest high edge of the whole day.",
  },
  run_by_hand: {
    term: "Run by hand",
    definition: "Three timed runs an operator starts: Run the fans (vent open, 15 min), Humidify (fog, 5 min) and Circulate (fans with the vent closed, 10 min). Each ends on its own, and a protection limit ends any of them.",
  },
  daily_record: {
    term: "Daily record",
    definition: "One row a day of what happened: time in band, starts and run time of each relay, electricity, gas and water, and drying. The reviewer reads it.",
  },
  starts: {
    term: "Starts",
    definition: "How many times a relay turned on in a day.",
  },
  run_time: {
    term: "Run time",
    definition: "How long a relay was on in a day, as the daily record counts it. A run that crosses midnight counts to the day it started.",
  },
  in_band: {
    term: "In band",
    definition: "The share of a day the house was inside the band, for temperature, for VPD and for both. Today's figure counts from local midnight to now.",
  },
  night_dried: {
    term: "Night dried",
    definition: "The night's VPD reached the drying line and stayed there long enough to count.",
  },
  metered_estimated: {
    term: "Metered and estimated",
    definition: "Electricity is metered at the greenhouse. Gas is estimated from how long the furnace ran. Each figure says which it is.",
  },
  counter_check: {
    term: "Counter check",
    definition: "The controller's own relay counters compared with the stored record, day by day, to show that nothing was lost on the way.",
  },
  daily_review: {
    term: "Daily review",
    definition: "What the reviewer writes once a day after reading the daily record: a short summary and, sometimes, a proposed band change.",
  },
  reviewer: {
    term: "Reviewer",
    definition: "The AI that writes the daily review. Its name, Iris, appears as an author. It changes no climate value: only the owner changes the band.",
  },
  proposal: {
    term: "Proposal",
    definition: "A band change the daily review suggests. Nothing changes until the owner saves it in the band editor.",
  },
  hardware_budget: {
    term: "Hardware budget",
    definition: "The controller's limits: free memory, the time one loop takes, storage write time and free stack. Each has a warning line and a critical line.",
  },
  gap_log: {
    term: "Gap log",
    definition: "The controller's own record of what happened while the host was away, replayed into the record when the host returns.",
  },
  delivery: {
    term: "Delivery",
    definition: "A value the host sent to the controller, and whether the controller confirmed it by reading it back.",
  },
  confirmed: {
    term: "Confirmed",
    definition: "The controller's readback equals what was sent. Not confirmed means it does not yet, or the readback has not arrived.",
  },
  mist_fog_limit: {
    term: "Daily mist & fog limit",
    definition: "The primary daily water limit: gallons through every mister and the fog today, against the controller's daily safety limit (360 gal). At the limit all misting stops except emergency fog. Normal misting first meets the lower daily budget (120 gal), which a VPD emergency may pass. Total water, drip irrigation included, is secondary.",
  },
  occupancy_hold: {
    term: "Occupancy hold",
    definition: "While the cameras see someone inside, the misters wait so nobody is sprayed. The main light also comes on for anyone inside, at any hour.",
  },
  main_light: {
    term: "Main light",
    definition: "The overhead light on Lutron. The controller switches it on when daylight is low inside its hours, and for anyone inside at any hour.",
  },
  grow_light: {
    term: "Grow light",
    definition: "The plant light on Lutron. The controller switches it on when daylight is low inside its light window, until the day's light minutes are met.",
  },
  light_window: {
    term: "Light window",
    definition: "The hours in which the controller may turn a light on. Whether it does depends on the daylight at the time, so the window is not a timer.",
  },
  light_timer: {
    term: "Light timer",
    definition: "Turn on or Turn off holds for 15 minutes, then the light goes back to what the controller wants.",
  },
  peer_probes: {
    term: "From peer probes",
    definition: "The zone's own probe is not reporting, so its value is the average of the neighbouring zones' probes.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryId = keyof typeof GLOSSARY;

/** Where the whole table is listed, for a Term's "All terms" link and Search. */
export const GLOSSARY_PATH = "/settings#glossary";

export function glossaryEntry(id: GlossaryId): GlossaryEntry {
  return GLOSSARY[id];
}
