import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { createWorkspaceAction } from "./actions";

export default async function OnboardingPage(props: any) {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();
  if (!data.user) redirect("/app/login");

  const searchParams = await props.searchParams;
  const err = searchParams?.e ? decodeURIComponent(searchParams.e) : null;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <form
        action={createWorkspaceAction}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-3"
      >
        <h1 className="text-xl font-bold">Criar Workspace</h1>

        {err && (
          <div className="text-sm rounded-xl border border-red-800/60 bg-red-900/20 p-3 text-red-200">
            {err}
          </div>
        )}

        <input
          name="name"
          placeholder="Nome do workspace"
          className="w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2"
          defaultValue="Meu Workspace"
        />

        <button className="w-full rounded-xl bg-white/10 hover:bg-white/15 border border-zinc-700 px-4 py-2 font-semibold">
          Criar e continuar
        </button>
      </form>
    </main>
  );
}