-- ==============================================================================
-- FASE 1: SEGURANÇA DAS RESERVAS, CONSISTÊNCIA FINANCEIRA E PREPARAÇÃO ASAAS
-- Projeto: Açaí Vexa — Campanha da Moto Elétrica (500 Números)
-- Data: 2026-11-22
-- ==============================================================================

-- 1. ESTRUTURA AUXILIAR E CAMPOS COMPLEMENTARES
-- Adiciona colunas complementares em raffles se ainda não existirem
alter table public.raffles add column if not exists prize_title text null;
alter table public.raffles add column if not exists prize_description text null;
alter table public.raffles add column if not exists draw_date timestamptz null;
alter table public.raffles add column if not exists payment_mode text null;
alter table public.raffles add column if not exists payment_instructions text null;
alter table public.raffles add column if not exists reserve_unit text not null default 'minutes';
alter table public.raffles add column if not exists reserve_value int not null default 15;

-- Adiciona coluna confirmed_at em raffle_numbers se não existir
alter table public.raffle_numbers add column if not exists confirmed_at timestamptz null;

-- 2. PREPARAÇÃO ASAAS NA TABELA PAYMENTS (SEM REDUNDÂNCIAS)
alter table public.payments add column if not exists asaas_id text unique null;
alter table public.payments add column if not exists asaas_status text null;
alter table public.payments add column if not exists pix_copy_paste text null;
alter table public.payments add column if not exists pix_qr_code_url text null;
alter table public.payments add column if not exists pix_qr_code_text text null;
alter table public.payments add column if not exists due_date timestamptz null;
alter table public.payments add column if not exists confirmed_at timestamptz null;
alter table public.payments add column if not exists webhook_payload jsonb null;
alter table public.payments add column if not exists updated_at timestamptz not null default now();

-- Índices de consulta rápida e integridade
create index if not exists idx_payments_asaas_id on public.payments(asaas_id);
create index if not exists idx_raffle_numbers_order_id on public.raffle_numbers(order_id);
create index if not exists idx_raffle_numbers_status_locked on public.raffle_numbers(raffle_id, status, locked_until);

-- ==============================================================================
-- ETAPA 1: RPC DE RESERVA ATÔMICA (ALL-OR-NOTHING, FOR UPDATE CONCORRENTE)
-- ==============================================================================
create or replace function public.reserve_numbers_atomic(
  p_raffle_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_numbers int[]
)
returns table(
  order_id uuid,
  public_token text,
  expires_at timestamptz,
  total_cents int,
  payment_id uuid,
  payment_status text
)
language plpgsql
security definer
as $$
declare
  v_raffle public.raffles%rowtype;
  v_order_id uuid;
  v_payment_id uuid;
  v_token text;
  v_expires timestamptz;
  v_total int;
  v_count int;
  v_sorted_numbers int[];
  v_num record;
  v_unit text;
  v_val int;
