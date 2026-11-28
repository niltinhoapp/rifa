"use client";

import { useEffect, useMemo, useRef, useState } from "react";

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

function formatDeadline(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
  const [inputFocused, setInputFocused] = useState(false);
  const [unavailableNotice, setUnavailableNotice] = useState<number[]>([]);
  const cadastroRef = useRef<HTMLElement | null>(null);

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
  // (mesma regra de antes) e avisa o comprador. Durante o envio da própria
  // reserva (loading) não avisa, para não gerar alerta falso.
  useEffect(() => {
    const lost = selected.filter((n) => !availableSet.has(n));
    if (lost.length === 0) return;
    setSelected((prev) => prev.filter((n) => availableSet.has(n)));
    if (!loading) {
      setUnavailableNotice((prev) =>
        Array.from(new Set([...prev, ...lost])).sort((a, b) => a - b)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableSet]);

  const total = raffle.priceCents * selected.length;

  // Barra fixa (mobile): reaproveita a seleção e o total já existentes
  const barActive = selected.length > 0 && !order;
  const showBar = barActive && !inputFocused;
  const selectedLabel = selected.length === 1 ? "número" : "números";

  // Dados dinâmicos da rifa (vindos do banco via page.tsx)
  const prizeName = raffle.prizeTitle?.trim() || raffle.title;
  const prizeText = raffle.prizeDescription?.trim() || raffle.description?.trim() || "";
  const lastNumberLabel = padNumber(raffle.totalNumbers, raffle.totalNumbers);
  const deadlineLabel = order ? formatDeadline(order.expires_at) : null;

  function goToCadastro() {
    cadastroRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
      setUnavailableNotice([]);
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

      <main
        className={`max-w-6xl mx-auto px-4 py-6 sm:py-8 space-y-6 ${barActive ? "pb-32 sm:pb-8" : ""}`}
        onFocus={(e) => {
          if ((e.target as HTMLElement).tagName === "INPUT") setInputFocused(true);
        }}
        onBlur={(e) => {
          const next = e.relatedTarget as HTMLElement | null;
          if (!next || next.tagName !== "INPUT") setInputFocused(false);
        }}
      >
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
                  Seus números estão reservados{deadlineLabel ? (<> até <b>{deadlineLabel}</b></>) : null}. Pague e envie o comprovante dentro do prazo.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOrder(null)}
                className="text-zinc-400 hover:text-white text-xs min-h-[44px] sm:min-h-0 px-3 sm:px-2 py-1 rounded bg-zinc-900 border border-zinc-700"
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
                <span className="text-zinc-400 block">Números reservados:</span>
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
                  className="shrink-0 min-h-[44px] sm:min-h-0 px-4 py-2 sm:px-3 sm:py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-sm sm:text-xs transition"
                >
                  {pixCopied ? "✓ Copiado!" : "Copiar Chave"}
                </button>
              </div>
            </div>

            {/* Botão de Envio de Comprovante no WhatsApp com telefone pré-definido */}
            <a
              href={`https://api.whatsapp.com/send?phone=5514998877886&text=${encodeURIComponent(
                `Olá, Dahora Motos Elétricas! Acabei de reservar os números [${(order.numbers ?? []).map((n) => padNumber(n, raffle.totalNumbers)).join(", ")}] na rifa "${prizeName}" no valor de ${formatBRL(order.total_cents)} (Pedido #${order.public_token.slice(0, 8)}). Vou enviar o comprovante de pagamento a seguir.`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-center text-sm font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/50"
            >
              <span>📱 Enviar Comprovante no WhatsApp: (14) 99887-7886</span>
            </a>
            <p className="text-xs text-zinc-400 text-center">
              No WhatsApp, anexe o comprovante do Pix na conversa.
            </p>
          </div>
        )}

        {/* Resumo da campanha: prêmio, preço e disponibilidade antes da grade */}
        <section
          aria-label="Resumo da campanha"
          className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 shadow-lg shadow-black/30"
        >
          <img
            src="/imagens/R-20.jpeg"
            alt={prizeName}
            width={112}
            height={80}
            fetchPriority="high"
            className="h-16 w-20 sm:h-20 sm:w-28 shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 object-cover"
          />
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="text-xs font-bold uppercase tracking-wide text-emerald-300">
              Prêmio
            </div>
            <div className="text-base sm:text-lg font-extrabold text-white leading-tight">
              {prizeName}
            </div>
            <div className="text-sm text-zinc-300">
              <b className="text-emerald-400">{formatBRL(raffle.priceCents)}</b> por número
              {" • "}
              <b className="text-white">{freeNumbers.length}</b> de {raffle.totalNumbers}{" "}
              números disponíveis
            </div>
          </div>
        </section>

        {/* Etapa 1: escolha dos números */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span aria-hidden="true">🎯</span>
                <span>Escolha seus números</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Toque nos números disponíveis para marcar.
              </p>
            </div>

            {/* Ações Rápidas de Seleção */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-full sm:w-auto text-xs text-zinc-300 sm:mr-1">Adicionar aleatórios:</span>
              {[1, 5, 10].map((qty) => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => pickRandom(qty)}
                  aria-label={`Adicionar ${qty} ${qty === 1 ? "número aleatório" : "números aleatórios"}`}
                  className="min-h-[44px] sm:min-h-0 min-w-[56px] px-4 py-2 sm:min-w-0 sm:px-2.5 sm:py-1 text-base sm:text-xs rounded-lg border border-zinc-700 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300"
                >
                  +{qty}
                </button>
              ))}
            </div>
          </div>

          {/* Legenda de disponibilidade, junto da grade */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-zinc-300">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border border-zinc-700 bg-zinc-900 inline-block" aria-hidden="true" />
                Disponível
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded border border-amber-500/60 bg-amber-500/20 inline-block" aria-hidden="true" />
                Reservado (aguardando pagamento)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-3.5 w-3.5 rounded bg-emerald-500 inline-block" aria-hidden="true" />
                Selecionado
              </span>
            </div>
            <p className="text-xs text-zinc-400">
              Números confirmados saem da grade e aparecem na lista de participantes.
            </p>
          </div>

          {/* Campo de Busca Rápida */}
          <div className="max-w-xs">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              enterKeyHint="search"
              autoComplete="off"
              aria-label="Buscar número na grade"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍 Buscar número na grade..."
              className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-3 sm:py-2 text-base sm:text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-100 placeholder:text-zinc-400 transition"
            />
          </div>

          {/* Grade de Botões dos Números */}
          {filteredGridNumbers.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">
              Nenhum número disponível encontrado para a busca "{search}".
            </div>
          ) : (
            <div
              role="group"
              aria-label="Grade de números"
              className="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12 gap-2 sm:max-h-[520px] sm:overflow-y-auto p-1 rounded-xl border border-zinc-800/60 bg-zinc-950/40"
            >
              {filteredGridNumbers.map((n) => {
                const isSelected = selected.includes(n.number);
                const isReserved = n.status === "reserved";
                const label = padNumber(n.number, raffle.totalNumbers);

                if (isReserved) {
                  return (
                    <div
                      key={n.number}
                      role="img"
                      aria-label={`Número ${label} reservado, aguardando confirmação`}
                      className="h-12 sm:h-11 overflow-hidden rounded-xl font-mono text-sm font-bold flex flex-col items-center justify-center gap-0.5 bg-amber-500/15 text-amber-300 border border-amber-500/50 cursor-not-allowed select-none opacity-90"
                      title={`Número ${label} reservado (aguardando confirmação)`}
                    >
                      <span>{label}</span>
                      <span className="text-[9px] sm:text-[10px] font-semibold leading-none tracking-tighter text-amber-300">
                        Reservado
                      </span>
                    </div>
                  );
                }

                return (
                  <button
                    key={n.number}
                    type="button"
                    aria-pressed={isSelected}
                    aria-label={`Número ${label}`}
                    onClick={() => toggleNumber(n.number)}
                    className={`h-12 sm:h-11 rounded-xl font-mono text-sm font-bold flex flex-col items-center justify-center transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-300 ${
                      isSelected
                        ? "bg-emerald-500 text-zinc-950 shadow-md shadow-emerald-500/30 scale-105 border-2 border-emerald-300 font-extrabold"
                        : "bg-zinc-900/90 text-zinc-200 hover:bg-zinc-800 hover:text-white border border-zinc-800/90 hover:border-zinc-700"
                    }`}
                  >
                    <span>{label}</span>
                    {isSelected && (
                      <span aria-hidden="true" className="text-[10px] -mt-0.5 leading-none font-bold">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Etapa 2: cadastro e confirmação da reserva */}
        <section
          ref={cadastroRef}
          id="cadastro"
          className="scroll-mt-20 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30"
        >
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <span aria-hidden="true">📝</span>
                <span>Preencha seus dados para reservar</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Seu WhatsApp fica registrado na reserva para identificar seu pedido e para contato sobre ele. O comprovante do Pix você envia depois, pelo WhatsApp da campanha.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="buyer-name" className="text-sm sm:text-xs font-medium text-zinc-300">
                  Nome completo
                </label>
                <input
                  id="buyer-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  className="mt-1 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-3 sm:py-2.5 text-base sm:text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 placeholder:text-zinc-400 transition"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Seu nome completo"
                />
              </div>

              <div>
                <label htmlFor="buyer-phone" className="text-sm sm:text-xs font-medium text-zinc-300">
                  WhatsApp com DDD
                </label>
                <input
                  id="buyer-phone"
                  name="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  className="mt-1 w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-3 sm:py-2.5 text-base sm:text-sm outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 placeholder:text-zinc-400 transition"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="(14) 99999-9999"
                />
              </div>
            </div>

            {/* Números selecionados */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between text-sm sm:text-xs text-zinc-300">
                <span>Números selecionados ({selected.length}):</span>
                {selected.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected([])}
                    className="min-h-[44px] sm:min-h-0 px-2 text-rose-300 hover:text-rose-200 underline font-medium"
                  >
                    Limpar todos
                  </button>
                )}
              </div>

              {selected.length === 0 ? (
                <div className="text-sm sm:text-xs text-zinc-400 py-1 italic">
                  Toque nos números da grade acima para selecioná-los.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                  {selected.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => toggleNumber(n)}
                      aria-label={`Remover número ${padNumber(n, raffle.totalNumbers)}`}
                      title="Toque para remover"
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 border border-emerald-500/50 px-2.5 py-1.5 sm:px-2 sm:py-0.5 text-sm sm:text-xs font-mono font-bold text-emerald-300 hover:bg-rose-950 hover:border-rose-700 hover:text-rose-300 transition"
                    >
                      {padNumber(n, raffle.totalNumbers)} <span aria-hidden="true">✕</span>
                    </button>
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
                className="min-h-[48px] rounded-xl bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed px-6 py-3.5 text-sm font-bold text-zinc-950 transition shadow-lg shadow-emerald-950/40"
              >
                {loading
                  ? "Processando reserva..."
                  : selected.length === 0
                  ? "Selecione números na grade acima"
                  : `Reservar ${selected.length} ${selectedLabel} — ${formatBRL(total)}`}
              </button>
            </div>

            {msg && (
              <div
                role="alert"
                className="rounded-xl border border-rose-900/50 bg-rose-950/40 p-3 text-xs sm:text-sm text-rose-200"
              >
                ⚠️ {msg}
              </div>
            )}
          </div>
        </section>

        {/* Etapa 3: como funciona o pagamento (a chave Pix só aparece após a reserva) */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-3 shadow-lg shadow-black/30">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <span aria-hidden="true">💰</span>
            <span>Pagamento via Pix</span>
          </h2>
          <ol className="list-decimal list-inside space-y-2 text-sm sm:text-xs text-zinc-300 leading-relaxed">
            <li>Escolha seus números na grade.</li>
            <li>
              Preencha seus dados e toque em <b>Reservar</b>.
            </li>
            <li>
              Depois da reserva, mostramos a chave Pix e o prazo para pagamento. Pague e envie o comprovante pelo WhatsApp.
            </li>
          </ol>
        </section>

        {/* Banner do Prêmio */}
        <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-zinc-900 via-zinc-900/90 to-zinc-950 p-6 sm:p-8 shadow-xl">
          <div className="absolute top-0 right-0 -mt-10 -mr-10 h-48 w-48 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
            <div className="w-full md:w-[42%] shrink-0 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950">
              <img src="/imagens/R-20.jpeg" alt={prizeName} className="w-full h-auto max-h-[360px] object-contain" loading="lazy" />
            </div>
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-bold text-emerald-300">
                <span>🛵 PRÊMIO PRINCIPAL</span>
                <span>•</span>
                <span>0KM NOVINHA</span>
              </div>

              <h2 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight">
                {prizeName}
              </h2>

              <p className="text-sm text-zinc-300 max-w-2xl leading-relaxed whitespace-pre-line">
                {prizeText ? `${prizeText} ` : ""}
                Escolha seus números de 001 a {lastNumberLabel}.
              </p>
            </div>

            <div className="shrink-0 flex flex-col items-start md:items-end justify-center rounded-xl bg-zinc-950/80 border border-zinc-800/90 p-4 sm:p-5 min-w-[200px]">
              <div className="text-xs text-zinc-400 font-medium">Valor por número</div>
              <div className="text-3xl font-extrabold text-emerald-400">
                {formatBRL(raffle.priceCents)}
              </div>
              <div className="text-[11px] text-zinc-400 mt-1">
                Total de {raffle.totalNumbers} números
              </div>
            </div>
          </div>

          {/* Barra de Progresso da Rifa */}
          <div className="mt-6 pt-4 border-t border-zinc-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-400">
                Progresso das Vendas: <b className="text-white">{paidNumbers.length} números confirmados</b> ({pctSold}%)
              </span>
              <span className="text-emerald-400 font-bold">
                {freeNumbers.length} números disponíveis
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

        {/* Seção de Transparência: Lista de Compradores / Números Confirmados */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span>🏆</span>
                <span>Lista de participantes / Números confirmados</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Transparência total: compradores que já tiveram o pagamento confirmado pelo administrador.
              </p>
            </div>

            <div className="text-xs bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-full text-zinc-300 font-semibold">
              Total confirmados: <span className="text-emerald-400 font-bold">{paidNumbers.length}</span>
            </div>
          </div>

          {/* Campo de Busca nos Compradores */}
          {paidNumbers.length > 0 && (
            <div className="max-w-xs">
              <input
                type="text"
                aria-label="Buscar comprador ou número"
                value={searchBuyer}
                onChange={(e) => setSearchBuyer(e.target.value)}
                placeholder="🔍 Buscar comprador ou número..."
                className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-3 sm:py-2 text-base sm:text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-100 placeholder:text-zinc-400 transition"
              />
            </div>
          )}

          {paidNumbers.length === 0 ? (
            <div className="py-8 text-center text-zinc-400 text-xs sm:text-sm italic">
              Nenhum número confirmado até o momento. Escolha seus números acima e seja o primeiro participante garantido!
            </div>
          ) : filteredPaidNumbers.length === 0 ? (
            <div className="py-6 text-center text-zinc-400 text-xs">
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
                    <div className="text-[11px] text-emerald-400 font-medium flex items-center gap-1">
                      <span>✓ Confirmado</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Rodapé Limpo */}
        <footer className="pt-4 pb-8 text-center text-xs text-zinc-400 space-y-1">
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

      {/* Barra fixa inferior (somente mobile): usa a seleção e o total existentes */}
      {showBar && (
        <div
          role="region"
          aria-label="Resumo da seleção"
          className="fixed inset-x-0 bottom-0 z-40 sm:hidden border-t border-zinc-800 bg-zinc-950/95 backdrop-blur-md"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          <div className="mx-auto max-w-6xl flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0" aria-live="polite">
              <div className="text-xs text-zinc-300">
                {selected.length} {selected.length === 1 ? "número selecionado" : "números selecionados"}
              </div>
              <div className="text-lg font-extrabold text-emerald-400 leading-tight">
                {formatBRL(total)}
              </div>
            </div>
            <button
              type="button"
              onClick={goToCadastro}
              className="shrink-0 min-h-[48px] rounded-xl bg-emerald-500 active:bg-emerald-600 px-6 text-sm font-bold text-zinc-950 shadow-lg shadow-emerald-950/40"
            >
              Continuar
            </button>
          </div>
        </div>
      )}

      {/* Aviso: número selecionado deixou de estar disponível */}
      {unavailableNotice.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-4 top-16 z-50 mx-auto max-w-md rounded-xl border border-amber-500/60 bg-zinc-950/95 p-3 shadow-2xl backdrop-blur-md"
        >
          <p className="text-sm text-amber-200">
            {unavailableNotice.length === 1
              ? `O número ${padNumber(unavailableNotice[0], raffle.totalNumbers)} deixou de estar disponível e saiu da sua seleção.`
              : `Os números ${unavailableNotice
                  .map((n) => padNumber(n, raffle.totalNumbers))
                  .join(", ")} deixaram de estar disponíveis e saíram da sua seleção.`}{" "}
            Revise sua seleção antes de reservar.
          </p>
          <button
            type="button"
            onClick={() => setUnavailableNotice([])}
            className="mt-2 min-h-[44px] sm:min-h-0 rounded-lg border border-amber-500/50 px-4 py-2 sm:py-1 text-sm font-semibold text-amber-100 hover:bg-amber-500/10"
          >
            Entendi
          </button>
        </div>
      )}
    </div>
  );
}
