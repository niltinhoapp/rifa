-- Extensions
create extension if not exists pgcrypto;

-- =========================
-- MULTI-TENANT (workspaces)
-- =========================
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Helper: checar se usuário é membro do workspace
create or replace function public.is_workspace_member(p_workspace_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = p_workspace_id
      and wm.user_id = auth.uid()
  );
$$;

-- =========================
-- RIFAS
-- =========================
create type public.raffle_status as enum ('draft','active','paused','ended');

create table if not exists public.raffles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  description text null,
  price_cents int not null check (price_cents > 0),
  total_numbers int not null check (total_numbers > 0),
  slug text not null unique,
  status public.raffle_status not null default 'draft',
  reserve_minutes int not null default 15 check (reserve_minutes between 5 and 180),
  created_at timestamptz not null default now()
);

create type public.number_status as enum ('free','reserved','paid','cancelled','expired');

create table if not exists public.raffle_numbers (
  id uuid primary key default gen_random_uuid(),
  raffle_id uuid not null references public.raffles(id) on delete cascade,
  number int not null,
  status public.number_status not null default 'free',
  locked_until timestamptz null,
  order_id uuid null,
  buyer_name text null,
  buyer_phone text null,
  updated_at timestamptz not null default now(),
  unique (raffle_id, number)
);

-- =========================
-- PEDIDOS
-- =========================
create type public.order_status as enum ('pending','paid','cancelled','expired');

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  raffle_id uuid not null references public.raffles(id) on delete cascade,
  public_token text not null unique,
  buyer_name text not null,
  buyer_phone text not null,
  total_cents int not null default 0,
  status public.order_status not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  raffle_id uuid not null references public.raffles(id) on delete cascade,
  number int not null,
  created_at timestamptz not null default now(),
  unique(order_id, number)
);

-- =========================
-- PAGAMENTOS (manual por enquanto)
-- =========================
create type public.payment_method as enum ('pix_manual','gateway');
create type public.payment_status as enum ('pending','confirmed','rejected');

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  method public.payment_method not null default 'pix_manual',
  status public.payment_status not null default 'pending',
  proof_url text null,
  created_at timestamptz not null default now()
);

-- =========================
-- RPC: reservar números com lock
-- =========================
create or replace function public.reserve_numbers(
  p_raffle_slug text,
  p_buyer_name text,
  p_buyer_phone text,
  p_numbers int[]
)
returns table(order_id uuid, public_token text, expires_at timestamptz, total_cents int)
language plpgsql
security definer
as $$
declare
  v_raffle public.raffles%rowtype;
  v_order_id uuid;
  v_token text;
  v_expires timestamptz;
  v_total int;
  v_n int;
begin
  select * into v_raffle
  from public.raffles
  where slug = p_raffle_slug and status = 'active'
  limit 1;

  if not found then
    raise exception 'Rifa não encontrada ou inativa';
  end if;

  if array_length(p_numbers, 1) is null or array_length(p_numbers, 1) < 1 then
    raise exception 'Selecione pelo menos 1 número';
  end if;

  -- Expira reservas antigas (best-effort)
  update public.raffle_numbers
  set status = 'expired', locked_until = null, order_id = null, buyer_name=null, buyer_phone=null, updated_at = now()
  where raffle_id = v_raffle.id
    and status = 'reserved'
    and locked_until is not null
    and locked_until < now();

  v_expires := now() + make_interval(mins => v_raffle.reserve_minutes);
  v_total := v_raffle.price_cents * array_length(p_numbers, 1);
  v_token := encode(gen_random_bytes(16), 'hex');

  insert into public.orders (workspace_id, raffle_id, public_token, buyer_name, buyer_phone, total_cents, status, expires_at)
  values (v_raffle.workspace_id, v_raffle.id, v_token, p_buyer_name, p_buyer_phone, v_total, 'pending', v_expires)
  returning id into v_order_id;

  -- Tenta reservar número por número com proteção contra concorrência
  foreach v_n in array p_numbers loop
    update public.raffle_numbers rn
    set status = 'reserved',
        locked_until = v_expires,
        order_id = v_order_id,
        buyer_name = p_buyer_name,
        buyer_phone = p_buyer_phone,
        updated_at = now()
    where rn.raffle_id = v_raffle.id
      and rn.number = v_n
      and rn.status = 'free';

    if not found then
      -- rollback manual: cancela pedido e solta números já travados
      update public.raffle_numbers
      set status='free', locked_until=null, order_id=null, buyer_name=null, buyer_phone=null, updated_at=now()
      where raffle_id = v_raffle.id
        and order_id = v_order_id
        and status='reserved';

      update public.orders set status='cancelled' where id = v_order_id;

      raise exception 'Número % indisponível (já reservado ou pago)', v_n;
    end if;

    insert into public.order_items(order_id, raffle_id, number)
    values (v_order_id, v_raffle.id, v_n);
  end loop;

  -- cria registro de pagamento manual pendente
  insert into public.payments(order_id, method, status)
  values (v_order_id, 'pix_manual', 'pending');

  return query
  select v_order_id, v_token, v_expires, v_total;