begin
  -- 1. Validação de parâmetros de entrada
  if p_buyer_name is null or length(trim(p_buyer_name)) < 2 then
    raise exception 'Nome do comprador é obrigatório (mínimo 2 caracteres)';
  end if;

  if p_buyer_phone is null or length(regexp_replace(p_buyer_phone, '\D', '', 'g')) < 10 then
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

  -- 3. Ordena os números deterministicamente (ASC) para prevenção estrita de deadlocks
  select array_agg(n order by n) into v_sorted_numbers
  from unnest(p_numbers) as n;

  -- 4. Verifica existência de todos os números na rifa
  select count(*) into v_count
  from public.raffle_numbers rn
  where rn.raffle_id = v_raffle.id
    and rn.number = any(v_sorted_numbers);

  if v_count <> array_length(v_sorted_numbers, 1) then
    raise exception 'Um ou mais números solicitados não existem nesta rifa';
  end if;

  -- 5. Bloqueio de linhas e verificação individual de disponibilidade (FOR UPDATE)
  for v_num in
    select rn.id, rn.number, rn.status, rn.locked_until, rn.order_id
    from public.raffle_numbers rn
    where rn.raffle_id = v_raffle.id
      and rn.number = any(v_sorted_numbers)
    order by rn.number
    for update
  loop
    -- Se já está pago, rejeita imediatamente
    if v_num.status = 'paid' then
      raise exception 'Número % indisponível (já foi pago)', v_num.number;
    end if;

    -- Se está reservado com lock ativo no tempo presente, rejeita
    if v_num.status = 'reserved' and v_num.locked_until is not null and v_num.locked_until > now() then
      raise exception 'Número % indisponível (já está reservado)', v_num.number;
    end if;
  end loop;

  -- 6. Calcula tempo de expiração da reserva
  v_unit := coalesce(v_raffle.reserve_unit, 'minutes');
  v_val := coalesce(v_raffle.reserve_value, v_raffle.reserve_minutes, 15);

  if v_unit = 'days' then
    v_expires := now() + make_interval(days => greatest(1, v_val));
  elsif v_unit = 'until_draw' then
    if v_raffle.draw_date is not null and v_raffle.draw_date > now() then
      v_expires := v_raffle.draw_date;
    else
      v_expires := now() + interval '15 minutes';
    end if;
  else
    -- Padrão em minutos
    v_expires := now() + make_interval(mins => greatest(5, v_val));
  end if;

  -- 7. Totalização e token público único
  v_total := v_raffle.price_cents * array_length(v_sorted_numbers, 1);
  v_token := encode(gen_random_bytes(16), 'hex');

  -- 8. Insere pedido
  insert into public.orders (
    workspace_id,
    raffle_id,
    public_token,
    buyer_name,
    buyer_phone,
    total_cents,
    status,
    expires_at
  )
  values (
    v_raffle.workspace_id,
    v_raffle.id,
    v_token,
    trim(p_buyer_name),
    regexp_replace(p_buyer_phone, '\D', '', 'g'),
    v_total,
    'pending',
    v_expires
  )
  returning id into v_order_id;

  -- 9. Insere itens do pedido
  insert into public.order_items (order_id, raffle_id, number)
  select v_order_id, v_raffle.id, unnest(v_sorted_numbers);

  -- 10. Atualiza números atômicos vinculando ao pedido
  update public.raffle_numbers rn
  set status = 'reserved',
      locked_until = v_expires,
      order_id = v_order_id,
      buyer_name = trim(p_buyer_name),
      buyer_phone = regexp_replace(p_buyer_phone, '\D', '', 'g'),
      updated_at = now()
  where rn.raffle_id = v_raffle.id
    and rn.number = any(v_sorted_numbers);

  -- 11. Insere pagamento pendente
  insert into public.payments (
    order_id,
    method,
    status,
    due_date
  )
  values (
    v_order_id,
    'pix_manual',
    'pending',
    v_expires
  )
  returning id into v_payment_id;

  -- 12. Retorna resumo atômico
  return query
  select
    v_order_id,
    v_token,
    v_expires,
    v_total,
    v_payment_id,
    'pending'::text;
end;
$$;

-- Permissões da RPC de reserva
revoke all on function public.reserve_numbers_atomic(text,text,text,int[]) from public;
grant execute on function public.reserve_numbers_atomic(text,text,text,int[]) to anon, authenticated, service_role;

-- ==============================================================================
-- ETAPA 2: RPC DE CONFIRMAÇÃO ATÔMICA E IDEMPOTENTE
-- ==============================================================================
create or replace function public.confirm_payment_atomic(
  p_payment_id uuid,
  p_confirmed_by uuid default null
)
returns table(
  order_id uuid,
  payment_id uuid,
  numbers_confirmed int,
  status text,
  already_confirmed boolean
)
language plpgsql
security definer
as $$
declare
  v_payment public.payments%rowtype;
  v_order public.orders%rowtype;
  v_count int;
  v_updated_numbers int;
begin
  -- 1. Trava o registro de pagamento
  select * into v_payment
  from public.payments
  where id = p_payment_id
  for update;

  if not found then
    raise exception 'Pagamento não encontrado: %', p_payment_id;
  end if;

  -- 2. Idempotência: se já confirmado anteriormente, retorna com status sem reexecutar
  if v_payment.status = 'confirmed' then
    select count(*) into v_count
    from public.raffle_numbers
    where order_id = v_payment.order_id and status = 'paid';

    return query select
      v_payment.order_id,
      v_payment.id,
      v_count,
      'confirmed'::text,
      true;
    return;
  end if;

  -- Se foi rejeitado formalmente, impede confirmação espúria
  if v_payment.status = 'rejected' then
    raise exception 'Pagamento rejeitado não pode ser confirmado';
  end if;

  -- 3. Trava o pedido
  select * into v_order
  from public.orders
  where id = v_payment.order_id
  for update;

  if not found then
    raise exception 'Pedido associado ao pagamento não encontrado';
  end if;

  -- 4. Validação de integridade dos números do pedido
  -- Os números devem ainda pertencer a este pedido
  select count(*) into v_count
  from public.raffle_numbers rn
  where rn.order_id = v_order.id
    and rn.status = 'reserved';

  if v_count = 0 then
    select count(*) into v_count
    from public.raffle_numbers rn
    where rn.order_id = v_order.id
      and rn.status = 'paid';

    if v_count = 0 then
      raise exception 'Nenhum número reservado válido encontrado para o pedido %. A reserva expirou ou os números foram liberados.', v_order.id;
    end if;
  end if;

  -- 5. Atualização conjunta e transacional dos três pilares:
  -- A) Pagamento: status 'confirmed' (enum payment_status)
  update public.payments
  set status = 'confirmed',
      confirmed_at = now(),
      updated_at = now()
  where id = v_payment.id;

  -- B) Pedido: status 'paid' (enum order_status)
  update public.orders
  set status = 'paid'
  where id = v_order.id;

  -- C) Números: status 'paid' (enum number_status) e confirmed_at
  update public.raffle_numbers
  set status = 'paid',
      confirmed_at = now(),
      updated_at = now()
  where order_id = v_order.id;

  get diagnostics v_updated_numbers = row_count;

  -- 6. Retorno de confirmação concluída
  return query select
    v_order.id,
    v_payment.id,
    v_updated_numbers,
    'confirmed'::text,
    false;
