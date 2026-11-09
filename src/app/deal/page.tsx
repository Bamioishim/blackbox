import type { Metadata } from "next";
import { DealConsole } from "./DealConsole";

export const metadata: Metadata = { title: "Open a deal | Blackbox" };

export default function Page() {
  return <DealConsole />;
}