end;
$$;

revoke all on function public.reserve_numbers(text,text,text,int[]) from public;
grant execute on function public.reserve_numbers(text,text,text,int[]) to anon, authenticated;

-- =========================
-- Trigger: gerar números ao ativar / criar
-- =========================
create or replace function public.seed_raffle_numbers()
returns trigger
language plpgsql
as $$
declare i int;
begin
  -- se já existir, não recria
  if (select count(*) from public.raffle_numbers where raffle_id = new.id) > 0 then
    return new;
  end if;

  for i in 1..new.total_numbers loop
    insert into public.raffle_numbers(raffle_id, number)
    values (new.id, i);
  end loop;

  return new;
end;
$$;

drop trigger if exists trg_seed_raffle_numbers on public.raffles;
create trigger trg_seed_raffle_numbers
after insert on public.raffles
for each row execute function public.seed_raffle_numbers();

-- =========================
-- RLS
-- =========================
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.raffles enable row level security;
alter table public.raffle_numbers enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.payments enable row level security;

-- workspaces: só membro vê
create policy "workspaces_select_member"
on public.workspaces for select
to authenticated
using (public.is_workspace_member(id));

-- workspace_members: só o próprio usuário vê suas memberships
create policy "members_select_self"
on public.workspace_members for select
to authenticated
using (user_id = auth.uid());

-- raffles: só membro do workspace
create policy "raffles_rw_member"
on public.raffles for all
to authenticated
using (public.is_workspace_member(workspace_id))
with check (public.is_workspace_member(workspace_id));

-- raffle_numbers: membro do workspace pode ler; update só membro (ex: marcar pago)
create policy "numbers_select_member"
on public.raffle_numbers for select
to authenticated
using (
  exists (
    select 1 from public.raffles r
    where r.id = raffle_id and public.is_workspace_member(r.workspace_id)
  )
);

create policy "numbers_update_member"
on public.raffle_numbers for update
to authenticated
using (
  exists (
    select 1 from public.raffles r
    where r.id = raffle_id and public.is_workspace_member(r.workspace_id)
  )
)
with check (
  exists (
    select 1 from public.raffles r
    where r.id = raffle_id and public.is_workspace_member(r.workspace_id)
  )
);

-- público (anon) pode ler rifa ativa e seus números (pra página /r/slug)
create policy "raffles_select_public_active"
on public.raffles for select
to anon
using (status = 'active');

create policy "numbers_select_public_active"
on public.raffle_numbers for select
to anon
using (
  exists (
    select 1 from public.raffles r
    where r.id = raffle_id and r.status = 'active'
  )
);

-- orders/payments: cliente (membro) pode ver; público só via token por API (não via select direto)
create policy "orders_select_member"
on public.orders for select
to authenticated
using (public.is_workspace_member(workspace_id));

create policy "payments_select_member"
on public.payments for select
to authenticated
using (
  exists (
    select 1 from public.orders o
    where o.id = order_id and public.is_workspace_member(o.workspace_id)
  )
);