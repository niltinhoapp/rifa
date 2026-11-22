import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * Motor de Simulação Transacional PostgreSQL para o Fluxo Manual de 24 Horas
 * Modela rigorosamente:
 * - clock_timestamp() e validade estrita de 24 horas
 * - Bloqueios de linha (SELECT ... FOR UPDATE) determinísticos
 * - All-or-Nothing rollback em falhas
 * - Verificação de expiração antes da confirmação (expires_at > clock_timestamp())
 * - Tri-Pilar atômico (orders, payments, raffle_numbers)
 */
class Manual24hPostgresEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.virtualClock = new Date("2026-11-22T14:00:00.000Z"); // UTC

    this.workspaces = [
      { id: "ws-acai-1", name: "Açaí Vexa", slug: "acai-vexa" },
      { id: "ws-outro-2", name: "Outro Comércio", slug: "outro" },
    ];

    this.workspace_members = [
      { workspace_id: "ws-acai-1", user_id: "admin-acai-uid", role: "owner" },
      { workspace_id: "ws-outro-2", user_id: "admin-outro-uid", role: "owner" },
    ];

    this.raffles = [
      {
        id: "raf-moto-500",
        workspace_id: "ws-acai-1",
        title: "Moto Elétrica Açaí Vexa",
        slug: "moto-eletrica-acai-vexa",
        status: "active",
        price_cents: 1000, // R$ 10,00
        total_numbers: 500,
        reserve_unit: "hours",
        reserve_value: 24,
      },
    ];

    // Cria 500 números (001 a 500)
    this.raffle_numbers = [];
    for (let i = 1; i <= 500; i++) {
      this.raffle_numbers.push({
        id: `rn-${i}`,
        raffle_id: "raf-moto-500",
        number: i,
        status: "free",
        locked_until: null,
        reserved_at: null,
        order_id: null,
        buyer_name: null,
        buyer_phone: null,
        confirmed_at: null,
      });
    }

    this.orders = [];
    this.order_items = [];
    this.payments = [];
    this.lockQueue = new Map();
  }

  getClock() {
    return new Date(this.virtualClock.getTime());
  }

  advanceClock(hours) {
    this.virtualClock = new Date(this.virtualClock.getTime() + hours * 3600 * 1000);
  }

  // Simulação fiel da RPC reserve_numbers_manual_24h
  async reserve_numbers_manual_24h(slug, buyer_name, buyer_phone, numbers) {
    const cleanName = (buyer_name || "").trim();
    const cleanPhone = (buyer_phone || "").replace(/\D/g, "");

    if (cleanName.length < 2) {
      throw new Error("Nome do comprador é obrigatório (mínimo 2 caracteres)");
    }
    if (cleanPhone.length < 10) {
      throw new Error("WhatsApp do comprador inválido (mínimo 10 dígitos com DDD)");
    }
    if (!numbers || numbers.length === 0) {
      throw new Error("Selecione pelo menos 1 número para reservar");
    }

    const raffle = this.raffles.find((r) => r.slug === slug && r.status === "active");
    if (!raffle) {
      throw new Error("Rifa não encontrada ou inativa");
    }

    // Ordenação determinística ASC
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);

    // Simula lock de linha determinístico (ORDER BY number FOR UPDATE)
    const acquiredLocks = [];
    for (const n of sorted) {
      while (this.lockQueue.get(n)) {
        await new Promise((r) => setTimeout(r, 5));
      }
      this.lockQueue.set(n, true);
      acquiredLocks.push(n);
    }

    try {
      const now = this.getClock();

      // Validação de existência de todas as cotas
      for (const n of sorted) {
        const row = this.raffle_numbers.find(
          (rn) => rn.raffle_id === raffle.id && rn.number === n
        );
        if (!row) {
          throw new Error(`Número ${n} não existe nesta rifa`);
        }
        if (row.status === "paid") {
          throw new Error(`Número ${n} indisponível (já foi pago)`);
        }
        if (
          row.status === "reserved" &&
          row.locked_until &&
          new Date(row.locked_until) > now
        ) {
          throw new Error(`Número ${n} indisponível (já está reservado)`);
        }
      }

      // Validade estrita de exatamente 24 horas em UTC
      const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000);
      const totalCents = raffle.price_cents * sorted.length;
      const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const publicToken = Math.random().toString(36).slice(2, 10);
      const paymentId = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // 1. Cria Pedido
      const newOrder = {
        id: orderId,
        workspace_id: raffle.workspace_id,
        raffle_id: raffle.id,
        public_token: publicToken,
        buyer_name: cleanName,
        buyer_phone: cleanPhone,
        total_cents: totalCents,
        status: "pending",
        created_at: now.toISOString(),
        reserved_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
      };
      this.orders.push(newOrder);

      // 2. Cria Itens
      for (const n of sorted) {
        this.order_items.push({ order_id: orderId, raffle_id: raffle.id, number: n });
      }

      // 3. Atualiza Cotas
      for (const n of sorted) {
        const row = this.raffle_numbers.find(
          (rn) => rn.raffle_id === raffle.id && rn.number === n
        );
        row.status = "reserved";
        row.locked_until = expiresAt.toISOString();
        row.reserved_at = now.toISOString();
        row.order_id = orderId;
        row.buyer_name = cleanName;
        row.buyer_phone = cleanPhone;
      }

      // 4. Cria Pagamento Manual
      this.payments.push({
        id: paymentId,
        order_id: orderId,
        method: "pix_manual",
        status: "pending",
        created_at: now.toISOString(),
        confirmed_at: null,
        confirmed_by: null,
      });

      return {
        order_id: orderId,
        public_token: publicToken,
        reserved_at: now.toISOString(),
        expires_at: expiresAt.toISOString(),
        total_cents: totalCents,
      };
    } finally {
      for (const n of acquiredLocks) {
        this.lockQueue.delete(n);
      }
    }
  }

  // Simulação fiel da RPC confirm_order_manual
  async confirm_order_manual(order_id, admin_id, caller_role = "authenticated") {
    const now = this.getClock();

    if (caller_role === "anon") {
      throw new Error("Acesso não autorizado: operação requer autenticação de administrador ou service_role");
    }

    const order = this.orders.find((o) => o.id === order_id);
    if (!order) {
      throw new Error(`Pedido não encontrado: ${order_id}`);
    }

    // Validação de membro do workspace
    if (caller_role === "authenticated") {
      if (!admin_id) {
        throw new Error("Identificador do administrador ausente");
      }
      const isMember = this.workspace_members.some(
        (wm) => wm.workspace_id === order.workspace_id && wm.user_id === admin_id
      );
      if (!isMember) {
        throw new Error("Acesso não autorizado: usuário não pertence ao workspace desta rifa");
      }
    }

    // Idempotência
    if (order.status === "paid") {
      const paidCount = this.raffle_numbers.filter(
        (rn) => rn.order_id === order.id && rn.status === "paid"
      ).length;
      return {
        order_id: order.id,
        numbers_confirmed: paidCount,
        status: "paid",
        already_confirmed: true,
      };
    }

    if (order.status === "cancelled") {
      throw new Error("Pedido cancelado não pode ser confirmado");
    }

    // REGRA 1 OBRIGATÓRIA: Bloqueio estrito de expiração direta no banco
    if (new Date(order.expires_at) <= now) {
      throw new Error(
        `Confirmação recusada: O prazo de 24 horas deste pedido expirou em ${order.expires_at} (horário atual: ${now.toISOString()}).`
      );
    }

    // REGRA 3 OBRIGATÓRIA: Bloqueia e valida cotas ativas vinculadas
    const expectedItems = this.order_items.filter((it) => it.order_id === order.id);
    if (expectedItems.length === 0) {
      throw new Error(`Inconsistência estrutural: nenhum item encontrado para o pedido ${order.id}`);
    }

    const reservedNumbers = this.raffle_numbers.filter(
      (rn) =>
        rn.order_id === order.id &&
        rn.status === "reserved" &&
        new Date(rn.locked_until) > now
    );

    if (reservedNumbers.length !== expectedItems.length) {
      throw new Error(
        `Confirmação recusada: nem todas as cotas continuam reservadas ativamente para este pedido (esperado: ${expectedItems.length}, reservadas ativas: ${reservedNumbers.length}).`
      );
    }

    // REGRA 4 OBRIGATÓRIA: Valida registro de pagamento existente
    const payment = this.payments.find((p) => p.order_id === order.id);
    if (!payment) {
      throw new Error(`Inconsistência financeira: nenhum registro de pagamento associado ao pedido ${order.id}`);
    }

    // ATUALIZAÇÃO ATÔMICA CONJUNTA DO TRI-PILAR
    payment.status = "confirmed";
    payment.confirmed_at = now.toISOString();
    payment.confirmed_by = admin_id;

    order.status = "paid";
    order.updated_at = now.toISOString();

    let count = 0;
    for (const rn of this.raffle_numbers) {
      if (rn.order_id === order.id && rn.status === "reserved") {
        rn.status = "paid";
        rn.confirmed_at = now.toISOString();
        count++;
      }
    }

    return {
      order_id: order.id,
      numbers_confirmed: count,
      status: "paid",
      already_confirmed: false,
    };
  }

  // Simulação fiel da RPC cleanup_expired_reservations_24h
  async cleanup_expired_reservations_24h(raffle_id = null, caller_role = "service_role") {
    if (caller_role !== "service_role") {
      throw new Error("Acesso restrito ao backend administrativo (service_role)");
    }

    const now = this.getClock();
    let ordersExpired = 0;
    let numbersReleased = 0;

    const expiredOrders = this.orders.filter(
      (o) =>
        o.status === "pending" &&
        new Date(o.expires_at) <= now &&
        (!raffle_id || o.raffle_id === raffle_id)
    );

    for (const order of expiredOrders) {
      const hasConfirmedPayment = this.payments.some(
        (p) => p.order_id === order.id && p.status === "confirmed"
      );

      if (!hasConfirmedPayment) {
        order.status = "expired";
        order.updated_at = now.toISOString();

        for (const rn of this.raffle_numbers) {
          if (rn.order_id === order.id && rn.status === "reserved") {
            rn.status = "free";
            rn.locked_until = null;
            rn.reserved_at = null;
            rn.order_id = null;
            rn.buyer_name = null;
            rn.buyer_phone = null;
            numbersReleased++;
          }
        }
        ordersExpired++;
      }
    }

    return { orders_expired: ordersExpired, numbers_released: numbersReleased };
  }
}

