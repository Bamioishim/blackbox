import { currentUser } from "@/lib/session";

export async function GET() {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Sign in to add wallet assets." }, { status: 401 });
  return Response.json({ userId: user.id });
}
