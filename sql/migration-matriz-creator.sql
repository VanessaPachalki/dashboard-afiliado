-- ================================================
-- MIGRATION: Whitelabel -> Matriz + Creators (isolamento por usuário)
-- ------------------------------------------------
-- Modelo novo:
--   - Marca única (BRX), sem subdomínio/whitelabel.
--   - Matriz (superadmin) vê tudo.
--   - Creator loga (convite por e-mail), sobe a própria tabela, faz o
--     próprio fechamento e vê SÓ os dados dele.
--
-- Isolamento passa a ser por DONO (auth user), não mais por agency_id.
--   - orders / uploads: já têm user_id (dono).
--   - accounts / sellers / turnos: recebem owner_id.
--
-- ⚠️ CLEAN SLATE autorizado: zera os dados atuais. Rodar em transação.
--    Executar SOMENTE no cutover, junto com o deploy do código da branch.
-- ================================================

begin;

-- 1) Clean slate (dados atuais serão descartados)
truncate table public.turnos, public.sellers, public.orders, public.uploads, public.accounts
  restart identity cascade;

-- 2) Creators convidados (a matriz libera por e-mail)
create table if not exists public.creators (
  email text primary key,
  display_name text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.creators enable row level security;

-- 3) Dono (creator) nas tabelas de dados
alter table public.accounts add column if not exists owner_id uuid references auth.users(id);
alter table public.sellers  add column if not exists owner_id uuid references auth.users(id);
alter table public.turnos   add column if not exists owner_id uuid references auth.users(id);

create index if not exists idx_accounts_owner on public.accounts(owner_id);
create index if not exists idx_sellers_owner  on public.sellers(owner_id);
create index if not exists idx_turnos_owner   on public.turnos(owner_id);

-- 4) Helper: matriz vê tudo (matriz = superadmin)
create or replace function public.is_matriz() returns boolean as $$
  select exists (
    select 1 from public.superadmins where email = auth.jwt()->>'email'
  );
$$ language sql stable security definer;

-- 5) RLS por dono — substitui as políticas antigas por agency_id
--    Regra única: o dono vê/gerencia o que é dele; a matriz vê tudo.

-- accounts
drop policy if exists "accounts_select" on public.accounts;
drop policy if exists "accounts_manage" on public.accounts;
create policy "accounts_owner" on public.accounts for all
  using (owner_id = auth.uid() or public.is_matriz())
  with check (owner_id = auth.uid() or public.is_matriz());

-- sellers
drop policy if exists "sellers_select" on public.sellers;
drop policy if exists "sellers_manage" on public.sellers;
create policy "sellers_owner" on public.sellers for all
  using (owner_id = auth.uid() or public.is_matriz())
  with check (owner_id = auth.uid() or public.is_matriz());

-- turnos
drop policy if exists "turnos_select" on public.turnos;
drop policy if exists "turnos_manage" on public.turnos;
create policy "turnos_owner" on public.turnos for all
  using (owner_id = auth.uid() or public.is_matriz())
  with check (owner_id = auth.uid() or public.is_matriz());

-- orders (dono = user_id)
drop policy if exists "orders_select" on public.orders;
drop policy if exists "orders_insert" on public.orders;
drop policy if exists "orders_delete" on public.orders;
create policy "orders_owner" on public.orders for all
  using (user_id = auth.uid() or public.is_matriz())
  with check (user_id = auth.uid() or public.is_matriz());

-- uploads (dono = user_id)
drop policy if exists "uploads_select" on public.uploads;
drop policy if exists "uploads_insert" on public.uploads;
drop policy if exists "uploads_delete" on public.uploads;
create policy "uploads_owner" on public.uploads for all
  using (user_id = auth.uid() or public.is_matriz())
  with check (user_id = auth.uid() or public.is_matriz());

-- creators: matriz gerencia; creator lê a própria linha (pra saber que é creator)
drop policy if exists "creators_matriz" on public.creators;
drop policy if exists "creators_self_read" on public.creators;
create policy "creators_matriz" on public.creators for all
  using (public.is_matriz()) with check (public.is_matriz());
create policy "creators_self_read" on public.creators for select
  using (email = auth.jwt()->>'email');

commit;
