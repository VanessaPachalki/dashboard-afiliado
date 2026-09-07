-- ================================================
-- Permite contas "virtuais" por creator (@username) vindas da API Partner,
-- que NÃO têm um e-mail de login. Hoje accounts.email é NOT NULL + FK para
-- approved_emails (contas nascem de um login). As contas de creator da API
-- não têm login, então relaxamos essas duas amarras.
--
-- Não-destrutivo: linhas existentes continuam válidas (email preenchido).
-- ================================================

alter table public.accounts alter column email drop not null;
alter table public.accounts drop constraint if exists accounts_email_fkey;

-- marca quais contas vieram da API (opcional, ajuda a distinguir de contas de login)
alter table public.accounts add column if not exists source text;
