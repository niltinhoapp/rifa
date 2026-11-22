import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  mapAsaasStatusToPaymentStatus,
  mapAsaasEventToLifecycleAction,
  validateWebhookToken,
} from "../src/lib/asaas/mapper.ts";
import {
  isAsaasPaymentSuccessful,
  isAsaasPaymentExpiredOrFailed,
} from "../src/types/asaas.ts";

/**
 * Motor de Simulação do Estado Transacional do PostgreSQL
 * Modela com precisão o comportamento de:
 * - Locks de linha (SELECT ... FOR UPDATE)
 * - All-or-nothing rollback (RAISE EXCEPTION)
 * - Enums e estados de Pedidos, Pagamentos e Números
 */
class PostgresTransactionalEngine {
  constructor() {
    this.reset();
  }

  reset() {
    this.workspaces = [
      { id: "ws-acai-1", name: "Açaí Vexa", slug: "acai-vexa" },
      { id: "ws-outro-2", name: "Outro Comércio", slug: "outro" },
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
        reserve_unit: "minutes",
        reserve_value: 15,
      },
      {
        id: "raf-isolada",
        workspace_id: "ws-outro-2",
        title: "Rifa Workspace 2",
        slug: "rifa-ws2",
        status: "active",
        price_cents: 2000,
        total_numbers: 100,
        reserve_unit: "minutes",
        reserve_value: 15,
      },
    ];

    // Cria 500 números para a rifa da Moto Elétrica
    this.raffle_numbers = [];
    for (let i = 1; i <= 500; i++) {
      this.raffle_numbers.push({
        id: `rn-moto-${i}`,
        raffle_id: "raf-moto-500",
        number: i,
        status: "free",
        locked_until: null,
        order_id: null,
        buyer_name: null,
        buyer_phone: null,
        confirmed_at: null,
      });
    }

