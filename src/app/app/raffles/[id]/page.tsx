import Link from "next/link";
import { redirect } from "next/navigation";
import { getActiveWorkspace } from "@/lib/workspace";
import { supabaseServer } from "@/lib/supabase/server";

// ⚠️ ajuste os imports abaixo conforme seu caminho real:
import RaffleEditForm from "./raffle-edit-form";
import NumbersAdmin from "./numbers-admin";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function RaffleAdminPage({ params }: PageProps) {
  const { id } = await params;

  const { user, workspace } = await getActiveWorkspace();
  if (!user) redirect("/app/login");
  if (!workspace) redirect("/app/onboarding");

  const sb = await supabaseServer();

  // carrega rifa (RLS garante que só do seu workspace aparece)
  const { data: raffle, error } = await sb
    .from("raffles")
    .select(
      "id,workspace_id,title,description,slug,status,total_numbers,price_cents,draw_date,payment_mode,payment_instructions,prize_title,reserve_unit,reserve_value,created_at"
    )
    .eq("id", id)
    .single();

  if (error || !raffle) {
    return (
      <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
        <div className="max-w-4xl mx-auto rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-xl font-bold">Rifa não encontrada</h1>
            <Link
              href="/app/raffles"
              className="rounded-xl border border-zinc-800 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            >
              Voltar
            </Link>
          </div>
          <div className="mt-3 text-sm text-zinc-400">
            {error?.message ?? "Sem acesso ou rifa inexistente."}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-6xl mx-auto space-y-4">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Admin da Rifa</h1>
            <p className="text-sm text-zinc-400 mt-1">
              Workspace:{" "}
              <span className="text-zinc-200 font-semibold">
                {workspace.name}
              </span>{" "}
              • Público:{" "}
              <span className="text-zinc-200 font-semibold">/r/{raffle.slug}</span>
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href={`/r/${raffle.slug}`}
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm hover:bg-white/10"
              target="_blank"
            >
              Abrir público
            </Link>

            <Link
              href="/app/raffles"
              className="rounded-xl border border-zinc-800 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
            >
              Voltar
            </Link>
          </div>
        </div>

        {/* ✅ edição da rifa */}
        <RaffleEditForm raffle={raffle as any} />

        {/* ✅ números + confirmar pagamento */}
        <NumbersAdmin raffleId={raffle.id} />
      </div>
    </main>
  );
}