"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function ResetPage() {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // garante que o Supabase processe o token do link (detectSessionInUrl)
  useEffect(() => {
    (async () => {
      const { data } = await sb.auth.getSession();
      setReady(true);

      // Se não tiver sessão aqui, normalmente é porque abriu a página direto,
      // sem vir do link do e-mail.
      if (!data.session) {
        setMsg("Abra essa página pelo link recebido no e-mail de redefinição.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveNewPassword() {
    setMsg(null);
    setLoading(true);
    try {
      const { data } = await sb.auth.getSession();
      if (!data.session) {
        setMsg("Sessão de redefinição não encontrada. Use o link do e-mail novamente.");
        return;
      }

      const { error } = await sb.auth.updateUser({ password });
      if (error) {
        setMsg(error.message);
        return;
      }

      setMsg("Senha atualizada ✅");
      router.push("/app");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h1 className="text-xl font-bold">Nova senha</h1>
        <p className="text-sm text-zinc-400 mt-1">
          Defina uma senha nova para sua conta.
        </p>

        <label className="block text-xs text-zinc-400 mt-4">Nova senha (mín. 6)</label>
        <input
          type="password"
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
        />

        <button
          onClick={saveNewPassword}
          disabled={!ready || loading || password.length < 6}
          className="mt-4 w-full rounded-xl border border-zinc-700 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
        >
          {loading ? "Salvando..." : "Salvar nova senha"}
        </button>

        {msg && (
          <div className="mt-3 text-sm rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
            {msg}
          </div>
        )}

        <div className="mt-4 text-sm">
          <Link className="text-zinc-300 hover:underline" href="/app/login">
            Voltar para login
          </Link>
        </div>
      </div>
    </main>
  );
}
