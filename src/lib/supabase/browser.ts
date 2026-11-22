import { createBrowserClient } from "@supabase/ssr";

export function supabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // ✅ não derruba a página inteira — ajuda no debug
  if (!url || !anon) {
    throw new Error(
      "Supabase env não carregou no client. Verifique .env.local (NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY) e reinicie o dev server."
    );
  }

  return createBrowserClient(url, anon);
}