end;
$$;

-- Permissões da RPC de confirmação
revoke all on function public.confirm_payment_atomic(uuid,uuid) from public;
grant execute on function public.confirm_payment_atomic(uuid,uuid) to authenticated, service_role;

-- ==============================================================================
-- ETAPA 3: EXPIRAÇÃO SEGURA E LIBERAÇÃO CONTROLADA DE RESERVAS
-- ==============================================================================
create or replace function public.expire_order_reservations(
  p_order_id uuid
)
returns table(
  order_id uuid,
  numbers_released int,
  was_expired boolean
)
language plpgsql
security definer
as $$
declare
  v_order public.orders%rowtype;
  v_has_confirmed_payment boolean;
  v_released int := 0;
begin
  -- 1. Trava o pedido
  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido não encontrado: %', p_order_id;
  end if;

  -- 2. Proteção financeira absoluta: NUNCA expira pedido já pago
  if v_order.status = 'paid' then
    return query select v_order.id, 0, false;
    return;
  end if;

  -- 3. Verifica se existe pagamento confirmado para proteger pagamentos em trânsito
  select exists(
    select 1 from public.payments p
    where p.order_id = v_order.id
      and p.status = 'confirmed'
  ) into v_has_confirmed_payment;

  if v_has_confirmed_payment then
    -- Se há pagamento confirmado, reconcilia o pedido como pago em vez de liberar
    update public.orders set status = 'paid' where id = v_order.id;
    update public.raffle_numbers
    set status = 'paid', confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
    where order_id = v_order.id;

    return query select v_order.id, 0, false;
    return;
  end if;

  -- 4. Validação de prazo: só expira se o prazo expirou ou já está marcado como expirado
  if v_order.expires_at > now() and v_order.status <> 'expired' then
    return query select v_order.id, 0, false;
    return;
  end if;

  -- 5. Atualiza status do pedido para 'expired'
  update public.orders
  set status = 'expired'
  where id = v_order.id;

  -- 6. Libera estritamente os números associados a este pedido
  -- NUNCA toca em números 'paid' e valida a propriedade através de rn.order_id = v_order.id
  update public.raffle_numbers rn
  set status = 'free',
      locked_until = null,
      order_id = null,
      buyer_name = null,
      buyer_phone = null,
      updated_at = now()
  where rn.order_id = v_order.id
    and rn.status = 'reserved';

  get diagnostics v_released = row_count;

  return query select v_order.id, v_released, true;
end;
$$;

create or replace function public.cleanup_expired_reservations(
  p_raffle_id uuid default null
)
returns table(
  orders_expired int,
  numbers_released int
)
language plpgsql
security definer
as $$
declare
  v_rec record;
  v_orders_count int := 0;
  v_numbers_count int := 0;
  v_res record;
begin
  for v_rec in
    select o.id
    from public.orders o
    where o.status = 'pending'
      and o.expires_at < now()
      and (p_raffle_id is null or o.raffle_id = p_raffle_id)
    order by o.expires_at asc
    limit 100
  loop
    select * into v_res from public.expire_order_reservations(v_rec.id);
    if v_res.was_expired then
      v_orders_count := v_orders_count + 1;
      v_numbers_count := v_numbers_count + v_res.numbers_released;
    end if;
  end loop;

  return query select v_orders_count, v_numbers_count;
end;
$$;

-- Permissões das funções de expiração
revoke all on function public.expire_order_reservations(uuid) from public;
grant execute on function public.expire_order_reservations(uuid) to authenticated, anon, service_role;

revoke all on function public.cleanup_expired_reservations(uuid) from public;
grant execute on function public.cleanup_expired_reservations(uuid) to authenticated, service_role;
