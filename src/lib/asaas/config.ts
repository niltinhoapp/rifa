/**
 * Configuração e Ambiente Asaas
 * Suporte nativo a Sandbox e Produção
 */

export interface AsaasConfig {
  apiKey: string;
  baseUrl: string;
  webhookToken: string;
  isSandbox: boolean;
}

export function getAsaasConfig(): AsaasConfig {
  const env = (process.env.ASAAS_ENVIRONMENT ?? "sandbox").toLowerCase();
  const isSandbox = env !== "production";

  const baseUrl = isSandbox
    ? "https://sandbox.asaas.com/api/v3"
    : "https://api.asaas.com/v3";

  return {
    apiKey: process.env.ASAAS_API_KEY ?? "",
    baseUrl,
    webhookToken: process.env.ASAAS_WEBHOOK_TOKEN ?? "",
    isSandbox,
  };
}
