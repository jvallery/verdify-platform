// SPDX-License-Identifier: MIT
import { Link } from "react-router";
import { GROUPS, type Section } from "../../lib/sections";
import { useShellStatus } from "../../lib/shell";
import { SectionIcon } from "../icons";
import { Brand, CountPill, useCurrentSection } from "../site-header";
import { ThemeSwitch } from "./theme-switch";

/**
 * The sections by group, as the rail and the More sheet list them: a small group label, then each section as a link
 * with its icon and label, the current one `aria-current="page"`, and the open-alert count on Activity. `idPrefix`
 * keeps the group labels' ids apart when both lists are on the page. `onNavigate` lets the sheet close as a link is
 * chosen.
 */
export function SectionGroups({ current, idPrefix, onNavigate, linkClass }: { current: Section | null; idPrefix: string; onNavigate?: () => void; linkClass: string }) {
  const { openAlerts, alertSeverity } = useShellStatus();
  return <>
    {GROUPS.map((group) => <div key={group.id} className="nav-group" data-group={group.id}>
      <p className="nav-group-label" id={`${idPrefix}-${group.id}`}>{group.label}</p>
      <ul className="nav-group-list" aria-labelledby={`${idPrefix}-${group.id}`}>
        {group.sections.map((section) => <li key={section.id}>
          <Link className={linkClass} to={section.to} data-section={section.id} aria-current={current?.id === section.id ? "page" : undefined} onClick={onNavigate}>
            <SectionIcon section={section.id} className="nav-icon" />
            <span className="nav-label">{section.label}</span>
            {section.id === "activity" && <CountPill count={openAlerts} severity={alertSeverity} />}
          </Link>
        </li>)}
      </ul>
    </div>)}
  </>;
}

/**
 * The fixed left rail above 860 px (README section 3.2, design-system section 3): the lockup, the three groups and, at
 * its foot, the theme switch. It scrolls on its own. At 860 px and below the stylesheet hides it and the bottom bar and
 * the More sheet take over.
 */
export function Rail() {
  const current = useCurrentSection();
  return <div className="rail" data-testid="rail">
    <Brand className="rail-brand" />
    <nav className="rail-nav" aria-label="Sections">
      <SectionGroups current={current} idPrefix="rail-group" linkClass="rail-link" />
    </nav>
    <div className="rail-foot"><ThemeSwitch className="rail-theme" /></div>
  </div>;
}
