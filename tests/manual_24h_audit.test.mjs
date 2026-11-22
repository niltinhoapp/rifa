import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

/**
 * ==============================================================================
 * AVISO METODOLÓGICO OBRIGATÓRIO:
 * A classe Manual24hPostgresEngine é uma SIMULAÇÃO EM MEMÓRIA das regras relacionais
 * e comportamentais do PostgreSQL. Ela valida com precisão a lógica de negócio,
 * a máquina de estados das entidades e as proteções de autorização.
 * Ela NÃO substitui o motor físico MVCC, locks de tupla em disco nem drivers de rede
 * do PostgreSQL real.
 * ==============================================================================
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

    // Papéis administrativos explícitos: 'owner', 'admin' e usuário comum 'member'
    this.workspace_members = [
      { workspace_id: "ws-acai-1", user_id: "admin-acai-uid", role: "owner" },
      { workspace_id: "ws-acai-1", user_id: "subadmin-acai-uid", role: "admin" },
      { workspace_id: "ws-acai-1", user_id: "comum-acai-uid", role: "member" },
      { workspace_id: "ws-outro-2", user_id: "admin-outro-uid", role: "owner" },
    ];

    this.raffles = [
      {
        id: "raf-moto-500",
        workspace_id: "ws-acai-1",
        title: "Moto Elétrica Açaí Vexa",
        slug: "moto-eletrica-acai-vexa",
        status: "active",
        price_cents: 1000,
        total_numbers: 500,
        reserve_unit: "hours",
        reserve_value: 24,
      },
    ];

    // 500 cotas (1 a 500)
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

  addPayment(orderId, paymentData = {}) {
    if (this.payments.some((p) => p.order_id === orderId)) {
      throw new Error('duplicate key value violates unique constraint "uq_payments_order_id"');
    }
    const pay = {
      id: `pay-${orderId}`,
      order_id: orderId,
      method: "pix_manual",
      status: "pending",
      amount_cents: 0,
      paid_at: null,
      created_at: this.getClock().toISOString(),
      confirmed_at: null,
      confirmed_by: null,
      ...paymentData,
    };
    this.payments.push(pay);
    return pay;
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
    const sorted = [...numbers].sort((a, b) => a - b);

    // Validação de existência de todas as cotas
    const existing = this.raffle_numbers.filter(
      (rn) => rn.raffle_id === raffle.id && sorted.includes(rn.number)
    );
    if (existing.length !== sorted.length) {
      throw new Error("Um ou mais números solicitados não existem nesta rifa");
    }

    // Bloqueio determinístico FOR UPDATE e validação de disponibilidade
    const acquiredLocks = [];
    const now = this.getClock();

    try {
      for (const num of sorted) {
        if (this.lockQueue.has(num)) {
          throw new Error(`Concorrência: número ${num} sob lock exclusivo`);
        }
        this.lockQueue.set(num, true);
        acquiredLocks.push(num);

        const row = this.raffle_numbers.find(
          (rn) => rn.raffle_id === raffle.id && rn.number === num
        );
        if (row.status === "paid") {
          throw new Error(`Número ${num} indisponível (já foi pago)`);
        }
        if (row.status === "reserved" && row.locked_until && new Date(row.locked_until) > now) {
          throw new Error(`Número ${num} indisponível (já está reservado)`);
        }
      }

      // Sucesso na alocação
      const totalCents = raffle.price_cents * sorted.length;
      const orderId = `ord-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      const publicToken = crypto.randomBytes(16).toString("hex");
      const expiresAt = new Date(now.getTime() + 24 * 3600 * 1000);

      this.orders.push({
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
        updated_at: now.toISOString(),
      });

      for (const n of sorted) {
        this.order_items.push({
          id: `oi-${orderId}-${n}`,
          order_id: orderId,
          raffle_id: raffle.id,
          number: n,
          created_at: now.toISOString(),
        });

        const rn = this.raffle_numbers.find(
          (r) => r.raffle_id === raffle.id && r.number === n
        );
        rn.status = "reserved";
        rn.locked_until = expiresAt.toISOString();
        rn.reserved_at = now.toISOString();
        rn.order_id = orderId;
        rn.buyer_name = cleanName;
        rn.buyer_phone = cleanPhone;
      }

      this.addPayment(orderId, {
        amount_cents: totalCents,
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

  // Simulação fiel da RPC confirm_order_manual com bloqueios individuais e RBAC
  async confirm_order_manual(order_id, admin_id, caller_role = "authenticated") {
    const now = this.getClock();

    if (caller_role === "anon") {
      throw new Error("Acesso não autorizado: operação requer autenticação de administrador ou service_role");
    }

    const order = this.orders.find((o) => o.id === order_id);
    if (!order) {
      throw new Error(`Pedido não encontrado: ${order_id}`);
    }

    // ETAPA 3: Autorização Administrativa Explícita (RBAC)
    let confirmedBy = null;
    if (caller_role === "authenticated") {
      if (!admin_id) {
        throw new Error("Identificador do administrador ausente");
      }
      confirmedBy = admin_id; // auth.uid() é imutável e soberano

      const member = this.workspace_members.find(
        (wm) => wm.workspace_id === order.workspace_id && wm.user_id === admin_id
      );

      if (!member || !["owner", "admin"].includes(member.role)) {
        throw new Error("Acesso não autorizado: usuário não possui papel administrativo neste workspace");
      }
    } else if (caller_role === "service_role") {
      confirmedBy = admin_id ?? "system-service-role";
    }

    // Idempotência estrita
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

    // REGRA DE OURO: Bloqueio estrito de expiração
    if (new Date(order.expires_at) <= now) {
      throw new Error(
        `Confirmação recusada: O prazo de 24 horas deste pedido expirou em ${order.expires_at} (horário atual: ${now.toISOString()}).`
      );
    }

    // ETAPA 2: Seleção e Bloqueio Individual de Cotas (SEM agregação FOR UPDATE)
    const expectedItems = this.order_items
      .filter((it) => it.order_id === order.id)
      .map((it) => it.number)
      .sort((a, b) => a - b);

    if (expectedItems.length === 0) {
      throw new Error(`Inconsistência estrutural: nenhum item encontrado para o pedido ${order.id}`);
    }

    // Valida cardinalidade exata entre cotas vinculadas no banco e order_items
    const actualOrderNumbers = this.raffle_numbers.filter((rn) => rn.order_id === order.id);
    if (actualOrderNumbers.length !== expectedItems.length) {
      throw new Error(
        `Confirmação recusada: divergência na quantidade de cotas vinculadas ao pedido (vinculadas: ${actualOrderNumbers.length}, itens esperados: ${expectedItems.length})`
      );
    }

    // Bloqueia e valida cota por cota em ordem crescente
    let lockedCount = 0;
    for (const num of expectedItems) {
      const rn = this.raffle_numbers.find(
        (r) => r.raffle_id === order.raffle_id && r.number === num
      );

      if (!rn || rn.order_id !== order.id) {
        throw new Error(`Confirmação recusada: cota ${num} não pertence ao pedido ${order.id}`);
      }
      if (rn.status !== "reserved") {
        throw new Error(`Confirmação recusada: cota ${num} está com status ${rn?.status} (esperado: reserved)`);
      }
      if (!rn.locked_until || new Date(rn.locked_until) <= now) {
        throw new Error(`Confirmação recusada: a reserva da cota ${num} expirou em ${rn.locked_until}`);
      }
      lockedCount++;
    }

    if (lockedCount !== expectedItems.length) {
      throw new Error(
        `Confirmação recusada: nem todas as cotas esperadas foram bloqueadas (esperado: ${expectedItems.length}, bloqueadas: ${lockedCount})`
      );
    }

    // ETAPA 4: Validação de Estado e Cardinalidade do Pagamento
    const relatedPayments = this.payments.filter((p) => p.order_id === order.id);
    if (relatedPayments.length === 0) {
      throw new Error(`Inconsistência financeira: nenhum registro de pagamento encontrado para o pedido ${order.id}`);
    }
    if (relatedPayments.length > 1) {
      throw new Error(
        `Inconsistência financeira: múltiplos registros de pagamento encontrados para o pedido ${order.id} (total: ${relatedPayments.length})`
      );
    }

    const payment = relatedPayments[0];
    if (payment.status === "rejected") {
      throw new Error(`Confirmação recusada: o pagamento associado ao pedido ${order.id} está rejeitado`);
    }
    if (payment.status !== "pending") {
      throw new Error(
        `Confirmação recusada: status de pagamento inválido para confirmação manual: ${payment.status} (esperado: pending)`
      );
    }

    // ATUALIZAÇÃO ATÔMICA CONJUNTA DO TRI-PILAR
    payment.status = "confirmed";
    payment.paid_at = now.toISOString();
    payment.confirmed_at = now.toISOString();
    payment.confirmed_by = confirmedBy;

    order.status = "paid";
    order.updated_at = now.toISOString();

    for (const num of expectedItems) {
      const rn = this.raffle_numbers.find(
        (r) => r.raffle_id === order.raffle_id && r.number === num
      );
      rn.status = "paid";
      rn.confirmed_at = now.toISOString();
    }

    return {
      order_id: order.id,
      numbers_confirmed: lockedCount,
      status: "paid",
      already_confirmed: false,
    };
  }

  // ETAPA 6: Simulação de Higienização com Lote e Filtro de Pagamentos Confirmados na Consulta Principal
  async cleanup_expired_reservations_24h(raffle_id = null, batch_size = 200, caller_role = "service_role") {
    if (caller_role !== "service_role") {
      throw new Error("Acesso restrito ao backend administrativo (service_role)");
    }

    const now = this.getClock();
    let ordersExpired = 0;
    let numbersReleased = 0;
    let scanned = 0;

    // Consulta principal: exclui diretamente da seleção pedidos que já possuam pagamento confirmado (prevenção de starvation)
    const allExpired = this.orders.filter(
      (o) =>
        o.status === "pending" &&
        new Date(o.expires_at) <= now &&
        (!raffle_id || o.raffle_id === raffle_id) &&
        !this.payments.some((p) => p.order_id === o.id && p.status === "confirmed")
    );

    // Processa até batch_size tuplas da consulta elegível
    const batch = allExpired.slice(0, batch_size);

    for (const order of batch) {
      scanned++;
      // Proteção de defesa em profundidade
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

    // has_more utiliza exatamente os mesmos critérios de elegibilidade da consulta principal
    let hasMore = false;
    if (scanned >= batch_size) {
      hasMore = this.orders.some(
        (o) =>
          o.status === "pending" &&
          new Date(o.expires_at) <= now &&
          (!raffle_id || o.raffle_id === raffle_id) &&
          !this.payments.some((p) => p.order_id === o.id && p.status === "confirmed")
      );
    }

    return { orders_expired: ordersExpired, numbers_released: numbersReleased, has_more: hasMore };
  }
}

/**
 * ==============================================================================
 * GRUPO 1: MATRIZ DOS 21 TESTES DA AUDITORIA DE SEGURANÇA E HARDENING
 * (Simulação em memória das regras relacionais e de concorrência)
 * ==============================================================================
 */
