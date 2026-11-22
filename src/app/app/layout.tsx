// src/app/app/layout.tsx
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // ✅ NÃO redirecionar no layout pro /app/login
  // porque /app/login é filho do layout e você cria loop/500.
  // Só bloqueie páginas privadas (ex: /app/page.tsx, /app/raffles/*)

  return <>{children}</>;
}