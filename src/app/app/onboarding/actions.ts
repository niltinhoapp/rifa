"use server";

import { redirect } from "next/navigation";
import { supabaseSSR } from "@/lib/supabase/ssr";

export async function createWorkspaceAction(formData: FormData) {
  const name = String(formData.get("name") ?? "Meu Workspace").trim();

  const sb = await supabaseSSR();
  const { data: auth } = await sb.auth.getUser();
  if (!auth.user) redirect("/app/login");

  const { data: ws, error } = await sb.rpc("create_workspace", { p_name: name });

  if (error) redirect(`/app/onboarding?e=${encodeURIComponent(error.message)}`);

  redirect("/app/raffles");
}