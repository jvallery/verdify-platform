// SPDX-License-Identifier: MIT
import { CropsWorkspace } from "./crops";
import { viewMeta } from "../lib/sections";
export const meta = () => viewMeta("hydro-overview");
export default function Hydroponics() { return <CropsWorkspace hydro />; }
