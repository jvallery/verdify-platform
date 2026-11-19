// SPDX-License-Identifier: MIT
import { useId, useState } from "react";
import { Button } from "../button";
import { cls } from "../common";
import { collapses, proseBlocks } from "./review-model";

/**
 * A review's summary as readable prose (screens 8, row 2): its paragraphs and simple lists, nothing else rendered from
 * markup. A long summary shows about 12 lines with Read all, which opens the rest in place; the whole text stays in the
 * document, so a screen reader and Find read all of it.
 */
export function ReviewProse({ summary }: { summary: string }) {
  const id = useId();
  const blocks = proseBlocks(summary);
  const long = collapses(blocks);
  const [open, setOpen] = useState(false);
  const collapsed = long && !open;
  return <div className="rv-prose-wrap">
    <div id={id} className={cls("rv-prose", collapsed && "rv-prose-collapsed")} data-collapsed={collapsed || undefined}>
      {blocks.map((block, index) => block.kind === "p"
        ? <p key={index}>{block.text}</p>
        : block.kind === "ul"
          ? <ul key={index}>{block.items.map((item, at) => <li key={at}>{item}</li>)}</ul>
          : <ol key={index}>{block.items.map((item, at) => <li key={at}>{item}</li>)}</ol>)}
    </div>
    {long && <Button variant="quiet" size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{open ? "Show less" : "Read all"}</Button>}
  </div>;
}
