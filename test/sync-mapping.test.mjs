// Teste local do mapeamento do sync (sem API) — valida achatar skus[],
// comissão {amount}, e o fuso de Brasília. Rodar: node test/sync-mapping.test.mjs
import { mapOrderToRows, brParts, mapStatus } from '../api/tiktok/mapping.mjs';

let fail = 0;
const eq = (got, exp, msg) => {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log(`${ok ? '✅' : '❌'} ${msg}${ok ? '' : `  (got ${JSON.stringify(got)}, exp ${JSON.stringify(exp)})`}`);
  if (!ok) fail++;
};

// 2026-08-13 02:56:43 UTC = 2026-08-12 23:56:43 no horário de Brasília (UTC-3)
const create_time = Math.floor(Date.parse('2026-08-13T02:56:43Z') / 1000);

const order = {
  id: '585521335145956426',
  create_time,
  status: 'SETTLED',
  skus: [
    {
      id: 'sku-1', product_id: 'p1', product_name: 'Fone Bluetooth XYZ Premium com cancelamento de ruído',
      shop_name: 'Best Buy Tech', quantity: 2, refunded_quantity: 0,
      content_id: '7673286476646075152', content_type: 'LIVE',
      price: { amount: '2949.99', currency: 'BRL' },
      estimated_commission: { amount: '96.00', currency: 'BRL' },
      actual_commission: { amount: '80.00', currency: 'BRL' }
    },
    {
      id: 'sku-2', product_id: 'p2', product_name: 'Capinha',
      shop_name: 'Best Buy Tech', quantity: 1, refunded_quantity: 1,
      content_id: '7673286476646075152', content_type: 'LIVE',
      price: { amount: '49.90', currency: 'BRL' },
      estimated_commission: { amount: '5.00', currency: 'BRL' },
      actual_commission: { amount: '4.00', currency: 'BRL' }
    }
  ]
};

const rows = mapOrderToRows(order, 'owner-uid', 'acc-id', 'ag-id');

// 1) achatou em 2 linhas (1 por SKU)
eq(rows.length, 2, '2 SKUs viram 2 linhas');

// 2) fuso de Brasília: 02:56 UTC -> 23:56 do dia anterior
eq(rows[0].order_date, '2026-08-12', 'order_date em BRT (dia anterior ao UTC)');
eq(rows[0].hour, 23, 'hour em BRT');
eq(rows[0].minute, 56, 'minute correto');
eq(rows[0].month, '2026-08', 'month correto');

// 3) campos do pedido + SKU
eq(rows[0].tiktok_order_id, '585521335145956426', 'order id');
eq(rows[0].sku_id, 'sku-1', 'sku id');
eq(rows[0].settlement_status, 0, 'SETTLED -> 0 (liquidado)');
eq(rows[0].content_type, 0, 'LIVE -> 0');
eq(rows[0].content_id, '075152', 'content_id últimos 6');
eq(rows[0].store_name, 'Best Buy Tech', 'store_name = shop_name');
eq(rows[0].gmv, 2949.99, 'gmv = price.amount (numérico)');
eq(rows[0].estimated_commission, 96, 'estimated_commission.amount');
eq(rows[0].received_commission, 80, 'received = actual_commission.amount');
eq(rows[0].items_sold, 2, 'items_sold = quantity');
eq(rows[1].items_refunded, 1, 'items_refunded = refunded_quantity');
eq(rows[0].product_name.length <= 60, true, 'product_name truncado <= 60');

// 4) status mapping
eq(mapStatus('UNSETTLED'), 2, 'UNSETTLED -> 2 (pendente)');
eq(mapStatus('SETTLED'), 0, 'SETTLED -> 0');
eq(mapStatus('CANCELED'), 1, 'CANCELED -> 1 (inelegível)');

console.log(fail === 0 ? '\n🎉 TODOS OS TESTES PASSARAM' : `\n❌ ${fail} teste(s) falharam`);
process.exit(fail ? 1 : 0);
