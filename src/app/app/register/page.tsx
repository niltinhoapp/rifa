"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";

export default function RegisterPage() {
  const router = useRouter();
  const sb = supabaseBrowser();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function register() {
    setMsg(null);
    setLoading(true);
    try {
      const { data, error } = await sb.auth.signUp({
        email: email.trim(),
        password,
      });

      if (error) {
        setMsg(error.message);
        return;
      }

      // se confirmar email estiver ligado no Supabase, user pode vir null/sem sessão
      if (!data.session) {
        setMsg("Conta criada. Verifique seu e-mail para confirmar (se estiver habilitado).");
        return;
      }

      router.push("/app");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
        <h1 className="text-xl font-bold">Criar conta</h1>
        <p className="text-sm text-zinc-400 mt-1">E-mail e senha.</p>

        <label className="block text-xs text-zinc-400 mt-4">E-mail</label>
        <input
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="seu@email.com"
          autoComplete="email"
        />

        <label className="block text-xs text-zinc-400 mt-3">Senha (mín. 6)</label>
        <input
          type="password"
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="new-password"
        />

        <button
          onClick={register}
          disabled={loading || email.trim().length < 5 || password.length < 6}
          className="mt-4 w-full rounded-xl border border-zinc-700 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
        >
          {loading ? "Criando..." : "Criar conta"}
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
