import type { Metadata } from "next";
import { Suspense } from "react";
import { Verifier } from "./Verifier";

export const metadata: Metadata = { title: "Verify a deal | Blackbox" };

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Verifier />
    </Suspense>
  );
}
