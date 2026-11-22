import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-3xl rounded-3xl border border-zinc-800 bg-zinc-900/60 p-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold">Rifa SaaS</h1>
            <p className="text-zinc-400 mt-2">
              Crie rifas, controle números e publique um link /r/slug.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/app/login"
              className="rounded-xl border border-zinc-700 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15"
            >
              Entrar no Admin
            </Link>
            <Link
              href="/r/kit-churrasco"
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-2 text-sm hover:bg-white/10"
            >
              Ver rifa exemplo
            </Link>
          </div>
        </div>

        <div className="mt-8 grid sm:grid-cols-3 gap-3 text-sm">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-4">
            <div className="font-semibold">Público</div>
            <div className="text-zinc-400 mt-1">
              Link /r/slug, seleção de números e reserva.
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-4">
            <div className="font-semibold">Admin</div>
            <div className="text-zinc-400 mt-1">
              Confirmar recebimento, liberar e editar rifa.
            </div>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/30 p-4">
            <div className="font-semibold">Reserva</div>
            <div className="text-zinc-400 mt-1">
              Minutos / dias / até o sorteio (conforme a rifa).
            </div>
          </div>
        </div>

        <div className="mt-6 text-xs text-zinc-500">
          Dica: seu link público fica assim: <span className="text-zinc-300">/r/kit-churrasco</span>
        </div>
      </div>
    </main>
  );
}