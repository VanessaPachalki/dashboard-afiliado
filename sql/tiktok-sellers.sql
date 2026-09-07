-- ================================================
-- Integração SELLER (Seller Open API) — permite buscar o MOTIVO real de
-- cancelamentos/devoluções por pedido. Cada seller autoriza o app 1x;
-- guardamos o token + shop_cipher por loja.
--
-- Pré-requisitos (no Partner Center, feitos pela Vanessa):
--   1. App & Service > Manage > Manage API: habilitar o pacote Return & Refund.
--   2. Pegar o link de autorização do app e enviar aos sellers.
--   3. (Protected Data) revisão de segurança / DSPR pode ser exigida.
-- ================================================

create table if not exists public.tiktok_sellers (
  shop_id           text primary key,
  shop_cipher       text not null,
  shop_name         text,
  region            text,
  seller_type       text,          -- LOCAL | CROSS_BORDER
  access_token      text,
  refresh_token     text,
  access_expire_at  timestamptz,
  refresh_expire_at timestamptz,
  scopes            text,
  agency_id         uuid,
  owner_id          uuid,
  connected_at      timestamptz default now(),
  updated_at        timestamptz default now()
);

alter table public.tiktok_sellers enable row level security;
alter table public.tiktok_sellers force row level security;
drop policy if exists tiktok_sellers_matriz on public.tiktok_sellers;
create policy tiktok_sellers_matriz on public.tiktok_sellers for all
  using (public.is_matriz()) with check (public.is_matriz());

-- Motivo real do pós-venda, gravado de volta nos pedidos (por order_id).
alter table public.orders
  add column if not exists aftersale_reason text,   -- texto do motivo (cancel/return_reason_text)
  add column if not exists aftersale_role   text,   -- BUYER | SELLER | SYSTEM | OPERATOR
  add column if not exists aftersale_type   text;   -- cancel | return
