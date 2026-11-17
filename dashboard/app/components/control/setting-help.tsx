// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { Setting } from "../../lib/operator-api";
import { anchorWords, ownerPage, settingEffect, settingLabel, type SettingEffect } from "../../lib/settings-context";

/**
 * What each setting does and what Settings' words mean (dashboard v2 screens §10.4, issue C28). A setting's text is
 * API-09's `help` (verdify_schemas.setting_help, which MCP and the lab reference page also serve), except where that
 * text describes the settings model the climate law replaced: the band's points, the band in force, the old fixed
 * limits, the lights' daily minutes and automatic switch, the drying cost limit and a few more are rewritten here to say
 * what the setting does to the controller or the host now, and a setting nothing reads says so instead of its old text.
 */

// ---------------------------------------------------------------------------------------------------- the text
/** The parts of a setting's explanation, as `Setting.help` carries them. */
export type HelpText = {
  readonly summary: string; readonly effect: string; readonly raise?: string | null; readonly lower?: string | null;
  readonly caution?: string | null; readonly guardrail?: boolean; readonly reference_url?: string | null;
};
type HelpShape = Pick<Setting, "param" | "label" | "group" | "control_class" | "help"> & { readonly effect?: string | null };

const BAND_PAGE = "The band is the owner's: change it on the Band page.";
const BAND_SHAPE = (at: string) => `The controller draws the band through the day from four points (sunrise, solar noon, sunset and solar midnight), so this point also shapes the hours either side of ${at}.`;

/** The band's points: what each edge makes the law do around its point of the day. */
function bandEdgeHelp(axis: string, side: string, at: string): HelpText | null {
  const shape = BAND_SHAPE(at);
  if (axis === "temp" && side === "low") {
    return {
      summary: `The low edge of the temperature band at ${at}.`,
      effect: `${shape} As the house cools toward the low edge, the law turns on electric heat a few degrees above it and the gas furnace just above it.`,
      raise: `Heating starts at a warmer temperature around ${at}: a warmer house, more heating.`,
      lower: `The house may run cooler around ${at} before heating starts: less heating.`, caution: BAND_PAGE,
    };
  }
  if (axis === "temp" && side === "high") {
    return {
      summary: `The high edge of the temperature band at ${at}.`,
      effect: `${shape} Above the high edge the law cools: it opens the vent with one fan, and adds the second fan a little further above.`,
      raise: `Cooling starts later around ${at}: a warmer house, less venting and fan time.`,
      lower: `Cooling starts sooner around ${at}: a cooler house, more venting and fan time.`, caution: BAND_PAGE,
    };
  }
  if (axis === "vpd" && side === "low") {
    return {
      summary: `The low edge of the VPD band at ${at}: below it the air is too humid.`,
      effect: `${shape} Near the low edge the law wants drying: it vents when the outdoor air is drier and the price of drying is under the drying cost limit.`,
      raise: `Drying is wanted sooner around ${at}: drier air, more venting and heat.`,
      lower: `The air may stay more humid around ${at} before drying is wanted: less venting and heat.`, caution: BAND_PAGE,
    };
  }
  if (axis === "vpd" && side === "high") {
    return {
      summary: `The high edge of the VPD band at ${at}: above it the air is too dry.`,
      effect: `${shape} Above the high edge the law runs the fogger, and further above it the misters.`,
      raise: `Fog and misters start later around ${at}: drier air, less water.`,
      lower: `Fog and misters start sooner around ${at}: more humid air, more water.`, caution: BAND_PAGE,
    };
  }
  return null;
}

/** The band in force: worked out by the host, never set. */
function bandInForceHelp(place: string, axis: string, side: string): HelpText {
  const what = side === "target" ? "middle" : `${side} edge`;
  const measure = axis === "temp" ? "temperature" : "VPD";
  const whose = place === "house" ? "the house" : `the ${place} probes, which share the house band`;
  return {
    summary: `The ${measure} band's ${what} for ${whose} at this minute.`,
    effect: "Worked out by the host from the band's four points at this moment of the solar day; nothing sets it. The record and the alerts use it, and the controller works out the same band on its own.",
    caution: BAND_PAGE,
  };
}

