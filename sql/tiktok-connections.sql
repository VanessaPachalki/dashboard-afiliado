-- ================================================
-- TikTok Shop — conexões OAuth por creator (1 conta por creator)
-- Escrita SÓ pela Vercel Function (service role, bypassa RLS).
-- Creator lê a própria; matriz lê todas.
-- ================================================

create table if not exists public.tiktok_connections (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  open_id text,
  seller_name text,
  access_token text,
  refresh_token text,
  access_expire_at timestamptz,
  refresh_expire_at timestamptz,
  scopes text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.tiktok_connections enable row level security;

create policy "ttconn_select" on public.tiktok_connections for select
  using (owner_id = auth.uid() or public.is_matriz());

-- creator pode desconectar a própria; matriz também
create policy "ttconn_delete" on public.tiktok_connections for delete
  using (owner_id = auth.uid() or public.is_matriz());
