// SPDX-License-Identifier: MIT
import { useLayoutEffect, useRef, type RefObject } from "react";
import { Link } from "react-router";
import { useShellNow, useShellStatus } from "../../lib/shell";
import { OperatorOnly } from "../../lib/session";
import { AccountMenu } from "../account-menu";
import { Banner } from "../banner";
import { Ago, FreshnessDot } from "../freshness";
import { Brand } from "../site-header";
import { StopAllWater } from "../stop-all-water";
import { SearchButton } from "./search";

/**
 * Keeps `--shell-header-h` on the document at the sticky top bar's height, fault row included, so a row that sticks
 * under it (Water's tabs, a table head) sits right below it. Set through CSSOM, never a style attribute.
 */
function useHeaderHeight(ref: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const header = ref.current;
    if (!header || typeof ResizeObserver !== "function") return;
    const root = header.ownerDocument.documentElement;
    const update = () => root.style.setProperty("--shell-header-h", `${Math.ceil(header.getBoundingClientRect().height)}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    return () => { observer.disconnect(); root.style.removeProperty("--shell-header-h"); };
  }, [ref]);
}

/**
 * The freshness chip: how old the controller's newest reading is (API-02 `freshness.climate`, from the shell's poll),
 * with its dot, linking to Controller. Above 860 px it reads "Last reading 12 s ago"; at 860 px and below only the dot
 * shows and the words stay for a screen reader. Before API-02 answers the dot is neutral and the age is a dash: unknown
 * is never shown as fresh.
 */
export function FreshnessChip() {
  const now = useShellNow().data;
  const { controllerReporting } = useShellStatus();
  const climate = now?.freshness.climate ?? null;
  return <Link className="fresh-chip" to="/system/controller" data-testid="freshness">
    {climate ? <FreshnessDot stale={Boolean(climate.stale)} notReporting={controllerReporting === false} /> : <span className="dot fresh-unknown" data-fresh="unknown" aria-hidden="true" />}
    <span className="fresh-chip-text">Last reading {climate ? <Ago at={climate.observed_at} /> : "—"}</span>
  </Link>;
}

/**
 * The sticky top bar (README section 3.2). Above 860 px it sits over the content column and holds Search, the
 * freshness chip, Stop all water for an operator and the account menu; at 860 px and below it holds the lockup, the
 * freshness dot and the account menu, and the stylesheet hides the rest. The one fault banner, worst first, is a row
 * inside it while it is true, so it never scrolls away.
 */
export function TopBar() {
  const { fault } = useShellStatus();
  const header = useRef<HTMLElement>(null);
  useHeaderHeight(header);
  return <header ref={header} className="topbar" data-testid="topbar">
    <div className="topbar-row">
      <Brand className="topbar-brand" />
      <SearchButton className="topbar-search" />
      <div className="topbar-tools">
        <FreshnessChip />
        <OperatorOnly><span className="topbar-stop"><StopAllWater /></span></OperatorOnly>
        <AccountMenu />
      </div>
    </div>
    {fault && <div className="topbar-fault"><Banner tone="fault" link={fault.link}>{fault.text}</Banner></div>}
  </header>;
}
