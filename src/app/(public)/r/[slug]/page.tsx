import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import RaffleClient from "./raffle-client";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type PageProps = {
  params: Promise<{ slug: string }>;
};

const DAHORA_SLUG = "dahora-motos-eletricas";
const DAHORA_URL = "https://rifa-es8i.onrender.com/r/dahora-motos-eletricas";
const R20_PRIME_IMAGE = "https://rifa-es8i.onrender.com/api/og/r20";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;

  // Esta primeira campanha é um teste interno. Somente ela recebe a identidade
  // pública da Dahora; as demais rotas continuam herdando os metadados globais.
  if (slug !== DAHORA_SLUG) return {};

  const title = "DAHORA MOTOS ELÉTRICAS | Concorra à Moto Elétrica R20 PRIME";
  const description =
    "Escolha seus números da sorte e concorra a uma Moto Elétrica R20 PRIME. São 500 números disponíveis por R$ 25,00 cada.";

  return {
    title,
    description,
    openGraph: {
      type: "website",
      locale: "pt_BR",
      url: DAHORA_URL,
      siteName: "DAHORA MOTOS ELÉTRICAS",
      title,
      description,
      images: [
        {
          url: R20_PRIME_IMAGE,
          width: 720,
          height: 875,
          alt: "Moto Elétrica R20 PRIME da Dahora Motos Elétricas",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [R20_PRIME_IMAGE],
    },
  };
}

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
