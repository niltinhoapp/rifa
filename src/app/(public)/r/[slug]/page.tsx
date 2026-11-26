import { supabaseServer } from "@/lib/supabase/server";
import RaffleClient from "./raffle-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function RifaPage({ params }: PageProps) {
  const { slug } = await params;

  const sb = await supabaseServer();

  const { data: raffle, error: raffleErr } = await sb
    .from("raffles")
    .select("id,title,description,price_cents,total_numbers,slug,status,reserve_minutes,payment_instructions,prize_title,prize_description")
    .eq("slug", slug)
    .single();

  if (raffleErr || !raffle) {
    return (
      <main className="max-w-3xl mx-auto p-6">
        <h1 className="text-xl font-bold">Rifa não encontrada</h1>
        <pre className="mt-3 text-xs whitespace-pre-wrap rounded-xl border p-3">
          slug: {slug}{"\n"}
          raffleErr: {raffleErr ? JSON.stringify(raffleErr, null, 2) : "null"}{"\n"}
          raffle: {raffle ? "FOUND" : "null"}
        </pre>
      </main>
    );
  }

  const { data: numbers } = await sb
    .from("raffle_numbers")
    .select("number,status,locked_until,buyer_name")
    .eq("raffle_id", raffle.id)
    .in("status", ["free", "reserved", "paid"])
    .order("number", { ascending: true });

  return (
    <RaffleClient
      raffle={{
        title: raffle.title,
        description: raffle.description,
        slug: raffle.slug,
        priceCents: raffle.price_cents,
        totalNumbers: raffle.total_numbers,
        reserveMinutes: raffle.reserve_minutes,
        paymentInstructions: raffle.payment_instructions,
        prizeTitle: raffle.prize_title,
        prizeDescription: raffle.prize_description,
      }}
      numbers={numbers ?? []}
    />
  );
}
