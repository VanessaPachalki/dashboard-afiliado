# TikTok Shop — Puxar dados de afiliado (creator) via Partner API (TAP)

Guia portátil do fluxo que FUNCIONA no BR para importar pedidos de afiliado
(com creator, comissão e impostos) sem o creator conectar a conta.

---

## O que estava travando (o problema)

Tentava-se puxar os dados via **Creator authorization**
(`shop.tiktok.com/alliance/creator/auth?app_key=...`), mas dava:

> "This app or service is not available in your region"

Causa: a autorização de **creator** do Affiliate não está liberada para BR em
app não publicado (só com conta de teste). Isso NÃO é bug de código.

**A solução real (usada por quem já opera no BR):** o fluxo **Partner (TAP)**.
A AGÊNCIA autoriza UMA vez, o creator não conecta nada, e você puxa os pedidos
(com creator + comissão) pela API de partner. Não passa pelo gate de região do
creator.

---

## O caminho certo (Partner / TAP)

- **Categoria do app:** "Seller and Scalable Creator Match-Up (TAP)"
  (no Partner Center em pt pode aparecer como "Gerenciamento de afiliados").
  O Partner Center só expõe o fluxo de partner authorization para essa categoria.
- **Escopos partner necessários** (Manage API — chaves que começam com `partner.`):
  - `partner.tap_campaign.read` (733508) — **essencial** (lê campanhas/pedidos)
  - `partner.authorization.info` (733700) — **essencial** (pega o category_asset_cipher)
  - (opcionais) `partner.tap_campaign.write` (733444), `.product.write` (733572), `.link.write` (733636)
  - ⚠️ Escopos partner são **gated** → passam por **review** da TikTok antes de valer.
- **Endpoint dos dados:** `POST /affiliate_partner/202504/cap_order/search`
- **Response (skus[]) traz:** `creator_username`, `estimated_commission`/`actual_commission`,
  `agency_commission`/`total_agency_commission`, `content_id` (live), `shop_name`,
  `product_name`, `quantity`, `refunded_quantity`, `price`, `isr`, `iva`.

---

## Fluxo de autorização (o que fazer para continuar)

1. **Ativar os escopos partner** no app: App & Service > Gerenciar > Manage API →
   ativar `partner.tap_campaign.read` + `partner.authorization.info` (mínimo) →
   Publicar. **Aguardar aprovação** (gated).
2. **Pegar o Service ID:** App & Service > selecionar o app > Basic Information > Service ID.
3. **Autorizar com a CONTA PRINCIPAL** (subconta NÃO autoriza):
   ```
   https://partner.tiktokshop.com/open/authorize?service_id={service_id}
   ```
   Na tela, escolher "Seller and Scalable Creator Match-Up (TAP)".
4. **Callback** recebe `auth_code` na Redirect URL configurada.
5. **Trocar auth_code por token** (backend):
   ```
   GET https://auth.tiktok-shops.com/api/v2/token/get
       ?app_key={app_key}&app_secret={app_secret}&auth_code={auth_code}&grant_type=authorized_code
   ```
   Guardar access_token + refresh_token (server-side, criptografado). Validar `granted_scopes`.
6. **Pegar o cipher** (obrigatório para as Affiliate Partner APIs):
   ```
   GET /authorization/202405/category_assets     Header: x-tts-access-token: {access_token}
   ```
   Retorna `category_assets[].cipher` → usar como `category_asset_cipher`.
7. **Puxar os pedidos:**
   ```
   POST /affiliate_partner/202504/cap_order/search
   Query: app_key, category_asset_cipher, page_size, page_token, sign, timestamp
   Body:  { create_time_ge, create_time_lt }   (unix seconds; janela incremental)
   ```
   Assinatura **HMAC-SHA256** (base = app_secret + path + {sortedKey}{value}... + body + app_secret),
   `timestamp` Unix (10 dígitos), header `x-tts-access-token`.
8. **Refresh do token** quando expira:
   ```
   GET https://auth.tiktok-shops.com/api/v2/token/refresh
       ?app_key=...&app_secret=...&refresh_token=...&grant_type=refresh_token
   ```

---

## Erros comuns e o que significam

| Erro | Significado | Ação |
|---|---|---|
| "not available in your region" | está no fluxo **creator** OU app não publicado | usar o fluxo **partner** (conta principal) |
| "Subcontas não podem autorizar" | logado numa subconta | entrar com a **conta principal** |
| "no partner scope for this app" / "requested API list is empty" | escopos partner não ativados/aprovados | ativar `partner.*` + esperar aprovação |
| 105005 | falta escopo (app ou token) | conferir Manage API e `granted_scopes` |
| 105002 | access token expirou | refresh |
| 101000 | identidade errada (ex: token seller em API partner) | usar o token certo |
| 106001 | assinatura inválida | revisar o cálculo do `sign` |

---

## Segurança

- Tokens e `app_secret` **apenas no servidor** (env vars), criptografados. Nunca no frontend.
- Custom service não precisa de review de serviço; mas os **escopos partner** têm review próprio (gated).

---

## Estado atual (o que falta)

- Escopos partner **ativados / em review**.
- Quando aprovados → **autorizar** (conta principal, link partner) → pegar `app_key` + `service_id`
  (app_secret na env var do servidor) → o backend faz token → cipher → `cap_order/search`.
