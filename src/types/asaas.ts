/**
 * Definições e Tipos da Integração Asaas v3 (Pix & Cobranças)
 * Compatível com Sandbox e Produção
 */

export type AsaasBillingType = "PIX" | "BOLETO" | "CREDIT_CARD" | "UNDEFINED";

export type AsaasChargeStatus =
  | "PENDING"
  | "RECEIVED"
  | "CONFIRMED"
  | "OVERDUE"
  | "REFUNDED"
  | "RECEIVED_IN_CASH"
  | "REFUND_REQUESTED"
  | "REFUND_IN_PROGRESS"
  | "CHARGEBACK_REQUESTED"
  | "CHARGEBACK_DISPUTE"
  | "AWAITING_CHARGEBACK_REVERSAL"
  | "DUNNING_REQUESTED"
  | "DUNNING_RECEIVED"
  | "AWAITING_RISK_ANALYSIS";

export type AsaasWebhookEvent =
  | "PAYMENT_CREATED"
  | "PAYMENT_AWAITING_RISK_ANALYSIS"
  | "PAYMENT_APPROVED_BY_RISK_ANALYSIS"
  | "PAYMENT_REPROVED_BY_RISK_ANALYSIS"
  | "PAYMENT_UPDATED"
  | "PAYMENT_CONFIRMED"
  | "PAYMENT_RECEIVED"
  | "PAYMENT_ANTICIPATED"
  | "PAYMENT_OVERDUE"
  | "PAYMENT_DELETED"
  | "PAYMENT_RESTORED"
  | "PAYMENT_REFUNDED"
  | "PAYMENT_REFUND_IN_PROGRESS"
  | "PAYMENT_RECEIVED_IN_CASH_UNDONE"
  | "PAYMENT_CHARGEBACK_REQUESTED"
  | "PAYMENT_CHARGEBACK_DISPUTE"
  | "PAYMENT_AWAITING_CHARGEBACK_REVERSAL"
  | "PAYMENT_DUNNING_RECEIVED"
  | "PAYMENT_DUNNING_REQUESTED"
  | "PAYMENT_BANK_SLIP_VIEWED"
  | "PAYMENT_CHECKOUT_VIEWED";

/**
 * Payload recebido pelo Webhook do Asaas
 */
export interface AsaasWebhookPayload {
  event: AsaasWebhookEvent;
  payment: {
    object: "payment";
    id: string;
    customer: string;
    dateCreated: string;
    dueDate: string;
    value: number;
    netValue?: number;
    billingType: AsaasBillingType;
    status: AsaasChargeStatus;
    description?: string;
    externalReference?: string; // Usado para guardar o order_id do nosso sistema
    confirmedDate?: string;
    paymentDate?: string;
    clientPaymentDate?: string;
    originalValue?: number;
    interestValue?: number;
    deleted?: boolean;
    canBePaidAfterDueDate?: boolean;
    pixTransaction?: {
      id?: string;
      endToEndIdentifier?: string;
      qrCode?: {
        payload?: string;
        encodedImage?: string;
      };
    };
  };
}

/**
 * Dados de resposta do Pix QR Code do Asaas
 */
export interface AsaasPixQrCodeResponse {
  encodedImage: string; // Base64 da imagem do QR Code
  payload: string; // Código Pix Copia e Cola
  expirationDate: string;
}

/**
 * Parâmetros para criação de cobrança Pix no Asaas
 */
export interface CreateAsaasPixChargeInput {
  customer: string;
  billingType: "PIX";
  value: number;
  dueDate: string;
  description: string;
  externalReference: string; // order_id
  postalService?: boolean;
}

/**
 * Resposta de criação de cobrança no Asaas
 */
export interface AsaasChargeResponse {
  id: string;
  customer: string;
  dateCreated: string;
  dueDate: string;
  value: number;
  billingType: AsaasBillingType;
  status: AsaasChargeStatus;
  externalReference?: string;
  description?: string;
  invoiceUrl?: string;
}

/**
 * Helpers para verificação de status financeiro
 */
export function isAsaasPaymentSuccessful(eventOrStatus: string): boolean {
  const s = eventOrStatus.toUpperCase();
  return (
    s === "PAYMENT_CONFIRMED" ||
    s === "PAYMENT_RECEIVED" ||
    s === "CONFIRMED" ||
    s === "RECEIVED"
  );
}

export function isAsaasPaymentExpiredOrFailed(eventOrStatus: string): boolean {
  const s = eventOrStatus.toUpperCase();
  return (
    s === "PAYMENT_OVERDUE" ||
    s === "PAYMENT_DELETED" ||
    s === "PAYMENT_REFUNDED" ||
    s === "OVERDUE" ||
    s === "REFUNDED"
  );
}
