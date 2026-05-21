-- ================================================
-- SPACEHUB - Migration: Whitelabel Multi-Tenant
--
-- INSTRUCOES:
--   Execute cada bloco separadamente no SQL Editor do Supabase.
--   Siga a ordem dos blocos (1, 2, 3...).
--   Nao execute tudo de uma vez.
-- ================================================


-- ================================================
-- BLOCO 1: Novas tabelas (agencies, agency_members, superadmins)
-- ================================================

-- Tabela principal de agencias (tenants)
CREATE TABLE public.agencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  primary_color TEXT NOT NULL DEFAULT '#E8551B',
  logo_url TEXT,
  plan TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter', 'pro')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Slug deve ser minusculo, alfanumerico com hifen
ALTER TABLE public.agencies
  ADD CONSTRAINT agencies_slug_format
  CHECK (slug ~ '^[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]$');

-- Slugs reservados nao podem ser usados
-- (validar no app: www, app, api, admin, test, staging, mail, ftp, static, assets)

CREATE UNIQUE INDEX idx_agencies_slug ON public.agencies(slug);

-- Membros de cada agencia (substitui approved_emails para controle por agencia)
CREATE TABLE public.agency_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id UUID NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'affiliate' CHECK (role IN ('agency_admin', 'affiliate')),
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(agency_id, email)
);

CREATE INDEX idx_agency_members_email ON public.agency_members(email);
CREATE INDEX idx_agency_members_agency ON public.agency_members(agency_id);

