-- ================================================
-- SPACEHUB/BRX - Turnos salvos do fechamento
-- ------------------------------------------------
-- Guarda um intervalo de turno (creator) por conta, com o snapshot do
-- fechamento, para baixar o relatório depois e detectar conflito de horário.
-- Execute no SQL Editor do Supabase.
-- ================================================

create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  account_id uuid not null references public.accounts(id) on delete cascade,
  seller_id uuid references public.sellers(id) on delete set null,
  creator_name text not null,
  start_dt text not null,   -- "YYYY-MM-DDTHH:MM"
  end_dt text not null,     -- "YYYY-MM-DDTHH:MM"
  comissao numeric(12,2) not null default 0,
  liquidados int not null default 0,
  inelegiveis int not null default 0,
  created_at timestamptz default now()
);

create index idx_turnos_account on public.turnos(account_id);
create index idx_turnos_agency on public.turnos(agency_id);

alter table public.turnos enable row level security;

-- Mesmo padrão dos sellers: admin da agência (ou superadmin) gerencia.
create policy "turnos_select" on public.turnos
  for select using (
    public.is_superadmin()
    or (agency_id in (select public.user_agency_ids()) and public.is_agency_admin(agency_id))
  );

create policy "turnos_manage" on public.turnos
  for all using (
    public.is_superadmin()
    or public.is_agency_admin(agency_id)
  );
