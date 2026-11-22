"use client";

import { useEffect, useMemo, useState } from "react";

type Raffle = {
  id: string;
  title: string | null;
  description: string | null;
  slug: string | null;
  status: string | null;
  total_numbers: number | null;
  price_cents: number | null;
  draw_date: string | null;
  payment_mode: string | null;
  payment_instructions: string | null;
  prize_title: string | null;
  reserve_unit: string | null;   // minutes | days | until_draw
  reserve_value: number | null;  // number
};

function isoToDateInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  // yyyy-mm-dd
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function dateInputToIso(dateStr: string) {
  // salva como meia-noite UTC
  // "2026-03-25" -> "2026-03-25T00:00:00.000Z"
  if (!dateStr) return null;
  return new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

export default function RaffleEditForm({ raffle }: { raffle: Raffle }) {
  const [title, setTitle] = useState(raffle.title ?? "");
  const [description, setDescription] = useState(raffle.description ?? "");
  const [prizeTitle, setPrizeTitle] = useState(raffle.prize_title ?? "");
  const [drawDate, setDrawDate] = useState(isoToDateInput(raffle.draw_date));
  const [totalNumbers, setTotalNumbers] = useState(Number(raffle.total_numbers ?? 100));

  const [paymentMode, setPaymentMode] = useState(raffle.payment_mode ?? "manual");
  const [paymentInstructions, setPaymentInstructions] = useState(raffle.payment_instructions ?? "");

  const [reserveUnit, setReserveUnit] = useState<string>(raffle.reserve_unit ?? "minutes");
  const [reserveValue, setReserveValue] = useState<number>(Number(raffle.reserve_value ?? 30));

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    // mantém valor padrão ao trocar unit
    if (reserveUnit === "minutes" && (!reserveValue || reserveValue < 1)) setReserveValue(30);
    if (reserveUnit === "days" && (!reserveValue || reserveValue < 1)) setReserveValue(3);
    if (reserveUnit === "until_draw") setReserveValue(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reserveUnit]);

  const numbersHint = useMemo(() => {
    if (totalNumbers === 100) return "Para 01–100: use 100.";
    return `Será 01–${totalNumbers}.`;
  }, [totalNumbers]);

  async function save() {
    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        prize_title: prizeTitle.trim() || null,
        draw_date: dateInputToIso(drawDate),
        total_numbers: Math.max(1, Number(totalNumbers || 1)),
        payment_mode: paymentMode,
        payment_instructions: paymentInstructions.trim() || null,
        reserve_unit: reserveUnit,
        reserve_value: reserveUnit === "until_draw" ? null : Math.max(1, Number(reserveValue || 1)),
      };

      const res = await fetch(`/api/admin/raffles/${raffle.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(data?.message ?? "Falha ao salvar");
        return;
      }

      setMsg("Salvo ✅");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-zinc-400">Link público: <span className="text-zinc-200">/r/{raffle.slug}</span></div>
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="rounded-xl border border-zinc-800 bg-white/5 px-4 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {msg && (
        <div className="mt-3 text-sm rounded-xl border border-zinc-800 bg-zinc-950/40 p-3">
          {msg}
        </div>
      )}

      <div className="mt-4 grid gap-4">
        <div>
          <label className="text-xs text-zinc-400">Título</label>
          <input
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Rifa do Kit Churrasco"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-400">Descrição</label>
          <textarea
            className="mt-1 w-full min-h- 80px rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Explique como funciona"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-400">Prêmio</label>
          <input
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
            value={prizeTitle}
            onChange={(e) => setPrizeTitle(e.target.value)}
            placeholder="Ex: Kit churrasco"
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-zinc-400">Data do sorteio</label>
            <input
              type="date"
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
              value={drawDate}
              onChange={(e) => setDrawDate(e.target.value)}
            />
          </div>

          <div>
            <label className="text-xs text-zinc-400">Qtd números</label>
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
              value={totalNumbers}
              onChange={(e) => setTotalNumbers(Number(e.target.value))}
            />
            <div className="text-xs text-zinc-500 mt-1">{numbersHint}</div>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-zinc-400">Modo de pagamento</label>
            <select
              className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
              value={paymentMode}
              onChange={(e) => setPaymentMode(e.target.value)}
            >
              <option value="manual">Manual</option>
              <option value="donation">Doação (sem Pix)</option>
              <option value="pix">Pix</option>
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-400">Reserva</label>
            <div className="mt-1 grid grid-cols-2 gap-2">
              <select
                className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
                value={reserveUnit}
                onChange={(e) => setReserveUnit(e.target.value)}
              >
                <option value="minutes">Minutos</option>
                <option value="days">Dias</option>
                <option value="until_draw">Até o sorteio</option>
              </select>

              {reserveUnit !== "until_draw" ? (
                <input
                  type="number"
                  min={1}
                  className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
                  value={reserveValue}
                  onChange={(e) => setReserveValue(Number(e.target.value))}
                  placeholder={reserveUnit === "days" ? "Ex: 3" : "Ex: 30"}
                />
              ) : (
                <div className="rounded-xl border border-zinc-800 bg-zinc-950/20 px-3 py-2 text-sm text-zinc-400">
                  Expira no sorteio
                </div>
              )}
            </div>
            <div className="text-xs text-zinc-500 mt-1">
              Ex.: “Dias = 3” para receber em mãos.
            </div>
          </div>
        </div>

        <div>
          <label className="text-xs text-zinc-400">
            Instruções do pagamento (texto que aparece no público)
          </label>
          <textarea
            className="mt-1 w-full min-h- 80px rounded-xl border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm outline-none"
            value={paymentInstructions}
            onChange={(e) => setPaymentInstructions(e.target.value)}
            placeholder="Ex: Pagamento por doação: 1 fralda + 1 lenço..."
          />
        </div>
      </div>
    </div>
  );
}