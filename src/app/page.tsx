import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { Landing } from "@/components/landing";

export const dynamic = "force-dynamic";

// `/` is the landing page for visitors and the Upcoming board for users.
export default async function Home() {
  const { data: session } = await auth.getSession();
  if (session?.user) redirect("/upcoming");
  return <Landing />;
}
