"use client";

import { useEffect, useMemo, useState } from "react";

type Raffle = {
  title: string;
  description: string | null;
  slug: string;
  priceCents: number;
  totalNumbers: number; // aqui será 100
  reserveMinutes: number;
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

// 01..100 fixo
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function maskName(name: string | null) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2) + "***";
  return `${parts[0]} ${parts[1]?.slice(0, 1) ?? ""}.`;
}

function msLeft(lockedUntil: string | null) {
  if (!lockedUntil) return 0;
  const t = new Date(lockedUntil).getTime() - Date.now();
  return Math.max(0, t);
}

function formatMMSS(ms: number) {
  const s = Math.floor(ms / 1000);
  const mm = Math.floor(s / 60);
  const ss = s % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
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

  const [order, setOrder] = useState<null | {
    public_token: string;
    expires_at: string;
    total_cents: number;
  }>(null);

  const [payInfo, setPayInfo] = useState<string | null>(null);

  // UI controls
  const [filter, setFilter] = useState<"all" | "free" | "reserved" | "paid">(
    "all"
  );
  const [search, setSearch] = useState("");

  // ✅ evita Hydration mismatch (SSR vs Client)
  const [mounted, setMounted] = useState(false);

  // tick para countdown (só importa no client)
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
      if (json?.ok) setLiveNumbers(json.numbers ?? []);
    } catch {
      // silencioso
    }
  }

  // auto refresh (5s)
  useEffect(() => {
    const id = setInterval(() => refreshNumbers(), 5000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raffle.slug]);

  const stats = useMemo(() => {
    let free = 0,
      reserved = 0,
      paid = 0,
      other = 0;

    for (const n of liveNumbers) {
      if (n.status === "free") free++;
      else if (n.status === "reserved") reserved++;
      else if (n.status === "paid") paid++;
      else other++;
    }

    return { free, reserved, paid, other, total: liveNumbers.length };
  }, [liveNumbers]);

  const freeSet = useMemo(() => {
    const s = new Set<number>();
    for (const n of liveNumbers) if (n.status === "free") s.add(n.number);
    return s;
  }, [liveNumbers]);

  const total = raffle.priceCents * selected.length;

  const filteredNumbers = useMemo(() => {
    const q = search.trim();
    let list = liveNumbers;

    if (filter !== "all") list = list.filter((n) => n.status === filter);

    if (q) {
      if (q.match(/^\d+$/)) {
        const qNum = Number(q);
        list = list.filter((n) => n.number === qNum);
      } else {
        const qLower = q.toLowerCase();
        list = list.filter((n) =>
          (n.buyer_name ?? "").toLowerCase().includes(qLower)
        );
      }
    }

    return list;
  }, [liveNumbers, filter, search]);

  function toggleNumber(n: number) {
    if (!freeSet.has(n)) return;
    setSelected((prev) =>
      prev.includes(n)
        ? prev.filter((x) => x !== n)
        : [...prev, n].sort((a, b) => a - b)
    );
  }

  async function reservar() {
    setMsg(null);
    setOrder(null);
    setPayInfo(null);

    if (selected.length === 0) return setMsg("Selecione pelo menos 1 número.");
    if (buyerName.trim().length < 2) return setMsg("Digite seu nome.");
    if (buyerPhone.trim().length < 8)
      return setMsg("Digite seu WhatsApp/telefone.");

    setLoading(true);
    try {
      const res = await fetch("/api/reserve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: raffle.slug, // ✅ campo certo
          name: buyerName, // ✅ campo certo
          phone: buyerPhone, // ✅ campo certo
          numbers: selected,
        }),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        return setMsg(json?.message ?? "Falha ao reservar.");
      }

      // ✅ resposta do seu /api/reserve (transacional)
      setOrder({
        public_token: json.order.public_token,
        expires_at: json.order.expires_at,
        total_cents: json.order.total_cents,
      });

      setPayInfo(json.payment_instructions ?? null);

      setSelected([]);
      await refreshNumbers();
      setMsg(null);
    } catch (e: any) {
      setMsg(e?.message ?? "Erro ao reservar.");
    } finally {
      setLoading(false);
    }
  }

  const selectedPreview = useMemo(() => {
    if (selected.length === 0) return "Nenhum";
    if (selected.length <= 10) return selected.map((n) => pad2(n)).join(", ");
    return `${selected
      .slice(0, 10)
      .map((n) => pad2(n))
      .join(", ")}… (+${selected.length - 10})`;
  }, [selected]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <main className="max-w-6xl mx-auto p-4 sm:p-6">
        {/* Header */}
        <header className="mb-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 text-xs text-zinc-300">
                <span className="px-2 py-1 rounded-full border border-zinc-800 bg-zinc-900/60">
                  Rifa online
                </span>
                <span className="px-2 py-1 rounded-full border border-zinc-800 bg-zinc-900/60">
                  Reserva {raffle.reserveMinutes} min
                </span>
                <button
                  onClick={refreshNumbers}
                  className="px-2 py-1 rounded-full border border-zinc-800 bg-zinc-900/60 hover:bg-white/10"
                  title="Atualizar agora"
                >
                  Atualizar
                </button>
              </div>

              <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
                {raffle.title}
              </h1>

              {raffle.description && (
                <p className="mt-2 text-zinc-300 max-w-2xl">
                  {raffle.description}
                </p>
              )}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="text-sm text-zinc-300">Preço por número</div>
              <div className="text-xl font-bold">
                {formatBRL(raffle.priceCents)}
              </div>
              <div className="mt-2 text-xs text-zinc-400">
                Selecionados:{" "}
                <span className="text-zinc-200">{selected.length}</span>
              </div>
              <div className="text-xs text-zinc-400">
                Total: <span className="text-zinc-200">{formatBRL(total)}</span>
              </div>
            </div>
          </div>
        </header>

        {/* Stats + legenda + checkout */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-300">Resumo</div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-zinc-400">Livres</div>
                <div className="text-lg font-bold">{stats.free}</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-zinc-400">Reservados</div>
                <div className="text-lg font-bold">{stats.reserved}</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-zinc-400">Pagos</div>
                <div className="text-lg font-bold">{stats.paid}</div>
              </div>
              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-zinc-400">Total</div>
                <div className="text-lg font-bold">{stats.total}</div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-300">Legenda</div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
                Livre
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                Reservado
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-400" />
                Pago
              </span>
              <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-950/40 px-3 py-1">
                <span className="h-2.5 w-2.5 rounded-full bg-white" />
                Selecionado
              </span>
            </div>

            <p className="mt-3 text-xs text-zinc-400">
              Passe o mouse em um número reservado/pago para ver detalhes
              (nome/tempo).
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-sm text-zinc-300">Reservar</div>

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <label className="text-xs text-zinc-400">Nome</label>
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                  value={buyerName}
                  onChange={(e) => setBuyerName(e.target.value)}
                  placeholder="Seu nome"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400">WhatsApp</label>
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                  value={buyerPhone}
                  onChange={(e) => setBuyerPhone(e.target.value)}
                  placeholder="(xx) 9xxxx-xxxx"
                />
              </div>

              <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
                <div className="text-xs text-zinc-400">Selecionados</div>
                <div className="mt-1 text-sm text-zinc-100">
                  {selectedPreview}
                </div>
              </div>

              <button
                onClick={reservar}
                disabled={loading}
                className="rounded-xl border border-zinc-700 bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-60"
              >
                {loading ? "Reservando..." : "Reservar e pagar"}
              </button>

              {msg && (
                <div className="rounded-xl border border-rose-900/40 bg-rose-950/30 p-3 text-sm text-rose-200">
                  {msg}
                </div>
              )}

              {order && (
                <div className="rounded-xl border border-emerald-900/40 bg-emerald-950/30 p-3 text-sm text-emerald-200">
                  <div className="font-semibold">Reserva criada ✅</div>
                  <div className="mt-1 text-xs text-emerald-100/80">
                    Token:{" "}
                    <span className="font-mono">{order.public_token}</span>
                  </div>

                  {/* ✅ Evita mismatch: só formata data no client depois do mount */}
                  <div className="mt-1 text-xs text-emerald-100/80">
                    Expira em:{" "}
                    {mounted
                      ? new Date(order.expires_at).toLocaleString("pt-BR")
                      : order.expires_at}
                  </div>

                  <div className="mt-2 text-sm">
                    Total:{" "}
                    <b className="text-emerald-100">
                      {formatBRL(order.total_cents)}
                    </b>
                  </div>

                  {payInfo && (
                    <div className="mt-3 rounded-xl border border-emerald-900/40 bg-emerald-950/20 p-3 text-xs text-emerald-100/90 whitespace-pre-wrap">
                      {payInfo}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Filtros */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 mb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {(["all", "free", "reserved", "paid"] as const).map((k) => {
                const active = filter === k;
                const label =
                  k === "all"
                    ? "Todos"
                    : k === "free"
                    ? "Livres"
                    : k === "reserved"
                    ? "Reservados"
                    : "Pagos";
                return (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    className={[
                      "rounded-full px-3 py-1 text-xs border",
                      active
                        ? "border-zinc-500 bg-white/15 text-white"
                        : "border-zinc-800 bg-zinc-950/40 text-zinc-300 hover:bg-white/10",
                    ].join(" ")}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full sm:w-72 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                placeholder="Buscar nº (ex: 07) ou nome (ex: joão)"
              />
              <button
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm hover:bg-white/10"
              >
                Limpar
              </button>
            </div>
          </div>
        </section>

        {/* Grade 01..100 */}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Números (01–100)</h2>
            <div className="text-xs text-zinc-400">
              Mostrando:{" "}
              <span className="text-zinc-200">{filteredNumbers.length}</span>
            </div>
          </div>

          <div className="grid grid-cols-5 sm:grid-cols-10 md:grid-cols-10 lg:grid-cols-10 gap-2">
            {filteredNumbers.map((n) => {
              void tick;

              const isFree = n.status === "free";
              const isSelected = selected.includes(n.number);
              const left = n.status === "reserved" ? msLeft(n.locked_until) : 0;

              const base =
                "relative rounded-xl border px-2 py-2 text-xs sm:text-sm font-semibold transition select-none";
              const disabled = "cursor-not-allowed opacity-75";
              const hover = "hover:brightness-110";

              let cls = `${base} border-zinc-800 bg-zinc-950/40 text-zinc-100 ${hover}`;

              if (n.status === "reserved")
                cls = `${base} border-amber-500/30 bg-amber-950/30 text-amber-100 ${disabled}`;
              if (n.status === "paid")
                cls = `${base} border-rose-500/30 bg-rose-950/30 text-rose-100 ${disabled}`;
              if (n.status !== "free" && n.status !== "reserved" && n.status !== "paid")
                cls = `${base} border-zinc-800 bg-zinc-900/40 text-zinc-400 ${disabled}`;

              if (isSelected) cls = `${base} border-white/30 bg-white text-black`;

              // ✅ title sem locale/date no SSR (evita mismatch)
              let title = "Indisponível";
              if (n.status === "free") title = "Livre";
              if (n.status === "reserved") title = `Reservado • ${maskName(n.buyer_name)}`;
              if (n.status === "paid") title = `Pago • ${maskName(n.buyer_name)}`;

              return (
                <button
                  key={n.number}
                  title={title}
                  onClick={() => toggleNumber(n.number)}
                  disabled={!isFree}
                  className={cls}
                >
                  <div className="flex items-center justify-between">
                    <span>{pad2(n.number)}</span>

                    {!isSelected && n.status === "free" && (
                      <span className="h-2 w-2 rounded-full bg-emerald-400/90" />
                    )}
                    {!isSelected && n.status === "reserved" && (
                      <span className="h-2 w-2 rounded-full bg-amber-400/90" />
                    )}
                    {!isSelected && n.status === "paid" && (
                      <span className="h-2 w-2 rounded-full bg-rose-400/90" />
                    )}
                    {isSelected && <span className="h-2 w-2 rounded-full bg-black/70" />}
                  </div>

                  {/* ✅ contador só depois do mount */}
                  {mounted && !isSelected && n.status === "reserved" && left > 0 && (
                    <div className="mt-1 text-[10px] leading-none text-amber-200/90 font-medium">
                      {formatMMSS(left)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <footer className="py-8 text-center text-xs text-zinc-500">
          © 2026 • Rifa SaaS
        </footer>
      </main>
    </div>
  );
}