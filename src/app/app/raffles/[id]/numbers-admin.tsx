"use client";

import { useEffect, useMemo, useState } from "react";

type NumRow = {
  number: number;
  status: string | null;
  locked_until: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
  confirmed_at: string | null;
};

type RaffleMeta = {
  id: string;
  total_numbers: number;
  slug: string;
  status: string | null;
  reserve_unit: string | null;
  reserve_value: number | null;
  draw_date: string | null;
};

function padNumber(n: number, total: number = 500) {
  if (total >= 1000) return String(n).padStart(4, "0");
  if (total >= 100) return String(n).padStart(3, "0");
  return String(n).padStart(2, "0");
}

function isLocked(lockedUntil: string | null) {
  if (!lockedUntil) return false;
  return new Date(lockedUntil).getTime() > Date.now();
}

function formatLeft(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;

  if (d > 0) return `${d}d ${String(h).padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

function reserveRuleLabel(r: RaffleMeta | null) {
  if (!r) return "—";
  const unit = r.reserve_unit ?? "minutes";
  const val = Number(r.reserve_value ?? 30);

  if (unit === "until_draw") return "até o sorteio";
  if (unit === "days") return `${Math.max(1, val)} dia(s)`;
  return `${Math.max(1, val)} min`;
}

export default function NumbersAdmin({ raffleId }: { raffleId: string }) {
  const [loading, setLoading] = useState(true);
  const [numbers, setNumbers] = useState<NumRow[]>([]);
  const [raffle, setRaffle] = useState<RaffleMeta | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const [filter, setFilter] = useState<"all" | "free" | "reserved" | "confirmed">("all");
  const [q, setQ] = useState("");

  // modal
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<NumRow | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // tick para contador
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function load() {
  setMsg(null);
  setLoading(true);
  try {
    const res = await fetch(`/api/admin/raffles/${raffleId}/numbers`, {
      cache: "no-store",
      credentials: "include",
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      setMsg(data?.message ?? "Falha ao carregar números");
      setNumbers([]);
      setRaffle(null);
      return;
    }

    setNumbers(data?.numbers ?? []);
    setRaffle(data?.raffle ?? null);
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raffleId]);

  const stats = useMemo(() => {
    let free = 0, reserved = 0, confirmed = 0, expired = 0;
    for (const n of numbers) {
      const st = (n.status ?? "free");
      if (st === "confirmed" || st === "paid") confirmed++;
      else if (st === "reserved") {
        if (isLocked(n.locked_until)) reserved++;
        else expired++;
      } else free++;
    }
    return { free, reserved, confirmed, expired, total: numbers.length };
  }, [numbers, tick]);

  const filtered = useMemo(() => {
    let arr = numbers;

    if (filter !== "all") {
      arr = arr.filter((n) => {
        const s = n.status ?? "free";
        if (filter === "confirmed") return s === "confirmed" || s === "paid";
        return s === filter;
      });
    }

    const qq = q.trim();
    if (qq) {
      const asNum = Number(qq);
      if (Number.isFinite(asNum)) arr = arr.filter((n) => n.number === asNum);
      else {
        const asNum2 = Number(qq.replace(/^0+/, ""));
        if (Number.isFinite(asNum2)) arr = arr.filter((n) => n.number === asNum2);
      }
    }

    return arr;
  }, [numbers, filter, q]);

  function openModal(n: NumRow) {
    setSel(n);
    setName(n.buyer_name ?? "");
    setPhone(n.buyer_phone ?? "");
    setOpen(true);
    setMsg(null);
  }

  async function act(action: "reserve" | "confirm" | "free") {
    if (!sel) return;

    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/raffles/${raffleId}/numbers/update`, {
  method: "POST",
  credentials: "include",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    action,
    number: sel.number,
    buyer_name: name,
    buyer_phone: phone,
  }),
});

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(data?.message ?? "Falha ao salvar");
        return;
      }

      setOpen(false);
      setSel(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  const total = raffle?.total_numbers ?? 100;

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-lg font-semibold">
            Números ({total >= 100 ? `001–${padNumber(total, total)}` : `01–${total}`})
          </div>

          <div className="text-xs text-zinc-400 mt-1">
            Regra de reserva: <span className="text-zinc-200 font-semibold">{reserveRuleLabel(raffle)}</span>
            {raffle?.draw_date ? (
              <>
                {" "}• sorteio:{" "}
                <span className="text-zinc-200">
                  {new Date(raffle.draw_date).toLocaleDateString("pt-BR")}
                </span>
              </>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <div className="rounded-xl border border-zinc-700 bg-zinc-950/25 px-3 py-1">
              Livres: <span className="text-zinc-100 font-semibold">{stats.free}</span>
            </div>
            <div className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-3 py-1">
              Reservados: <span className="text-zinc-100 font-semibold">{stats.reserved}</span>
            </div>
            <div className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-3 py-1">
              Confirmados: <span className="text-zinc-100 font-semibold">{stats.confirmed}</span>
            </div>
            {stats.expired > 0 && (
              <div className="rounded-xl border border-zinc-700 bg-zinc-950/35 px-3 py-1">
                Expirados: <span className="text-zinc-100 font-semibold">{stats.expired}</span>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar nº (ex: 26)"
            className="w-40 rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
          />

          <select
            className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="all">Todos</option>
            <option value="free">Livres</option>
            <option value="reserved">Reservados</option>
            <option value="confirmed">Confirmados</option>
          </select>

          <button
            onClick={load}
            className="rounded-xl border border-zinc-800 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
          >
            Atualizar
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-zinc-300">
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2">
          <span className="inline-block h-3 w-3 rounded bg-zinc-700/40 border border-zinc-600" />
          Livre
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2">
          <span className="inline-block h-3 w-3 rounded bg-amber-900/40 border border-amber-700/50" />
          Reservado (ativo)
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-950/30 px-3 py-2">
          <span className="inline-block h-3 w-3 rounded bg-emerald-900/40 border border-emerald-700/50" />
          Confirmado
        </div>
      </div>

      <div className="mt-4 grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 gap-2">
        {filtered.map((n) => {
          const st = (n.status ?? "free");
          const locked = st === "reserved" && isLocked(n.locked_until);

          const base =
            "rounded-xl border px-2 py-2 text-center text-sm font-semibold select-none cursor-pointer";

          const isConfirmed = st === "confirmed" || st === "paid";
          const cls =
            isConfirmed
              ? "border-emerald-700/50 bg-emerald-950/40 hover:bg-emerald-950/55"
              : st === "reserved"
              ? locked
                ? "border-amber-700/50 bg-amber-950/35 hover:bg-amber-950/50"
                : "border-zinc-800 bg-zinc-950/30 hover:bg-white/10"
              : "border-zinc-800 bg-zinc-950/30 hover:bg-white/10";

          let title = "Livre";
          if (isConfirmed) title = `Confirmado • ${n.buyer_name ?? ""}`.trim();
          if (st === "reserved") {
            if (locked) {
              const left = n.locked_until ? new Date(n.locked_until).getTime() - Date.now() : 0;
              title = `Reservado • ${n.buyer_name ?? ""} • faltam ${formatLeft(left)}`.trim();
            } else {
              title = `Reserva expirada • ${n.buyer_name ?? ""}`.trim();
            }
          }

          return (
            <div
              key={n.number}
              onClick={() => openModal(n)}
              className={`${base} ${cls}`}
              title={title}
            >
              {padNumber(n.number, total)}
            </div>
          );
        })}
      </div>

      {loading && <div className="mt-4 text-sm text-zinc-400">Carregando...</div>}
      {msg && (
        <div className="mt-4 text-sm rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
          {msg}
        </div>
      )}

      {open && sel && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4">
          <div className="w-full max-w-lg rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-lg font-bold">
                  Número {padNumber(sel.number, total)}
                </div>

                <div className="text-xs text-zinc-400 mt-1">
                  status atual: <span className="text-zinc-200">{sel.status ?? "free"}</span>
                  {sel.status === "reserved" && sel.locked_until ? (
                    <>
                      {" "}•{" "}
                      {isLocked(sel.locked_until) ? (
                        <span className="text-amber-200">
                          faltam {formatLeft(new Date(sel.locked_until).getTime() - Date.now())}
                        </span>
                      ) : (
                        <span className="text-zinc-400">reserva expirada</span>
                      )}
                    </>
                  ) : null}
                </div>

                <div className="text-xs text-zinc-500 mt-1">
                  Regra de reserva: {reserveRuleLabel(raffle)}
                </div>
              </div>

              <button
                onClick={() => setOpen(false)}
                className="rounded-xl border border-zinc-800 bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
              >
                Fechar
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <div>
                <label className="text-xs text-zinc-400">Nome</label>
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: João"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400">Telefone (opcional)</label>
                <input
                  className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm outline-none"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(xx) 9xxxx-xxxx"
                />
              </div>

              <div className="text-xs text-zinc-500">
                Confirmado = entrega recebida (ex: fralda + lenço).
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  disabled={saving}
                  onClick={() => act("reserve")}
                  className="rounded-xl border border-amber-700/40 bg-amber-950/30 px-4 py-2 text-sm font-semibold hover:bg-amber-950/45 disabled:opacity-60"
                >
                  {saving ? "..." : "Reservar"}
                </button>

                <button
                  disabled={saving}
                  onClick={() => act("confirm")}
                  className="rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-4 py-2 text-sm font-semibold hover:bg-emerald-950/45 disabled:opacity-60"
                >
                  {saving ? "..." : "Confirmar recebimento"}
                </button>

                <button
                  disabled={saving}
                  onClick={() => act("free")}
                  className="rounded-xl border border-zinc-700 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-60"
                >
                  {saving ? "..." : "Liberar"}
                </button>
              </div>

              {msg && (
                <div className="mt-2 text-sm rounded-xl border border-zinc-800 bg-zinc-900/30 p-3">
                  {msg}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}