/** A light's settings whose served text names the retired words. */
function lightHelp(light: string, part: string): HelpText | null {
  const name = light === "main" ? "main light" : "grow light";
  if (part === "target_light_minutes") {
    return {
      summary: `Minutes of light a day the ${name} aims for, counting bright daylight and lamp time.`,
      effect: `Inside the light window each minute counts once if daylight is above the daylight threshold or the ${name} is on. While the day's count is short and it is dim, the controller turns the ${name} on; once the count is reached it stays off. The count starts again each day.`,
      raise: `Longer days: the ${name} runs more on dim days and uses more electricity.`,
      lower: `Shorter days: the ${name} adds less light on dim days.`,
      caution: `The light window still caps it: the ${name} never runs outside the window.`,
    };
  }
  if (part === "auto_mode") {
    return {
      summary: `Lets the controller switch the ${name} on its own.`,
      effect: `On: the controller switches the ${name} from the light window, daylight and the minutes of light a day. Off: the controller turns the ${name} off at once and keeps it off.`,
      raise: `Hands the ${name} back to the controller (Back to automatic on Lights).`,
      lower: `Switches the ${name} off and keeps it off until this is turned back on.`,
    };
  }
  if (part === "min_on_s") {
    return {
      summary: `The shortest time the ${name} stays on once switched on.`,
      effect: `After turning the ${name} on, the controller keeps it on at least this long, even if daylight returns or the window ends. Turning automatic switching off still turns it off at once.`,
      raise: "Fewer short on and off cycles; the light may stay on a little past the point it is needed.",
      lower: "The light can turn off sooner after coming on; more cycling.",
    };
  }
  return null;
}

/** Rows whose served text describes the retired model, by key. */
const REWRITTEN: Readonly<Record<string, HelpText>> = {
  dry_cost_limit_kwh_per_kg: {
    summary: "The most the owner will pay to dry the air, in kWh of heat per kilogram of water carried out.",
    effect: "The law runs drying only while its price, the heat a drying vent loses for each kilogram of water it carries out, is at or under this limit. Drier and warmer outdoor air makes drying cheaper.",
    raise: "Drying runs more often, also when it costs more heat: drier air, more electricity.",
    lower: "Drying runs only when it is cheap; at 0, only when it is free: less electricity, more humid air.",
    caution: "The limit is the owner's: change it on the Drying page, beside the price the controller is paying.",
  },
  sw_onchip_band_enabled: {
    summary: "Whether the controller works out the band itself from the band's four points.",
    effect: "On, as normal: the controller draws the band from its four points and the sun, so it keeps holding the house without the host. Off: it falls back to the old fixed limits.",
    caution: "Read-only here. An alert fires when it is off.",
  },
  manual_override_timeout_min: {
    summary: "How long a press of a button on the controller's panel runs the fans, the fogger or the vent, in minutes.",
    effect: "A press of a button on the controller's panel runs that equipment by hand for this many minutes, then hands it back to the law. A second press ends it early.",
    raise: "Each press runs the equipment longer before the law takes it back.",
    lower: "Each press ends sooner and the law takes the equipment back sooner.",
  },
  outdoor_staleness_max_s: {
    summary: "The oldest outdoor reading, in seconds, the controller still uses to switch the lights by daylight.",
    effect: "An outdoor reading older than this is ignored when the controller decides whether daylight is bright enough. The climate law has its own fixed limit for outdoor air.",
    raise: "Older readings still count: the lights keep following daylight through short gaps in the weather data.",
    lower: "Readings expire sooner: the lights stop following daylight as soon as the weather data lags.",
  },
};

/** The old fixed limits, kept for the controller's old fallback. */
function legacyLimitHelp(axis: string, side: string): HelpText {
  const measure = axis === "temp" ? "temperature" : "VPD";
  return {
    summary: `An old fixed ${side} ${measure} limit the climate law does not use.`,
    effect: "The law takes its edges from the band, and its protection limits are fixed at 40 °F and 100 °F. The controller keeps this value only for its old fallback, used when it does not work out the band itself.",
  };
}

/** What a setting nothing reads says instead of its old text. */
export const NO_EFFECT_TEXT = "Nothing on this controller reads this setting: changing it changes nothing.";
const NO_EFFECT_HELP: HelpText = {
  summary: "Stored on the controller; nothing on this controller reads it.",
  effect: "The controller keeps this value and reports it back, but no rule of the climate law and no task on the host reads it, so changing it changes nothing.",
};

/**
 * The explanation a setting shows: the served `help`, or the rewrite above where the served text describes the retired
 * model, or the no-effect text for a setting nothing reads. Null when the API serves none and none is written here.
 */
