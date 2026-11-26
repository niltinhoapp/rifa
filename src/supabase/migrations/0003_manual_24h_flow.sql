-- ==============================================================================
-- MIGRATION: 0003_manual_24h_flow.sql
-- PROJETO: Açaí Vexa — Campanha da Moto Elétrica (500 Números)
-- DIRETRIZ: Operação 100% Manual, Reserva Estrita de 24 Horas e Confirmação Transacional
-- DATA: 2026-11-22
-- ==============================================================================

-- 1. ESTRUTURA E CAMPOS AUXILIARES
alter table public.raffles add column if not exists prize_title text null;
alter table public.raffles add column if not exists prize_description text null;
alter table public.raffles add column if not exists draw_date timestamptz null;
alter table public.raffles add column if not exists payment_mode text not null default 'pix_manual';
alter table public.raffles add column if not exists payment_instructions text null;
alter table public.raffles add column if not exists reserve_unit text not null default 'hours';
alter table public.raffles add column if not exists reserve_value int not null default 24;

alter table public.raffle_numbers add column if not exists reserved_at timestamptz null;
alter table public.raffle_numbers add column if not exists confirmed_at timestamptz null;

alter table public.orders add column if not exists reserved_at timestamptz null default now();
alter table public.orders add column if not exists updated_at timestamptz null default now();

alter table public.payments add column if not exists confirmed_at timestamptz null;
alter table public.payments add column if not exists confirmed_by uuid null references auth.users(id);
alter table public.payments add column if not exists updated_at timestamptz not null default now();

-- 1.1 Proteção declarativa contra duplicidade de pagamentos por pedido
-- Verificação preventiva: garante que a migration falhe de maneira segura se houver duplicidades
do $$
declare
  v_dup_count int;
  v_dup_examples text;
begin
  select count(*) into v_dup_count
  from (
    select order_id
    from public.payments
    group by order_id
    having count(*) > 1
  ) dups;

  if v_dup_count > 0 then
    select string_agg(order_id::text || ' (' || c::text || ' pagamentos)', ', ')
    into v_dup_examples
    from (
      select order_id, count(*) as c
      from public.payments
      group by order_id
      having count(*) > 1
      limit 5
    ) s;

    raise exception 'MIGRATION ABORTADA: Foram encontrados % pedidos com pagamentos duplicados na tabela public.payments. Exemplos: %. É necessária resolução manual prévia sem exclusão automática.', v_dup_count, v_dup_examples;
  end if;
end $$;

-- Adiciona constraint UNIQUE em public.payments(order_id) se ainda não existir
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'uq_payments_order_id'
      and conrelid = 'public.payments'::regclass
  ) then
    alter table public.payments
      add constraint uq_payments_order_id unique (order_id);
  end if;
end $$;

-- Índices para integridade e performance
create index if not exists idx_orders_workspace_status on public.orders(workspace_id, status);
create index if not exists idx_orders_raffle_expires on public.orders(raffle_id, status, expires_at);
create index if not exists idx_raffle_numbers_order_status on public.raffle_numbers(order_id, status);
create index if not exists idx_payments_order_status on public.payments(order_id, status);

