-- ================================================
-- LIMPAR pedidos — recomeçar do zero (dados de teste/uploads antigos).
-- DESTRUTIVO: apaga os pedidos e o bucket de upload do partner.
-- Depois é só re-sincronizar/subir o que quiser.
-- Escopo: só a agência atual (brx).
-- ================================================
delete from public.orders
where agency_id = (select id from public.agencies where slug = 'brx')
   or agency_id is null;

-- zera o "carimbo" do upload do partner (pra próxima sync recomeçar limpa)
update public.uploads set uploaded_at = null
where filename = '__tiktok_partner__';
