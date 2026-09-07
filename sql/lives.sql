-- ================================================
-- Fechamentos de live salvos. Cada live = 1 fechamento (nome + janela + host).
-- Chave de conflito: um Creator Host NUNCA tem duas lives no mesmo horário
-- (mesma account_id com sobreposição de [start_dt, end_dt]).
-- turnos = a escala (responsáveis) salva em JSON, pra reabrir/editar.
-- ================================================

create table if not exists public.lives (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid references public.agencies(id),
  owner_id uuid references auth.users(id),
  account_id uuid references public.accounts(id) on delete cascade,  -- creator host
  name text not null,
  start_dt text not null,   -- "YYYY-MM-DDTHH:MM"
  end_dt text not null,
  pct numeric,
  turnos jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.lives enable row level security;
create policy "lives_owner" on public.lives for all
  using (owner_id = auth.uid() or public.is_matriz())
  with check (owner_id = auth.uid() or public.is_matriz());

create index if not exists idx_lives_account on public.lives(account_id);
