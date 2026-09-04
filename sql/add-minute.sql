-- ================================================
-- SPACEHUB - Precisão de minuto no fechamento por creator
-- ------------------------------------------------
-- Motivo: o fechamento por horário (revezamento de creators na
-- mesma conta) precisa cortar a troca no MINUTO exato. Até aqui
-- os pedidos guardavam só a hora cheia (hour int), impossibilitando
-- separar quem estava no ar quando a virada acontece no meio da hora.
--
-- Pedidos já existentes recebem minute = 0 (precisão só de hora).
-- Para precisão total, reenvie os arquivos .xlsx após a migração.
-- ================================================

alter table public.orders
  add column if not exists minute int not null default 0;