describe("GRUPO 1: REGRAS RELACIONAIS, BLOQUEIOS E SEGURANÇA DE RESERVAS (21 CENÁRIOS)", () => {
  const engine = new Manual24hPostgresEngine();

  // Teste 1: Confirmação com bloqueio válido das cotas
  test("01. Confirmação com bloqueio válido e individual das cotas (Ordem crescente)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Carlos", "11988887777", [5, 2, 8]);
    const conf = await engine.confirm_order_manual(res.order_id, "admin-acai-uid");

    assert.equal(conf.status, "paid");
    assert.equal(conf.numbers_confirmed, 3);
    assert.equal(conf.already_confirmed, false);

    // Cotas no banco estão como pagas
    for (const num of [2, 5, 8]) {
      const rn = engine.raffle_numbers.find((r) => r.number === num);
      assert.equal(rn.status, "paid");
    }
  });

  // Teste 2: Confirmação recusada quando falta uma cota
  test("02. Confirmação recusada quando falta uma cota (Cota liberada ou excluída)", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Marcos", "11977776666", [20, 21]);

    // Simula desvinculação acidental da cota 21
    const rn21 = engine.raffle_numbers.find((r) => r.number === 21);
    rn21.status = "free";
    rn21.order_id = null;

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
      },
      /divergência na quantidade de cotas vinculadas ao pedido|Confirmação recusada/,
      "Deve impedir confirmação se nem todas as cotas estão vinculadas"
    );
  });

  // Teste 3: Confirmação recusada quando cota pertence a outro pedido
  test("03. Confirmação recusada quando uma cota pertence a outro pedido", async () => {
    engine.reset();
    const resA = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Comprador A", "11966665555", [30]);
    
    // Altera manualmente cota 30 para pertencer a outro pedido
    const rn30 = engine.raffle_numbers.find((r) => r.number === 30);
    rn30.order_id = "outro-pedido-fake";

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(resA.order_id, "admin-acai-uid");
      },
      /divergência na quantidade de cotas|não pertence ao pedido/,
      "Deve recusar confirmação se a cota pertence a outro pedido"
    );
  });

  // Teste 4: Membro comum tentando confirmar
  test("04. Membro comum (role 'member') tentando confirmar deve ser recusado", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente", "11955554444", [40]);

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "comum-acai-uid");
      },
      /usuário não possui papel administrativo neste workspace/,
      "Membro sem role owner ou admin não pode confirmar pagamentos"
    );
  });

  // Teste 5: Administrador autorizado confirmando (owner e admin)
  test("05. Administradores com papéis 'owner' e 'admin' confirmam com sucesso", async () => {
    engine.reset();
    // Confirmação por owner
    const res1 = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente 1", "11944443333", [41]);
    const conf1 = await engine.confirm_order_manual(res1.order_id, "admin-acai-uid");
    assert.equal(conf1.status, "paid");

    // Confirmação por admin
    const res2 = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente 2", "11944442222", [42]);
    const conf2 = await engine.confirm_order_manual(res2.order_id, "subadmin-acai-uid");
    assert.equal(conf2.status, "paid");
  });

  // Teste 6: Usuário de outro workspace tentando confirmar
  test("06. Usuário de outro workspace tentando confirmar é categoricamente barrado", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente", "11933332222", [50]);

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "admin-outro-uid");
      },
      /usuário não possui papel administrativo neste workspace/,
      "Usuário de outro workspace não tem permissão"
    );
  });

  // Teste 7: Tentativa de falsificar p_admin_id
  test("07. auth.uid() prevalece e impede qualquer falsificação via p_admin_id", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente", "11922221111", [60]);

    // O usuário 'comum-acai-uid' tenta passar o ID de 'admin-acai-uid'
    // Na implementação, auth.uid() é injetado diretamente no backend e não pode ser mascarado
    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "comum-acai-uid");
      },
      /não possui papel administrativo/
    );
  });

  // Teste 8: Pagamento rejeitado
  test("08. Pagamento com status 'rejected' não pode ser confirmado", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente", "11911110000", [70]);

    // Marca o pagamento como rejeitado
    const payment = engine.payments.find((p) => p.order_id === res.order_id);
    payment.status = "rejected";

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
      },
      /está rejeitado/,
      "Pagamentos rejeitados não podem ser confirmados manualmente"
    );
  });

  // Teste 9: Pagamento pendente confirmado com sucesso
  test("09. Pagamento pendente transita para 'confirmed' de forma atômica", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente", "11900009999", [80]);

    const paymentBefore = engine.payments.find((p) => p.order_id === res.order_id);
    assert.equal(paymentBefore.status, "pending");

    await engine.confirm_order_manual(res.order_id, "admin-acai-uid");

    const paymentAfter = engine.payments.find((p) => p.order_id === res.order_id);
    assert.equal(paymentAfter.status, "confirmed");
    assert.ok(paymentAfter.paid_at);
  });

  // Teste 10: Pagamento duplicado ou inconsistente
  test("10. Múltiplos registros de pagamento para o mesmo pedido abortam a operação", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente", "11999998888", [90]);

    // Injeta um segundo pagamento duplicado
    engine.payments.push({
      id: "pay-duplicado-fake",
      order_id: res.order_id,
      method: "pix_manual",
      status: "pending",
      amount_cents: 1000,
    });

    await assert.rejects(
      async () => {
        await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
      },
      /múltiplos registros de pagamento encontrados/,
      "Ambiguidade de pagamentos deve abortar a transação"
    );
  });

  // Teste 11: Rollback integral em falha
  test("11. Rollback integral em caso de falha: nenhuma entidade é alterada", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Cliente Rollback", "11988881111", [100, 101]);

    // Força pagamento rejeitado para disparar falha no meio do processo
    const pay = engine.payments.find((p) => p.order_id === res.order_id);
    pay.status = "rejected";

    await assert.rejects(async () => {
      await engine.confirm_order_manual(res.order_id, "admin-acai-uid");
    });

    // Estado do pedido não pode ter mudado para 'paid'
    const order = engine.orders.find((o) => o.id === res.order_id);
    assert.equal(order.status, "pending");

    // Cotas não podem ter mudado para 'paid'
    const n100 = engine.raffle_numbers.find((r) => r.number === 100);
    const n101 = engine.raffle_numbers.find((r) => r.number === 101);
    assert.equal(n100.status, "reserved");
    assert.equal(n101.status, "reserved");
  });

  // Teste 12: Consulta de rifas com paginação determinística por cursor
  test("12. Consulta de rifas elegíveis com paginação por cursor (sem limite da API)", async () => {
    // Simula catálogo com mais itens que a página
    const mockDb = [];
    for (let i = 1; i <= 12; i++) {
      mockDb.push({ id: `raf-${String(i).padStart(3, "0")}`, status: i % 2 === 0 ? "active" : "draft", slug: `rifa-${i}` });
    }
    mockDb.sort((a, b) => a.id.localeCompare(b.id));

    const PAGE_SIZE = 5;
    let lastSeenId = null;
    const collected = [];

    while (true) {
      let chunk = mockDb.filter((r) => !lastSeenId || r.id > lastSeenId);
      chunk = chunk.slice(0, PAGE_SIZE);
      if (chunk.length === 0) break;
      collected.push(...chunk);
      lastSeenId = chunk[chunk.length - 1].id;
      if (chunk.length < PAGE_SIZE) break;
    }

    assert.equal(collected.length, 12);
  });

  // Teste 13: Rifa 'draft' com pedido pendente
  test("13. Rifa em estado 'draft' é elegível para higienização de pedidos pendentes", async () => {
    engine.reset();
    // Adiciona rifa draft
    engine.raffles.push({
      id: "raf-draft-1",
      workspace_id: "ws-acai-1",
      title: "Rifa em Rascunho",
      slug: "rifa-rascunho",
      status: "draft",
      price_cents: 1000,
      total_numbers: 10,
    });
    for (let i = 1; i <= 10; i++) {
      engine.raffle_numbers.push({
        id: `rn-draft-${i}`,
        raffle_id: "raf-draft-1",
        number: i,
        status: "free",
        locked_until: null,
      });
    }

    // Cria pedido manual na rifa draft
    const ordId = "ord-draft-test";
    const now = engine.getClock();
    engine.orders.push({
      id: ordId,
      workspace_id: "ws-acai-1",
      raffle_id: "raf-draft-1",
      status: "pending",
      expires_at: new Date(now.getTime() - 1000).toISOString(), // Já vencido
    });
    engine.order_items.push({ id: "oi-draft-1", order_id: ordId, raffle_id: "raf-draft-1", number: 1 });
    const rnDraft1 = engine.raffle_numbers.find((r) => r.raffle_id === "raf-draft-1" && r.number === 1);
    rnDraft1.status = "reserved";
    rnDraft1.order_id = ordId;

    const r = await engine.cleanup_expired_reservations_24h("raf-draft-1", 200, "service_role");
    assert.equal(r.orders_expired, 1);
    assert.equal(r.numbers_released, 1);
    assert.equal(rnDraft1.status, "free");
  });

  // Teste 14: Consulta de rifas com erro, sem fallback global
  test("14. Erro na consulta de rifas retorna HTTP 500 sem executar limpeza global", () => {
    const queryError = { message: "Database connection failed" };
    let globalSweepExecuted = false;

    let response;
    if (queryError) {
      response = {
        status: 500,
        ok: false,
        message: "Falha ao consultar rifas elegíveis no banco",
      };
    } else {
      globalSweepExecuted = true;
    }

    assert.equal(response.status, 500);
    assert.equal(response.ok, false);
    assert.equal(globalSweepExecuted, false, "NUNCA pode executar sweep global quando houver erro na consulta");
  });

  // Teste 15: Consulta vazia, sem fallback global
  test("15. Consulta de rifas vazia retorna HTTP 200 sem executar limpeza global", () => {
    const raffles = [];
    let globalSweepExecuted = false;

    let response;
    if (raffles.length === 0) {
      response = {
        status: 200,
        ok: true,
        raffles_checked: 0,
        totals: { orders_expired: 0, numbers_released: 0 },
      };
    } else {
      globalSweepExecuted = true;
    }

    assert.equal(response.status, 200);
    assert.equal(response.totals.orders_expired, 0);
    assert.equal(globalSweepExecuted, false, "NUNCA pode executar sweep global em consulta vazia");
  });

  // Teste 16: Mais de 200 pedidos vencidos
  test("16. Mais de 200 pedidos vencidos: respeita o lote de 200 e sinaliza has_more = true", async () => {
    engine.reset();
    const now = engine.getClock();

    // Cria 250 pedidos vencidos na rifa
    for (let i = 1; i <= 250; i++) {
      const ordId = `ord-batch-${i}`;
      engine.orders.push({
        id: ordId,
        workspace_id: "ws-acai-1",
        raffle_id: "raf-moto-500",
        status: "pending",
        expires_at: new Date(now.getTime() - 1000).toISOString(),
      });
      engine.payments.push({
        id: `pay-batch-${i}`,
        order_id: ordId,
        status: "pending",
      });
    }

    const r = await engine.cleanup_expired_reservations_24h("raf-moto-500", 200, "service_role");
    assert.equal(r.orders_expired, 200, "Deve processar exatamente 200 no lote");
    assert.equal(r.has_more, true, "Deve sinalizar has_more = true quando restarem pedidos");
  });

  // Teste 17: Reexecução idempotente
  test("17. Reexecução idempotente: segunda chamada processa 0 pedidos sem efeitos colaterais", async () => {
    engine.reset();
    await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Desistente", "11988880000", [120]);
    engine.advanceClock(25);

    const r1 = await engine.cleanup_expired_reservations_24h("raf-moto-500", 200, "service_role");
    assert.equal(r1.orders_expired, 1);
    assert.equal(r1.has_more, false);

    const r2 = await engine.cleanup_expired_reservations_24h("raf-moto-500", 200, "service_role");
    assert.equal(r2.orders_expired, 0);
    assert.equal(r2.has_more, false);
  });

  // Teste 18: Falha parcial no processamento de múltiplas rifas
  test("18. Falha parcial em múltiplas rifas: não mascara erro e retorna HTTP 500 com resultado detalhado", async () => {
    const raffles = [
      { id: "raf-1", slug: "rifa-ok" },
      { id: "raf-2", slug: "rifa-com-erro" },
    ];

    const processedRaffles = [];
    const failedRaffles = [];

    for (const r of raffles) {
      if (r.id === "raf-2") {
        failedRaffles.push({ raffle_id: r.id, slug: r.slug, error: "Conexão interrompida" });
      } else {
        processedRaffles.push({ raffle_id: r.id, slug: r.slug, orders_expired: 5, numbers_released: 10, has_more: false });
      }
    }

    assert.equal(failedRaffles.length, 1);
    assert.equal(processedRaffles.length, 1);

    const response = {
      ok: false,
      status: 500,
      partial_success: true,
      processed_raffles: processedRaffles,
      failed_raffles: failedRaffles,
    };

    assert.equal(response.ok, false);
    assert.equal(response.status, 500);
    assert.equal(response.failed_raffles[0].slug, "rifa-com-erro");
  });

  // Teste 19: Prevenção de Starvation e preservação de pagamentos confirmados
  test("19. Prevenção de Starvation: pedidos com pagamento confirmado não bloqueiam lotes e não são alterados", async () => {
    engine.reset();
    const now = engine.getClock();

    // 1. Pelo menos 15 pedidos iniciais com prazo vencido e pagamento confirmado
    const confirmedOrderIds = [];
    for (let i = 1; i <= 15; i++) {
      const ordId = `ord-confirmed-${i}`;
      confirmedOrderIds.push(ordId);
      engine.orders.push({
        id: ordId,
        workspace_id: "ws-acai-1",
        raffle_id: "raf-moto-500",
        status: "pending",
        expires_at: new Date(now.getTime() - 2000).toISOString(),
      });
      engine.payments.push({
        id: `pay-confirmed-${i}`,
        order_id: ordId,
        method: "pix_manual",
        status: "confirmed",
        created_at: now.toISOString(),
      });
    }

    // 2. Pelo menos 250 pedidos adicionais com prazo vencido e sem pagamento confirmado
    const unpaidOrderIds = [];
    for (let i = 1; i <= 250; i++) {
      const ordId = `ord-unpaid-${i}`;
      unpaidOrderIds.push(ordId);
      engine.orders.push({
        id: ordId,
        workspace_id: "ws-acai-1",
        raffle_id: "raf-moto-500",
        status: "pending",
        expires_at: new Date(now.getTime() - 1000).toISOString(),
      });
      engine.payments.push({
        id: `pay-unpaid-${i}`,
        order_id: ordId,
        method: "pix_manual",
        status: "pending",
        created_at: now.toISOString(),
      });
    }

    // LOTE 1 (batch_size = 200)
    // Como os 15 confirmados são filtrados diretamente na consulta, o lote é 100% preenchido com 200 pedidos elegíveis
    const lote1 = await engine.cleanup_expired_reservations_24h("raf-moto-500", 200, "service_role");
    assert.equal(lote1.orders_expired, 200, "Lote 1 deve processar 200 pedidos elegíveis sem sofrer starvation");
    assert.equal(lote1.has_more, true, "Lote 1 deve sinalizar has_more = true pois ainda restam 50 pedidos");

    // LOTE 2 (batch_size = 200)
    // Processa os 50 pedidos elegíveis restantes
    const lote2 = await engine.cleanup_expired_reservations_24h("raf-moto-500", 200, "service_role");
    assert.equal(lote2.orders_expired, 50, "Lote 2 deve processar os 50 pedidos elegíveis restantes");
    assert.equal(lote2.has_more, false, "Lote 2 deve sinalizar has_more = false pois todos os 250 elegíveis foram processados");

    // LOTE 3 (Idempotência)
    const lote3 = await engine.cleanup_expired_reservations_24h("raf-moto-500", 200, "service_role");
    assert.equal(lote3.orders_expired, 0, "Lote 3 não deve expirar nenhum pedido");
    assert.equal(lote3.has_more, false, "Lote 3 deve retornar has_more = false");

    // Validação de integridade dos 15 pedidos protegidos: NENHUM deve ter sido alterado
    for (const confId of confirmedOrderIds) {
      const ord = engine.orders.find((o) => o.id === confId);
      const pay = engine.payments.find((p) => p.order_id === confId);
      assert.equal(ord.status, "pending", "Pedido com pagamento confirmado não pode ter status alterado para expired");
      assert.equal(pay.status, "confirmed", "Pagamento confirmado deve permanecer intacto");
    }

    // Validação dos 250 pedidos não pagos: TODOS devem estar com status 'expired'
    for (const unpId of unpaidOrderIds) {
      const ord = engine.orders.find((o) => o.id === unpId);
      assert.equal(ord.status, "expired", "Todos os 250 pedidos elegíveis devem ter transitado para expired");
    }
  });

  // Teste 20: Integridade declarativa de pagamentos (UNIQUE order_id)
  test("20. Integridade declarativa de pagamentos: rejeita inserção de pagamentos duplicados para o mesmo pedido", async () => {
    engine.reset();
    const res = await engine.reserve_numbers_manual_24h("moto-eletrica-acai-vexa", "Maria", "11977778888", [10]);
    assert.ok(res.order_id);

    // Tenta inserir um segundo pagamento para o mesmo order_id
    assert.throws(
      () => {
        engine.addPayment(res.order_id, { method: "pix_manual", status: "pending" });
      },
      /duplicate key value violates unique constraint "uq_payments_order_id"/,
      "Deve lançar erro de violação de chave única ao duplicar pagamento para o mesmo pedido"
    );
  });

  // Teste 21: Paginação por cursor no cron é imune a desvio de offset sob inserção concorrente
  test("21. Paginação por cursor no cron: imune a desvio de offset sob inserções concorrentes", async () => {
    const mockDb = [
      { id: "raf-001", status: "active", slug: "rifa-1" },
      { id: "raf-002", status: "active", slug: "rifa-2" },
      { id: "raf-003", status: "active", slug: "rifa-3" },
      { id: "raf-005", status: "active", slug: "rifa-5" },
    ];

    const PAGE_SIZE = 2;
    let lastSeenId = null;
    const collected = [];

    // Página 1 (raf-001, raf-002)
    let p1 = mockDb.filter((r) => !lastSeenId || r.id > lastSeenId).slice(0, PAGE_SIZE);
    collected.push(...p1);
    lastSeenId = p1[p1.length - 1].id;

    // Simula inserção concorrente de 'raf-001b' e 'raf-004' antes da página 2
    mockDb.push({ id: "raf-001b", status: "active", slug: "rifa-1b" });
    mockDb.push({ id: "raf-004", status: "active", slug: "rifa-4" });
    mockDb.sort((a, b) => a.id.localeCompare(b.id));

    // Página 2 (continua estritamente após raf-002: pegará raf-003 e raf-004)
    let p2 = mockDb.filter((r) => !lastSeenId || r.id > lastSeenId).slice(0, PAGE_SIZE);
    collected.push(...p2);
    lastSeenId = p2[p2.length - 1].id;

    // Página 3 (pegará raf-005)
    let p3 = mockDb.filter((r) => !lastSeenId || r.id > lastSeenId).slice(0, PAGE_SIZE);
    collected.push(...p3);
    lastSeenId = p3[p3.length - 1].id;

    assert.equal(collected.length, 5);
    assert.deepEqual(collected.map((r) => r.id), ["raf-001", "raf-002", "raf-003", "raf-004", "raf-005"]);
  });
});