-- Superadmins (acesso a tudo, independente de agencia)
CREATE TABLE public.superadmins (
  email TEXT PRIMARY KEY,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- ================================================
-- BLOCO 2: Adicionar agency_id nas tabelas existentes (nullable por enquanto)
-- ================================================

ALTER TABLE public.approved_emails ADD COLUMN agency_id UUID REFERENCES public.agencies(id);
ALTER TABLE public.accounts ADD COLUMN agency_id UUID REFERENCES public.agencies(id);
ALTER TABLE public.uploads ADD COLUMN agency_id UUID REFERENCES public.agencies(id);
ALTER TABLE public.orders ADD COLUMN agency_id UUID REFERENCES public.agencies(id);
ALTER TABLE public.sellers ADD COLUMN agency_id UUID REFERENCES public.agencies(id);
ALTER TABLE public.login_attempts ADD COLUMN agency_id UUID REFERENCES public.agencies(id);

-- Indexes para performance (queries sempre filtram por agency_id)
CREATE INDEX idx_approved_emails_agency ON public.approved_emails(agency_id);
CREATE INDEX idx_accounts_agency ON public.accounts(agency_id);
CREATE INDEX idx_uploads_agency ON public.uploads(agency_id);
CREATE INDEX idx_orders_agency ON public.orders(agency_id);
CREATE INDEX idx_orders_agency_user ON public.orders(agency_id, user_id);
CREATE INDEX idx_sellers_agency ON public.sellers(agency_id);
CREATE INDEX idx_login_attempts_agency ON public.login_attempts(agency_id);


-- ================================================
-- BLOCO 3: Seed — SPACEHUB como primeira agencia + Vanessa como superadmin
-- ================================================

-- Criar agencia SPACEHUB
INSERT INTO public.agencies (slug, name, primary_color, plan, is_active)
VALUES ('spacehub', 'SPACEHUB', '#E8551B', 'pro', true);

-- Adicionar Vanessa como superadmin
INSERT INTO public.superadmins (email, display_name)
VALUES ('vanessa.pachalki@spacehub-ai.com', 'Vanessa');


-- ================================================
-- BLOCO 4: Migrar dados existentes para a agencia SPACEHUB
-- (atribuir agency_id a todos os registros orfaos)
-- ================================================

-- Pegar o ID da agencia SPACEHUB
-- IMPORTANTE: copie o UUID retornado e substitua nos comandos abaixo
SELECT id FROM public.agencies WHERE slug = 'spacehub';

-- Substitua 'SEU_AGENCY_ID_AQUI' pelo UUID retornado acima
-- Exemplo: UPDATE public.approved_emails SET agency_id = 'a1b2c3d4-...' WHERE agency_id IS NULL;

UPDATE public.approved_emails SET agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub') WHERE agency_id IS NULL;
UPDATE public.accounts SET agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub') WHERE agency_id IS NULL;
UPDATE public.uploads SET agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub') WHERE agency_id IS NULL;
UPDATE public.orders SET agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub') WHERE agency_id IS NULL;
UPDATE public.sellers SET agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub') WHERE agency_id IS NULL;
UPDATE public.login_attempts SET agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub') WHERE agency_id IS NULL;

-- Popular agency_members a partir dos approved_emails existentes
INSERT INTO public.agency_members (agency_id, email, role, display_name)
SELECT
  (SELECT id FROM agencies WHERE slug = 'spacehub'),
  email,
  CASE WHEN role = 'admin' THEN 'agency_admin' ELSE 'affiliate' END,
  display_name
FROM public.approved_emails
WHERE agency_id = (SELECT id FROM agencies WHERE slug = 'spacehub')
ON CONFLICT (agency_id, email) DO NOTHING;


-- ================================================
-- BLOCO 5: Tornar agency_id NOT NULL (apos migrar tudo)
-- ================================================

-- Verificar se existe algum registro sem agency_id (deve retornar 0 em todas)
SELECT 'approved_emails' AS tbl, COUNT(*) FROM approved_emails WHERE agency_id IS NULL
UNION ALL SELECT 'accounts', COUNT(*) FROM accounts WHERE agency_id IS NULL
UNION ALL SELECT 'uploads', COUNT(*) FROM uploads WHERE agency_id IS NULL
UNION ALL SELECT 'orders', COUNT(*) FROM orders WHERE agency_id IS NULL
UNION ALL SELECT 'sellers', COUNT(*) FROM sellers WHERE agency_id IS NULL;

-- Se todos retornaram 0, executar:
ALTER TABLE public.accounts ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.uploads ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.orders ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE public.sellers ALTER COLUMN agency_id SET NOT NULL;
-- approved_emails e login_attempts ficam nullable (compatibilidade)


-- ================================================
-- BLOCO 6: Helper functions para multi-tenant
-- ================================================

-- Verificar se usuario e superadmin
CREATE OR REPLACE FUNCTION public.is_superadmin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.superadmins
    WHERE email = auth.jwt()->>'email'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Verificar se usuario e admin de uma agencia especifica
CREATE OR REPLACE FUNCTION public.is_agency_admin(p_agency_id UUID)
RETURNS BOOLEAN AS $$
  SELECT public.is_superadmin() OR EXISTS (
    SELECT 1 FROM public.agency_members
    WHERE email = auth.jwt()->>'email'
      AND agency_id = p_agency_id
      AND role = 'agency_admin'
  );
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Retorna os IDs das agencias do usuario atual
CREATE OR REPLACE FUNCTION public.user_agency_ids()
RETURNS SETOF UUID AS $$
  SELECT agency_id FROM public.agency_members
  WHERE email = auth.jwt()->>'email';
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Verificar plano da agencia
CREATE OR REPLACE FUNCTION public.agency_plan(p_agency_id UUID)
RETURNS TEXT AS $$
  SELECT plan FROM public.agencies WHERE id = p_agency_id AND is_active = true;
$$ LANGUAGE SQL SECURITY DEFINER STABLE;


-- ================================================
-- BLOCO 7: Novas RLS policies (substituir as antigas)
-- IMPORTANTE: execute como uma unica transacao
-- ================================================

BEGIN;

-- ====== AGENCIES ======
ALTER TABLE public.agencies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "agencies_read" ON public.agencies
  FOR SELECT USING (true);  -- leitura publica (resolve subdomain)

CREATE POLICY "agencies_manage" ON public.agencies
  FOR ALL USING (public.is_superadmin());

-- ====== AGENCY_MEMBERS ======
ALTER TABLE public.agency_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read" ON public.agency_members
  FOR SELECT USING (
    public.is_superadmin()
    OR agency_id IN (SELECT public.user_agency_ids())
  );

CREATE POLICY "members_manage" ON public.agency_members
  FOR INSERT WITH CHECK (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

CREATE POLICY "members_update" ON public.agency_members
  FOR UPDATE USING (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

CREATE POLICY "members_delete" ON public.agency_members
  FOR DELETE USING (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

-- ====== SUPERADMINS ======
ALTER TABLE public.superadmins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmins_read" ON public.superadmins
  FOR SELECT USING (public.is_superadmin());

CREATE POLICY "superadmins_manage" ON public.superadmins
  FOR ALL USING (public.is_superadmin());

-- ====== ORDERS (drop old + create new) ======
DROP POLICY IF EXISTS "orders_select" ON public.orders;
DROP POLICY IF EXISTS "orders_insert" ON public.orders;
DROP POLICY IF EXISTS "orders_delete" ON public.orders;

CREATE POLICY "orders_select" ON public.orders
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (auth.uid() = user_id OR public.is_agency_admin(agency_id))
    )
  );

CREATE POLICY "orders_insert" ON public.orders
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND agency_id IN (SELECT public.user_agency_ids())
  );

CREATE POLICY "orders_delete" ON public.orders
  FOR DELETE USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (auth.uid() = user_id OR public.is_agency_admin(agency_id))
    )
  );

