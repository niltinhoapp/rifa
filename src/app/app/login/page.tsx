import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/workspace";

export default async function AppHome() {
  const { user, workspace } = await getActiveWorkspace();

  if (!user) redirect("/app/login");

  if (!workspace) redirect("/app/onboarding"); // ✅ aqui cria

  redirect("/app/raffles");
}