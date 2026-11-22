import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase com Privilégios Administrativos (Service Role)
 * 
 * DIRETRIZES DE SEGURANÇA:
 * 1. Uso EXCLUSIVO no backend (Route Handlers, scripts internos e rotinas administrativas).
 * 2. NUNCA importe este módulo em componentes client-side ("use client").
 * 3. SUPABASE_SERVICE_ROLE_KEY nunca deve ser prefixada com NEXT_PUBLIC_.
 */
export function getSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL não configurado");
  }

  if (!serviceKey || serviceKey.trim() === "") {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY não configurado no ambiente do servidor");
  }

  return createClient(url, serviceKey.trim(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
