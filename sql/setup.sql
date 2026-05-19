-- ================================================
-- SPACEHUB Dashboard - Supabase Setup
-- Execute este SQL no SQL Editor do Supabase
-- ================================================

-- 1. Tabela de emails aprovados (whitelist)
create table public.approved_emails (
  email text primary key,
  role text not null default 'affiliate' check (role in ('admin','affiliate')),
  display_name text,
  created_at timestamptz default now()
);

-- 2. Tabela de uploads (metadados dos xlsx)
create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  filename text not null,
  month_label text,
  row_count int default 0,
  uploaded_at timestamptz default now(),
  storage_path text
);

-- 3. Tabela de pedidos (dados parseados - formato compacto 14 colunas)
create table public.orders (
  id bigint generated always as identity primary key,
  upload_id uuid not null references public.uploads(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  month text not null,
  order_date text not null,
  hour int not null,
  day_of_week int not null,
  gmv numeric(12,2) not null,
  settlement_status int not null,
  content_type int not null,
  store_name text not null,
  product_name text not null,
  content_id text not null,
  items_sold int not null default 0,
  items_refunded int not null default 0,
  estimated_commission numeric(12,2) default 0,
  received_commission numeric(12,2) default 0
);

-- Indexes
create index idx_orders_user on public.orders(user_id);
create index idx_orders_upload on public.orders(upload_id);

-- ================================================
-- 4. Row Level Security
-- ================================================

alter table public.orders enable row level security;
alter table public.uploads enable row level security;
alter table public.approved_emails enable row level security;

-- Helper: check if current user is admin
create or replace function public.is_admin()
returns boolean as $$
  select exists (
    select 1 from public.approved_emails
    where email = auth.jwt()->>'email' and role = 'admin'
  );
$$ language sql security definer stable;

-- Orders: affiliate sees own, admin sees all
create policy "orders_select" on public.orders
  for select using (auth.uid() = user_id or public.is_admin());

create policy "orders_insert" on public.orders
  for insert with check (auth.uid() = user_id or public.is_admin());

create policy "orders_delete" on public.orders
  for delete using (auth.uid() = user_id or public.is_admin());

-- Uploads: same pattern
create policy "uploads_select" on public.uploads
  for select using (auth.uid() = user_id or public.is_admin());

create policy "uploads_insert" on public.uploads
  for insert with check (auth.uid() = user_id or public.is_admin());

create policy "uploads_delete" on public.uploads
  for delete using (auth.uid() = user_id or public.is_admin());

-- Approved emails: admin full access, affiliates can read own
create policy "approved_admin" on public.approved_emails
  for all using (public.is_admin());

create policy "approved_self" on public.approved_emails
  for select using (email = auth.jwt()->>'email');

-- ================================================
-- 5. Storage bucket
-- ================================================
insert into storage.buckets (id, name, public) values ('xlsx-uploads', 'xlsx-uploads', false);

create policy "storage_upload" on storage.objects
  for insert with check (
    bucket_id = 'xlsx-uploads'
    and auth.role() = 'authenticated'
  );

create policy "storage_read" on storage.objects
  for select using (
    bucket_id = 'xlsx-uploads'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

create policy "storage_delete" on storage.objects
  for delete using (
    bucket_id = 'xlsx-uploads'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- ================================================
-- 6. Seed: adicionar Vanessa como admin
-- TROQUE pelo seu email real!
-- ================================================
insert into public.approved_emails (email, role, display_name)
values ('vanessa.pachalki@spacehub-ai.com', 'admin', 'Vanessa - SPACEHUB');
