"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { supabaseSSR } from "@/lib/supabase/ssr";
import { getActiveWorkspace } from "@/lib/workspace";

function slugify(input: string) {
  return (input ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function parseBRLtoCents(v: string) {
  const raw = (v ?? "").trim();
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const n = Number(normalized);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export async function createRaffleAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim() || null;

  // se sua tabela ainda NÃO tem prize, deixe null e não insira no insert (abaixo)
  const prize = String(formData.get("prize") ?? "").trim() || null;

  const priceStr = String(formData.get("price") ?? "0");
  const total_numbers = Number(formData.get("total_numbers") ?? 100);
  const reserve_minutes = Number(formData.get("reserve_minutes") ?? 15);

  if (!title) throw new Error("Título inválido");
  const price_cents = parseBRLtoCents(priceStr);

  const sb = await supabaseSSR();
  const { user, workspace } = await getActiveWorkspace();
  if (!user) redirect("/app/login");
  if (!workspace) redirect("/app");

  const base = slugify(title) || "rifa";
  const suffix = Math.random().toString(36).slice(2, 6);
  const slug = `${base}-${suffix}`;

  // ✅ cria rifa pegando id garantido
  const { data: raffle, error: rErr } = await sb
    .from("raffles")
    .insert({
      workspace_id: workspace.id,
      title,
      description,
      // ⚠️ só deixe esta linha se a coluna prize EXISTIR no banco
      prize,
      slug,
      price_cents,
      total_numbers,
      reserve_minutes,
      status: "active",
    })
    .select("id")
    .single();

  if (rErr || !raffle?.id) {
    throw new Error(rErr?.message ?? "Falha ao criar rifa");
  }

  const raffleId = raffle.id as string;

  // cria números 1..N
  const rows = Array.from({ length: total_numbers }, (_, i) => ({
    raffle_id: raffleId,
    number: i + 1,
    status: "free",
    locked_until: null,
    buyer_name: null,
    buyer_phone: null,
    confirmed_at: null,
  }));

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    const { error: nErr } = await sb.from("raffle_numbers").insert(chunk);
    if (nErr) throw new Error(nErr.message);
  }

  revalidatePath("/app/raffles");
  redirect(`/app/raffles/${raffleId}`);
}