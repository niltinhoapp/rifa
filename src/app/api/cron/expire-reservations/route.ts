import "server-only";
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Comparação em tempo constante para mitigar ataques de temporização (Timing Attacks).
 * Garante tempo de execução idêntico independente da posição do primeiro caractere divergente.
 */
function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Autenticação estrita do Cron Job.
 * 
 * Regras Obrigatórias:
 * 1. Exige CRON_SECRET configurado no servidor (não aceita nulo ou vazio -> HTTP 500).
 * 2. Rejeição explícita de segredo enviado por query string (?secret= -> HTTP 401).
 * 3. Exige exclusivamente cabeçalho Authorization: Bearer <CRON_SECRET>.
 * 4. Validação por comparação em tempo constante.
 * 5. Não registra o segredo nos logs do servidor.
 */
function authenticateCronRequest(req: Request): {
  authorized: boolean;
  status: number;
  message: string;
} {
  const serverSecret = process.env.CRON_SECRET?.trim();
  if (!serverSecret) {
    return {
      authorized: false,
      status: 500,
      message: "CRON_SECRET não configurado no servidor",
    };
  }

  // Rejeição imediata de segredo via query string
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

/**
 * Função interna de processamento das rifas elegíveis.
 * Utilizada tanto pelo GET (Vercel Cron) quanto pelo POST (compatibilidade).
 * 
 * Diretrizes Operacionais:
 * 1. Não aceita parâmetros arbitrários do cliente para escolher rifas.
 * 2. Lista todas as rifas elegíveis no banco via cliente administrativo.
 * 3. Executa a RPC cleanup_expired_reservations_24h para cada rifa.
 * 4. Trata falhas individuais sem mascarar erros das demais rifas.
 * 5. Não declara sucesso total se houver rifas com falha.
 */
async function handleCron(req: Request): Promise<NextResponse> {
  const auth = authenticateCronRequest(req);
  if (!auth.authorized) {
    return NextResponse.json(
      { ok: false, message: auth.message },
      { status: auth.status }
    );
  }

  let sbAdmin;
  try {
    sbAdmin = getSupabaseAdminClient();
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, message: "Falha na inicialização do cliente administrativo" },
      { status: 500 }
    );
  }

  // 1. Busca todas as rifas ativas ou finalizadas que possam ter reservas pendentes
  const { data: raffles, error: rafflesErr } = await sbAdmin
    .from("raffles")
    .select("id, title, slug, status")
    .in("status", ["active", "paused", "ended"]);

  if (rafflesErr) {
    // Falha operacional ao consultar rifas: tenta sweep global via RPC e relata erro
    const { data: fallbackData, error: fallbackErr } = await sbAdmin.rpc(
      "cleanup_expired_reservations_24h",
      { p_raffle_id: null }
    );

    if (fallbackErr) {
      return NextResponse.json(
        {
          ok: false,
          message: "Falha geral ao processar limpeza de reservas",
          detail: fallbackErr.message,
        },
        { status: 500 }
      );
    }

    const fbRow = Array.isArray(fallbackData) ? fallbackData[0] : fallbackData;
    return NextResponse.json({
      ok: true,
      mode: "global_sweep_fallback",
      totals: {
        orders_expired: fbRow?.orders_expired ?? 0,
        numbers_released: fbRow?.numbers_released ?? 0,
      },
    });
  }

  // 2. Se não houver rifas cadastradas, executa sweep global de prevenção
  if (!raffles || raffles.length === 0) {
    const { data: emptyData, error: emptyErr } = await sbAdmin.rpc(
      "cleanup_expired_reservations_24h",
      { p_raffle_id: null }
    );

    if (emptyErr) {
      return NextResponse.json(
        { ok: false, message: emptyErr.message },
        { status: 500 }
      );
    }

    const row = Array.isArray(emptyData) ? emptyData[0] : emptyData;
    return NextResponse.json({
      ok: true,
      raffles_checked: 0,
      totals: {
        orders_expired: row?.orders_expired ?? 0,
        numbers_released: row?.numbers_released ?? 0,
      },
    });
  }

  // 3. Processamento individualizado por rifa elegível
  let totalOrdersExpired = 0;
  let totalNumbersReleased = 0;
  const processedRaffles: Array<{
    raffle_id: string;
    slug: string;
    orders_expired: number;
    numbers_released: number;
  }> = [];

  const failedRaffles: Array<{
    raffle_id: string;
    slug: string;
    error: string;
  }> = [];

  for (const raffle of raffles) {
    try {
      const { data, error } = await sbAdmin.rpc("cleanup_expired_reservations_24h", {
        p_raffle_id: raffle.id,
      });

      if (error) {
        failedRaffles.push({
          raffle_id: raffle.id,
          slug: raffle.slug,
          error: error.message,
        });
      } else {
        const res = Array.isArray(data) ? data[0] : data;
        const exp = res?.orders_expired ?? 0;
        const rel = res?.numbers_released ?? 0;

        totalOrdersExpired += exp;
        totalNumbersReleased += rel;

        processedRaffles.push({
          raffle_id: raffle.id,
          slug: raffle.slug,
          orders_expired: exp,
          numbers_released: rel,
        });
      }
    } catch (err: any) {
      failedRaffles.push({
        raffle_id: raffle.id,
        slug: raffle.slug,
        error: err?.message ?? "Exceção inesperada na execução da rifa",
      });
    }
  }

  // 4. Verificação de integridade operacional: não declarar sucesso total se houver falhas
  if (failedRaffles.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        message: `Aviso operacional: falha ao processar ${failedRaffles.length} de ${raffles.length} rifas`,
        partial_success: processedRaffles.length > 0,
        totals: {
          orders_expired: totalOrdersExpired,
          numbers_released: totalNumbersReleased,
        },
        processed_raffles: processedRaffles,
        failed_raffles: failedRaffles,
      },
      { status: 500 }
    );
  }

  // 5. Sucesso completo
  return NextResponse.json({
    ok: true,
    raffles_checked: raffles.length,
    totals: {
      orders_expired: totalOrdersExpired,
      numbers_released: totalNumbersReleased,
    },
    processed_raffles: processedRaffles,
  });
}

/**
 * Método GET — Padrão utilizado pelo Vercel Cron.
 */
export async function GET(req: Request) {
  return handleCron(req);
}

/**
 * Método POST — Compatibilidade com disparadores manuais e webhooks externos.
 */
export async function POST(req: Request) {
  return handleCron(req);
}
