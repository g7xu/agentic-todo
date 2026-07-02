import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";

export const dynamic = "force-dynamic";

// `/` routes to Today when signed in, otherwise to the sign-in page.
export default async function Home() {
  const { data: session } = await auth.getSession();
  redirect(session?.user ? "/today" : "/auth/sign-in");
}
