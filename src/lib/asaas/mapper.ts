import type { PaymentStatus, OrderStatus } from "../../types/payment.ts";
import type { AsaasChargeStatus, AsaasWebhookEvent } from "../../types/asaas.ts";

/**
 * Mapeia o status do Asaas para o status de pagamento interno (PostgreSQL enum `payment_status`)
 */
export function mapAsaasStatusToPaymentStatus(
  status: AsaasChargeStatus | string
): PaymentStatus {
  switch (status?.toUpperCase()) {
    case "CONFIRMED":
    case "RECEIVED":
    case "RECEIVED_IN_CASH":
      return "confirmed";

    case "OVERDUE":
    case "REFUNDED":
    case "CHARGEBACK_REQUESTED":
    case "CHARGEBACK_DISPUTE":
    case "AWAITING_CHARGEBACK_REVERSAL":
      return "rejected";

    case "PENDING":
    case "AWAITING_RISK_ANALYSIS":
    default:
      return "pending";
  }
}

/**
 * Mapeia um evento de Webhook do Asaas para a ação de confirmação ou expiração interna
 */
export function mapAsaasEventToLifecycleAction(event: AsaasWebhookEvent | string): {
  action: "CONFIRM" | "EXPIRE" | "IGNORE";
  reason: string;
} {
  switch (event) {
    case "PAYMENT_CONFIRMED":
    case "PAYMENT_RECEIVED":
      return {
        action: "CONFIRM",
        reason: "Pagamento Pix confirmado pela instituição financeira",
      };

    case "PAYMENT_OVERDUE":
    case "PAYMENT_DELETED":
      return {
        action: "EXPIRE",
        reason: "Cobrança Pix expirou ou foi cancelada no Asaas",
      };

    case "PAYMENT_CREATED":
    case "PAYMENT_UPDATED":
    case "PAYMENT_ANTICIPATED":
    default:
      return {
        action: "IGNORE",
        reason: "Evento informativo sem alteração de estado final",
      };
  }
}

/**
 * Valida se o token do Webhook recebido confere com o configurado
 */
export function validateWebhookToken(
  receivedToken: string | null | undefined,
  expectedToken: string
): boolean {
  if (!expectedToken || !receivedToken) return false;
  return receivedToken.trim() === expectedToken.trim();
}