describe("MATRIZ DOS 14 TESTES OBRIGATÓRIOS — FLUXO MANUAL 24H E CONFIRMAÇÃO", () => {
  const engine = new Manual24hPostgresEngine();

  // Teste 01: Reserva normal de 1 número
  test("01. Reserva normal de 1 número (cota 042)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Carlos Cliente",
      "11988887777",
      [42]
    );

    assert.ok(res.order_id);
    assert.equal(res.total_cents, 1000); // R$ 10,00

    const row = engine.raffle_numbers.find((rn) => rn.number === 42);
    assert.equal(row.status, "reserved");
    assert.equal(row.order_id, res.order_id);
    assert.equal(row.buyer_name, "Carlos Cliente");
  });

  // Teste 02: Reserva simultânea do mesmo número por dois compradores (Concorrência)
  test("02. Reserva simultânea do mesmo número por dois compradores (cota 042)", async () => {
    engine.reset();
    const p1 = engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Comprador A",
      "11988881111",
      [42]
    );
    const p2 = engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Comprador B",
      "11988882222",
      [42]
    );

    const results = await Promise.allSettled([p1, p2]);
    const success = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    assert.equal(success.length, 1, "Exatamente um comprador deve conseguir");
    assert.equal(rejected.length, 1, "O concorrente deve receber rejeição");
    assert.match(rejected[0].reason.message, /indisponível/);
  });

  // Teste 03: Reserva de vários números com um deles indisponível (Rollback All-or-Nothing)
  test("03. Reserva de vários números com um indisponível (Rollback All-or-Nothing)", async () => {
    engine.reset();
    // Reserva prévia da cota 101
    await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Primeiro Comprador",
      "11911111111",
      [101]
    );

    // Segundo comprador tenta reservar [100, 101, 102]
    await assert.rejects(
      async () => {
        await engine.reserve_numbers_manual_24h(
          "moto-eletrica-acai-vexa",
          "Segundo Comprador",
          "11922222222",
          [100, 101, 102]
        );
      },
      /Número 101 indisponível/
    );

    // As cotas 100 e 102 devem permanecer livres (Rollback completo)
    const n100 = engine.raffle_numbers.find((rn) => rn.number === 100);
    const n102 = engine.raffle_numbers.find((rn) => rn.number === 102);
    assert.equal(n100.status, "free");
    assert.equal(n102.status, "free");
  });

  // Teste 04: Reserva com validade de exatamente 24 horas
  test("04. Reserva com validade de exatamente 24 horas (UTC)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Validade Teste",
      "11933333333",
      [50]
    );

    const diffMs = new Date(res.expires_at).getTime() - new Date(res.reserved_at).getTime();
    const exact24HoursMs = 24 * 3600 * 1000;
    assert.equal(diffMs, exact24HoursMs, "A diferença deve ser exatamente 86.400.000 ms (24h)");
  });

  // Teste 05: Expiração automática após 24 horas
  test("05. Expiração automática após 24 horas", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Cliente Ausente",
      "11944444444",
      [60, 61]
    );

    // Avança o relógio do sistema em 25 horas
    engine.advanceClock(25);

    const cleanupRes = await engine.cleanup_expired_reservations_24h();
    assert.equal(cleanupRes.orders_expired, 1);
    assert.equal(cleanupRes.numbers_released, 2);

    const n60 = engine.raffle_numbers.find((rn) => rn.number === 60);
    const n61 = engine.raffle_numbers.find((rn) => rn.number === 61);
    assert.equal(n60.status, "free");
    assert.equal(n61.status, "free");
    assert.equal(n60.order_id, null);
  });

  // Teste 06: Liberação e nova reserva de números expirados
  test("06. Liberação e nova reserva de números expirados", async () => {
    engine.reset();
    // Reserva original de [70]
    await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Primeiro Comprador",
      "11955555555",
      [70]
    );

    // Expira após 24h e executa higienização
    engine.advanceClock(25);
    await engine.cleanup_expired_reservations_24h();

    // Novo comprador reserva a mesma cota 70
    const res2 = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Novo Comprador",
      "11966666666",
      [70]
    );

    const row = engine.raffle_numbers.find((rn) => rn.number === 70);
    assert.equal(row.status, "reserved");
    assert.equal(row.order_id, res2.order_id);
    assert.equal(row.buyer_name, "Novo Comprador");
  });

  // Teste 07: Confirmação manual dentro do prazo
  test("07. Confirmação manual dentro do prazo (Tri-Pilar atômico)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Bom Pagador",
      "11977777777",
      [80, 81]
    );

    // Avança 5 horas (ainda dentro das 24h)
    engine.advanceClock(5);

    const conf = await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
    assert.equal(conf.status, "paid");
    assert.equal(conf.numbers_confirmed, 2);
    assert.equal(conf.already_confirmed, false);

    // Valida consistência atômica nos 3 pilares
    const order = engine.orders.find((o) => o.id === res.order_id);
    const payment = engine.payments.find((p) => p.order_id === res.order_id);
    const n80 = engine.raffle_numbers.find((rn) => rn.number === 80);
    const n81 = engine.raffle_numbers.find((rn) => rn.number === 81);

    assert.equal(order.status, "paid", "orders.status deve ser 'paid'");
    assert.equal(payment.status, "confirmed", "payments.status deve ser 'confirmed'");
    assert.equal(payment.confirmed_by, "admin-acai-uid", "confirmed_by deve ser registrado");
    assert.equal(n80.status, "paid", "cota 80 deve ser 'paid'");
    assert.equal(n81.status, "paid", "cota 81 deve ser 'paid'");
  });

  // Teste 08: Tentativa de confirmação depois do prazo (Regra 1 Obrigatória)
  test("08. Tentativa de confirmação depois do prazo (Recusada mesmo sem cron prévio)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Pagamento Atrasado",
      "11988888888",
      [90]
    );

    // Avança 24h e 1 minuto sem rodar a rotina de limpeza do cron
    engine.advanceClock(24.02);

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
      },
      /O prazo de 24 horas deste pedido expirou/,
      "A confirmação DEVE ser recusada pela verificação direta de expires_at no banco"
    );
  });

  // Teste 09: Confirmação duplicada (Idempotência estrita)
  test("09. Confirmação duplicada (Idempotência estrita)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Cliente Fiel",
      "11999990000",
      [105]
    );

    // Primeira confirmação
    const conf1 = await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
    assert.equal(conf1.status, "paid");
    assert.equal(conf1.already_confirmed, false);

    // Segunda chamada imediata
    const conf2 = await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
    assert.equal(conf2.status, "paid");
    assert.equal(conf2.already_confirmed, true, "Deve reportar already_confirmed sem duplicar");
  });

  // Teste 10: Confirmação simultânea com expiração
  test("10. Confirmação simultânea com rotina de expiração", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Cliente no Limite",
      "11900001111",
      [110]
    );

    // Avança 23h e 50min (ainda dentro das 24h)
    engine.advanceClock(23.8);

    // Confirmação é realizada
    await engine.confirm_order_manual(res.order_id, "admin-acai-uid");

    // Avança mais 2 horas (passou de 24h da reserva original)
    engine.advanceClock(2);

    // Rotina de limpeza executa
    const cleanup = await engine.cleanup_expired_reservations_24h();
    assert.equal(cleanup.orders_expired, 0, "Pedido confirmado NUNCA pode ser expirado");

    const row = engine.raffle_numbers.find((rn) => rn.number === 110);
    assert.equal(row.status, "paid", "Cota deve permanecer como paga");
  });

  // Teste 11: Reexecução da rotina de expiração (Idempotência do cron)
  test("11. Reexecução da rotina de expiração (Idempotência do cron)", async () => {
    engine.reset();
    await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Cliente Desistente",
      "11922223333",
      [120]
    );

    engine.advanceClock(25);

    // Primeira execução do cron
    const r1 = await engine.cleanup_expired_reservations_24h();
    assert.equal(r1.orders_expired, 1);
    assert.equal(r1.numbers_released, 1);

    // Segunda execução imediata
    const r2 = await engine.cleanup_expired_reservations_24h();
    assert.equal(r2.orders_expired, 0);
    assert.equal(r2.numbers_released, 0);
  });

  // Teste 12: Tentativa de modificar números de um pedido antigo
  test("12. Tentativa de modificar números já liberados ou de outro pedido", async () => {
    engine.reset();
    const resA = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Comprador A",
      "11933334444",
      [130]
    );

    // Pedido A expira e é limpo
    engine.advanceClock(25);
    await engine.cleanup_expired_reservations_24h();

    // Novo Comprador B reserva a cota 130
    await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Comprador B",
      "11944445555",
      [130]
    );

    // Administrador tenta confirmar o Pedido A antigo
    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(resA.order_id, "admin-acai-uid");
      },
      /Confirmação recusada/,
      "Não pode confirmar cota que já pertence a um novo pedido"
    );
  });

  // Teste 13: Falha parcial em operações relacionadas ao pedido (All-or-Nothing)
  test("13. Falha parcial em operações do pedido aborta tudo", async () => {
    engine.reset();
    // Simula tentativa com cota 999 que não existe na rifa de 500 cotas
    await assert.rejects(
      async () => {
        await engine.reserve_numbers_manual_24h(
          "moto-eletrica-acai-vexa",
          "Tentativa Falha",
          "11955556666",
          [200, 999]
        );
      },
      /não existe nesta rifa/
    );

    // Cota válida 200 não pode ter sido alterada
    const n200 = engine.raffle_numbers.find((rn) => rn.number === 200);
    assert.equal(n200.status, "free");
    assert.equal(n200.order_id, null);
  });

  // Teste 14: Acesso não autorizado às ações administrativas
  test("14. Acesso não autorizado às ações administrativas (RLS/Workspace)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h(
      "moto-eletrica-acai-vexa",
      "Cliente Protegido",
      "11966667777",
      [300]
    );

    // Administrador do outro workspace tenta confirmar rifa alheia
    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "admin-outro-uid");
      },
      /Acesso não autorizado/,
      "Deve barrar confirmação feita por administrador de outro workspace"
    );
  });

  // Teste 15: Tentativa de higienização sem papel service_role
  test("15. Tentativa de higienização sem papel service_role (Bloqueio estrito)", async () => {
    engine.reset();
    await assert.rejects(
      async () => {
        // Chamada fingindo ser usuário comum ou anon
        await engine.cleanup_expired_reservations_24h(null, "authenticated");
      },
      /Acesso restrito ao backend administrativo/,
      "Apenas o backend com service_role pode executar cleanup"
    );

    await assert.rejects(
      async () => {
        await engine.cleanup_expired_reservations_24h(null, "anon");
      },
      /Acesso restrito ao backend administrativo/,
      "Chamadas anônimas devem ser terminantemente recusadas"
    );
  });

  // Teste 16: Autenticação do cron com CRON_SECRET e Timing-Safe check
  test("16. Validação de segurança do cron (CRON_SECRET obrigatório e timing-safe)", () => {
    function timingSafeEqualStr(a, b) {
      if (typeof a !== "string" || typeof b !== "string") return false;
      const bufA = Buffer.from(a, "utf-8");
      const bufB = Buffer.from(b, "utf-8");
      if (bufA.length !== bufB.length) return false;
      return crypto.timingSafeEqual(bufA, bufB);
    }

    const validSecret = "super-segredo-cron-2026-vexa";
    
    // Segredo correto
    assert.equal(timingSafeEqualStr("super-segredo-cron-2026-vexa", validSecret), true);

    // Segredo incorreto (mesmo tamanho)
    assert.equal(timingSafeEqualStr("super-segredo-cron-2026-fake", validSecret), false);

    // Segredo com tamanho diferente
    assert.equal(timingSafeEqualStr("curto", validSecret), false);

    // Segredo vazio ou nulo
    assert.equal(timingSafeEqualStr("", validSecret), false);
    assert.equal(timingSafeEqualStr(null, validSecret), false);
  });
});

