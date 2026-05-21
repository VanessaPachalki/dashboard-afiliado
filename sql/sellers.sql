-- ================================================
-- SPACEHUB - Tabela de Vendedores (Sellers)
-- Execute no SQL Editor do Supabase
-- ================================================

-- Tabela de vendedores vinculados a contas
create table public.sellers (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  name text not null,
  commission_pct numeric(5,2) not null default 0 check (commission_pct >= 0 and commission_pct <= 100),
  created_at timestamptz default now()
);

-- Index para busca por conta
create index idx_sellers_account on public.sellers(account_id);

-- RLS
alter table public.sellers enable row level security;

-- Só admin pode gerenciar vendedores
create policy "sellers_admin" on public.sellers
  for all using (public.is_admin());