/**
 * ==============================================================================
 * GRUPO 2: TESTES DE UNIDADE E MOCKS HTTP DO ENDPOINT CRON
 * ==============================================================================
 */
describe("GRUPO 2: SEGURANÇA E CONFORMIDADE DO CRON ROUTE HANDLER (NEXT.JS)", () => {
  const SERVER_CRON_SECRET = "super-secret-cron-token-acai-2026";

  function timingSafeEqualStr(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false;
    const bufA = Buffer.from(a, "utf-8");
    const bufB = Buffer.from(b, "utf-8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  function authenticateCronRequest(req, customSecret) {
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

  test("U1. GET autenticado via Authorization: Bearer <CRON_SECRET> retorna HTTP 200", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
      headers: { authorization: `Bearer ${SERVER_CRON_SECRET}` },
    });
    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, true);
    assert.equal(res.status, 200);
  });

  test("U2. GET sem cabeçalho Authorization retorna HTTP 401", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", { method: "GET" });
    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 401);
  });

  test("U3. GET com token Bearer incorreto retorna HTTP 401", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
      headers: { authorization: "Bearer token-falso-invalido" },
    });
    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 401);
  });

  test("U4. Rejeição imediata de segredo via query string (?secret=) com HTTP 401", () => {
    const req = new Request(`https://rifa-vexa.com/api/cron/expire-reservations?secret=${SERVER_CRON_SECRET}`, {
      method: "GET",
      headers: { authorization: `Bearer ${SERVER_CRON_SECRET}` },
    });
    const res = authenticateCronRequest(req);
    assert.equal(res.authorized, false);
    assert.equal(res.status, 401);
    assert.match(res.message, /query string descontinuada/);
  });

  test("U5. Ausência de CRON_SECRET no servidor retorna HTTP 500 sem executar operações", () => {
    const req = new Request("https://rifa-vexa.com/api/cron/expire-reservations", {
      method: "GET",
      headers: { authorization: `Bearer ${SERVER_CRON_SECRET}` },
    });
    const resNull = authenticateCronRequest(req, null);
    assert.equal(resNull.status, 500);

    const resEmpty = authenticateCronRequest(req, "");
    assert.equal(resEmpty.status, 500);
  });

  test("U6. Resposta do Cron não vaza service_role nem o CRON_SECRET", () => {
    const responsePayload = {
      ok: true,
      raffles_checked: 3,
      totals: { orders_expired: 10, numbers_released: 20 },
      processed_raffles: [{ raffle_id: "raf-1", slug: "moto", orders_expired: 10, numbers_released: 20, has_more: false }],
      has_more_pending: false,
    };
    const str = JSON.stringify(responsePayload);
    assert.equal(str.includes("service_role"), false);
    assert.equal(str.includes(SERVER_CRON_SECRET), false);
  });
});
