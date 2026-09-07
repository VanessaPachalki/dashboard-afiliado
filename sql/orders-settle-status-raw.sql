-- ================================================
-- Guarda o status BRUTO da API (settle_status) pra mostrar os 5 níveis:
-- SETTLED | PENDING | CUSTOMER UNPAID | INELIGIBLE | FROZEN.
-- O settlement_status (int) continua igual (compatível com o upload manual).
-- ================================================

alter table public.orders add column if not exists settle_status_raw text;