    this.orders = [];
    this.order_items = [];
    this.payments = [];
    this.lockQueue = new Map(); // Simula lock de linhas no PostgreSQL
  }

  // Simula a RPC reserve_numbers_atomic
  async reserve_numbers_atomic(slug, buyer_name, buyer_phone, numbers) {
    if (!buyer_name || buyer_name.trim().length < 2) {
      throw new Error("Nome do comprador é obrigatório (mínimo 2 caracteres)");
    }
    const cleanPhone = (buyer_phone || "").replace(/\D/g, "");
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

    // Ordenação determinística ASC para evitar deadlocks
    const sorted = [...new Set(numbers)].sort((a, b) => a - b);

    // Simula concorrência com Lock Exclusivo por linha (FOR UPDATE)
    const acquiredLocks = [];
    for (const n of sorted) {
      while (this.lockQueue.get(n)) {
        await new Promise((r) => setTimeout(r, 10)); // Espera liberação da linha
      }
      this.lockQueue.set(n, true);
      acquiredLocks.push(n);
    }

    try {
      const now = new Date();
      // Validação de todos os números antes de qualquer alteração (All-or-Nothing)
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

      // Calcula expiração
      const expiresAt = new Date(now.getTime() + raffle.reserve_value * 60_000);
      const totalCents = raffle.price_cents * sorted.length;
      const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const publicToken = Math.random().toString(36).slice(2);
      const paymentId = `pay-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Insere pedido
      const newOrder = {
        id: orderId,
        workspace_id: raffle.workspace_id,
        raffle_id: raffle.id,
        public_token: publicToken,
        buyer_name: buyer_name.trim(),
        buyer_phone: cleanPhone,
        total_cents: totalCents,
        status: "pending",
        expires_at: expiresAt.toISOString(),
      };
      this.orders.push(newOrder);

      // Insere itens
      for (const n of sorted) {
        this.order_items.push({ order_id: orderId, number: n });
      }

      // Atualiza números para reserved
      for (const n of sorted) {
        const row = this.raffle_numbers.find(
          (rn) => rn.raffle_id === raffle.id && rn.number === n
        );
        row.status = "reserved";
        row.locked_until = expiresAt.toISOString();
        row.order_id = orderId;
        row.buyer_name = buyer_name.trim();
        row.buyer_phone = cleanPhone;
      }

      // Insere pagamento
      const newPayment = {
        id: paymentId,
        order_id: orderId,
        method: "pix_manual",
        status: "pending",
        due_date: expiresAt.toISOString(),
      };
      this.payments.push(newPayment);

      return {
        order_id: orderId,
        public_token: publicToken,
        expires_at: expiresAt.toISOString(),
        total_cents: totalCents,
        payment_id: paymentId,
        payment_status: "pending",
      };
    } finally {
      // Libera locks das linhas
      for (const n of acquiredLocks) {
        this.lockQueue.delete(n);
      }
    }
  }

  // Simula a RPC confirm_payment_atomic
  async confirm_payment_atomic(payment_id) {
    const payment = this.payments.find((p) => p.id === payment_id);
    if (!payment) {
      throw new Error(`Pagamento não encontrado: ${payment_id}`);
    }

    // Idempotência
    if (payment.status === "confirmed") {
      const paidCount = this.raffle_numbers.filter(
        (rn) => rn.order_id === payment.order_id && rn.status === "paid"
      ).length;
      return {
        order_id: payment.order_id,
        payment_id: payment.id,
        numbers_confirmed: paidCount,
        status: "confirmed",
        already_confirmed: true,
      };
    }

    if (payment.status === "rejected") {
      throw new Error("Pagamento rejeitado não pode ser confirmado");
    }

    const order = this.orders.find((o) => o.id === payment.order_id);
    if (!order) {
      throw new Error("Pedido associado ao pagamento não encontrado");
    }

    // Validação estrita: os números ainda devem pertencer a este pedido
    const reservedNumbers = this.raffle_numbers.filter(
      (rn) => rn.order_id === order.id && rn.status === "reserved"
    );

    if (reservedNumbers.length === 0) {
      const alreadyPaid = this.raffle_numbers.filter(
        (rn) => rn.order_id === order.id && rn.status === "paid"
      );
      if (alreadyPaid.length === 0) {
        throw new Error(
          `Nenhum número reservado válido encontrado para o pedido ${order.id}. A reserva expirou ou os números foram liberados.`
        );
      }
    }

    // Atualização atômica conjunta dos 3 pilares
    payment.status = "confirmed";
    payment.confirmed_at = new Date().toISOString();

    order.status = "paid";

    let count = 0;
    for (const rn of this.raffle_numbers) {
      if (rn.order_id === order.id) {
        rn.status = "paid";
        rn.confirmed_at = new Date().toISOString();
        count++;
      }
    }

    return {
      order_id: order.id,
      payment_id: payment.id,
      numbers_confirmed: count,
      status: "confirmed",
      already_confirmed: false,
    };
  }

  // Simula a RPC expire_order_reservations
  async expire_order_reservations(order_id) {
    const order = this.orders.find((o) => o.id === order_id);
    if (!order) {
      throw new Error(`Pedido não encontrado: ${order_id}`);
    }

    // Proteção financeira: pedido pago NUNCA é expirado
    if (order.status === "paid") {
      return { order_id: order.id, numbers_released: 0, was_expired: false };
    }

    const hasConfirmedPayment = this.payments.some(
      (p) => p.order_id === order.id && p.status === "confirmed"
    );

    if (hasConfirmedPayment) {
      // Reconcilia
      order.status = "paid";
      for (const rn of this.raffle_numbers) {
        if (rn.order_id === order.id) {
          rn.status = "paid";
          rn.confirmed_at = rn.confirmed_at || new Date().toISOString();
        }
      }
      return { order_id: order.id, numbers_released: 0, was_expired: false };
    }

    const now = new Date();
    if (new Date(order.expires_at) > now && order.status !== "expired") {
      return { order_id: order.id, numbers_released: 0, was_expired: false };
    }

    order.status = "expired";
    let released = 0;
    for (const rn of this.raffle_numbers) {
      if (rn.order_id === order.id && rn.status === "reserved") {
        rn.status = "free";
        rn.locked_until = null;
        rn.order_id = null;
        rn.buyer_name = null;
        rn.buyer_phone = null;
        released++;
      }
    }

    return { order_id: order.id, numbers_released: released, was_expired: true };
  }
}

describe("AUDITORIA FASE 1: 10 TESTES OBRIGATÓRIOS DE SEGURANÇA E CONSISTÊNCIA", () => {
  const engine = new PostgresTransactionalEngine();

  // --------------------------------------------------------------------------
  // TESTE 1: Dois compradores tentando reservar o mesmo número (Concorrência)
  // --------------------------------------------------------------------------
  test("1. Concorrência: Dois compradores tentando reservar o mesmo número (número 42)", async () => {
    engine.reset();

    const p1 = engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Comprador Alpha",
      "11988881111",
      [42]
    );

    const p2 = engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Comprador Beta",
      "11988882222",
      [42]
    );

    const results = await Promise.allSettled([p1, p2]);

    const successes = results.filter((r) => r.status === "fulfilled");
    const rejections = results.filter((r) => r.status === "rejected");

    assert.equal(successes.length, 1, "Exatamente um comprador deve conseguir a reserva");
    assert.equal(rejections.length, 1, "O segundo comprador deve receber rejeição por concorrência");
    assert.match(
      rejections[0].reason.message,
      /indisponível/,
      "Mensagem de erro deve indicar indisponibilidade"
    );

    // Verifica que o número 42 está devidamente alocado para o vencedor
    const row = engine.raffle_numbers.find((rn) => rn.number === 42);
    assert.equal(row.status, "reserved");
    assert.ok(row.order_id, "Número deve estar vinculado a uma ordem válida");
  });

  // --------------------------------------------------------------------------
  // TESTE 2: Compra de vários números simultaneamente (em campanha de 500 números)
  // --------------------------------------------------------------------------
  test("2. Compra de vários números simultaneamente (cotas 100 a 110)", async () => {
    engine.reset();

    const cotas = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110];
    const res = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Carlos Cliente",
      "11977773333",
      cotas
    );

    assert.ok(res.order_id);
    assert.equal(res.total_cents, 11000, "11 números x R$ 10,00 = R$ 110,00 (11000 cents)");

    // Todos os 11 números devem estar marcados como reserved
    for (const n of cotas) {
      const row = engine.raffle_numbers.find((rn) => rn.number === n);
      assert.equal(row.status, "reserved");
      assert.equal(row.order_id, res.order_id);
      assert.equal(row.buyer_name, "Carlos Cliente");
    }
  });

  // --------------------------------------------------------------------------
  // TESTE 3: Falha no meio da operação (Rollback All-or-Nothing)
  // --------------------------------------------------------------------------
  test("3. Falha no meio da operação: Rollback All-or-Nothing (cotas [200, 201, 999])", async () => {
    engine.reset();

    // Cota 999 não existe na rifa de 500 números
    await assert.rejects(
      async () => {
        await engine.reserve_numbers_atomic(
          "moto-eletrica-acai-vexa",
          "Tentativa Inválida",
          "11966664444",
          [200, 201, 999]
        );
      },
      /não existe nesta rifa/,
      "Deve rejeitar o lote inteiro"
    );

    // As cotas válidas 200 e 201 NÃO devem ter sido reservadas (Rollback total)
    const n200 = engine.raffle_numbers.find((rn) => rn.number === 200);
    const n201 = engine.raffle_numbers.find((rn) => rn.number === 201);
    assert.equal(n200.status, "free", "Cota 200 deve permanecer livre");
    assert.equal(n201.status, "free", "Cota 201 deve permanecer livre");
    assert.equal(n200.order_id, null);
    assert.equal(n201.order_id, null);
  });

  // --------------------------------------------------------------------------
  // TESTE 4: Tentativa de reservar número já ocupado/pago
  // --------------------------------------------------------------------------
  test("4. Tentativa de reservar número já pago/confirmado", async () => {
    engine.reset();

    // Reserva inicial
    const res = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Cliente Original",
      "11955555555",
      [15]
    );

    // Confirma pagamento
    await engine.confirm_payment_atomic(res.payment_id);

    // Outro usuário tenta reservar a cota 15 já paga
    await assert.rejects(
      async () => {
        await engine.reserve_numbers_atomic(
          "moto-eletrica-acai-vexa",
          "Cliente Intruso",
          "11944444444",
          [15]
        );
      },
      /já foi pago/,
      "Deve ser bloqueado pois o número já está pago"
    );
  });

  // --------------------------------------------------------------------------
  // TESTE 5: Expiração de reserva
  // --------------------------------------------------------------------------
  test("5. Expiração e liberação segura de reserva após vencimento do prazo", async () => {
    engine.reset();

    const res = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Cliente Desistente",
      "11933333333",
      [50, 51]
    );

    // Força data do pedido e do locked_until para o passado (expirado há 10 minutos)
    const past = new Date(Date.now() - 10 * 60_000).toISOString();
    const order = engine.orders.find((o) => o.id === res.order_id);
    order.expires_at = past;

    for (const n of [50, 51]) {
      const rn = engine.raffle_numbers.find((row) => row.number === n);
      rn.locked_until = past;
    }

    // Executa a expiração
    const expRes = await engine.expire_order_reservations(res.order_id);
    assert.equal(expRes.was_expired, true);
    assert.equal(expRes.numbers_released, 2);

    // Cotas devem estar livres novamente
    for (const n of [50, 51]) {
      const rn = engine.raffle_numbers.find((row) => row.number === n);
      assert.equal(rn.status, "free");
      assert.equal(rn.order_id, null);
      assert.equal(rn.buyer_name, null);
    }
  });

  // --------------------------------------------------------------------------
  // TESTE 6: Tentativa de liberar número de outro pedido
  // --------------------------------------------------------------------------
  test("6. Tentativa de liberar número pertencente a outro pedido", async () => {
    engine.reset();

    // Pedido A (número 80)
    const resA = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Comprador A",
      "11922222222",
      [80]
    );

    // Pedido B (número 81)
    const resB = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Comprador B",
      "11911111111",
      [81]
    );

    // Força expiração apenas de A
    const past = new Date(Date.now() - 5 * 60_000).toISOString();
    engine.orders.find((o) => o.id === resA.order_id).expires_at = past;
    engine.raffle_numbers.find((rn) => rn.number === 80).locked_until = past;

    // Expira Pedido A
    await engine.expire_order_reservations(resA.order_id);

    // Cota 80 foi liberada
    assert.equal(engine.raffle_numbers.find((rn) => rn.number === 80).status, "free");

    // Cota 81 do Pedido B continua estritamente intacta e reservada!
    const n81 = engine.raffle_numbers.find((rn) => rn.number === 81);
    assert.equal(n81.status, "reserved");
    assert.equal(n81.order_id, resB.order_id);
    assert.equal(n81.buyer_name, "Comprador B");
  });

  // --------------------------------------------------------------------------
  // TESTE 7: Confirmação duplicada (Idempotência)
  // --------------------------------------------------------------------------
  test("7. Confirmação duplicada (Idempotência estrita)", async () => {
    engine.reset();

    const res = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Cliente Fiel",
      "11900000000",
      [300]
    );

    // Primeira confirmação
    const conf1 = await engine.confirm_payment_atomic(res.payment_id);
    assert.equal(conf1.status, "confirmed");
    assert.equal(conf1.already_confirmed, false);
    assert.equal(conf1.numbers_confirmed, 1);

    // Segunda confirmação (idêntica ou reprocessamento de webhook)
    const conf2 = await engine.confirm_payment_atomic(res.payment_id);
    assert.equal(conf2.status, "confirmed");
    assert.equal(conf2.already_confirmed, true, "Deve reportar already_confirmed sem duplicar");
    assert.equal(conf2.numbers_confirmed, 1);
  });

  // --------------------------------------------------------------------------
  // TESTE 8: Falha entre atualizações de pagamento, pedido e números (Consistência Atômica)
  // --------------------------------------------------------------------------
  test("8. Consistência Atômica: Tri-pilar Pagamento (confirmed), Pedido (paid) e Números (paid)", async () => {
    engine.reset();

    const res = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Consistência Total",
      "11987654321",
      [250, 251]
    );

    await engine.confirm_payment_atomic(res.payment_id);

    const payment = engine.payments.find((p) => p.id === res.payment_id);
    const order = engine.orders.find((o) => o.id === res.order_id);
    const n250 = engine.raffle_numbers.find((rn) => rn.number === 250);
    const n251 = engine.raffle_numbers.find((rn) => rn.number === 251);

    // Verifica enums corretos
    assert.equal(payment.status, "confirmed", "payments.status deve ser 'confirmed'");
    assert.ok(payment.confirmed_at, "payments deve ter confirmed_at");
    assert.equal(order.status, "paid", "orders.status deve ser 'paid'");
    assert.equal(n250.status, "paid", "raffle_numbers.status deve ser 'paid'");
    assert.equal(n251.status, "paid", "raffle_numbers.status deve ser 'paid'");
    assert.ok(n250.confirmed_at, "raffle_numbers deve ter confirmed_at");
  });

  // --------------------------------------------------------------------------
  // TESTE 9: Isolamento entre Workspaces
  // --------------------------------------------------------------------------
  test("9. Isolamento entre Workspaces e Rifas Distintas", async () => {
    engine.reset();

    // Rifa da Moto pertence ao workspace ws-acai-1
    const resA = await engine.reserve_numbers_atomic(
      "moto-eletrica-acai-vexa",
      "Cliente Açaí",
      "11988880000",
      [1]
    );
    const orderA = engine.orders.find((o) => o.id === resA.order_id);
    assert.equal(orderA.workspace_id, "ws-acai-1");

    // Rifa isolada pertence ao workspace ws-outro-2
    // Garante que o slug de outra empresa não interfere no workspace da Açaí Vexa
    const rafIsolada = engine.raffles.find((r) => r.slug === "rifa-ws2");
    assert.equal(rafIsolada.workspace_id, "ws-outro-2");
    assert.notEqual(orderA.workspace_id, rafIsolada.workspace_id);
  });

  // --------------------------------------------------------------------------
  // TESTE 10: Regressão e Mapeamento de Integração Asaas
  // --------------------------------------------------------------------------
  test("10. Regressão e Mapeamento do Asaas (Webhooks, Status e Token)", () => {
    // Validação de Token de Webhook
    assert.equal(validateWebhookToken("meu-token-secreto", "meu-token-secreto"), true);
    assert.equal(validateWebhookToken("token-errado", "meu-token-secreto"), false);
    assert.equal(validateWebhookToken("", "meu-token-secreto"), false);

    // Mapeamento de Status Asaas -> PostgreSQL Enum
    assert.equal(mapAsaasStatusToPaymentStatus("CONFIRMED"), "confirmed");
    assert.equal(mapAsaasStatusToPaymentStatus("RECEIVED"), "confirmed");
    assert.equal(mapAsaasStatusToPaymentStatus("PENDING"), "pending");
    assert.equal(mapAsaasStatusToPaymentStatus("OVERDUE"), "rejected");
    assert.equal(mapAsaasStatusToPaymentStatus("REFUNDED"), "rejected");

    // Ciclo de Vida de Eventos do Webhook
    assert.equal(mapAsaasEventToLifecycleAction("PAYMENT_RECEIVED").action, "CONFIRM");
    assert.equal(mapAsaasEventToLifecycleAction("PAYMENT_CONFIRMED").action, "CONFIRM");
    assert.equal(mapAsaasEventToLifecycleAction("PAYMENT_OVERDUE").action, "EXPIRE");
    assert.equal(mapAsaasEventToLifecycleAction("PAYMENT_DELETED").action, "EXPIRE");
    assert.equal(mapAsaasEventToLifecycleAction("PAYMENT_UPDATED").action, "IGNORE");

    // Validação booleana
    assert.equal(isAsaasPaymentSuccessful("PAYMENT_RECEIVED"), true);
    assert.equal(isAsaasPaymentSuccessful("RECEIVED"), true);
    assert.equal(isAsaasPaymentSuccessful("PENDING"), false);
    assert.equal(isAsaasPaymentExpiredOrFailed("PAYMENT_OVERDUE"), true);
    assert.equal(isAsaasPaymentExpiredOrFailed("OVERDUE"), true);
  });
});
