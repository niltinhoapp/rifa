"use client";

import { useEffect, useMemo, useState } from "react";

type OrderItem = {
  id: string;
  public_token: string;
  buyer_name: string;
  buyer_phone: string;
  total_cents: number;
  status: "pending" | "paid" | "cancelled" | "expired";
  expires_at: string;
  created_at: string;
  reserved_at: string;
  numbers: number[];
};

function formatBRL(cents: number) {
  return (Number(cents ?? 0) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function padNumber(n: number) {
  return String(n).padStart(3, "0");
}

function msLeft(expiresAt: string) {
  return Math.max(0, new Date(expiresAt).getTime() - Date.now());
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "Expirado";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(ss).padStart(2, "0")}s`;
}

export default function OrdersAdmin({ raffleId }: { raffleId: string }) {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<OrderItem[]>([]);
  const [filter, setFilter] = useState<"all" | "pending" | "paid" | "expired">("pending");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; type: "success" | "error" } | null>(null);

  // Tick para atualização do relógio a cada segundo
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/raffles/${raffleId}/orders`, {
        cache: "no-store",
        credentials: "include",
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.ok) {
        setOrders(data.orders ?? []);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raffleId]);

  async function confirmOrder(orderId: string) {
    if (!confirm("Confirmar recebimento do pagamento manual para este pedido?")) return;

    setActionLoading(orderId);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/orders/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: orderId }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data?.ok) {
        setMsg({ text: data?.message ?? "Falha ao confirmar pedido", type: "error" });
        return;
      }

      setMsg({
        text: `Pedido confirmado com sucesso! ${data.numbers_confirmed} cota(s) marcadas como pagas.`,
        type: "success",
      });
      await loadOrders();
    } catch (e: any) {
      setMsg({ text: e?.message ?? "Erro na requisição", type: "error" });
    } finally {
      setActionLoading(null);
    }
  }

  const stats = useMemo(() => {
    let pending = 0, paid = 0, expired = 0;
    const now = Date.now();
    for (const o of orders) {
      if (o.status === "paid") paid++;
      else if (o.status === "pending") {
        if (new Date(o.expires_at).getTime() > now) pending++;
        else expired++;
      } else expired++;
    }
    return { pending, paid, expired, total: orders.length };
  }, [orders, tick]);

  const filteredOrders = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();

    return orders.filter((o) => {
      const isTimeExpired = new Date(o.expires_at).getTime() <= now;

      if (filter === "pending" && (o.status !== "pending" || isTimeExpired)) return false;
      if (filter === "paid" && o.status !== "paid") return false;
      if (filter === "expired" && (o.status !== "expired" && !(o.status === "pending" && isTimeExpired))) return false;

      if (q) {
        const matchesName = o.buyer_name.toLowerCase().includes(q);
        const matchesPhone = o.buyer_phone.includes(q);
        const matchesToken = o.public_token.toLowerCase().includes(q);
        const matchesNumber = o.numbers.some((n) => String(n).includes(q) || padNumber(n).includes(q));
        return matchesName || matchesPhone || matchesToken || matchesNumber;
      }

      return true;
    });
  }, [orders, filter, search, tick]);

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div>
          <h2 className="text-lg font-bold text-zinc-100">Gestão de Pedidos e Reservas (Manual)</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Confira o comprovante enviado no WhatsApp e confirme o pedido para marcar todas as cotas como pagas.
          </p>
        </div>

        <button
          onClick={loadOrders}
          disabled={loading}
          className="rounded-xl border border-zinc-800 bg-white/5 px-3 py-1.5 text-xs text-zinc-200 hover:bg-white/10 transition"
        >
          {loading ? "Carregando..." : "↻ Atualizar"}
        </button>
      </div>

      {msg && (
        <div
          className={`rounded-xl border p-3 text-xs ${
            msg.type === "success"
              ? "border-emerald-800 bg-emerald-950/40 text-emerald-200"
              : "border-rose-800 bg-rose-950/40 text-rose-200"
          }`}
        >
          {msg.text}
        </div>
      )}

      {/* Contadores e Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => setFilter("pending")}
            className={`rounded-xl px-3 py-1.5 border transition ${
              filter === "pending"
                ? "border-amber-600 bg-amber-950/50 text-amber-200 font-semibold"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-white/5"
            }`}
          >
            Aguardando Pagamento ({stats.pending})
          </button>
          <button
            onClick={() => setFilter("paid")}
            className={`rounded-xl px-3 py-1.5 border transition ${
              filter === "paid"
                ? "border-emerald-600 bg-emerald-950/50 text-emerald-200 font-semibold"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-white/5"
            }`}
          >
            Confirmados / Pagos ({stats.paid})
          </button>
          <button
            onClick={() => setFilter("expired")}
            className={`rounded-xl px-3 py-1.5 border transition ${
              filter === "expired"
                ? "border-zinc-600 bg-zinc-800 text-zinc-200 font-semibold"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-white/5"
            }`}
          >
            Expirados ({stats.expired})
          </button>
          <button
            onClick={() => setFilter("all")}
            className={`rounded-xl px-3 py-1.5 border transition ${
              filter === "all"
                ? "border-zinc-600 bg-zinc-800 text-zinc-200 font-semibold"
                : "border-zinc-800 bg-zinc-950/40 text-zinc-400 hover:bg-white/5"
            }`}
          >
            Todos ({stats.total})
          </button>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por comprador, WhatsApp, token ou nº..."
          className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-1.5 text-xs text-zinc-200 outline-none w-full sm:w-64 focus:border-zinc-600"
        />
      </div>

      {/* Tabela de Pedidos */}
      <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/30">
        <table className="w-full text-left text-xs text-zinc-300">
          <thead className="border-b border-zinc-800 bg-zinc-950/60 text-[11px] uppercase tracking-wider text-zinc-400">
            <tr>
              <th className="p-3">Pedido / Token</th>
              <th className="p-3">Comprador</th>
              <th className="p-3">Cotas</th>
              <th className="p-3">Total</th>
              <th className="p-3">Validade (24h)</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {filteredOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-6 text-center text-zinc-500">
                  Nenhum pedido encontrado nesta categoria.
                </td>
              </tr>
            ) : (
              filteredOrders.map((ord) => {
                const left = msLeft(ord.expires_at);
                const isExpired = left <= 0 && ord.status !== "paid";
                const isPaid = ord.status === "paid";

                return (
                  <tr key={ord.id} className="hover:bg-white/[0.02] transition">
                    <td className="p-3 font-mono text-[11px]">
                      <span className="text-zinc-200 font-semibold">#{ord.public_token.slice(0, 8)}</span>
                    </td>
                    <td className="p-3">
                      <div className="font-semibold text-zinc-100">{ord.buyer_name}</div>
                      <a
                        href={`https://wa.me/55${ord.buyer_phone}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:underline flex items-center gap-1 mt-0.5"
                      >
                        📱 {ord.buyer_phone}
                      </a>
                    </td>
                    <td className="p-3">
                      <div className="max-w-[200px] flex flex-wrap gap-1">
                        {ord.numbers.map((n) => (
                          <span
                            key={n}
                            className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-mono text-zinc-200 font-semibold"
                          >
                            {padNumber(n)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 font-semibold text-emerald-300">
                      {formatBRL(ord.total_cents)}
                    </td>
                    <td className="p-3 font-mono text-[11px]">
                      {isPaid ? (
                        <span className="text-zinc-500">Concluído</span>
                      ) : isExpired ? (
                        <span className="text-rose-400 font-semibold">Expirado</span>
                      ) : (
                        <span className="text-amber-300 font-semibold">
                          {formatCountdown(left)}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      {isPaid ? (
                        <span className="rounded-full bg-emerald-950/60 border border-emerald-800 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
                          Pago
                        </span>
                      ) : isExpired ? (
                        <span className="rounded-full bg-rose-950/60 border border-rose-800 px-2.5 py-1 text-[10px] font-semibold text-rose-300">
                          Expirado
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-950/60 border border-amber-800 px-2.5 py-1 text-[10px] font-semibold text-amber-300">
                          Aguardando
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      {!isPaid && !isExpired && (
                        <button
                          onClick={() => confirmOrder(ord.id)}
                          disabled={actionLoading === ord.id}
                          className="rounded-xl border border-emerald-700 bg-emerald-600/30 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-600/50 transition disabled:opacity-50"
                        >
                          {actionLoading === ord.id ? "Confirmando..." : "Confirmar Pagamento"}
                        </button>
                      )}
                      {isPaid && (
                        <span className="text-[11px] text-zinc-500 italic">Confirmado</span>
                      )}
                      {isExpired && !isPaid && (
                        <span className="text-[11px] text-rose-500/80 italic">Não confirmável</span>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
