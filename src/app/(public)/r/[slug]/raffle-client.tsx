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

function formatCountdown24h(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
}

function msLeft(lockedUntil: string | null) {
  if (!lockedUntil) return 0;
  const t = new Date(lockedUntil).getTime() - Date.now();
  return Math.max(0, t);
}

function extractPixKey(instructions: string | null | undefined): string {
  if (!instructions) return "financeiro@dahoramotoseletricas.com.br";
  const match = instructions.match(/(?:chave pix|pix)[:\s]+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{11}|\d{14}|\+[0-9]{12,13})/i);
  if (match && match[1]) return match[1].replace(/[.,;:)]$/, "");
  return "financeiro@dahoramotoseletricas.com.br";
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
  const [mounted, setMounted] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setMounted(true);
    const id = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(id);
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

  // Filtra ESTRITAMENTE os números livres
  const freeNumbers = useMemo(() => {
    return liveNumbers.filter((n) => n.status === "free");
  }, [liveNumbers]);

  const availableSet = useMemo(() => {
    return new Set(freeNumbers.map((n) => n.number));
  }, [freeNumbers]);

  // Se algum selecionado deixar de estar livre, desmarca automaticamente
  useEffect(() => {
    setSelected((prev) => prev.filter((n) => availableSet.has(n)));
  }, [availableSet]);

  const total = raffle.priceCents * selected.length;

  const filteredNumbers = useMemo(() => {
    const q = search.trim();
    if (!q) return freeNumbers;
    if (q.match(/^\d+$/)) {
      const qNum = Number(q);
      return freeNumbers.filter((n) => n.number === qNum);
    }
    return freeNumbers;
  }, [freeNumbers, search]);

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

  const pixKey = useMemo(() => {
    return extractPixKey(payInfo || raffle.paymentInstructions);
  }, [payInfo, raffle.paymentInstructions]);

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(pixKey);
      setPixCopied(true);
      setTimeout(() => setPixCopied(false), 3000);
    } catch {
      // fallback manual
    }
  }

  async function reservar() {
    setMsg(null);
    if (!buyerName.trim() || buyerName.trim().length < 2) {
      return setMsg("Por favor, digite seu nome completo (mínimo 2 letras).");
    }
    const cleanPhone = buyerPhone.replace(/\D/g, "");
    if (!cleanPhone || cleanPhone.length < 10) {
      return setMsg("Por favor, digite seu WhatsApp com DDD (mínimo 10 dígitos).");
    }
    if (!selected.length) {
      return setMsg("Por favor, escolha pelo menos 1 número da sorte.");
    }

    setLoading(true);
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: raffle.slug,
          name: buyerName.trim(),
          phone: cleanPhone,
          numbers: selected,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        return setMsg(json?.message ?? "Falha ao reservar seus números.");
      }

      setOrder({
        id: json.order?.id,
        public_token: json.order.public_token,
        expires_at: json.order.expires_at,
        total_cents: json.order.total_cents,
        numbers: json.order?.numbers ?? [...selected],
      });

      if (json.payment_instructions) {
        setPayInfo(json.payment_instructions);
      }

      setSelected([]);
      await refreshNumbers();
      setMsg(null);
    } catch (e: any) {
      setMsg(e?.message ?? "Erro de conexão ao realizar reserva.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500 selection:text-white">
      {/* Barra superior de identificação */}
      <div className="border-b border-zinc-800/80 bg-zinc-900/50 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="font-bold text-sm sm:text-base tracking-tight text-white">
              Dahora Motos Elétricas
            </span>
          </div>

          <a
            href="https://dahoramotoseletricas.com.br"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-emerald-400 hover:text-emerald-300 transition flex items-center gap-1 font-medium bg-emerald-950/40 border border-emerald-800/50 px-3 py-1.5 rounded-full"
          >
            <span>dahoramotoseletricas.com.br</span>
            <span>↗</span>
          </a>
        </div>
      </div>

      <main className="max-w-5xl mx-auto p-4 sm:p-6 space-y-6">
        {/* Cabeçalho da Campanha */}
        <header className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 sm:p-6 space-y-3 shadow-lg shadow-black/40">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2.5 py-1 rounded-full border border-emerald-800/50 bg-emerald-950/40 text-emerald-300 font-semibold">
              ⚡ Reserva Válida por 24 Horas
            </span>
            <span className="px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-300">
              Pagamento via Pix Manual
            </span>
            <span className="px-2.5 py-1 rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-400">
              {freeNumbers.length} números disponíveis
            </span>
          </div>

          <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-white">
            {raffle.title}
          </h1>

          {raffle.description && (
            <p className="text-zinc-300 text-sm sm:text-base leading-relaxed max-w-3xl">
              {raffle.description}
            </p>
          )}

          <div className="pt-2 flex flex-wrap items-center gap-4 text-xs sm:text-sm text-zinc-400 border-t border-zinc-800/60">
            <div>
              Valor da Cota:{" "}
              <b className="text-emerald-400 text-lg sm:text-xl font-bold ml-1">
                {formatBRL(raffle.priceCents)}
              </b>
            </div>
            <div>•</div>
            <div>
              Total da Rifa: <span className="text-zinc-200 font-medium">{raffle.totalNumbers} números (001 a {raffle.totalNumbers})</span>
            </div>
          </div>
        </header>

        {/* Modal / Card de Reserva Concluída com Sucesso */}
        {order && (
          <div className="rounded-2xl border-2 border-emerald-500/60 bg-emerald-950/50 p-5 sm:p-6 space-y-4 shadow-xl shadow-emerald-950/30">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-800/40 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🎉</span>
                <span className="text-lg sm:text-xl font-bold text-white">
                  Reserva Realizada com Sucesso!
                </span>
              </div>
              <span className="text-xs bg-emerald-900/80 px-3 py-1 rounded-full text-emerald-200 font-mono font-semibold self-start sm:self-auto">
                Pedido: #{order.public_token.slice(0, 8)}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-zinc-950/60 p-3 border border-emerald-900/30">
                <div className="text-xs text-zinc-400">Seus Números da Sorte:</div>
                <div className="font-bold text-emerald-300 text-base mt-0.5">
                  {(order.numbers ?? []).map((n) => padNumber(n, raffle.totalNumbers)).join(", ") || "—"}
                </div>
              </div>

              <div className="rounded-xl bg-zinc-950/60 p-3 border border-emerald-900/30">
                <div className="text-xs text-zinc-400">Total a Pagar:</div>
                <div className="font-bold text-emerald-300 text-base mt-0.5">
                  {formatBRL(order.total_cents)}
                </div>
              </div>
            </div>

            {mounted && (
              <div className="flex items-center justify-between rounded-xl border border-amber-500/40 bg-amber-950/40 px-4 py-2.5 text-xs sm:text-sm">
                <span className="text-amber-200 font-medium">Prazo de Validade da Reserva:</span>
                <span className="font-mono font-bold text-amber-300 text-sm sm:text-base">
                  {formatCountdown24h(msLeft(order.expires_at))}
                </span>
              </div>
            )}

            {/* Chave Pix no Card de Sucesso */}
            <div className="rounded-xl bg-zinc-950/70 p-4 border border-zinc-800 space-y-3">
              <div className="text-xs font-semibold text-zinc-300">
                Pague via Pix para garantir suas cotas:
              </div>
              <div className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2 text-sm">
                <span className="font-mono text-emerald-400 font-semibold break-all text-xs sm:text-sm">
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

            {/* Botão de Envio de Comprovante no WhatsApp */}
            <a
              href={`https://api.whatsapp.com/send?text=${encodeURIComponent(
                `Olá, Dahora Motos Elétricas! Acabei de reservar as cotas [${(order.numbers ?? []).map((n) => padNumber(n, raffle.totalNumbers)).join(", ")}] na rifa "${raffle.title}" no valor total de ${formatBRL(order.total_cents)} (Pedido #${order.public_token.slice(0, 8)}). Segue o comprovante de pagamento!`
              )}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3.5 text-center text-sm font-bold text-white hover:bg-emerald-500 transition shadow-lg shadow-emerald-950/50"
            >
              <span>📱 Enviar Comprovante no WhatsApp</span>
            </a>
          </div>
        )}

        {/* Bloco de Reserva e Chave Pix (Visual Limpo e Objetivo) */}
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
                    Limpar
                  </button>
                )}
              </div>

              {selected.length === 0 ? (
                <div className="text-xs text-zinc-500 py-1 italic">
                  Toque nos números livres da grade abaixo para selecionar suas cotas.
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
                Após clicar em <b>Reservar</b>, faça o Pix no valor total e envie o comprovante para confirmação imediata da sua cota.
              </p>

              <div className="rounded-xl bg-zinc-950/70 border border-zinc-800 p-3.5 space-y-2">
                <div className="text-[11px] font-semibold text-zinc-400">
                  Chave Pix Oficial da Loja:
                </div>
                <div className="flex items-center justify-between gap-2 bg-zinc-900 border border-zinc-700/80 rounded-xl px-3 py-2">
                  <span className="font-mono text-emerald-400 font-bold text-xs sm:text-sm truncate">
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

            <div className="rounded-xl bg-emerald-950/30 border border-emerald-900/40 p-3.5 text-xs text-emerald-200/90 leading-relaxed space-y-1.5">
              <div className="font-bold text-emerald-300">Como funciona a reserva?</div>
              <div>• A sua reserva fica garantida por <b>24 horas</b>.</div>
              <div>• Suas cotas saem imediatamente da grade pública.</div>
              <div>• Confirmação 100% manual com envio do comprovante.</div>
            </div>
          </div>
        </section>

        {/* Grade de Números Livres */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 sm:p-6 space-y-4 shadow-lg shadow-black/30">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
            <div>
              <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
                <span>🎯</span>
                <span>Escolha seus Números da Sorte</span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Mostrando <b>apenas números 100% livres e disponíveis</b> ({freeNumbers.length} disponíveis).
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
              placeholder="🔍 Buscar número disponível..."
              className="w-full rounded-xl border border-zinc-700/80 bg-zinc-950/60 px-3.5 py-2 text-xs outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 text-zinc-100 placeholder:text-zinc-500 transition"
            />
          </div>

          {/* Grade de Botões dos Números */}
          {filteredNumbers.length === 0 ? (
            <div className="py-12 text-center text-zinc-500 text-sm">
              Nenhum número livre encontrado para a busca "{search}".
            </div>
          ) : (
            <div className="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-12 lg:grid-cols-15 gap-2 max-h-[500px] overflow-y-auto p-1 rounded-xl border border-zinc-800/60 bg-zinc-950/40">
              {filteredNumbers.map((n) => {
                const isSelected = selected.includes(n.number);

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
          </div>
        </footer>
      </main>
    </div>
  );
}
