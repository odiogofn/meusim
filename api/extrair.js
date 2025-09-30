// api/extrair.js
import fetch from 'node-fetch';
import cheerio from 'cheerio';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const monthNamesPt = {
  '1': 'Janeiro','2': 'Fevereiro','3': 'Março','4': 'Abril','5': 'Maio','6': 'Junho',
  '7': 'Julho','8': 'Agosto','9': 'Setembro','10': 'Outubro','11': 'Novembro','12': 'Dezembro'
};

function normalizeMonthFilter(m) {
  if (!m) return null;
  const n = String(m).trim();
  if (!n) return null;
  // se for número (1..12), converte para nome
  if (/^\d+$/.test(n)) return monthNamesPt[String(parseInt(n,10))];
  return n; // assume já é nome em pt
}

function parseDDMMYYYYtoISO(s){
  if(!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req, res) {
  try {
    const { ano, mes, dataEntrega } = req.query;
    if (!ano) return res.status(400).json({ error: 'Parâmetro "ano" é obrigatório' });

    // pegar clientes ativos
    const { data: clientes, error: errCli } = await supabase
      .from('clientes')
      .select('id, entidade, cod_tce')
      .eq('ativo', 'sim')
      .order('cod_tce', { ascending: true });

    if (errCli) return res.status(500).json({ error: errCli.message });
    if (!clientes || clientes.length === 0) return res.status(200).json([]);

    const results = [];
    const mesFilter = normalizeMonthFilter(mes); // ex: 'Janeiro' ou null
    const dataFilterISO = dataEntrega || null; // frontend envia YYYY-MM-DD or empty

    for (let i=0; i<clientes.length; i++) {
      const c = clientes[i];
      const cod = String(c.cod_tce).padStart(3,'0');
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod}/versao/${ano}`;

      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Extração TCE)' } });
        if (!response.ok) {
          console.warn(`HTTP ${response.status} para ${url}`);
          results.push({ mes: 'ERRO', municipio: c.entidade, unidade_orcamentaria: '—', data_entrega: `HTTP ${response.status}` });
          await sleep(2000);
          continue;
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        const municipio = ($('#barraConteudoTitulo h1 a').text().trim() || $('h1 a').text().trim() || c.entidade).trim();

        // localizar tabela
        let table = $('#example');
        if (!table.length) table = $('#montaTabela table').first();
        if (!table.length) table = $('table.tablesorter').first();

        if (table && table.length) {
          table.find('tbody tr').each((_, tr) => {
            const tds = $(tr).find('td').map((i, td) => $(td).text().trim()).get();

            // pular linhas vazias/colspan
            if (!tds || tds.length < 5) return;

            const mesText = tds[0] || '';
            const dataEntregaText = tds[2] || '';
            const unidade = tds[4] || '';

            // aplicar filtro de mês (se informado)
            if (mesFilter) {
              if (!mesText.toLowerCase().includes(mesFilter.toLowerCase())) return;
            }
            // aplicar filtro por data de entrega (se informado) - comparar ISO
            if (dataFilterISO) {
              const iso = parseDDMMYYYYtoISO(dataEntregaText);
              if (!iso || iso !== dataFilterISO) return;
            }

            results.push({
              mes: mesText,
              municipio,
              unidade_orcamentaria: unidade,
              data_entrega: dataEntregaText
            });
          });
        } else {
          results.push({ mes: 'ERRO', municipio: c.entidade, unidade_orcamentaria: '—', data_entrega: 'Tabela não encontrada' });
        }
      } catch (err) {
        console.error('Erro ao processar', c.cod_tce, err.message);
        results.push({ mes: 'ERRO', municipio: c.entidade, unidade_orcamentaria: '—', data_entrega: `Erro: ${err.message}` });
      }

      // respeitar intervalo de 2s entre requisições
      await sleep(2000);
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
