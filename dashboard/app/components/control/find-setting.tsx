// SPDX-License-Identifier: MIT
import { useId, type ChangeEvent, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useSearch } from "../shell/search";

/**
 * "Find a setting" in a page header: the shell's Search (components/shell/search.tsx) opened with the words typed here,
 * where a setting is found by its label or its name and opening one goes to its drawer on Settings. It is a plain GET
 * form, so before the page hydrates it lands on Settings filtered by the words (`/settings?q=`); outside the shell (a
 * page rendered alone) it does the same through the router.
 */
export function FindSetting() {
  const id = useId();
  const navigate = useNavigate();
  const search = useSearch();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const words = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    if (search) search.open(words);
    else navigate(words ? `/settings?${new URLSearchParams({ q: words })}` : "/settings");
  };
  return <form className="ctl-find" method="get" action="/settings" role="search" aria-label="Find a setting" onSubmit={submit}>
    <label className="screen-reader" htmlFor={id}>Find a setting</label>
    <input id={id} type="search" name="q" placeholder="Find a setting" autoComplete="off" />
    <button type="submit" className="btn">Find</button>
  </form>;
}

/** Search names, keys and the API's explanations; keep the question in the URL as `q`. */
export function SettingsSearch({ value, onChange }: { value: string; onChange: (text: string) => void }) {
  const id = useId();
  return <div className="ctl-find ctl-search" role="search" aria-label="Settings">
    <label className="screen-reader" htmlFor={id}>Search settings</label>
    <input id={id} type="search" value={value} placeholder="Search by name, key or what it changes" autoComplete="off"
      onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)} />
  </div>;
}
