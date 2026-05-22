# REGISTRO DE PROGRAMA DE COMPUTADOR — INPI

## SPACEHUB — Plataforma SaaS Whitelabel para Agencias de Afiliados TikTok Shop

---

## 1. IDENTIFICACAO DO PROGRAMA

| Campo | Informacao |
|---|---|
| **Nome do programa** | SPACEHUB — Plataforma SaaS de Performance para Afiliados |
| **Titular** | Vanessa Pachalki |
| **Data de criacao** | 11 de maio de 2026 |
| **Linguagens utilizadas** | JavaScript (ES6+), HTML5, CSS3, SQL (PostgreSQL) |
| **Dominio publicado** | afiliados.spacehub-ai.com |
| **Repositorio** | github.com/VanessaPachalki/dashboard-afiliado |
| **Total de linhas de codigo** | 5.493 linhas (codigo-fonte proprio) |
| **Quantidade de commits** | 52 commits documentados |

---

## 2. DESCRICAO TECNICA DO PROGRAMA

### 2.1 Finalidade

O SPACEHUB e um sistema web (SaaS) whitelabel desenvolvido para **agencias de afiliados do TikTok Shop no Brasil**. Ele permite:

- Upload e processamento de planilhas de pedidos exportadas do TikTok Shop
- Visualizacao de metricas de performance de creators/afiliados
- Calculo automatizado de comissoes com cenarios de projecao
- Fechamento financeiro por live, por loja e por creator
- Gestao de acessos com controle por e-mail e papeis (superadmin/admin/afiliado)
- Multi-tenancy: multiplas agencias na mesma plataforma, cada uma com sua marca
- Branding customizavel por agencia (tema de cores, logo, nome)
- Modo de aparencia claro, escuro e automatico

### 2.2 Problema resolvido

Agencias que gerenciam dezenas de creators afiliados ao TikTok Shop precisam analisar dados de performance que sao exportados apenas em planilhas brutas (XLSX). O SPACEHUB transforma esses dados em dashboards visuais interativos, calcula comissoes e fornece insights automaticos — eliminando a necessidade de analise manual em Excel. A arquitetura whitelabel permite que qualquer agencia tenha sua propria instancia com marca personalizada.

---

## 3. ARQUITETURA DO SISTEMA

### 3.1 Stack tecnologico

| Camada | Tecnologia |
|---|---|
| **Frontend** | HTML5, CSS3, JavaScript puro (ES6+) |
| **Graficos** | Chart.js v4 (15+ tipos de graficos) |
| **Processamento de planilhas** | XLSX.js (parsing client-side) |
| **Backend (BaaS)** | Supabase (PostgreSQL + Auth + Storage + RLS) |
| **Autenticacao** | Google OAuth 2.0 via Supabase Auth |
| **Hospedagem** | Vercel (CDN global + auto-deploy) |
| **Build pipeline** | Node.js + Terser (minificacao) + JavaScript Obfuscator (protecao de codigo) |
| **Seguranca** | Row Level Security (RLS), CSP headers, sanitizacao XSS, ofuscacao de codigo |
| **Multi-tenancy** | Resolucao por subdominio + isolamento por agency_id |

### 3.2 Paginas do sistema (7 telas)

1. **index.html** — Tela de login com Google OAuth (multi-tenant)
2. **dashboard.html** — Dashboard principal de performance do afiliado
3. **upload.html** — Upload de planilhas XLSX com drag-and-drop
4. **admin.html** — Painel administrativo (gestao de membros e contas)
5. **fechamento.html** — Fechamento de comissoes (calculo financeiro)
6. **settings.html** — Configuracoes da agencia (tema, logo, nome, aparencia)
7. **superadmin.html** — Painel de gestao de agencias (superadmin only)

### 3.3 Arquivos de codigo-fonte