-- ====== UPLOADS (drop old + create new) ======
DROP POLICY IF EXISTS "uploads_select" ON public.uploads;
DROP POLICY IF EXISTS "uploads_insert" ON public.uploads;
DROP POLICY IF EXISTS "uploads_delete" ON public.uploads;

CREATE POLICY "uploads_select" ON public.uploads
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (auth.uid() = user_id OR public.is_agency_admin(agency_id))
    )
  );

CREATE POLICY "uploads_insert" ON public.uploads
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND agency_id IN (SELECT public.user_agency_ids())
  );

CREATE POLICY "uploads_delete" ON public.uploads
  FOR DELETE USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (auth.uid() = user_id OR public.is_agency_admin(agency_id))
    )
  );

-- ====== ACCOUNTS (drop old + create new) ======
DROP POLICY IF EXISTS "accounts_admin" ON public.accounts;
DROP POLICY IF EXISTS "accounts_self" ON public.accounts;

CREATE POLICY "accounts_select" ON public.accounts
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (email = auth.jwt()->>'email' OR public.is_agency_admin(agency_id))
    )
  );

CREATE POLICY "accounts_manage" ON public.accounts
  FOR ALL USING (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

-- ====== APPROVED_EMAILS (drop old + create new) ======
DROP POLICY IF EXISTS "approved_admin" ON public.approved_emails;
DROP POLICY IF EXISTS "approved_self" ON public.approved_emails;

CREATE POLICY "approved_select" ON public.approved_emails
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (email = auth.jwt()->>'email' OR public.is_agency_admin(agency_id))
    )
  );

CREATE POLICY "approved_manage" ON public.approved_emails
  FOR ALL USING (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

-- ====== SELLERS (drop old + create new) ======
DROP POLICY IF EXISTS "sellers_admin" ON public.sellers;

CREATE POLICY "sellers_select" ON public.sellers
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND public.is_agency_admin(agency_id)
    )
  );

CREATE POLICY "sellers_manage" ON public.sellers
  FOR ALL USING (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

-- ====== LOGIN_ATTEMPTS (drop old + create new) ======
DROP POLICY IF EXISTS "login_attempts_insert" ON public.login_attempts;
DROP POLICY IF EXISTS "login_attempts_select" ON public.login_attempts;
DROP POLICY IF EXISTS "login_attempts_delete" ON public.login_attempts;

CREATE POLICY "login_attempts_insert" ON public.login_attempts
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "login_attempts_select" ON public.login_attempts
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND public.is_agency_admin(agency_id)
    )
  );

CREATE POLICY "login_attempts_delete" ON public.login_attempts
  FOR DELETE USING (
    public.is_superadmin()
    OR public.is_agency_admin(agency_id)
  );

COMMIT;


-- ================================================
-- BLOCO 8: Audit log (rastreamento de acoes)
-- ================================================

CREATE TABLE public.audit_log (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  agency_id UUID REFERENCES public.agencies(id),
  user_email TEXT NOT NULL,
  action TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_agency ON public.audit_log(agency_id);
CREATE INDEX idx_audit_created ON public.audit_log(created_at);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insert" ON public.audit_log
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "audit_read" ON public.audit_log
  FOR SELECT USING (public.is_superadmin());


-- ================================================
-- FIM DA MIGRATION
-- Verificacao final: rode este SELECT para confirmar
-- ================================================

SELECT
  (SELECT COUNT(*) FROM agencies) AS agencies,
  (SELECT COUNT(*) FROM agency_members) AS members,
  (SELECT COUNT(*) FROM superadmins) AS superadmins,
  (SELECT COUNT(*) FROM orders WHERE agency_id IS NOT NULL) AS orders_migrated,
  (SELECT COUNT(*) FROM orders WHERE agency_id IS NULL) AS orders_orphan;
