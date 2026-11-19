// SPDX-License-Identifier: MIT
import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { useSettingsRead } from "../../lib/queries";
import { useModalDialog } from "../forms/modal";
import { MarkIcon } from "../icons";
import { LINE_ITEMS, PAGE_ITEMS, RELAY_ITEMS, TERM_ITEMS, searchResults, settingItems, type SearchItem } from "./search-model";

type SearchState = { readonly open: (query?: string) => void };
const SearchContext = createContext<SearchState | null>(null);
/** Opens Search, optionally with words already typed; null outside the shell (a test rendering a page alone). */
export const useSearch = (): SearchState | null => useContext(SearchContext);

/** A key typed into a field is the field's: `/` opens Search only from the page itself. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Search for the whole page (README section 3.2): `/` (outside a field) and Ctrl K or ⌘ K open it from anywhere, and so
 * do the top bar's Search button, the More sheet's and every "Find a setting" (`useSearch`). The dialog mounts only
 * while open, so the settings read runs only then.
 */
export function SearchProvider({ children }: { children?: ReactNode }) {
  const [query, setQuery] = useState<string | null>(null);
  const open = useCallback((words = "") => setQuery(words), []);
  const close = useCallback(() => setQuery(null), []);
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const chord = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
      const slash = event.key === "/" && !event.metaKey && !event.ctrlKey && !event.altKey && !typing(event.target);
      if (!chord && !slash) return;
      event.preventDefault();
      setQuery((current) => current ?? "");
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const value = useMemo(() => ({ open }), [open]);
  return <SearchContext.Provider value={value}>
    {children}
    {query !== null && <SearchDialog initialQuery={query} onClose={close} />}
  </SearchContext.Provider>;
}

/** The top bar's Search: the field's look, with the `/` hint, as a button that opens the dialog. */
export function SearchButton({ className }: { className?: string }) {
  const search = useSearch();
  return <button type="button" className={className ? `search-button ${className}` : "search-button"} onClick={() => search?.open()} aria-keyshortcuts="/ Control+K Meta+K">
    <MarkIcon name="search" className="search-button-icon" />
    <span className="search-button-label">Search</span>
    <kbd className="search-button-key" aria-hidden="true">/</kbd>
  </button>;
}

/**
 * One modal dialog with a combobox (ARIA 1.2, list autocomplete): typing filters the results into groups of at most 8;
 * Up and Down move through every result, Home and End jump, Enter or a press opens one, Escape closes. Focus stays in
 * the field and the active result is its `aria-activedescendant`, so a screen reader hears each as it moves; a polite
 * status says how many there are.
 */
export function SearchDialog({ initialQuery = "", onClose }: { initialQuery?: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const id = useId();
  const [query, setQuery] = useState(initialQuery);
  const [active, setActive] = useState(0);
  const settings = useSettingsRead();
  const settingList = settings.data?.items;
  const items = useMemo<SearchItem[]>(() => [...PAGE_ITEMS, ...settingItems(settingList), ...RELAY_ITEMS, ...LINE_ITEMS, ...TERM_ITEMS], [settingList]);
  const groups = useMemo(() => searchResults(query, items), [query, items]);
  const flat = groups.flatMap((group) => group.items);
  const current = flat.length ? Math.min(active, flat.length - 1) : -1;
  const optionId = (index: number) => `${id}-option-${index}`;
  const { onKeyDown, onCancel } = useModalDialog(ref, true, onClose, () => field.current);

  useEffect(() => {
    if (current < 0) return;
    ref.current?.ownerDocument.getElementById(optionId(current))?.scrollIntoView?.({ block: "nearest" });
  });

  const choose = (item: SearchItem) => {
    onClose();
    navigate(item.to);
  };
  const onFieldKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!flat.length) return;
    const move: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: flat.length - 1 };
    if (event.key in move) {
      event.preventDefault();
      setActive((move[event.key] + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      choose(flat[current]);
    }
  };

  let index = -1;
  const status = !query.trim() ? "" : flat.length ? `${flat.length} result${flat.length === 1 ? "" : "s"}` : "No results";
  return <dialog ref={ref} className="search-dialog" aria-labelledby={`${id}-title`} onKeyDown={onKeyDown} onCancel={onCancel}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="search-panel" data-testid="search">
      <div className="search-head">
        <h2 id={`${id}-title`} className="screen-reader">Search</h2>
        <MarkIcon name="search" className="search-field-icon" />
        <label className="screen-reader" htmlFor={`${id}-field`}>Search pages, settings, relays, water lines and terms</label>
        <input ref={field} id={`${id}-field`} className="search-field" type="search" autoComplete="off" spellCheck={false}
          placeholder="Search pages, settings, relays, lines, terms" value={query}
          role="combobox" aria-expanded={flat.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={current >= 0 ? optionId(current) : undefined}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { setQuery(event.target.value); setActive(0); }} onKeyDown={onFieldKey} />
        <button type="button" className="search-close" onClick={onClose}><MarkIcon name="close" /><span className="screen-reader">Close search</span></button>
      </div>
      <div id={`${id}-list`} className="search-results" role="listbox" aria-label="Results">
        {groups.map((group) => <div key={group.group} role="group" className="search-group" aria-labelledby={`${id}-${group.group}`}>
          <div id={`${id}-${group.group}`} role="presentation" className="search-group-label">{group.label}</div>
          {group.items.map((item) => {
            index += 1;
            const mine = index;
            return <div key={item.id} id={optionId(mine)} role="option" aria-selected={mine === current} className="search-option"
              data-group={item.group} onClick={() => choose(item)} onPointerMove={() => { if (mine !== current) setActive(mine); }}>
              <span className="search-option-label">{item.label}</span>
              {item.detail && <span className="search-option-detail">{item.detail}</span>}
            </div>;
          })}
        </div>)}
      </div>
      {query.trim() && !flat.length && <p className="search-empty">Nothing matches “{query.trim()}”.</p>}
      {!query.trim() && <p className="search-hint">Type to find a page, a setting by its label or name, a relay, a water line or a term.</p>}
      <p className="screen-reader" role="status">{status}</p>
    </div>
  </dialog>;
}