-- ==============================================================================
-- 2. RPC: RESERVA ATÔMICA COM VALIDADE ESTREITA DE 24 HORAS
-- ==============================================================================
create or replace function public.reserve_numbers_manual_24h(
  p_raffle_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_numbers int[]
)
returns table(
  order_id uuid,
  public_token text,
  reserved_at timestamptz,
  expires_at timestamptz,
  total_cents int
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_raffle public.raffles%rowtype;
  v_order_id uuid;
  v_token text;
  v_now timestamptz := clock_timestamp();
  v_expires timestamptz := v_now + interval '24 hours';
  v_total int;
  v_sorted_numbers int[];
  v_count int;
  v_num record;
  v_clean_phone text;
  v_clean_name text;
begin
  -- 1. Validações de entrada
  v_clean_name := trim(p_buyer_name);
  v_clean_phone := regexp_replace(p_buyer_phone, '\D', '', 'g');

  if v_clean_name is null or length(v_clean_name) < 2 then
    raise exception 'Nome do comprador é obrigatório (mínimo 2 caracteres)';
  end if;

  if v_clean_phone is null or length(v_clean_phone) < 10 then
    raise exception 'WhatsApp do comprador inválido (mínimo 10 dígitos com DDD)';
  end if;

  if p_numbers is null or array_length(p_numbers, 1) is null or array_length(p_numbers, 1) < 1 then
    raise exception 'Selecione pelo menos 1 número para reservar';
  end if;

  -- 2. Carrega a rifa ativa
  select * into v_raffle
  from public.raffles
  where slug = p_raffle_slug and status = 'active'
  limit 1;

  if not found then
    raise exception 'Rifa não encontrada ou inativa';
  end if;

  -- 3. Ordenação determinística ASC para prevenção absoluta de deadlocks
  select array_agg(n order by n) into v_sorted_numbers
  from unnest(p_numbers) as n;

  -- 4. Validação de existência de todas as cotas na rifa
  select count(*) into v_count
  from public.raffle_numbers rn
  where rn.raffle_id = v_raffle.id
    and rn.number = any(v_sorted_numbers);

  if v_count <> array_length(v_sorted_numbers, 1) then
    raise exception 'Um ou mais números solicitados não existem nesta rifa';
  end if;

  -- 5. Bloqueio exclusivo por linha das cotas solicitadas (FOR UPDATE)
  for v_num in
    select rn.number, rn.status, rn.locked_until
    from public.raffle_numbers rn
    where rn.raffle_id = v_raffle.id
      and rn.number = any(v_sorted_numbers)
    order by rn.number
    for update
  loop
    if v_num.status = 'paid' then
      raise exception 'Número % indisponível (já foi pago)', v_num.number;
    end if;

    if v_num.status = 'reserved' and v_num.locked_until is not null and v_num.locked_until > v_now then
      raise exception 'Número % indisponível (já está reservado)', v_num.number;
    end if;
  end loop;

  -- 6. Totalização financeira e geração do token público
  v_total := v_raffle.price_cents * array_length(v_sorted_numbers, 1);
  v_token := replace(gen_random_uuid()::text, '-', '');

  -- 7. Insere o pedido com prazo de 24 horas fixo em UTC
  insert into public.orders (
    workspace_id,
    raffle_id,
    public_token,
    buyer_name,
    buyer_phone,
    total_cents,
    status,
    expires_at,
    created_at,
    reserved_at,
    updated_at
  )
  values (
    v_raffle.workspace_id,
    v_raffle.id,
    v_token,
    v_clean_name,
    v_clean_phone,
    v_total,
    'pending',
    v_expires,
    v_now,
    v_now,
    v_now
  )
  returning id into v_order_id;

  -- 8. Insere os itens do pedido
  insert into public.order_items (order_id, raffle_id, number, created_at)
  select v_order_id, v_raffle.id, unnest(v_sorted_numbers), v_now;

  -- 9. Atualiza as cotas para reserved vinculadas atomicamente ao pedido
  update public.raffle_numbers rn
  set status = 'reserved',
      locked_until = v_expires,
      reserved_at = v_now,
      order_id = v_order_id,
      buyer_name = v_clean_name,
      buyer_phone = v_clean_phone,
      updated_at = v_now
  where rn.raffle_id = v_raffle.id
    and rn.number = any(v_sorted_numbers);

  -- 10. Cria o registro de pagamento manual pendente
  insert into public.payments (
    order_id,
    method,
    status,
    created_at,
    updated_at
  )
  values (
    v_order_id,
    'pix_manual',
    'pending',
    v_now,
    v_now
  );

  return query select v_order_id, v_token, v_now, v_expires, v_total;
end;
$$;

revoke all on function public.reserve_numbers_manual_24h(text, text, text, int[]) from public;
grant execute on function public.reserve_numbers_manual_24h(text, text, text, int[]) to anon, authenticated, service_role;

-- ==============================================================================
-- 3. RPC: CONFIRMAÇÃO MANUAL TRANSACIONAL PELO ADMINISTRADOR
-- ==============================================================================
create or replace function public.confirm_order_manual(
  p_order_id uuid,
  p_admin_id uuid default null
)
returns table(
  order_id uuid,
  numbers_confirmed int,
  status text,
  already_confirmed boolean
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_confirmed_by uuid;
  v_admin_role text;
  v_expected_numbers int[];
  v_actual_order_numbers_count int;
  v_locked_count int := 0;
  v_payment_count int;
  v_num record;
  v_now timestamptz := clock_timestamp();
begin
  -- 1. Trava o pedido com FOR UPDATE
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado: %', p_order_id;
  end if;

  -- 2. Validação estrita de autorização administrativa e isolamento de workspace
  if auth.uid() is not null then
    -- Chamada autenticada via Supabase Auth: identidade é estritamente vinculada a auth.uid()
    -- Impede qualquer personificação por meio de p_admin_id
    v_confirmed_by := auth.uid();

    -- Busca o papel explícito do usuário no workspace do pedido
    select wm.role into v_admin_role
    from public.workspace_members wm
    where wm.workspace_id = v_order.workspace_id
      and wm.user_id = auth.uid();

    if not found or v_admin_role not in ('owner', 'admin') then
      raise exception 'Acesso não autorizado: usuário não possui papel administrativo neste workspace';
    end if;
  else
    -- Chamada sem auth.uid(): restrita exclusivamente ao backend com papel service_role
    if current_setting('request.jwt.claim.role', true) <> 'service_role' and current_user <> 'service_role' then
      raise exception 'Acesso não autorizado: operação requer autenticação de administrador ou service_role';
    end if;
    v_confirmed_by := p_admin_id;
  end if;

  -- 3. Idempotência estrita: se já confirmado, retorna sem duplicar
  if v_order.status = 'paid' then
    select count(*) into v_locked_count
    from public.raffle_numbers
    where order_id = v_order.id and status = 'paid';

    return query select v_order.id, v_locked_count, 'paid'::text, true;
    return;
  end if;

  if v_order.status = 'cancelled' then
    raise exception 'Pedido cancelado não pode ser confirmado';
  end if;

  -- 4. REGRA OBRIGATÓRIA: Bloqueio estrito de pedido vencido (expires_at > clock_timestamp())
  if v_order.expires_at <= v_now then
    raise exception 'Confirmação recusada: O prazo de 24 horas deste pedido expirou em % (horário atual: %).', v_order.expires_at, v_now;
  end if;

  -- 5. Validação de integridade: seleciona e ordena as cotas esperadas de order_items
  select array_agg(oi.number order by oi.number asc) into v_expected_numbers
  from public.order_items oi
  where oi.order_id = v_order.id;

  if v_expected_numbers is null or array_length(v_expected_numbers, 1) is null or array_length(v_expected_numbers, 1) = 0 then
    raise exception 'Inconsistência estrutural: nenhum item encontrado para o pedido %', v_order.id;
  end if;

  -- Garante que não existem cotas adicionais no banco vinculadas a este pedido fora de order_items
  select count(*) into v_actual_order_numbers_count
  from public.raffle_numbers rn
  where rn.order_id = v_order.id;

  if v_actual_order_numbers_count <> array_length(v_expected_numbers, 1) then
    raise exception 'Confirmação recusada: divergência na quantidade de cotas vinculadas ao pedido (vinculadas: %, itens esperados: %)', v_actual_order_numbers_count, array_length(v_expected_numbers, 1);
  end if;

  -- 6. Bloqueia as cotas individualmente (SEM agregação com FOR UPDATE) em ordem crescente
  v_locked_count := 0;
  for v_num in
    select rn.id, rn.number, rn.status, rn.locked_until, rn.order_id
    from public.raffle_numbers rn
    where rn.raffle_id = v_order.raffle_id
      and rn.number = any(v_expected_numbers)
    order by rn.number asc
    for update
  loop
    if v_num.order_id is distinct from v_order.id then
      raise exception 'Confirmação recusada: cota % não pertence ao pedido % (pertence a: %)', v_num.number, v_order.id, v_num.order_id;
    end if;

    if v_num.status <> 'reserved' then
      raise exception 'Confirmação recusada: cota % está com status % (esperado: reserved)', v_num.number, v_num.status;
    end if;

    if v_num.locked_until is null or v_num.locked_until <= v_now then
      raise exception 'Confirmação recusada: a reserva da cota % expirou em %', v_num.number, v_num.locked_until;
    end if;

    v_locked_count := v_locked_count + 1;
  end loop;

  if v_locked_count <> array_length(v_expected_numbers, 1) then
    raise exception 'Confirmação recusada: nem todas as cotas esperadas foram bloqueadas (esperado: %, bloqueadas: %)', array_length(v_expected_numbers, 1), v_locked_count;
  end if;

  -- 7. Validação de cardinalidade e estado do pagamento
  select count(*) into v_payment_count
  from public.payments p
  where p.order_id = v_order.id;

  if v_payment_count = 0 then
    raise exception 'Inconsistência financeira: nenhum registro de pagamento encontrado para o pedido %', v_order.id;
  end if;

  if v_payment_count > 1 then
    raise exception 'Inconsistência financeira: múltiplos registros de pagamento encontrados para o pedido % (total: %)', v_order.id, v_payment_count;
  end if;

  -- Trava o pagamento único com FOR UPDATE
  select * into v_payment
  from public.payments p
  where p.order_id = v_order.id
  for update;

  if v_payment.status = 'rejected' then
    raise exception 'Confirmação recusada: o pagamento associado ao pedido % está rejeitado', v_order.id;
  end if;

  if v_payment.status <> 'pending' then
    raise exception 'Confirmação recusada: status de pagamento inválido para confirmação manual: % (esperado: pending)', v_payment.status;
  end if;

  -- 8. ATUALIZAÇÃO ATÔMICA CONJUNTA (TRI-PILAR)
  -- A) Pagamento: status 'confirmed' (enum payment_status)
  update public.payments
  set status = 'confirmed',
      paid_at = v_now,
      confirmed_at = v_now,
      confirmed_by = v_confirmed_by,
      updated_at = v_now
  where id = v_payment.id;

  -- B) Pedido: status 'paid' (enum order_status)
  update public.orders
  set status = 'paid',
      updated_at = v_now
  where id = v_order.id;

  -- C) Cotas: status 'paid' (enum number_status) e timestamp de confirmação
  update public.raffle_numbers
  set status = 'paid',
      confirmed_at = v_now,
      updated_at = v_now
  where order_id = v_order.id
    and status = 'reserved';

  return query select v_order.id, v_locked_count, 'paid'::text, false;
