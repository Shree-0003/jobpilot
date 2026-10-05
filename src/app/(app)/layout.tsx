import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth/session";
import Shell from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (!s.session.mfaVerified) redirect("/mfa");
  return <Shell email={s.user.email}>{children}</Shell>;
}
