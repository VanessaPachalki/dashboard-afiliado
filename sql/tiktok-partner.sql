-- ================================================
-- TikTok Partner (TAP) — conexão da MATRIZ (a agência autoriza 1x)
-- e coluna creator_username nos orders (atribuição dos pedidos do partner).
-- Escrita só pela Vercel Function (service role). Leitura: matriz.
-- ================================================

-- 1 linha só (a conexão de parceiro da agência)
create table if not exists public.tiktok_partner (
  id int primary key default 1,
  access_token text,
  refresh_token text,
  access_expire_at timestamptz,
  refresh_expire_at timestamptz,
  category_asset_cipher text,
  scopes text,
  connected_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint tiktok_partner_single check (id = 1)
);

alter table public.tiktok_partner enable row level security;
create policy "ttpartner_matriz" on public.tiktok_partner for all
  using (public.is_matriz()) with check (public.is_matriz());

-- creator_username nos pedidos (o partner traz por username, não por user_id)
alter table public.orders add column if not exists creator_username text;
create index if not exists idx_orders_creator_username on public.orders(creator_username);
