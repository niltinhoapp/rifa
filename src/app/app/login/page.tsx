import Link from "next/link";
import { loginAction } from "./actions";

type LoginPageProps = {
  searchParams: Promise<{ e?: string }> | { e?: string };
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const error = params?.e;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6">
        <h1 className="text-2xl font-bold">Acesso administrativo</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Entre com o e-mail e a senha cadastrados para administrar sua rifa.
        </p>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-rose-800 bg-rose-950/40 p-3 text-sm text-rose-200">
            {error}
          </div>
        )}

        <form action={loginAction} className="mt-5 space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm text-zinc-300">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-zinc-400"
              placeholder="seu@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-zinc-300">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 text-sm text-white outline-none focus:border-zinc-400"
              placeholder="Sua senha"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-xl border border-zinc-600 bg-white/10 px-4 py-3 text-sm font-semibold text-white hover:bg-white/15"
          >
            Entrar no painel
          </button>
        </form>

        <div className="mt-4 text-center">
          <Link href="/app/forgot" className="text-sm text-zinc-400 hover:text-white hover:underline">
            Esqueci minha senha
          </Link>
        </div>
      </div>
    </main>
  );
}
