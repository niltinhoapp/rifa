"use server";

import { redirect } from "next/navigation";
import { supabaseSSR } from "@/lib/supabase/ssr";

export async function loginAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  const sb = await supabaseSSR();
  const { error } = await sb.auth.signInWithPassword({ email, password });

  if (error) redirect(`/app/login?e=${encodeURIComponent(error.message)}`);

  redirect("/app");
}