```
js/dashboard.js ......... 723 linhas  — Motor principal de analise e graficos
js/fechamento.js ........ 504 linhas  — Sistema de fechamento de comissoes
js/admin.js ............. 423 linhas  — Painel administrativo
js/upload.js ............ 308 linhas  — Processamento de uploads XLSX
js/settings.js .......... 300 linhas  — Configuracoes da agencia (tema, logo)
js/superadmin.js ........ 288 linhas  — Gestao de agencias (superadmin)
js/tenant.js ............ 200 linhas  — Resolucao de subdominio e branding
js/auth.js .............. 131 linhas  — Autenticacao multi-tenant
js/supabase-config.js .... 19 linhas  — Configuracao do Supabase + utilitarios
css/style.css ........... 304 linhas  — Tema visual (dark/light mode, CSS variables)
sql/setup.sql ........... 199 linhas  — Schema inicial do banco de dados
sql/migration-whitelabel.sql .. 409 linhas — Migration multi-tenant
sql/sellers.sql .......... 23 linhas  — Tabela de sellers/comissoes
build.js ................ 100 linhas  — Pipeline de build (minificacao + ofuscacao)
```

**Total: 3.931 linhas de codigo-fonte (JS+CSS+SQL+build)**
**Total com HTML: 5.493 linhas**

---

## 4. BANCO DE DADOS — SCHEMA COMPLETO

### 4.1 Tabelas (10 tabelas + 1 bucket de storage)

```sql
-- TABELA 1: Agencias (tenants)
agencies (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug          TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    primary_color TEXT NOT NULL DEFAULT '#E8551B',
    logo_url      TEXT,
    logo_height   INT NOT NULL DEFAULT 32,
    plan          TEXT NOT NULL DEFAULT 'starter' CHECK (plan IN ('starter','pro')),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- TABELA 2: Membros de agencia
agency_members (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agency_id    UUID NOT NULL REFERENCES agencies(id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT 'affiliate' CHECK (role IN ('agency_admin','affiliate')),
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(agency_id, email)
)

-- TABELA 3: Superadmins (acesso global)
superadmins (
    email        TEXT PRIMARY KEY,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
)

-- TABELA 4: Controle de acesso por e-mail (legado + compatibilidade)
approved_emails (
    email         TEXT PRIMARY KEY,
    role          TEXT CHECK (role IN ('admin','affiliate')),
    display_name  TEXT,
    agency_id     UUID REFERENCES agencies(id),
    created_at    TIMESTAMPTZ DEFAULT now()
)

-- TABELA 5: Contas de afiliados (multi-conta por usuario)
accounts (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email      TEXT REFERENCES approved_emails(email),
    name       TEXT NOT NULL,
    agency_id  UUID NOT NULL REFERENCES agencies(id),
    created_at TIMESTAMPTZ DEFAULT now()
)

-- TABELA 6: Pedidos (tabela principal de dados)
orders (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    upload_id            UUID REFERENCES uploads(id),
    user_id              UUID REFERENCES auth.users(id),
    account_id           UUID REFERENCES accounts(id),
    agency_id            UUID NOT NULL REFERENCES agencies(id),
    tiktok_order_id      TEXT,
    sku_id               TEXT,
    month                TEXT,
    order_date           TEXT,
    hour                 INT,
    day_of_week          INT,
    gmv                  NUMERIC(12,2),
    settlement_status    INT,
    content_type         INT,
    store_name           TEXT,
    product_name         TEXT,
    content_id           TEXT,
    items_sold           INT,
    items_refunded       INT,
    estimated_commission NUMERIC(12,2),
    received_commission  NUMERIC(12,2),
    UNIQUE(user_id, tiktok_order_id, sku_id)
)

-- TABELA 7: Historico de uploads
uploads (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES auth.users(id),
    agency_id    UUID NOT NULL REFERENCES agencies(id),
    filename     TEXT,
    month_label  TEXT,
    row_count    INT,
    uploaded_at  TIMESTAMPTZ DEFAULT now(),
    storage_path TEXT
)

-- TABELA 8: Sellers/creators para comissao
sellers (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id     UUID REFERENCES accounts(id),
    agency_id      UUID NOT NULL REFERENCES agencies(id),
    name           TEXT NOT NULL,
    commission_pct NUMERIC(5,2) CHECK (commission_pct BETWEEN 0 AND 100),
    created_at     TIMESTAMPTZ DEFAULT now()
)

-- TABELA 9: Log de tentativas de login
login_attempts (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email        TEXT,
    agency_id    UUID REFERENCES agencies(id),
    attempted_at TIMESTAMPTZ DEFAULT now()
)

-- TABELA 10: Audit log (rastreamento de acoes)
audit_log (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    agency_id   UUID REFERENCES agencies(id),
    user_email  TEXT NOT NULL,
    action      TEXT NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
)
```