end;
$$;

revoke all on function public.confirm_order_manual(uuid, uuid) from public;
revoke all on function public.confirm_order_manual(uuid, uuid) from anon;
grant execute on function public.confirm_order_manual(uuid, uuid) to authenticated, service_role;

-- ==============================================================================
-- 4. RPC: HIGIENIZAÇÃO SEGURA DE RESERVAS EXPIRADAS APÓS 24 HORAS
-- ==============================================================================
-- Descarte preventivo da assinatura legada de 1 parâmetro (uuid) para eliminar sobrecarga ambígua
drop function if exists public.cleanup_expired_reservations_24h(uuid);

create or replace function public.cleanup_expired_reservations_24h(
  p_raffle_id uuid default null,
  p_batch_size int default 200
)
returns table(
  orders_expired int,
  numbers_released int,
  has_more boolean
)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_rec record;
  v_orders int := 0;
  v_nums int := 0;
  v_released int;
  v_scanned int := 0;
  v_has_more boolean := false;
  v_now timestamptz := clock_timestamp();
  v_effective_batch int := coalesce(p_batch_size, 200);
begin
  -- Exclusividade de Execução: apenas o backend administrativo (service_role) pode rodar a higienização
  if current_setting('request.jwt.claim.role', true) <> 'service_role' and current_user <> 'service_role' then
    raise exception 'Acesso restrito ao backend administrativo (service_role)';
  end if;

  if v_effective_batch < 1 or v_effective_batch > 1000 then
    v_effective_batch := 200;
  end if;

  for v_rec in
    select o.id, o.raffle_id, o.expires_at
    from public.orders o
    where o.status = 'pending'
      and o.expires_at <= v_now
      and (p_raffle_id is null or o.raffle_id = p_raffle_id)
      and not exists (
        select 1
        from public.payments p
        where p.order_id = o.id
          and p.status = 'confirmed'
      )
    order by o.expires_at asc
    for update of o skip locked
    limit v_effective_batch
  loop
    v_scanned := v_scanned + 1;

    -- Proteção Financeira Absoluta: NUNCA expira se houver pagamento confirmado
    if not exists (
      select 1 from public.payments
      where order_id = v_rec.id and status = 'confirmed'
    ) then
      update public.orders
      set status = 'expired',
          updated_at = v_now
      where id = v_rec.id;

      -- Libera EXCLUSIVAMENTE as cotas deste pedido que estejam em estado 'reserved'
      update public.raffle_numbers
      set status = 'free',
          locked_until = null,
          reserved_at = null,
          order_id = null,
          buyer_name = null,
          buyer_phone = null,
          updated_at = v_now
      where order_id = v_rec.id
        and status = 'reserved';

      get diagnostics v_released = row_count;
      v_orders := v_orders + 1;
      v_nums := v_nums + v_released;
    end if;
  end loop;

  -- Avalia se ainda restam pedidos expirados não processados
  -- Utiliza a quantidade de registros examinados (v_scanned) para não ser afetado por pedidos com pagamento confirmado
  if v_scanned >= v_effective_batch then
    select exists (
      select 1
      from public.orders o
      where o.status = 'pending'
        and o.expires_at <= v_now
        and (p_raffle_id is null or o.raffle_id = p_raffle_id)
        and not exists (
          select 1 from public.payments p
          where p.order_id = o.id and p.status = 'confirmed'
        )
    ) into v_has_more;
  end if;

  return query select v_orders, v_nums, v_has_more;
end;
$$;

revoke all on function public.cleanup_expired_reservations_24h(uuid, int) from public;
revoke all on function public.cleanup_expired_reservations_24h(uuid, int) from anon, authenticated;
grant execute on function public.cleanup_expired_reservations_24h(uuid, int) to service_role;
