import { connection } from "next/server";
import ResetPasswordClient from "./ResetPasswordClient";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  await connection();
  const { token = "" } = await searchParams;
  return <ResetPasswordClient token={token} />;
}
