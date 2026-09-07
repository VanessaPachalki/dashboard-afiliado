-- ================================================
-- Equipe / Auxiliares + prestação de contas.
-- Fase 1: cadastro de auxiliares (com dados de pagamento) + status de
-- pagamento no fechamento + vínculo do host à conta (pra visão futura).
-- ================================================

-- Auxiliares: pessoas que cobrem turnos nas lives. Dados de pagamento
-- ficam aqui pra facilitar o repasse (é o Creator Host que paga).
create table if not exists public.auxiliares (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid,
  name         text not null,
  email        text,          -- login futuro (visão consultiva)
  phone        text,
  pix_type     text,          -- CPF | CNPJ | E-mail | Telefone | Aleatória
  pix_key      text,
  bank_name    text,
  bank_agency  text,
  bank_account text,
  notes        text,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- vínculo opcional a uma conta/creator da base (Creator Host) — guarda o id.
alter table public.auxiliares add column if not exists account_id uuid;

-- PII + dado financeiro: só matriz.
alter table public.auxiliares enable row level security;
alter table public.auxiliares force row level security;
drop policy if exists auxiliares_matriz on public.auxiliares;
create policy auxiliares_matriz on public.auxiliares for all
  using (public.is_matriz()) with check (public.is_matriz());

-- Status de pagamento do fechamento (o host paga -> marca feito/não realizado).
alter table public.lives
  add column if not exists paid    boolean default false,
  add column if not exists paid_at timestamptz;

-- Vínculo do Creator Host (conta) a um login, pra a visão "Minhas Lives".
alter table public.accounts
  add column if not exists host_email text;
