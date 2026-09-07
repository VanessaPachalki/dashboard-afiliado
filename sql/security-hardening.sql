-- ================================================
-- SEGURANÇA — fecha vazamentos e remove backdoor.
-- Rode no Supabase (SQL Editor).
-- ================================================

-- 1) approved_emails estava LEGÍVEL pela chave pública (anon) — vazava e-mails
--    e quem é admin. Liga RLS: só matriz.
alter table public.approved_emails enable row level security;
drop policy if exists "approved_matriz" on public.approved_emails;
create policy "approved_matriz" on public.approved_emails for all
  using (public.is_matriz()) with check (public.is_matriz());

-- 2) agencies expunha TODAS as agências pela chave pública. Limita a chave
--    pública à marca atual (brx); matriz continua vendo tudo.
alter table public.agencies enable row level security;
drop policy if exists "agencies_public_brx" on public.agencies;
create policy "agencies_public_brx" on public.agencies for select
  using (slug = 'brx' or public.is_matriz());
drop policy if exists "agencies_matriz_manage" on public.agencies;
create policy "agencies_matriz_manage" on public.agencies for all
  using (public.is_matriz()) with check (public.is_matriz());

-- 3) Remove o backdoor admin@admin.com (matriz com senha fraca).
--    (Também apague o usuário em Authentication > Users no Dashboard.)
delete from public.superadmins where email = 'admin@admin.com';
