import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AppHome() {
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getUser();

  if (error || !data.user) redirect("/app/login");

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-3xl mx-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h1 className="text-xl font-bold">Admin OK ✅</h1>
        <p className="text-sm text-zinc-400 mt-2">Você está logado.</p>
      </div>
    </main>
  );
}
