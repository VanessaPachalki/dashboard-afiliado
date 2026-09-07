-- ================================================
-- SEGURANÇA — fecha vazamentos e remove backdoor.
-- Rode no Supabase (SQL Editor). Pode rodar de novo sem problema.
-- ================================================

-- 1) approved_emails: estava LEGÍVEL pela chave pública (anon) — vazava e-mails
--    e quem é admin. Apaga TODAS as policies antigas e deixa só matriz.
alter table public.approved_emails enable row level security;
alter table public.approved_emails force row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='approved_emails' loop
    execute format('drop policy %I on public.approved_emails', p.policyname);
  end loop;
end $$;
create policy "approved_matriz" on public.approved_emails for all
  using (public.is_matriz()) with check (public.is_matriz());

-- 2) agencies: expunha TODAS as agências pela chave pública. A página de login
--    só precisa ler a marca atual (brx). Apaga policies antigas e recria.
alter table public.agencies enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies
           where schemaname='public' and tablename='agencies' loop
    execute format('drop policy %I on public.agencies', p.policyname);
  end loop;
end $$;
create policy "agencies_public_brx" on public.agencies for select
  using (slug = 'brx' or public.is_matriz());
create policy "agencies_matriz_manage" on public.agencies for all
  using (public.is_matriz()) with check (public.is_matriz());

-- 3) Remove o backdoor admin@admin.com (matriz com senha fraca).
--    (Também apague o usuário em Authentication > Users no Dashboard.)
delete from public.superadmins where email = 'admin@admin.com';
