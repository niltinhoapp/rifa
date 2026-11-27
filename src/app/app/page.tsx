import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/workspace";

export default async function AppHome() {
  const { user, workspace } = await getActiveWorkspace();

  if (!user) redirect("/app/login");
  if (!workspace) redirect("/app/onboarding");

  // Usuário autenticado com workspace segue diretamente para a gestão das rifas.
  redirect("/app/raffles");
}