export function settingHelp(row: HelpShape): HelpText | null {
  const served = row.help ?? null;
  const reference = served?.reference_url ?? null;
  const own = ownHelp(row);
  if (own) return { ...own, guardrail: served?.guardrail ?? false, reference_url: reference };
  return served;
}
function ownHelp(row: HelpShape): HelpText | null {
  if (settingEffect(row) === "none") return NO_EFFECT_HELP;
  const { param } = row;
  if (Object.hasOwn(REWRITTEN, param)) return REWRITTEN[param];
  let match = /^band_(temp|vpd)_(low|high)_(sr|sm|ss|mid)$/.exec(param);
  if (match) return bandEdgeHelp(match[1], match[2], anchorWords(match[3]) ?? match[3]);
  match = /^band_(house|center|south|west|east)_(temp|vpd)_(low|high|target)$/.exec(param);
  if (match) return bandInForceHelp(match[1], match[2], match[3]);
  match = /^(?:sw_)?gl_(main|grow)_(target_light_minutes|auto_mode|min_on_s)$/.exec(param);
  if (match) return lightHelp(match[1], match[2]);
  match = /^(temp|vpd)_(low|high)$/.exec(param);
  if (match) return legacyLimitHelp(match[1], match[2]);
  return null;
}

/** "Raising it" or, for a switch, "Turning it on". */
export const raiseWord = (kind: string): string => (kind === "switch" ? "Turning it on" : "Raising it");
export const lowerWord = (kind: string): string => (kind === "switch" ? "Turning it off" : "Lowering it");

/** The one-line summary a row shows under its name; nothing when there is no text. */
export function SettingSummary({ setting }: { setting: HelpShape }) {
  const summary = settingHelp(setting)?.summary;
  return summary ? <span className="setting-summary">{summary}</span> : null;
}

// ---------------------------------------------------------------------------------------------------- read-only
/** A short name and one line, as a row and the drawer show them. */
export type StateWords = { readonly label: string; readonly definition: string };
/** Why a row cannot be written (`read_only_kind`), in the page's words. */
export const READ_ONLY_WORDS: Readonly<Record<string, StateWords>> = {
  band_in_force: { label: "Worked out by the host", definition: "From the band's four points at this minute; change the band on the Band page." },
  retired: { label: "Retired", definition: "Nothing on this controller uses it. Kept for its history." },
  readback_context: { label: "Reported by the controller", definition: "The controller measures or reports it; nothing sets it." },
  legacy_wide_limit: { label: "Old fixed limit", definition: "The law takes its edges from the band; its protection limits are fixed at 40 °F and 100 °F." },
  zone_vpd_target: { label: "Worked out for one group of probes", definition: "Worked out by the controller each cycle; nothing sets it here." },
  activity_mirror: { label: "Copies the light schedule", definition: "Copied from the main light's schedule; change the schedule instead." },
  band_owner: { label: "Decides who works out the band", definition: "Changed only through a reviewed rollout." },
  no_anchor_row: { label: "Nothing to write to", definition: "No stored row holds this value, so a change would reach nothing." },
  no_entity: { label: "Nothing to write to", definition: "The controller has no entry that takes this value." },
  unknown: { label: "Not a setting", definition: "Not a registered setting." },
};
/**
 * Why a row is not changed in the drawer: the page that owns it (Band, Drying), else its read-only kind, else the
 * API's reason as served. Null for a row the drawer changes.
 */
export function readOnlyWords(setting: ReadOnlyShape): StateWords | null {
  const owner = ownerPage(setting);
  const unused = settingEffect(setting) === "none";
  if (owner && !unused && setting.group !== "band_in_force") {
    return { label: `Set on ${owner.page}`, definition: owner.page === "Band" ? BAND_PAGE : "The limit is the owner's: change it on the Drying page." };
  }
  if (setting.writable) return owner ? NOT_USED : null;
  const kind = setting.read_only_kind ? READ_ONLY_WORDS[setting.read_only_kind] : undefined;
  if (kind) return kind;
  if (setting.read_only_reason) return { label: setting.read_only_reason, definition: setting.read_only_reason };
  return unused ? NOT_USED : null;
}
type ReadOnlyShape = Pick<Setting, "param" | "group" | "control_class" | "writable" | "read_only_kind" | "read_only_reason"> & { readonly effect?: string | null };
const NOT_USED: StateWords = { label: "Not used", definition: NO_EFFECT_TEXT };

