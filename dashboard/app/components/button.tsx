// SPDX-License-Identifier: MIT
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { OperatorOnly, useWritesEnabled } from "../lib/session";
import { cls } from "./common";

/**
 * The variants of design system v2 §4: `default` is the secondary (outline) button, `primary` the accent fill, `quiet`
 * text only, `danger` the critical fill. `stop` looks like danger and is Stop: never confirmed, and live while writes are
 * off.
 */
export type ButtonVariant = "default" | "primary" | "quiet" | "danger" | "stop";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  /** A verb and its object: "Run wall drip", "Save". */
  children: ReactNode;
  variant?: ButtonVariant;
  /** md is 44 px; sm is 36 px drawn inside a 44 px target. */
  size?: "md" | "sm";
  /** While the request is out: reads "Sending…" and is disabled. No spinner. */
  busy?: boolean;
  /** A control that changes something: carries `data-write-control` and renders only for operators. */
  write?: boolean;
  /** Full width on phones (Run, Stop all water, Acknowledge). */
  wide?: boolean;
};

const VARIANT_CLASS: Readonly<Record<ButtonVariant, string | null>> = { default: null, primary: "btn-primary", quiet: "btn-quiet", danger: "btn-danger", stop: "btn-stop" };

/**
 * The `.btn` of design system v2 §4. `variant="stop"` is `.btn-stop` and is never confirmed. A write control is disabled
 * while changes are switched off (`writes_enabled: false`), except Stop, which stays live.
 */
export function Button({ children, variant = "default", size = "md", busy = false, write = false, wide = false, disabled, className, type = "button", ...rest }: ButtonProps) {
  const writesEnabled = useWritesEnabled();
  const switchedOff = write && variant !== "stop" && !writesEnabled;
  const button = <button {...rest} type={type}
    className={cls("btn", VARIANT_CLASS[variant], size === "sm" && "btn-sm", wide && "btn-wide", className)}
    disabled={disabled || busy || switchedOff} data-write-control={write ? "true" : undefined}>
    {busy ? "Sending…" : children}
  </button>;
  return write ? <OperatorOnly>{button}</OperatorOnly> : button;
}
