// SPDX-License-Identifier: MIT
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { sectionOf, type SectionId } from "../../lib/sections";
import { useShellStatus } from "../../lib/shell";
import { SignOutForm } from "../account-menu";
import { useModalDialog } from "../forms/modal";
import { MarkIcon, SectionIcon } from "../icons";
import { CountPill, useCurrentSection } from "../site-header";
import { SectionGroups } from "./rail";
import { useSearch } from "./search";
import { ThemeSwitch } from "./theme-switch";

/** The four sections the phone bar holds itself, in order; Activity reads Alerts there. */
export const BAR_SECTIONS: readonly SectionId[] = ["now", "climate", "water", "activity"];
const BAR_LABELS: Partial<Record<SectionId, string>> = { activity: "Alerts" };

/**
 * The More sheet (README section 3.2): a modal sheet from the bottom with Search, every section by group (the current
 * one marked), the theme switch and Sign out. Focus moves into it and stays there; Escape, Close, a press on the scrim
 * and choosing a link close it, and focus returns to More.
 */
export function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const current = useCurrentSection();
  const search = useSearch();
  const { onKeyDown, onCancel } = useModalDialog(ref, open, onClose);
  if (!open) return null;
  return <dialog ref={ref} className="more-sheet" aria-labelledby="more-sheet-title" data-testid="more-sheet" onKeyDown={onKeyDown} onCancel={onCancel}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="more-sheet-panel">
      <div className="more-sheet-head">
        <h2 id="more-sheet-title">More</h2>
        <button type="button" className="more-sheet-close" onClick={onClose}><MarkIcon name="close" /><span className="screen-reader">Close</span></button>
      </div>
      <button type="button" className="search-button more-sheet-search" onClick={() => { onClose(); search?.open(); }}>
        <MarkIcon name="search" className="search-button-icon" /><span className="search-button-label">Search</span>
      </button>
      <nav className="more-sheet-nav" aria-label="All sections">
        <SectionGroups current={current} idPrefix="more-group" linkClass="more-link" onNavigate={onClose} />
      </nav>
      <div className="more-sheet-foot">
        <ThemeSwitch className="more-theme" />
        <SignOutForm className="more-signout" />
      </div>
    </div>
  </dialog>;
}

/**
 * The phone's fixed bottom bar (860 px and below, README section 3.2): Now, Climate, Water, Alerts (with the open-alert
 * count) and More, each a fifth of the width and at least 44 px, an icon over a one-word label, above the safe-area
 * inset. The section the page is in is marked: on its own item when it is one of the four, on More otherwise, which
 * then names it for a screen reader.
 */
export function BottomBar() {
  const current = useCurrentSection();
  const { openAlerts, alertSeverity } = useShellStatus();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  // A navigation from anywhere (Search, a link in a card) closes the sheet.
  useEffect(() => { setOpen(false); }, [pathname]);
  const onBar = current !== null && BAR_SECTIONS.includes(current.id);
  const inMore = current !== null && !onBar;
  return <>
    <nav className="bottom-bar" aria-label="Sections, phone">
      {BAR_SECTIONS.map((id) => {
        const section = sectionOf(id);
        return <Link key={id} className="bar-item" to={section.to} data-section={id} aria-current={current?.id === id ? "page" : undefined}>
          <SectionIcon section={id} className="bar-icon" />
          <span className="bar-label">{BAR_LABELS[id] ?? section.label}</span>
          {id === "activity" && <CountPill count={openAlerts} severity={alertSeverity} />}
        </Link>;
      })}
      <button type="button" className="bar-item bar-more" aria-haspopup="dialog" aria-expanded={open} aria-current={inMore ? "true" : undefined}
        data-section="more" onClick={() => setOpen(true)}>
        <MarkIcon name="more" className="bar-icon" />
        <span className="bar-label">More</span>
        {inMore && <span className="screen-reader">, you are in {current?.label}</span>}
      </button>
    </nav>
    <MoreSheet open={open} onClose={() => setOpen(false)} />
  </>;
}