// ---------------------------------------------------------------------------------------------------- effect and state words
/** The three filters by what reads a setting, as Settings names them. */
export const EFFECT_WORDS: Readonly<Record<SettingEffect, StateWords>> = {
  controller: { label: "Read by the controller", definition: "The controller's control loop reads it: the climate law, the lights, the misters or the water program." },
  host: { label: "Used by the host", definition: "A task on the host reads it: the band in force, which the record and the alerts use." },
  none: { label: "Stored and not used", definition: "The controller stores it and reports it back, but nothing reads it: changing one changes nothing on this controller." },
};
/** A row's state words (words.md: confirmed, not confirmed), defined once for the legend. */
export const STATE_WORDS: Readonly<Record<string, StateWords>> = {
  confirmed: { label: "Confirmed", definition: "The controller's readback equals the value in force." },
  not_confirmed: { label: "Not confirmed since", definition: "A value was sent and the controller's readback does not show it yet. The time is when it was sent." },
  not_reported: { label: "Not reported", definition: "The controller reports nothing for this setting." },
  reported: { label: "Reported", definition: "The value the controller reports, after an operator's value was released." },
  derived: { label: "Worked out by the host", definition: "The host works it out; the controller has nothing to read back." },
};

// ---------------------------------------------------------------------------------------------------- the drawer's panel
/**
 * The drawer's explanation, above the field: what it is, what it does, raising and lowering it, the caution and the lab
 * reference entry; for a row the drawer does not change, why; for a derived row, the settings it is worked out from,
 * each opening its own drawer (`editTo`).
 */
export function SettingHelpPanel({ setting, editTo, labelOf }: {
  setting: HelpShape & Pick<Setting, "kind" | "writable" | "read_only_kind" | "read_only_reason" | "source_params">;
  editTo?: (param: string) => string;
  labelOf?: (param: string) => string;
}) {
  const help = settingHelp(setting);
  const readOnly = readOnlyWords(setting);
  const sources = setting.source_params ?? [];
  if (!help && !readOnly) return null;
  const rows: [string, ReactNode][] = [];
  if (help) {
    rows.push(["What it does", help.effect]);
    if (help.raise) rows.push([raiseWord(setting.kind), help.raise]);
    if (help.lower) rows.push([lowerWord(setting.kind), help.lower]);
  }
  return <section className="ctl-help" aria-label="About this setting">
    {help && <p className="ctl-help-summary">{help.summary}</p>}
    {readOnly && <p className="ctl-help-readonly" data-read-only-kind={setting.read_only_kind ?? undefined}>
      <strong>{readOnly.label}.</strong>{readOnly.definition !== readOnly.label && <> {readOnly.definition}</>}
    </p>}
    {rows.length > 0 && <dl className="ctl-help-list">
      {rows.map(([term, text]) => <div key={term}><dt>{term}</dt><dd>{text}</dd></div>)}
    </dl>}
    {help?.caution && help.caution !== readOnly?.definition && <p className={help.guardrail ? "notice notice-warn ctl-help-caution" : "ctl-help-caution"}>
      {help.guardrail && <strong>Guardrail. </strong>}{help.caution}
    </p>}
    {sources.length > 0 && <p className="ctl-help-sources">
      <span>Worked out from: </span>
      {sources.map((param, index) => <span key={param}>{index > 0 && ", "}{editTo
        ? <Link to={editTo(param)} preventScrollReset>{labelOf?.(param) ?? param}</Link>
        : <span>{labelOf?.(param) ?? param}</span>}</span>)}
    </p>}
    {help?.reference_url && <p className="ctl-help-ref"><a href={help.reference_url} target="_blank" rel="noreferrer">Full reference entry<span aria-hidden="true"> ›</span></a></p>}
  </section>;
}

// ---------------------------------------------------------------------------------------------------- the legend
/** What the filters and the states mean, folded under the catalogue. */
export function SettingsLegend() {
  return <details className="ctl-legend">
    <summary>What these words mean</summary>
    <dl>
      {(Object.keys(EFFECT_WORDS) as SettingEffect[]).map((key) => <div key={`e-${key}`}><dt>{EFFECT_WORDS[key].label}</dt><dd>{EFFECT_WORDS[key].definition}</dd></div>)}
      {Object.entries(STATE_WORDS).map(([key, entry]) => <div key={`s-${key}`}><dt>{entry.label}</dt><dd>{entry.definition}</dd></div>)}
    </dl>
  </details>;
}

/** The label a param reads by, for a link that names another setting. */
export const labelFor = (rows: readonly Pick<Setting, "param" | "label">[] | null | undefined) =>
  (param: string): string => {
    const row = rows?.find((item) => item.param === param);
    return row ? settingLabel(row) : param;
  };
