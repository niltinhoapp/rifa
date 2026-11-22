/**
 * Definições de Tipos e Enums Internos do Sistema de Pagamentos e Rifas
 * Base de dados: Supabase (PostgreSQL)
 */

export type PaymentMethod = "pix_manual" | "gateway";

/**
 * Status do pagamento na tabela `public.payments`
 * Corresponde ao enum PostgreSQL `payment_status`
 */
export type PaymentStatus = "pending" | "confirmed" | "rejected";

/**
 * Status do pedido na tabela `public.orders`
 * Corresponde ao enum PostgreSQL `order_status`
 */
export type OrderStatus = "pending" | "paid" | "cancelled" | "expired";

/**
 * Status de cada cota/número na tabela `public.raffle_numbers`
 * Corresponde ao enum PostgreSQL `number_status`
 */
export type NumberStatus = "free" | "reserved" | "paid" | "cancelled" | "expired";

/**
 * Status da rifa na tabela `public.raffles`
 */
export type RaffleStatus = "draft" | "active" | "paused" | "ended";

/**
 * Unidade de tempo para bloqueio de reserva
 */
export type ReserveUnit = "minutes" | "days" | "until_draw";

/**
 * Registro de pagamento interno com campos de integração Asaas
 */
export interface PaymentRecord {
  id: string;
  order_id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  proof_url?: string | null;
  asaas_id?: string | null;
  asaas_status?: string | null;
  pix_copy_paste?: string | null;
  pix_qr_code_url?: string | null;
  pix_qr_code_text?: string | null;
  due_date?: string | null;
  confirmed_at?: string | null;
  webhook_payload?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string;
}

/**
 * Retorno da RPC `reserve_numbers_atomic`
 */
export interface AtomicReservationResult {
  order_id: string;
  public_token: string;
  expires_at: string;
  total_cents: number;
  payment_id: string;
  payment_status: string;
}

/**
 * Retorno da RPC `confirm_payment_atomic`
 */
export interface AtomicConfirmationResult {
  order_id: string;
  payment_id: string;
  numbers_confirmed: number;
  status: string;
  already_confirmed: boolean;
}

/**
 * Retorno da RPC `expire_order_reservations`
 */
export interface ExpireReservationResult {
  order_id: string;
  numbers_released: number;
  was_expired: boolean;
}
