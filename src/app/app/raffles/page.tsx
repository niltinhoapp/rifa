import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";
import { createRaffleAction } from "./actions";

export default async function RafflesPage() {
  const { user, workspace } = await getActiveWorkspace();
  if (!user) redirect("/app/login");
  if (!workspace) redirect("/app");

  const sb = await supabaseServer();

  const { data: raffles } = await sb
    .from("raffles")
    .select("id,title,slug,status,total_numbers,price_cents,created_at")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <header className="flex items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Rifas</h1>
            <p className="text-zinc-400 text-sm">Crie e gerencie suas rifas.</p>
          </div>
          <Link
            href="/app"
            className="rounded-xl border border-zinc-800 bg-white/5 px-4 py-2 text-sm hover:bg-white/10"
          >
            Voltar
          </Link>
        </header>

        {/* Criar nova */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-lg font-semibold">Criar nova rifa</h2>

          <form action={createRaffleAction} className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs text-zinc-400">Título</label>
              <input
                name="title"
                required
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                placeholder="Ex: Kit churrasco"
              />
            </div>

            <div className="md:col-span-2">
              <label className="text-xs text-zinc-400">Descrição (opcional)</label>
              <textarea
                name="description"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600 min-h-90px"
                placeholder="Regras, local de entrega, etc."
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Prêmio (opcional)</label>
              <input
                name="prize"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                placeholder="Ex: Kit churrasco"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Preço por número (R$)</label>
              <input
                name="price"
                defaultValue="5,00"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Qtd números</label>
              <input
                name="total_numbers"
                defaultValue="100"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </div>

            <div>
              <label className="text-xs text-zinc-400">Reserva (min)</label>
              <input
                name="reserve_minutes"
                defaultValue="15"
                className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
              />
            </div>

            <div className="md:col-span-2">
              <button className="rounded-xl border border-zinc-700 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15">
                Criar rifa
              </button>
            </div>
          </form>
        </section>

        {/* Lista */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <h2 className="text-lg font-semibold">Minhas rifas</h2>

          <div className="mt-4 grid gap-3">
            {(raffles ?? []).length === 0 ? (
              <p className="text-zinc-400 text-sm">Nenhuma rifa criada ainda.</p>
            ) : (
              (raffles ?? []).map((r) => (
                <Link
                  key={r.id}
                  href={`/app/raffles/${r.id}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/30 p-4 hover:bg-white/5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-semibold">{r.title}</div>
                      <div className="text-xs text-zinc-400">Público: /r/{r.slug}</div>
                    </div>
                    <div className="text-xs text-zinc-300">
                      <div>Nº: {r.total_numbers}</div>
                      <div>R$ {(r.price_cents / 100).toFixed(2).replace(".", ",")}</div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  );
}