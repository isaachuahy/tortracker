import { redirect } from "next/navigation";
import { serverClient } from "@/lib/supabase-server";
import { Shell } from "@/components/shell";
export default async function NotebookLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) redirect("/login");
  return <Shell email={user.email || ""}>{children}</Shell>;
}
