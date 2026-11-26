"use client";

import { useEffect, useMemo, useState } from "react";

type Raffle = {
  title: string;
  description: string | null;
  slug: string;
  priceCents: number;
  totalNumbers: number;
  reserveMinutes: number;
  paymentInstructions?: string | null;
  prizeTitle?: string | null;
  prizeDescription?: string | null;
};

type RaffleNumber = {
  number: number;
  status: "free" | "reserved" | "paid" | "cancelled" | "expired";
  locked_until: string | null;
  buyer_name: string | null;
};

function formatBRL(cents: number) {
  return (Number(cents ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function padNumber(n: number, total: number = 500) {
  if (total >= 1000) return String(n).padStart(4, "0");
  if (total >= 100) return String(n).padStart(3, "0");
  return String(n).padStart(2, "0");
}

function extractPixKey(instructions: string | null | undefined): string {
  if (!instructions) return "14998877886";
  const match = instructions.match(/(?:chave pix|pix)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{10,14}|\+[0-9]{12,13})/i);
  if (match && match[1]) return match[1].replace(/[.,;:)]$/, "");
  return "14998877886";
}

export default function RaffleClient({
  raffle,
  numbers,
}: {
  raffle: Raffle;
  numbers: RaffleNumber[];
}) {
  const [liveNumbers, setLiveNumbers] = useState<RaffleNumber[]>(numbers);
  const [selected, setSelected] = useState<number[]>([]);
  const [buyerName, setBuyerName] = useState("");
  const [buyerPhone, setBuyerPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pixCopied, setPixCopied] = useState(false);

  const [order, setOrder] = useState<null | {
    id?: string;
    public_token: string;
    expires_at: string;
    total_cents: number;
    numbers?: number[];
  }>(null);

  const [payInfo, setPayInfo] = useState<string | null>(
    raffle.paymentInstructions ?? null
  );

  const [search, setSearch] = useState("");
  const [searchBuyer, setSearchBuyer] = useState("");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  async function refreshNumbers() {
    try {
      const res = await fetch(`/api/raffles/${raffle.slug}/numbers`, {
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      if (json?.ok && Array.isArray(json.numbers)) {
        setLiveNumbers(json.numbers);
      }
    } catch {
      // silencioso
    }
  }

  // Auto-refresh a cada 5 segundos
  useEffect(() => {
    const id = setInterval(() => refreshNumbers(), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raffle.slug]);

  // Separação dos números por status
  const freeNumbers = useMemo(() => {
    return liveNumbers.filter((n) => n.status === "free");
  }, [liveNumbers]);

  const reservedNumbers = useMemo(() => {
    return liveNumbers.filter((n) => n.status === "reserved");
  }, [liveNumbers]);

  const paidNumbers = useMemo(() => {
    return liveNumbers
      .filter((n) => n.status === "paid")
      .sort((a, b) => a.number - b.number);
  }, [liveNumbers]);

  // Grade de compra: mostra Livres + Reservados (os PAGOS saem da grade de compra!)
  const gridNumbers = useMemo(() => {
    return liveNumbers
      .filter((n) => n.status === "free" || n.status === "reserved")
      .sort((a, b) => a.number - b.number);
  }, [liveNumbers]);

  const availableSet = useMemo(() => {
    return new Set(freeNumbers.map((n) => n.number));
  }, [freeNumbers]);

  // Se algum selecionado deixar de estar livre, desmarca automaticamente
  useEffect(() => {
    setSelected((prev) => prev.filter((n) => availableSet.has(n)));
  }, [availableSet]);

  const total = raffle.priceCents * selected.length;

  const filteredGridNumbers = useMemo(() => {
    const q = search.trim();
    if (!q) return gridNumbers;
    if (q.match(/^\d+$/)) {
      const qNum = Number(q);
      return gridNumbers.filter((n) => n.number === qNum);
    }
    return gridNumbers;
  }, [gridNumbers, search]);

  const filteredPaidNumbers = useMemo(() => {
    const q = searchBuyer.trim().toLowerCase();
    if (!q) return paidNumbers;
    return paidNumbers.filter((n) => {
      const matchesNum = String(n.number).includes(q) || padNumber(n.number, raffle.totalNumbers).includes(q);
      const matchesName = (n.buyer_name ?? "").toLowerCase().includes(q);
      return matchesNum || matchesName;
    });
  }, [paidNumbers, searchBuyer, raffle.totalNumbers]);

  function toggleNumber(n: number) {
    if (!availableSet.has(n)) return;
    setSelected((prev) =>
      prev.includes(n)
        ? prev.filter((x) => x !== n)
        : [...prev, n].sort((a, b) => a - b)
    );
  }

  function pickRandom(count: number) {
    const unselected = freeNumbers
      .map((n) => n.number)
      .filter((n) => !selected.includes(n));

    if (!unselected.length) return;

    // Embaralha
    const shuffled = [...unselected].sort(() => 0.5 - Math.random());
    const picked = shuffled.slice(0, count);

    setSelected((prev) => [...prev, ...picked].sort((a, b) => a - b));
  }

  const pixKey = "14998877886";

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(pixKey);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 3000);
    } catch {
      // fallback
    }
  }

  async function reservar() {
    setMsg(null);

    const cleanName = buyerName.trim();
    const cleanPhone = buyerPhone.replace(/\D/g, "");

    if (!cleanName || cleanName.length < 2) {
      setMsg("Por favor, informe seu nome completo.");
      return;
    }
    if (!cleanPhone || cleanPhone.length < 10) {
      setMsg("Por favor, informe um WhatsApp válido com DDD (mínimo 10 dígitos).");
      return;
    }
    if (selected.length === 0) {
      setMsg("Selecione pelo menos um número da sorte.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: raffle.slug,
          name: cleanName,
          phone: cleanPhone,
          numbers: selected,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setMsg(json?.message ?? "Falha ao reservar seus números. Tente novamente.");
        await refreshNumbers();
        return;
      }

      setOrder({
        id: json.order_id,
        public_token: json.public_token,
        expires_at: json.expires_at,
        total_cents: json.total_cents,
        numbers: json.numbers ?? selected,
      });

      if (json.payment_instructions) {
        setPayInfo(json.payment_instructions);
      }

      setSelected([]);
      await refreshNumbers();

      // Scroll suave até o topo para ver o card de confirmação
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setMsg("Erro de conexão ao processar reserva.");
    } finally {
      setLoading(false);
    }
  }

  const pctSold = raffle.totalNumbers > 0 ? Math.round((paidNumbers.length / raffle.totalNumbers) * 100) : 0;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased selection:bg-emerald-500 selection:text-black">
      {/* Top Header com Branding da Loja */}
      <header className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/85 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">⚡</span>
            <div>
              <div className="text-xs uppercase tracking-widest text-emerald-400 font-extrabold">
                Campanha Oficial
              </div>
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">
                Dahora Motos Elétricas
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <a
              href="https://dahoramotoseletricas.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-semibold hover:bg-emerald-500/20 transition"
            >
              <span>🌐 dahoramotoseletricas.com.br</span>
            </a>
            <a
              href="https://api.whatsapp.com/send?phone=5514998877886&text=Ol%C3%A1!%20Gostaria%20de%20informa%C3%A7%C3%B5es%20sobre%20a%20Rifa%20da%20Scooter%20El%C3%A9trica!"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-600 text-white font-semibold hover:bg-emerald-500 transition shadow-sm"
            >
              <span>WhatsApp: (14) 99887-7886</span>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        {/* Banner do Prêmio — Moto Elétrica R20 PRIME */}
        <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 p-6 sm:p-8 shadow-xl">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">\n            <div className="w-full md:w-[42%] shrink-0 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">\n              <img src="https://static.wixstatic.com/media/acc37b_79f5e928245e4f8498b6ece85c2d8d2b~mv2.jpeg" alt="Moto elétrica R20 PRIME" className="w-full h-auto max-h-[360px] object-contain" fetchPriority="high" />\n            </div>
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                <span>🛵 PRÊMIO PRINCIPAL</span>
                <span>•</span>
                <span>0KM NOVINHA</span>
              </div>

              <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                Moto Elétrica R20 PRIME
              </h2>

              <p className="text-sm text-zinc-300 max-w-2xl leading-relaxed">
                Concorra a uma <b>Moto Elétrica R20 PRIME</b> com motor de 1000W, autonomia de até 50 km e bateria removível, fornecida e garantida pela <b>Dahora Motos Elétricas</b>. Escolha seus números da sorte de 001 a 500!
              </p>
            </div>

            <div className="shrink-0 flex flex-col items-start md:items-end justify-center rounded-xl bg-zinc-950/80 border border-zinc-800/90 p-4 sm:p-5 min-w-[200px]">
              <div className="text-xs text-zinc-400 font-medium">Valor por Cota</div>
              <div className="text-3xl font-extrabold text-emerald-400">
                {formatBRL(raffle.priceCents)}
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                Apenas 500 cotas disponíveis!
              </div>
            </div>
          </div>

          {/* Barra de Progresso da Rifa */}
          <div className="mt-6 pt-4 border-t border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">
                Progresso das Vendas: <b className="text-white">{paidNumbers.length} cotas confirmadas</b> ({pctSold}%)
              </span>
              <span className="text-emerald-400 font-bold">
                {freeNumbers.length} cotas livres
              </span>
            </div>
            <div className="w-full bg-zinc-950 rounded-full h-2.5 overflow-hidden border border-zinc-800">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-2.5 rounded-full transition-all duration-500"
                style={{ width: `${Math.max(2, pctSold)}%` }}
              />
            </div>
          </div>
        </section>

        {/* Modal / Card de Confirmação de Reserva Gerada */}
        {order && (
          <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-950/40 p-6 space-y-4 shadow-2xl backdrop-blur-md animate-in fade-in duration-300">
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="inline-block text-2xl mb-1">🎉</span>
                <h3 className="text-xl font-bold text-white">
                  Reserva Realizada com Sucesso!
                </h3>
                <p className="text-xs text-emerald-200 mt-0.5">
                  Suas cotas estão reservadas e garantidas por <b>24 horas</b>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrder(null)}
                className="text-zinc-400 hover:text-white text-xs px-2 py-1 rounded bg-zinc-900 border border-zinc-700"
              >
                ✕ Fechar
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-zinc-950/70 p-4 rounded-xl border border-zinc-800">
              <div>
                <span className="text-zinc-400 block">Número do Pedido:</span>
                <span className="font-mono font-bold text-white">#{order.public_token.slice(0, 8)}</span>
              </div>
              <div>
                <span className="text-zinc-400 block">Cotas Reservadas:</span>
                <span className="font-mono font-bold text-emerald-400 text-sm">
                  {(order.numbers ?? []).map((n) => padNumber(n, raffle.totalNumbers)).join(", ")}
                </span>
              </div>
              <div>
                <span className="text-zinc-400 block">Total a Pagar:</span>
                <span className="font-bold text-white text-sm">{formatBRL(order.total_cents)}</span>
              </div>
            </div>

            {/* Chave Pix e Cópia */}
            <div className="rounded-xl bg-zinc-950 border border-zinc-800 p-4 space-y-2">
              <div className="text-xs font-semibold text-zinc-300">
                Chave Pix (Telefone Celular):
              </div>
              <div className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2">
                <span className="font-mono text-emerald-400 font-bold text-sm select-all">
                  {pixKey}
                </span>
                <button
                  type="button"
                  onClick={copyPix}
                  className="shrink-0 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition"
                >
                  {pixCopied ? "✓ Copiado!" : "Copiar Chave"}
                </button>
              </div>
            </div>

            {/* Botão de Envio de Comprovante no WhatsApp com telefone pré-definido */}
            <a
              href={`https://api.whatsapp.com/send?phone=5514998877886&text=${encodeURIComponent(
                `Olá, Dahora Motos Elétricas! Acabei de reservar as cotas [${(order.numbers ?? []).map((n) => padNumber(n, raffle.totalNumbers)).join(", ")}] na rifa da Moto Elétrica R20 PRIME no valor de ${formatBRL(order.total_cents)} (Pedido #${order.public_token.slice(0, 8)}). Segue o meu comprovante de pagamento!`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-center text-sm font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/50"
            >
              <span>📱 Enviar Comprovante no WhatsApp: (14) 99887-7886</span>
            </a>
          </div>
        )}

        {/* Bloco de Reserva e Chave Pix */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Formulário de Reserva (7 colunas) */}
          <div className="lg:col-span-7 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <span>📝</span>
              <span>Preencha seus Dados para Reservar</span>
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-zinc-300">Nome Completo</label>
                <input
                  type="text"
                  className="mt-1 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Seu nome completo"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300">WhatsApp com DDD</label>
                <input
                  type="tel"
                  className="mt-1 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-2.5 text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="(14) 99999-9999"
                />
              </div>
            </div>

            {/* Cotas Selecionadas */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Cotas Selecionadas ({selected.length}):</span>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="text-rose-400 hover:text-rose-300 underline font-medium"
                  >
                    Limpar todas
                  </button>
                )}
              </div>

              {selected.length === 0 ? (
                <div className="text-xs text-zinc-500 py-1 italic">
                  Toque nos números verdes da grade abaixo para selecionar suas cotas da sorte.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {selected.map((n) => (
                    <span
                      key={n}
                      onClick={() => toggleNumber(n)}
                      className="cursor-pointer inline-flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/50 px-2 py-0.5 text-xs font-mono font-bold text-emerald-300 hover:bg-rose-950 hover:border-rose-700 hover:text-rose-300 transition"
                      title="Clique para remover"
                    >
                      {padNumber(n, raffle.totalNumbers)} ✕
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Total e Botão de Ação */}
            <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-zinc-800/80">
              <div>
                <div className="text-xs text-zinc-400">Total a pagar:</div>
                <div className="text-2xl font-extrabold text-emerald-400">
                  {formatBRL(total)}
                </div>
              </div>

              <button
                type="button"
                onClick={reservar}
                disabled={loading || selected.length === 0}
                className="rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3.5 text-sm font-bold text-zinc-950 transition shadow-lg shadow-emerald-950/40"
              >
                {loading
                  ? "Processando Reserva..."
                  : selected.length === 0
                  ? "Escolha seus números abaixo"
                  : `Reservar e Pagar (${formatBRL(total)})`}
              </button>
            </div>

            {msg && (
              <div className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-3 text-xs sm:text-sm text-rose-200">
                ⚠️ {msg}
              </div>
            )}
          </div>

          {/* Card de Informações Pix e Instruções (5 colunas) */}
          <div className="lg:col-span-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30 flex flex-col justify-between">
            <div className="space-y-3">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span>💰</span>
                <span>Pagamento via Pix</span>
              </h2>

              <p className="text-xs text-zinc-400 leading-relaxed">
                Após clicar em <b>Reservar</b>, faça a transferência Pix e envie o comprovante para nosso WhatsApp com o(s) número(s) escolhido(s).
              </p>

              <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 p-3.5 space-y-2">
                <div className="text-[11px] font-semibold text-zinc-400">
                  Chave Pix Oficial (Telefone Celular):
                </div>
                <div className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2">
                  <span className="font-mono text-emerald-400 font-bold text-sm select-all">
                    {pixKey}
                  </span>
                  <button
                    type="button"
                    onClick={copyPix}
                    className="shrink-0 px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition"
                  >
                    {pixCopied ? "✓ Copiado!" : "Copiar"}
                  </button>
                </div>
              </div>
            </div>

            {/* Legenda de Cores */}
            <div className="rounded-xl bg-zinc-950/60 border border-zinc-800/80 p-3.5 text-xs space-y-2">
              <div className="font-bold text-zinc-300">Entenda os Status das Cotas:</div>
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="h-3.5 w-3.5 rounded bg-zinc-900 border border-zinc-700 inline-block" />
                <span><b>Livre:</b> Disponível para você escolher e reservar.</span>
              </div>
              <div className="flex items-center gap-2 text-amber-300">
                <span className="h-3.5 w-3.5 rounded bg-amber-500/20 border border-amber-500/60 inline-block" />
                <span><b>Amarelo (Reservado):</b> Aguardando comprovante (bloqueado para novos pedidos).</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <span className="h-3.5 w-3.5 rounded bg-emerald-500 inline-block" />
                <span><b>Confirmado/Pago:</b> Sai da grade e vai para a lista pública abaixo!</span>
              </div>
            </div>
          </div>
        </section>

        {/* Grade de Escolha dos Números */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span>🎯</span>
                <span>Escolha suas Cotas da Sorte</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Números <b>livres</b> (clique para marcar) ou <b>amarelos</b> (reservados aguardando pagamento).
              </p>
            </div>

            {/* Ações Rápidas de Seleção */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-400 mr-1">Rápido:</span>
              <button
                type="button"
                onClick={() => pickRandom(1)}
                className="px-2.5 py-1 text-xs rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 font-medium transition"
              >
                +1 Aleatório
              </button>
              <button
                type="button"
                onClick={() => pickRandom(5)}
                className="px-2.5 py-1 text-xs rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 font-medium transition"
              >
                +5 Aleatórios
              </button>
              <button
                type="button"
                onClick={() => pickRandom(10)}
                className="px-2.5 py-1 text-xs rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 font-medium transition"
              >
                +10 Aleatórios
              </button>
            </div>
          </div>

          {/* Campo de Busca Rápida */}
          <div className="max-w-xs">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Buscar número na grade..."
              className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-100 placeholder:text-zinc-500 transition"
            />
          </div>

          {/* Grade de Botões dos Números */}
          {filteredGridNumbers.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-sm">
              Nenhum número disponível encontrado para a busca "{search}".
            </div>
          ) : (
            <div className="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-15 gap-2 max-h-[520px] overflow-y-auto p-1 rounded-xl border border-zinc-800/60 bg-zinc-950/40">
              {filteredGridNumbers.map((n) => {
                const isSelected = selected.includes(n.number);
                const isReserved = n.status === "reserved";

                if (isReserved) {
                  return (
                    <div
                      key={n.number}
                      className="h-11 rounded-xl font-mono text-xs font-bold flex flex-col items-center justify-center bg-amber-500/15 text-amber-300 border border-amber-500/50 cursor-not-allowed select-none opacity-90"
                      title={`Cota ${padNumber(n.number, raffle.totalNumbers)} reservada (aguardando confirmação)`}
                    >
                      <span>{padNumber(n.number, raffle.totalNumbers)}</span>
                      <span className="text-[8px] font-semibold tracking-tighter text-amber-400">
                        RESERVADO
                      </span>
                    </div>
                  );
                }

                return (
                  <button
                    key={n.number}
                    type="button"
                    onClick={() => toggleNumber(n.number)}
                    className={`h-11 rounded-xl font-mono text-xs sm:text-sm font-bold flex flex-col items-center justify-center transition-all ${
                      isSelected
                        ? "bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30 scale-105 border-2 border-emerald-300 font-extrabold"
                        : "bg-zinc-900/90 text-zinc-200 hover:bg-zinc-800 hover:text-white border border-zinc-800/90 hover:border-zinc-700"
                    }`}
                  >
                    <span>{padNumber(n.number, raffle.totalNumbers)}</span>
                    {isSelected && (
                      <span className="text-[9px] -mt-0.5 leading-none font-bold">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Seção de Transparência: Lista de Compradores / Cotas Confirmadas */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span>🏆</span>
                <span>Lista de Participantes / Cotas Pagas</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Transparência total: compradores que já tiveram o pagamento confirmado pelo administrador.
              </p>
            </div>

            <div className="text-xs bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-full text-zinc-300 font-semibold">
              Total Confirmadas: <span className="text-emerald-400 font-bold">{paidNumbers.length}</span>
            </div>
          </div>

          {/* Campo de Busca nos Compradores */}
          {paidNumbers.length > 0 && (
            <div className="max-w-xs">
              <input
                type="text"
                value={searchBuyer}
                onChange={(e) => setSearchBuyer(e.target.value)}
                placeholder="🔍 Buscar comprador ou cota..."
                className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-100 placeholder:text-zinc-500 transition"
              />
            </div>
          )}

          {paidNumbers.length === 0 ? (
            <div className="py-8 text-center text-zinc-500 text-xs sm:text-sm italic">
              Nenhuma cota confirmada até o momento. Escolha seus números acima e seja o primeiro participante garantido!
            </div>
          ) : filteredPaidNumbers.length === 0 ? (
            <div className="py-6 text-center text-zinc-500 text-xs">
              Nenhum participante encontrado para a busca "{searchBuyer}".
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5 max-h-80 overflow-y-auto p-1">
              {filteredPaidNumbers.map((n) => (
                <div
                  key={n.number}
                  className="flex items-center gap-2.5 rounded-xl border border-zinc-800 bg-zinc-950/70 p-2.5"
                >
                  <span className="shrink-0 rounded-lg bg-emerald-500/20 border border-emerald-500/40 px-2 py-1 font-mono text-xs font-extrabold text-emerald-300">
                    {padNumber(n.number, raffle.totalNumbers)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-semibold text-zinc-200 truncate">
                      {n.buyer_name || "Participante"}
                    </div>
                    <div className="text-[10px] text-emerald-400/90 font-medium flex items-center gap-1">
                      <span>✓ Confirmado</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Rodapé Limpo */}
        <footer className="pt-4 pb-8 text-center text-xs text-zinc-500 space-y-1">
          <div>
            <b>Dahora Motos Elétricas</b> — Todos os direitos reservados.
          </div>
          <div>
            Acesse nossa loja online:{" "}
            <a
              href="https://dahoramotoseletricas.com.br"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              dahoramotoseletricas.com.br
            </a>
            {" • "}
            WhatsApp:{" "}
            <a
              href="https://api.whatsapp.com/send?phone=5514998877886"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:underline"
            >
              (14) 99887-7886
            </a>
          </div>
        </footer>
      </main>
    </div>
  );
}
