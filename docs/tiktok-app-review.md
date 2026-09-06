# Creatorfy — Pacote de Review do App (TikTok Shop Partner Center)

App: **[VP] Affiliate Platform** · app_key `6l6tft39p5smb` · service id `7681928952139532050`
Produto: **https://app.creatorfy.shop/**

---

## 1. Conta de teste (o que fornecer no formulário)

O app autentica via **Google Sign-In**. Crie uma **conta Google dedicada** para a review e forneça o login/senha dela:

- **Login de teste:** `creatorfy.review@gmail.com` (crie uma conta Google só pra isso)
- **Senha:** (a senha dessa conta Google)

Passos para preparar (você faz uma vez):
1. Crie a conta Google `creatorfy.review@gmail.com`.
2. Em `app.creatorfy.shop` (como matriz), vá em **Matriz → Creators → Convidar** e convide `creatorfy.review@gmail.com`.
3. (Opcional, recomendado) suba 1 planilha de exemplo já nessa conta pra ter dados visíveis na review.

> Assim o revisor entra em "Entrar com Google", usa o login/senha fornecido, e cai direto no espaço do creator de teste.

---

## 2. Instruções passo a passo de teste (colar no campo)

```
1. Acesse https://app.creatorfy.shop/
2. Clique em "Entrar com Google" e faça login com a conta de teste fornecida.
3. Você entra como Creator, vendo apenas os próprios dados (isolado).
4. Página "Upload": aqui o creator importa os pedidos de afiliado. Há duas formas:
   a) Botão "Conectar TikTok" — inicia a autorização de Creator do TikTok Shop
      Affiliate (Affiliate Information + Read Creator Affiliate Collaborations).
      Após autorizar, o botão "Sincronizar" importa os pedidos de afiliado via
      a API "Search Creator Affiliate Orders".
   b) Upload manual de planilha .xlsx (exportação de pedidos de afiliado).
5. Página "Fechamento": selecione conta, vendedor e período, clique "Buscar Lives".
   Defina o "Turno do Creator" (data/hora) e "Calcular Fechamento" — o sistema apura
   a comissão do creator por janela de horário (turno), por live.
6. Clique "Exportar Imagem" ou "Exportar PDF" para gerar o relatório de comissão.
7. Página "Dashboard": análise de desempenho das lives (GMV, comissão, pico por hora)
   com base nos pedidos de afiliado importados.
8. (Perfil Matriz/agência) o admin vê todos os creators, atividade e comissão
   consolidada, e pode abrir os dados de cada creator ("Ver lives").
```

---

## 3. Lista resumida de recursos (colar no campo)

```
Pedidos de afiliado (Affiliate Orders):
  1. Importação automática via API (Search Creator Affiliate Orders)
  2. Importação manual por planilha (.xlsx)
Fechamento de comissão:
  1. Apuração da comissão do creator por turno (janela de data/hora) e por live
  2. Divisão de comissão entre múltiplos creators do mesmo turno
  3. Relatório exportável (imagem/PDF) por creator
Análise (Dashboard):
  1. Desempenho por live, GMV, comissão, pico de horário
Gestão (Matriz/Agência):
  1. Convite de creators, visão consolidada, isolamento de dados por creator
Escopo do serviço: creators de afiliado locais do Brasil (BR)
```

---

## 4. Capturas de tela a enviar (você captura no app)

Capturar em `app.creatorfy.shop` (recomendo ≥ 5):
1. Tela de login ("Entrar com Google").
2. Página **Upload** com o botão **"Conectar TikTok"** + **"Sincronizar"**.
3. Tela de **autorização do TikTok** (o consentimento com os escopos Affiliate).
4. Página **Fechamento** com o "Turno do Creator" e o resultado (comissão apurada).
5. **Relatório** exportado (imagem/PDF).
6. **Dashboard** (análise das lives).
7. (Matriz) **Visão Geral** com a lista de creators.

## 5. Vídeo (screen recording, perspectiva do usuário)
Grave o fluxo: login → Upload/Conectar TikTok → Fechamento → Exportar relatório → Dashboard. 1–3 min.

---

## 6. PRD — Documento de Design do Produto (exportar como PDF)

### Visão geral
**Creatorfy** é uma plataforma de **apuração de comissão e análise de desempenho** para creators de afiliado do TikTok Shop, operada por uma agência (matriz) que gerencia múltiplos creators. Cada creator importa seus **pedidos de afiliado** (via API do TikTok Shop Affiliate ou planilha), e a plataforma calcula a **comissão por turno de live** e gera relatórios.

### Principais recursos
- **Importação de pedidos de afiliado** — automática via API (`Search Creator Affiliate Orders`, escopo 1021508) e manual via `.xlsx`.
- **Fechamento de comissão por turno** — apura a comissão do creator por janela de data/hora (turno), atribuindo cada pedido à live/creator correta.
- **Relatórios** — exportação por creator em imagem/PDF.
- **Dashboard** — análise das lives (GMV, comissão, pico por hora).
- **Multi-creator / agência** — a matriz convida creators, vê tudo consolidado; cada creator vê só os próprios dados.

### Fluxo de dados
```
Creator autoriza (OAuth Creator do TikTok Shop Affiliate)
   -> token (access/refresh) armazenado no servidor (criptografado, service role)
   -> "Sincronizar": Search Creator Affiliate Orders (assinado HMAC-SHA256)
   -> pedidos de afiliado mapeados para o modelo interno (orders), por creator
   -> Fechamento (apuração por turno) e Dashboard (análise)
   -> Relatório de comissão (imagem/PDF)
```
Alternativa manual: creator exporta a planilha de pedidos de afiliado no TikTok e faz upload — mesmo destino (orders).

### APIs do TikTok Shop usadas
- **Affiliate Information (434372):** Get Creator Profile, Get Live Room Info.
- **Read Creator Affiliate Collaborations (1021508):** **Search Creator Affiliate Orders** (`POST /affiliate_creator/202410/orders/search`) — fonte primária do fechamento.
- **Autorização:** fluxo de Creator (`shop.tiktok.com/alliance/creator/auth`), troca de `auth_code` por token (`grant_type=authorized_code`), refresh de token, validação de `user_type=1` e `granted_scopes`.

### Casos de uso
1. **Creator** conecta a conta TikTok, sincroniza os pedidos e vê seu fechamento de comissão por turno; baixa o relatório.
2. **Agência (matriz)** gerencia os creators, acompanha a comissão consolidada e a atividade de cada um.
3. Apuração por **turno de live** quando vários creators revezam na mesma conta/live.

### Segurança e privacidade
- Tokens OAuth **apenas no servidor** (variáveis de ambiente + service role), nunca no cliente.
- **Isolamento por usuário (RLS)** no banco: cada creator acessa somente os próprios dados; a matriz (admin) acessa o consolidado.
- Aprovado na **avaliação de segurança de dados do BR**.
- Escopo mínimo (somente os escopos de Affiliate necessários).

### Escopo do serviço
Creators de afiliado **locais do Brasil (BR)**.
```