### 4.2 Functions de seguranca

```sql
-- Verificar se usuario e superadmin
is_superadmin() RETURNS BOOLEAN

-- Verificar se usuario e admin de uma agencia
is_agency_admin(p_agency_id UUID) RETURNS BOOLEAN

-- Retornar IDs das agencias do usuario
user_agency_ids() RETURNS SETOF UUID

-- Verificar plano da agencia
agency_plan(p_agency_id UUID) RETURNS TEXT
```

### 4.3 Politicas de seguranca (RLS)

- Isolamento por **agency_id**: cada agencia ve apenas seus dados
- Afiliados veem **apenas seus proprios pedidos** dentro da agencia
- Agency admins tem acesso a **todos os dados da sua agencia**
- Superadmins tem acesso a **todas as agencias**
- Swap atomico de policies via transacao SQL
- Audit log registra acoes para rastreamento

---

## 5. FUNCIONALIDADES IMPLEMENTADAS

### 5.1 Dashboard de Performance (18 modulos de visualizacao)

| # | Modulo | Descricao |
|---|---|---|
| 1 | KPIs principais | GMV total, pedidos, ticket medio, lojas, lives, videos, taxa de inelegibilidade, comissao |
| 2 | Barra de maturidade | Distribuicao visual dos status de liquidacao dos pedidos |
| 3 | Insights automaticos | Analise automatica de pico de horario, melhor dia e melhor tipo de conteudo |
| 4 | Evolucao semanal | Grafico de linha com GMV diario |
| 5 | Dedicacao vs resultado | Barras comparando producao de conteudo com GMV gerado |
| 6 | Retorno por conteudo | Retorno medio (R$) por live vs video |
| 7 | Live vs Video GMV | Comparativo de GMV por tipo de conteudo |
| 8 | Mix de conteudo | Porcentagem live/video na producao total |
| 9 | Hora do dia | GMV por hora com destaque automatico do pico de 3h |
| 10 | Dia da semana | Performance por dia da semana |
| 11 | Comissao por mes | Evolucao da comissao recebida |
| 12 | Status dos pedidos | Distribuicao doughnut por status de liquidacao |
| 13 | Cenarios de comissao | Projecao otimista, realista e pessimista |
| 14 | Taxa de inelegibilidade | Historico mensal de cancelamentos |
| 15 | Tipo de cancelamento | Breakdown de devolucoes vs cancelamentos |
| 16 | Ranking de lojas | Top 15 lojas com metricas detalhadas e mini barras |
| 17 | Top conteudos | Lives e videos com melhor performance |
| 18 | Analise de produtos | Produtos que nao compensam vs top produtos |

### 5.2 Sistema de Upload

- Drag-and-drop de arquivos XLSX
- Parsing client-side (sem enviar arquivo ao servidor)
- Validacao de 9 colunas obrigatorias do TikTok Shop
- Parse de datas em multiplos formatos (DD/MM/YYYY HH:MM:SS e ISO)
- Calculo automatico de campos derivados (mes, hora, dia da semana)
- Insercao em lotes de 500 registros
- Deduplicacao automatica por `(user_id, tiktok_order_id, sku_id)`
- Barra de progresso com porcentagem
- Relatorio de duplicatas ignoradas

