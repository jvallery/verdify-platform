// SPDX-License-Identifier: MIT
import type { PanelRead } from "../../lib/queries";
import type { ShellStatus } from "../../lib/shell";
import type { PanelState } from "../panel";

/**
 * A block of the controller's own data as its panel shows it (design system section 3): its skeleton until the read
 * first answers, its own error while the newest read failed (never its old data as if current), and, while the shell
 * says the ingestor is not running or the controller is not reporting, its last values muted with that reason.
 */
export function deviceState(read: Pick<PanelRead<unknown>, "data" | "failed" | "pending">, status: Pick<ShellStatus, "ingestorRunning" | "controllerReporting">): PanelState {
  if (read.failed) return "error";
  if (read.pending || read.data === null) return "loading";
  if (status.ingestorRunning === false) return "ingestor_down";
  if (status.controllerReporting === false) return "controller_not_reporting";
  return "ready";
}

/** A block of the host's own record (Data): loading, its own error, empty when `isEmpty` says so, else ready. */
export function hostState<T>(read: Pick<PanelRead<T>, "data" | "failed" | "pending">, isEmpty?: (data: T) => boolean): PanelState {
  if (read.failed) return "error";
  if (read.pending || read.data === null) return "loading";
  return isEmpty?.(read.data) ? "empty" : "ready";
}
