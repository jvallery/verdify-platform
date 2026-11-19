// SPDX-License-Identifier: MIT
import { useId, type ReactNode } from "react";
import { Link } from "react-router";
import { useApiDown } from "../lib/session";
import { cls } from "./common";
import { HeadEnd, type HeadLink } from "./panel";

type CardBase = {
  title?: ReactNode; eyebrow?: ReactNode; headingLevel?: 2 | 3; className?: string; id?: string; children?: ReactNode;
  /** The one state pill of the head (redesign §4.4), after the title. */
  pill?: ReactNode;
  /** The title row's as-of time (design system v2 §3): "as of 06:42", at the head's right before its actions. */
  asOf?: ReactNode;
  /** Abnormal: a 3 px `--warn` or `--critical` rule at the left edge; the surface stays calm. Dropped while the API is down. */
  tone?: "warn" | "fault";
  /** The foot: a `.meta` line or a "Details ›" link. */
  foot?: ReactNode;
};
/** A card with its own controls in the head: actions, an "All … ›" link and a ⋯ menu. */
type StaticCard = CardBase & { actions?: ReactNode; link?: HeadLink; menu?: ReactNode; to?: undefined };
/** An interactive card: the whole card is one link, so it holds no other control. */
type LinkCard = CardBase & { to: string; actions?: undefined; link?: undefined; menu?: undefined };

/**
 * The card of design system v2 §3: `--surface`, a 1 px `--border`, `--radius-lg`, `--shadow-1` and `--space-4` padding
 * (`--space-5` above 860 px). A title row (an optional eyebrow, the title with one pill, an as-of time, the head's
 * actions, an "All … ›" link and a menu), the body and a meta foot. Cards never nest: a group inside one is a
 * `.card-section`. A data card that loads is a `Panel`, which has the same head.
 */
export function Card(props: StaticCard | LinkCard) {
  const { title, eyebrow, headingLevel = 2, className, id, children, pill, asOf, tone, foot } = props;
  const headingId = useId();
  const apiDown = useApiDown();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const label = (eyebrow || title) && <div className="card-title">
    {eyebrow && <span className="eyebrow">{eyebrow}</span>}
    {title && <div className="card-title-row"><Heading id={headingId}>{title}</Heading>{pill}</div>}
  </div>;
  const classes = cls("card", tone && !apiDown && `tone-${tone}`, className);
  if (props.to !== undefined) {
    return <Link to={props.to} id={id} className={cls(classes, "card-link")}>{label && <div className="card-head">{label}</div>}{children}{foot && <div className="card-foot meta">{foot}</div>}</Link>;
  }
  const end = <HeadEnd asOf={asOf} actions={props.actions} link={props.link} menu={props.menu} />;
  const head = (label || asOf || props.actions || props.link || props.menu) && <div className="card-head">{label}{end}</div>;
  return <div id={id} className={classes}>{head}{children}{foot && <div className="card-foot meta">{foot}</div>}</div>;
}
