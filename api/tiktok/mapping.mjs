// Mapeamento puro (sem I/O) de pedidos de afiliado da TikTok -> schema `orders`.
// Schema confirmado na OAS oficial: affiliate_creator 202410 orders/search.

const num = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const amt = o => (o && o.amount != null ? num(o.amount) : 0); // {amount,currency}
const CONTENT_TYPE_MAP = { LIVE: 0, VIDEO: 1, SHOWCASE: 3, PRODUCT_CARD: 2 };

export function mapStatus(s) {
  const u = String(s || '').toUpperCase();
  if (u.includes('UNSETTLE')) return 2;            // ainda não liquidado
  if (u.includes('SETTLE')) return 0;              // liquidado
  if (u.includes('INVALID') || u.includes('CANCEL') || u.includes('REFUND')) return 1;
  return 2;
}

// create_time (unix UTC) -> partes no horário de Brasília (turno por hora depende disso)
export function brParts(unixSec) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  });
  const p = {};
  for (const part of fmt.formatToParts(new Date(unixSec * 1000))) p[part.type] = part.value;
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  const order_date = `${p.year}-${p.month}-${p.day}`;
  const dow = (new Date(order_date + 'T00:00:00Z').getUTCDay() + 6) % 7;
  return { order_date, month: `${p.year}-${p.month}`, hour, minute: parseInt(p.minute, 10), dow };
}

// Achata um pedido em N linhas (1 por SKU) — igual ao xlsx (pedido + SKU).
export function mapOrderToRows(order, ownerId, accountId, agencyId) {
  const t = brParts(order.create_time || 0);
  const status = mapStatus(order.status);
  return (order.skus || []).map(sku => ({
    user_id: ownerId,           // dono (RLS de orders é por user_id)
    account_id: accountId,
    agency_id: agencyId,
    tiktok_order_id: String(order.id || ''),
    sku_id: String(sku.id || ''),
    month: t.month,
    order_date: t.order_date,
    hour: t.hour,
    minute: t.minute,
    day_of_week: t.dow,
    gmv: amt(sku.price),
    settlement_status: status,
    content_type: CONTENT_TYPE_MAP[String(sku.content_type || '').toUpperCase()] ?? 0,
    content_id: String(sku.content_id || '').slice(-6),
    store_name: sku.shop_name || 'Desconhecida',
    product_name: (sku.product_name || '').slice(0, 60),
    items_sold: num(sku.quantity),
    items_refunded: num(sku.refunded_quantity),
    estimated_commission: amt(sku.estimated_commission),
    received_commission: amt(sku.actual_commission)   // comissão liquidada = recebida
  }));
}
