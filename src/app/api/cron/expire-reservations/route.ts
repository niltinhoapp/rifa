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

  // 1. Busca todas as rifas elegíveis via paginação determinística (sem limite da API)
  // Inclui 'draft', 'active', 'paused' e 'ended' para cobrir qualquer pedido pendente
  const PAGE_SIZE = 500;
  let page = 0;
  const allRaffles: Array<{ id: string; status: string; slug: string }> = [];

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    const { data: pageData, error: pageErr } = await sbAdmin
      .from("raffles")
      .select("id, status, slug")
      .in("status", ["draft", "active", "paused", "ended"])
      .order("id", { ascending: true })
      .range(from, to);

    // REGRA DE SEGURANÇA: Erro na consulta NUNCA executa limpeza global de fallback
    if (pageErr) {
      return NextResponse.json(
        {
          ok: false,
          message: "Falha ao consultar rifas elegíveis no banco",
          detail: pageErr.message,
        },
        { status: 500 }
      );
    }

    if (!pageData || pageData.length === 0) {
      break;
    }

    allRaffles.push(...pageData);

    if (pageData.length < PAGE_SIZE) {
      break;
    }

    page++;
  }

  // 2. Se a consulta for vazia (zero rifas), retorna sucesso limpo sem executar limpeza global
  if (allRaffles.length === 0) {
    return NextResponse.json({
      ok: true,
      raffles_checked: 0,
      totals: {
        orders_expired: 0,
        numbers_released: 0,
      },
      processed_raffles: [],
      has_more_pending: false,
    });
  }

  // 3. Processamento individualizado por rifa elegível (lotes de até 200 pedidos por execução)
  let totalOrdersExpired = 0;
  let totalNumbersReleased = 0;
  let hasMorePending = false;

  const processedRaffles: Array<{
    raffle_id: string;
    slug: string;
    orders_expired: number;
    numbers_released: number;
    has_more: boolean;
  }> = [];

  const failedRaffles: Array<{
    raffle_id: string;
    slug: string;
    error: string;
  }> = [];

  for (const raffle of allRaffles) {
    try {
      const { data, error } = await sbAdmin.rpc("cleanup_expired_reservations_24h", {
        p_raffle_id: raffle.id,
        p_batch_size: 200,
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
        const more = Boolean(res?.has_more);

        totalOrdersExpired += exp;
        totalNumbersReleased += rel;
        if (more) {
          hasMorePending = true;
        }

        processedRaffles.push({
          raffle_id: raffle.id,
          slug: raffle.slug,
          orders_expired: exp,
          numbers_released: rel,
          has_more: more,
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
        message: `Aviso operacional: falha ao processar ${failedRaffles.length} de ${allRaffles.length} rifas`,
        partial_success: processedRaffles.length > 0,
        totals: {
          orders_expired: totalOrdersExpired,
          numbers_released: totalNumbersReleased,
        },
        processed_raffles: processedRaffles,
        failed_raffles: failedRaffles,
        has_more_pending: hasMorePending,
      },
      { status: 500 }
    );
  }

  // 5. Sucesso completo
  return NextResponse.json({
    ok: true,
    raffles_checked: allRaffles.length,
    totals: {
      orders_expired: totalOrdersExpired,
      numbers_released: totalNumbersReleased,
    },
    processed_raffles: processedRaffles,
    has_more_pending: hasMorePending,
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
