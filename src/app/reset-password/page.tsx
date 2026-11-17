import { Suspense } from "react";
import ResetPasswordClient from "./ResetPasswordClient";

async function ResetPasswordContent({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams;
  return <ResetPasswordClient token={token} />;
}

export default function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  return <Suspense fallback={<main style={{ maxWidth: 520, margin: "72px auto", padding: 24 }}>Loading secure password reset…</main>}>
    <ResetPasswordContent searchParams={searchParams} />
  </Suspense>;
}
