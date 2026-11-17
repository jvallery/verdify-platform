// SPDX-License-Identifier: MIT
import type { ReactNode } from "react";
import { Link } from "react-router";
import { groupOf, sectionOf, viewOf, type RetiredViewId, type ViewId } from "../../lib/sections";
import { cls } from "../common";

type AnyViewId = ViewId | RetiredViewId;

/**
 * A section's tabs (design-system section 3, Page): a labelled `nav.tabs` ("Water views") of links, the current one
 * `aria-current="page"`, underlined by primitives.css and scrolling sideways rather than wrapping. A tab is a link, so a
 * tab change adds to history and Back returns to the previous tab. A section with one view has none.
 */
export function SectionTabs({ view }: { view: AnyViewId }) {
  const current = viewOf(view);
  const section = sectionOf(current.section);
  if (section.views.length < 2) return null;
  return <nav className="tabs" aria-label={`${section.label} views`}>
    {section.views.map((item) => <Link key={item.id} className="tab" to={item.path} aria-current={item.id === current.id ? "page" : undefined}>{item.tab}</Link>)}
  </nav>;
}

export type PageHeaderProps = {
  /** The view this page is (lib/sections.ts): its group and section make the breadcrumb, its title the h1. */
  view: AnyViewId;
  /**
   * The h1 when the page shows a focused state of its view ("South zone" on Zones). The breadcrumb then adds the view
   * as a link after the section.
   */
  title?: string;
  /** The purpose line under the title; the view's own (lib/sections.ts) unless given; null shows none. */
  purpose?: string | null;
  /**
   * The status line: the page's one sentence of state, from data (`.meta`). Pass null while it loads: the line keeps
   * its height, so nothing shifts when it fills. Leave it out for a page with none.
   */
  status?: ReactNode;
  /** The status line's phone wording, shown in its place at 860 px and below; both render and the stylesheet shows one. */
  statusShort?: ReactNode;
  /** At most two actions, the primary last: at the title row's right above 860 px, under the status line on phones. */
  actions?: ReactNode;
  /** At the end of the tabs row: Water's Stop all water, which shares the sticky row at 860 px and below. */
  tabsEnd?: ReactNode;
  /** The tabs row sticks under the top bar at 860 px and below (Water). */
  stickyTabs?: boolean;
};

/**
 * Every screen's head (design-system section 3, Page): the breadcrumb (group, then section, the section a link to its
 * default view unless the page is that view), the one h1, the purpose line, the status line and the actions, then the
 * section's tabs. Now has no page header: its hero is its head.
 */
export function PageHeader({ view, title, purpose, status, statusShort, actions, tabsEnd, stickyTabs = false }: PageHeaderProps) {
  const current = viewOf(view);
  const section = sectionOf(current.section);
  const group = groupOf(section.group);
  const focused = title !== undefined && title !== current.title;
  const onDefault = section.views[0].id === current.id && !focused;
  const line = purpose === undefined ? current.purpose : purpose;
  const sep = <span className="page-crumb-sep" aria-hidden="true">›</span>;
  return <>
    <div className="page-header">
      <nav className="page-crumbs" aria-label="Breadcrumb">
        <ol>
          <li>{group.label}</li>
          <li>{sep}{onDefault ? <span aria-current="page">{section.label}</span> : <Link to={section.to}>{section.label}</Link>}</li>
          {focused && <li>{sep}<Link to={current.path}>{current.tab}</Link></li>}
        </ol>
      </nav>
      <h1 className="page-title">{title ?? current.title}</h1>
      {line && <p className="page-description">{line}</p>}
      {status !== undefined && <p className={cls("page-status meta", statusShort !== undefined && "page-status-long")}>{status}</p>}
      {status !== undefined && statusShort !== undefined && <p className="page-status-short meta">{statusShort}</p>}
      {actions && <div className="page-actions">{actions}</div>}
    </div>
    {section.views.length > 1 && <div className={cls("page-tabs", stickyTabs && "page-tabs-sticky")}>
      <SectionTabs view={current.id} />
      {tabsEnd && <div className="page-tabs-end">{tabsEnd}</div>}
    </div>}
  </>;
}
