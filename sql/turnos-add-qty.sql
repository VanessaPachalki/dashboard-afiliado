-- ================================================
-- Turnos: quantidade de creators (divide a comissão no relatório)
-- Execute no SQL Editor do Supabase.
-- ================================================

alter table public.turnos
  add column if not exists qty int not null default 1;