### 5.3 Painel Administrativo

- Gestao de membros da agencia (agency_members)
- Criacao de contas vinculadas a e-mails
- Atribuicao de papeis (agency_admin/afiliado)
- Historico completo de uploads
- Monitoramento de tentativas de login bloqueadas
- Paginacao (15 itens por pagina)
- Optimistic UI em todas as operacoes CRUD

### 5.4 Fechamento de Comissoes

- Cadastro de sellers/creators por conta
- Configuracao de percentual de comissao individual (aceita virgula e ponto)
- Filtro por periodo (data inicial e final)
- Selecao de lives especificas para calculo
- Filtro de horario por live com minutos (turnos de creators via input type=time)
- Exibicao de multiplas lojas por live
- KPIs: liquidados, cancelados, devolucoes, itens reembolsados
- 3 graficos: Liquidados por loja (barras), Nao Pagou por loja (pizza), Cancelou/Devolveu por loja (pizza)
- Calculo de comissao com 3 cenarios

### 5.5 Multi-Tenancy (Whitelabel)

- Cada agencia tem subdominio proprio: `[slug].spacehub-ai.com`
- Resolucao de subdominio via `tenant.js` com 3 camadas de cache (CDN, sessionStorage, memory)
- Branding dinamico por agencia: 5 temas predefinidos (Vulcano, Oceano, Floresta, Cosmos, Neon)
- Logo customizavel por agencia (upload base64, tamanho ajustavel 20-80px)
- Modo de aparencia: escuro, claro, automatico (segue sistema operacional)
- Isolamento completo de dados por agency_id em todas as tabelas
- Hierarquia de papeis: superadmin > agency_admin > affiliate

### 5.6 Painel Superadmin

- Dashboard com stats globais (agencias, membros, pedidos, uploads)
- CRUD completo de agencias (criar, ativar, desativar)
- Gestao de membros por agencia
- Guia integrado de setup (DNS + Vercel) para novas agencias
- Link direto para acessar qualquer agencia

### 5.7 Configuracoes da Agencia

- Edicao do nome da agencia
- Selecao de tema de cores (5 opcoes com preview visual)
- Upload e remocao de logo (PNG, JPG, WebP, max 200KB)
- Slider de tamanho da logo (20-80px) com preview ao vivo
- Seletor de modo de aparencia (escuro/claro/automatico)
- Preview em tempo real de todas as configuracoes

### 5.8 Seguranca

- Autenticacao Google OAuth 2.0 via Supabase Auth
- Row Level Security (RLS) multi-tenant em todas as tabelas
- Content Security Policy (CSP) headers
- Sanitizacao contra XSS (`esc()` e `escAttr()`)
- Log de tentativas de acesso nao autorizadas
- Controle de acesso por papel (RBAC) com 3 niveis
- Codigo-fonte ofuscado em producao (JavaScript Obfuscator)
- Fingerprint INPI invisivel no bundle
- Headers de seguranca: X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy same-origin

### 5.9 Performance

- Cache em SessionStorage com TTL de 5 minutos
- Lazy loading de graficos via Intersection Observer API
- Graficos renderizados apenas quando visiveis no viewport
- Paginacao na busca de dados (1000 registros por lote)
- Optimistic UI em todas as operacoes CRUD (feedback instantaneo)
- Resolucao de tenant cacheada (evita queries repetidas)
- Build pipeline com minificacao (Terser) para reducao de tamanho

---

## 6. IDENTIDADE VISUAL

