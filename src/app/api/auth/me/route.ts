import { currentUser } from "@/lib/session";
export async function GET() {
  const user = await currentUser();
  return Response.json({user});
}
