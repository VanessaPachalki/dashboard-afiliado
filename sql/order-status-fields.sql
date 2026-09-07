-- ================================================
-- Enriquece orders com o STATUS DO PEDIDO (ciclo de vida) + refund/return
-- reais da TikTok, além do settle_status (status da comissão) que já temos.
--
-- Rode ANTES de re-sincronizar (o import passa a mandar essas colunas).
-- Colunas nullable: pedidos antigos ficam null e o app cai no comportamento
-- anterior (estimativa por reembolso). Re-sincronizar preenche.
-- ================================================
alter table public.orders
  add column if not exists order_status       text,   -- PROCESSING | COMPLETED | CANCELLED | FROZEN | DEDUCTED
  add column if not exists returned_quantity  integer,
  add column if not exists refunded_quantity  integer,
  add column if not exists attribution_type   text;    -- Direct | Indirect
