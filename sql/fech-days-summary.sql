-- ================================================
-- Resumo de pedidos por dia (pro Passo 1 do fechamento — "frescor").
-- Retorna, por dia: total de pedidos e quantos ainda estão PENDENTES
-- (settlement_status 2=Pendente, 3=Aguardando). Dia com 0 pendentes = final.
-- RLS aplica (security invoker): matriz vê tudo, creator vê o dele.
-- ================================================

create or replace function public.fech_days(p_from text, p_to text, p_agency uuid default null)
returns table(order_date text, total bigint, pendentes bigint)
language sql stable as $$
  select order_date,
         count(*)::bigint,
         count(*) filter (where settlement_status in (2, 3))::bigint
  from public.orders
  where order_date >= p_from and order_date <= p_to
    and (p_agency is null or agency_id = p_agency)   -- calendário só da agência atual
  group by order_date
  order by order_date desc;
$$;