| Elemento | Valor |
|---|---|
| **Temas disponiveis** | Vulcano (#E8551B), Oceano (#3B82F6), Floresta (#10B981), Cosmos (#8B5CF6), Neon (#EC4899) |
| **Modo de aparencia** | Dark mode, Light mode, Automatico |
| **Cor de fundo (dark)** | #080808 |
| **Cor de fundo (light)** | #f5f5f7 |
| **Fonte** | Inter (Google Fonts) |
| **Logo** | Customizavel por agencia (base64, tamanho ajustavel) |
| **Branding** | Dinamico via CSS custom properties (--orange) |

---

## 7. HISTORICO DE DESENVOLVIMENTO (COMMITS)

O desenvolvimento foi realizado entre **11 de maio de 2026** e **22 de maio de 2026**, com 52 commits documentados no Git:

| Data | Commit | Descricao |
|---|---|---|
| 11/05 | 3c6605d | Dashboard TikTok Shop — versao inicial |
| 11/05 | 6cc0374 | Publicacao no GitHub Pages |
| 11/05 | 20f202f | Fix cenarios de comissao |
| 11/05 | 4882e05 | Fix labels de status TikTok Shop |
| 11/05 | 6ba4ea0 | Legenda de status de liquidacao |
| 11/05 | 7f584fe | Asterisco em taxas + coluna Liquidados |
| 11/05 | 6581a57 | UX: barra de maturidade e mini barras |
| 12/05 | f560cb6 | Refactor: arquitetura multi-pagina com Supabase e OAuth |
| 12/05 | 4cb3507 | Configuracao de dominio customizado (CNAME) |
| 12/05 | b5f2940 | Seguranca: XSS, CSP, RLS |
| 12/05 | e9595f5 | Log de tentativas de login bloqueadas |
| 12/05 | c93f463 | Fix UI do painel admin |
| 12/05 | 775d96b | Admin: reorganizacao de secoes |
| 15/05 | d22e105 | Feature: pagina de Fechamento de Comissoes |
| 15/05 | 9fb00d0 | Fechamento: filtro por Lives |
| 15/05 | 6cd6369 | Fechamento: simplificacao de exibicao |
| 15/05 | 27214d6 | Fechamento: liquidados, devolucoes e cancelamentos por live |
| 15/05 | 9599736 | Fechamento: paginacao de tabelas |
| 15/05 | 2681882 | Fix: layout do formulario |
| 16/05 | 4d10603 | Fechamento: 3 graficos por loja |
| 16/05 | 9ec2557 | Fix: estilos globais de botoes |
| 19/05 | f055de7 | Fechamento: legendas nos campos |
| 19/05 | cbde8db | Fechamento: graficos pizza + legendas |
| 19/05 | c659da8 | Fix: alinhamento de botoes |
| 19/05 | 0865586 | Fix: comissao pendente corrigida |
| 19/05 | 5ba26fa | Layout: padronizacao CSS |
| 19/05 | 2ea01be | Fix: tamanho dos graficos pizza |
| 19/05 | d0920a1 | Fechamento: remocao do resumo detalhado |
| 19/05 | 22de0ce | Layout: container 1400px |
| 19/05 | 579f45c | Fix: formulario em grid fixo |
| 19/05 | 3a05090 | Fix: tema escuro nos campos |
| 19/05 | a4b51be | Fix: tema escuro nos selects |
| 20/05 | abe95c6 | Fechamento: pedidos das lives vs total |
| 20/05 | de78108 | Fechamento: KPIs detalhados |
| 21/05 | 13dd6cb | Fechamento: graficos por loja |
| 21/05 | 7e683c3 | Feature: filtro de horario por live (turnos) |
| 21/05 | a7ab240 | UX: optimistic UI, filtro com minutos, comissao aceita virgula |
| 21/05 | 415e282 | UI: redesign dos cards de lives |
| 21/05 | b6c43a3 | Fix: multiplas lojas por live |
| 21/05 | e88a8a5 | Whitelabel: multi-tenant + build pipeline + branding |
| 21/05 | c7e9d69 | Feature: painel Super Admin |
| 21/05 | c6e405e | Superadmin: guia de setup de nova agencia |
| 21/05 | 5088586 | UX: logo substitui nome, 5 temas fixos |
| 21/05 | d38946b | Feature: pagina de configuracoes |
| 21/05 | dccb9d9 | Fix: Vulcano + logo base64 + modo dark/light/auto |
| 21/05 | caf7a16 | Fix: graficos usam cor dinamica do tema |
| 21/05 | 42db0f9 | Fix: CTCOLOR dinamico para todos os graficos |
| 21/05 | 08ff53e | Fix: light mode completo (textos, grid, pills, forms) |
| 21/05 | 37647f4 | Fix: botao Sair segue tema |
| 21/05 | 50d0393 | Fix: light mode persiste + graficos Comissao e Status |
| 21/05 | 6aa3482 | Feature: slider de tamanho da logo |
| 21/05 | 51518df | Fix: slider usa addEventListener |

---

## 8. FUNCIONALIDADES PLANEJADAS (ROADMAP)

### 8.1 Curto prazo

- **Integracao direta com API do TikTok Shop** — Sincronizacao automatica de pedidos
- **Notificacoes automaticas** — Alertas por e-mail quando pedidos mudam de status
- **Exportacao de relatorios em PDF** — Relatorios formatados para enviar a creators
- **Dashboard mobile responsivo** — Otimizacao completa para celular
- **Filtros avancados no dashboard** — Filtrar por loja, conteudo, GMV e periodo
- **Relatorio individual do creator** — Pagina com link unico para o creator
- **Suporte a multiplas plataformas** — Expandir para Shopee, Kwai e Amazon

### 8.2 Medio prazo

- **Cobranca automatica** — Integracao com Stripe/Mercado Pago para planos pagos
- **Comparativo entre creators** — Rankings e benchmarks de performance
- **Metas e gamificacao** — Badges, streaks e ranking para creators
- **Historico de comissoes** — Timeline de pagamentos com comprovantes
- **Calendario de lives** — Agenda compartilhada com escala de creators
- **Onboarding automatizado** — Fluxo guiado para novos creators
- **Dashboard de saude financeira** — Receita, custos, margem e projecao

### 8.3 Longo prazo

- **IA — Previsao de GMV** — Modelo preditivo com base em historico e sazonalidade
- **IA — Recomendacao de horarios e lojas** — Sugestao automatica de melhores horarios
- **IA — Deteccao de anomalias** — Identificacao de quedas e fraudes
- **IA — Assistente conversacional** — Chatbot para creators tirarem duvidas
- **App mobile nativo** — iOS e Android com push notifications
- **API publica REST** — Para integracao com ERPs e automacoes
- **Marketplace de lojas** — Conectar agencias com lojas por nicho
- **Modulo de pagamentos** — Comissoes via Pix com split automatico
- **Modulo de treinamento (LMS)** — Cursos para capacitar creators
- **Expansao internacional** — TikTok Shop de outros paises com multi-moeda

---

## 9. TRECHOS DE CODIGO-FONTE REPRESENTATIVOS

### 9.1 Resolucao de tenant e branding dinamico (js/tenant.js)

```javascript
// Resolucao de subdominio para identificar agencia
(function() {
  const hostname = window.location.hostname;
  const parts = hostname.split('.');
  let slug = null;
  if (parts.length >= 3) {
    const domain = parts.slice(-2).join('.');
    if (domain === 'spacehub-ai.com') slug = parts[0];
  }
  const RESERVED = ['www','app','api','admin','test','staging','mail','ftp','static','assets'];
  if (slug && RESERVED.includes(slug)) slug = null;
  window.__TENANT_SLUG = slug;
})();

// Aplicacao de branding por agencia
function applyBranding(agency) {
  const root = document.documentElement;
  if (agency.primary_color) {
    root.style.setProperty('--orange', agency.primary_color);
    root.style.setProperty('--orange-soft', agency.primary_color + '30');
  }
  window.BRAND_COLOR = agency.primary_color || '#E8551B';
  // ... logo, nome, titulo da pagina
}
```

### 9.2 Autenticacao multi-tenant (js/auth.js)

```javascript
async function requireAuth() {
  const session = await getSession();
  if (!session) { window.location.href = 'index.html'; return null; }
  const agency = window.AGENCY;
  // Agency subdomain: check agency_members
  if (agency?.id) {
    const { data: member } = await sb
      .from('agency_members')
      .select('email, role, display_name')
      .eq('agency_id', agency.id)
      .eq('email', session.user.email)
      .maybeSingle();
    if (member) return session;
  }
  // Fallback: check superadmins
  const { data: sa } = await sb
    .from('superadmins')
    .select('email')
    .eq('email', session.user.email)
    .maybeSingle();
  if (sa) return session;
  // Not authorized
  await sb.auth.signOut();
  window.location.href = 'index.html';
  return null;
}
```

### 9.3 Row Level Security multi-tenant (sql/migration-whitelabel.sql)

```sql
-- Pedidos visiveis apenas para membros da mesma agencia
CREATE POLICY "orders_select" ON public.orders
  FOR SELECT USING (
    public.is_superadmin()
    OR (
      agency_id IN (SELECT public.user_agency_ids())
      AND (auth.uid() = user_id OR public.is_agency_admin(agency_id))
    )
  );
```

### 9.4 Sistema de upload com deduplicacao (js/upload.js)

```javascript
async function processFile(file, userId, accountId) {
  // Parse client-side
  const wb = XLSX.read(await file.arrayBuffer(), {type:'array'});
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  // Create upload record with agency_id
  const { data: upload } = await sb.from('uploads')
    .insert({ user_id: userId, account_id: accountId, agency_id: agencyId(),
              filename: file.name, row_count: rows.length })
    .select().single();
  // Upsert in chunks with deduplication
  for (let i = 0; i < orders.length; i += 500) {
    await sb.from('orders')
      .upsert(chunk, { onConflict: 'user_id,tiktok_order_id,sku_id', ignoreDuplicates: true });
  }
}
```

### 9.5 Fechamento de comissoes com filtro de turno (js/fechamento.js)

```javascript
function calcularFechamento() {
  // Parse time "HH:MM" to minutes for precise filtering
  function timeToMinutes(timeStr) {
    if (!timeStr) return null;
    const [h, m] = timeStr.split(':').map(Number);
    return h * 60 + m;
  }
  // Filter orders by content_id + time range
  const orders = fetchedOrders.filter(o => {
    const live = selectedLives.find(l => l.content_id === o.content_id);
    if (!live) return false;
    const orderStart = o.hour * 60;
    const orderEnd = o.hour * 60 + 59;
    if (live.minIni !== null && orderEnd < live.minIni) return false;
    if (live.minFim !== null && orderStart > live.minFim) return false;
    return true;
  });
}
```

### 9.6 Build pipeline com ofuscacao (build.js)

```javascript
const JavaScriptObfuscator = require('javascript-obfuscator');
// Ofuscacao com protecao de propriedade intelectual
const OBFUSCATOR_OPTS = {
  compact: true,
  controlFlowFlattening: true,
  deadCodeInjection: true,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: true,
  splitStrings: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
};
// Watermark INPI invisivel
const WATERMARK = `/* __s:{p:"SPACEHUB",v:"1.0",r:"INPI-2026"} */`;
```

---

## 10. DECLARACAO

Declaro que o programa de computador descrito neste documento, denominado **SPACEHUB — Plataforma SaaS de Performance para Afiliados**, e uma obra original, desenvolvida por **Vanessa Pachalki**, com inicio em **11 de maio de 2026**, conforme comprovado pelo historico de 52 commits no repositorio Git.

O programa foi integralmente concebido, projetado e desenvolvido para atender as necessidades especificas de agencias de afiliados do TikTok Shop no Brasil, incluindo a arquitetura whitelabel multi-tenant que permite que multiplas agencias utilizem a plataforma com branding proprio. Constitui obra intelectual original protegida pela Lei 9.609/98 (Lei de Software).

---

*Documento atualizado em 22 de maio de 2026 para fins de registro de programa de computador junto ao INPI — Instituto Nacional da Propriedade Industrial.*
