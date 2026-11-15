// SPDX-License-Identifier: MIT
import Crops from "./crops";
import { viewMeta } from "../lib/sections";
export const meta = () => viewMeta("hydro-overview");
export default function Hydroponics() { return <Crops hydro />; }