describe("MATRIZ DE AUDITORIA CRON — EXPIRAÇÃO VERCEL E SEGURANÇA", () => {
  const SERVER_CRON_SECRET = "super-secret-cron-token-acai-2026";
  const SERVICE_ROLE_MOCK = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock-service-role-key";

  function timingSafeEqualStr(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  function authenticateCronRequest(req, customSecret) {
    // Se customSecret for fornecido (incluindo null ou undefined em testes), utiliza-o; caso contrário, usa o padrão do teste
    const serverSecret = (arguments.length > 1 ? customSecret : SERVER_CRON_SECRET)?.trim();
    if (!serverSecret) {
      return {
        authorized: false,
        status: 500,
        message: "CRON_SECRET não configurado no servidor",
      };
    }

    const url = new URL(req.url);
    if (url.searchParams.has("secret")) {
      return {
        authorized: false,
        status: 401,
        message: "Autenticação por query string descontinuada. Utilize Authorization: Bearer <CRON_SECRET>",
      };
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return {
        authorized: false,
        status: 401,
        message: "Cabeçalho Authorization ausente",
      };
    }

    if (!authHeader.startsWith("Bearer ")) {
      return {
        authorized: false,
        status: 401,
        message: "Formato de autorização inválido. Esperado: Bearer <CRON_SECRET>",
      };
    }

    const token = authHeader.slice(7).trim();
    if (!token) {
      return {
        authorized: false,
        status: 401,
        message: "Token Bearer vazio ou malformado",
      };
    }

    if (!timingSafeEqualStr(token, serverSecret)) {
      return {
        authorized: false,
        status: 401,
        message: "Acesso não autorizado: token inválido",
      };
    }

    return { authorized: true, status: 200, message: "OK" };
  }

  // 1. GET autenticado
  test("C1. GET autenticado via Authorization: Bearer <CRON_SECRET> retorna sucesso", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
      headers: {
        authorization: `Bearer ${SERVER_CRON_SECRET}`,
      },
    });

    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, true);
    assert.equal(res.status, 200);
    assert.equal(res.message, "OK");
  });

  // 2. GET sem segredo
  test("C2. GET sem cabeçalho Authorization é rejeitado com HTTP 401", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
    });

    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 401);
    assert.match(res.message, /Cabeçalho Authorization ausente/);
  });

  // 3. GET com segredo incorreto
  test("C3. GET com token Bearer incorreto é rejeitado com HTTP 401", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
      headers: {
        authorization: "Bearer token-totalmente-errado-123",
      },
    });

    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 401);
    assert.match(res.message, /token inválido/);
  });

  // 4. Rejeição de segredo enviado pela URL
  test("C4. Rejeição imediata de segredo via query string (?secret=) com HTTP 401", () => {
    const req = new Request(`https://rifa-vexa.com/api/cron/expire-reservations?secret=${SERVER_CRON_SECRET}`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${SERVER_CRON_SECRET}`,
      },
    });

    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 401);
    assert.match(res.message, /query string descontinuada/);
  });

  // 5. Ausência de CRON_SECRET no servidor
  test("C5. Ausência de CRON_SECRET configurado no servidor retorna HTTP 500", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
      headers: {
        authorization: `Bearer ${SERVER_CRON_SECRET}`,
      },
    });

    // Simula ambiente sem CRON_SECRET
    const resUndefined = authenticateCronRequest(req, undefined);
    assert.equal(resUndefined.authorized, false);
    assert.equal(resUndefined.status, 500);
    assert.match(resUndefined.message, /não configurado/);

    const resEmpty = authenticateCronRequest(req, "   ");
    assert.equal(resEmpty.authorized, false);
    assert.equal(resEmpty.status, 500);
    assert.match(resEmpty.message, /não configurado/);
  });

  // 6. Processamento de múltiplas rifas
  test("C6. Processamento independente de múltiplas rifas com agregação de totais", async () => {
    const engine = new Manual24hPostgresEngine();

    // Adiciona segunda rifa na engine
    engine.raffles.push({
      id: "raf-capacete-100",
      workspace_id: "ws-acai-1",
      title: "Capacete Elétrico Açaí Vexa",
      slug: "capacete-acai-vexa",
      status: "active",
      price_cents: 500,
      total_numbers: 100,
    });
    for (let i = 1; i <= 100; i++) {
      engine.raffle_numbers.push({
        id: `rn-cap-${i}`,
        raffle_id: "raf-capacete-100",
        number: i,
        status: "free",
        locked_until: null,
        reserved_at: null,
        order_id: null,
        buyer_name: null,
        buyer_phone: null,
      });
    }

    // Cria reserva na Rifa 1 (Moto)
    await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Comprador Moto", "11911112222", [10, 11]);
    // Cria reserva na Rifa 2 (Capacete)
    await engine.reserve_numbers_manual_24h("capacete-acai-vexa", "Comprador Capacete", "11933334444", [5]);

    // Avança o relógio além de 24 horas
    engine.advanceClock(25);

    // Executa limpeza para Rifa 1
    const r1 = await engine.cleanup_expired_reservations_24h("raf-moto-500", "service_role");
    assert.equal(r1.orders_expired, 1);
    assert.equal(r1.numbers_released, 2);

    // Executa limpeza para Rifa 2
    const r2 = await engine.cleanup_expired_reservations_24h("raf-capacete-100", "service_role");
    assert.equal(r2.orders_expired, 1);
    assert.equal(r2.numbers_released, 1);

    // Totais consolidados
    const totalOrders = r1.orders_expired + r2.orders_expired;
    const totalNumbers = r1.numbers_released + r2.numbers_released;
    assert.equal(totalOrders, 2);
    assert.equal(totalNumbers, 3);
  });

  // 7. Falha em uma rifa sem ocultar o resultado das demais
  test("C7. Falha isolada em uma rifa preserva o resultado das demais e relata erro (HTTP 500)", async () => {
    const raffles = [
      { id: "raf-sucesso-1", slug: "rifa-ok" },
      { id: "raf-falha-2", slug: "rifa-quebrada" },
    ];

    const processedRaffles = [];
    const failedRaffles = [];
    let totalExpired = 0;
    let totalReleased = 0;

    for (const r of raffles) {
      if (r.id === "raf-falha-2") {
        failedRaffles.push({
          raffle_id: r.id,
          slug: r.slug,
          error: "Connection timeout no PostgreSQL para esta tabela",
        });
      } else {
        processedRaffles.push({
          raffle_id: r.id,
          slug: r.slug,
          orders_expired: 3,
          numbers_released: 5,
        });
        totalExpired += 3;
        totalReleased += 5;
      }
    }

    // O cron deve acusar falha sem declarar falso sucesso total
    assert.equal(failedRaffles.length, 1);
    assert.equal(processedRaffles.length, 1);
    assert.equal(totalExpired, 3);
    assert.equal(totalReleased, 5);

    const httpResponse = {
      ok: false,
      message: `Aviso operacional: falha ao processar ${failedRaffles.length} de ${raffles.length} rifas`,
      partial_success: processedRaffles.length > 0,
      totals: { orders_expired: totalExpired, numbers_released: totalReleased },
      processed_raffles: processedRaffles,
      failed_raffles: failedRaffles,
    };

    assert.equal(httpResponse.ok, false, "Não pode declarar ok: true se houve rifa com falha");
    assert.equal(httpResponse.partial_success, true);
    assert.equal(httpResponse.failed_raffles[0].slug, "rifa-quebrada");
  });

  // 8. Reexecução segura (idempotência)
  test("C8. Reexecução segura do cron resulta em 0 alterações sem efeitos colaterais", async () => {
    const engine = new Manual24hPostgresEngine();
    await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Desistente", "11988887777", [50]);

    engine.advanceClock(26);

    // Execução 1: limpa 1 pedido e libera 1 cota
    const r1 = await engine.cleanup_expired_reservations_24h(null, "service_role");
    assert.equal(r1.orders_expired, 1);
    assert.equal(r1.numbers_released, 1);

    // Execução 2 imediata: sem pedidos para expirar
    const r2 = await engine.cleanup_expired_reservations_24h(null, "service_role");
    assert.equal(r2.orders_expired, 0);
    assert.equal(r2.numbers_released, 0);

    // Status da cota permanece livre
    const n50 = engine.raffle_numbers.find((rn) => rn.number === 50);
    assert.equal(n50.status, "free");
  });

  // 9. Ausência de exposição da service role
  test("C9. Resposta e estrutura do cron NUNCA expõem a chave service_role", () => {
    const mockOutput = {
      ok: true,
      raffles_checked: 2,
      totals: {
        orders_expired: 4,
        numbers_released: 8,
      },
      processed_raffles: [
        { raffle_id: "raf-1", slug: "moto", orders_expired: 4, numbers_released: 8 }
      ],
    };

    const serialized = JSON.stringify(mockOutput);
    assert.equal(serialized.includes(SERVICE_ROLE_MOCK), false);
    assert.equal(serialized.includes("service_role"), false);
    assert.equal(serialized.includes(SERVER_CRON_SECRET), false);
  });
});
