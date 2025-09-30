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

function pad3(s){ return String(s).padStart(3,'0'); }
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
    if (!ano) return res.status(400).json({ error: 'ano é obrigatório' });

    // pega clientes ativos
    const { data: clientes, error: errCli } = await supabase.from('clientes').select('id,entidade,cod_tce').eq('ativo', 'sim').order('cod_tce', { ascending: true });
    if (errCli) return res.status(500).json({ error: errCli.message });
    if (!clientes || clientes.length === 0) return res.status(200).json([]);

    const results = [];

    for (let i = 0; i < clientes.length; i++) {
      const c = clientes[i];
      const cod = pad3(c.cod_tce);
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod}/versao/${ano}`;

      try {
        const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)' } });
        if (!response.ok) {
          console.warn(`HTTP ${response.status} para ${url}`);
          // opcional: push erro
          results.push({ mes: 'ERRO', municipio: c.entidade, unidade_orcamentaria: '—', data_entrega: `HTTP ${response.status}` });
          await sleep(2000);
          continue;
        }
        const html = await response.text();
        const $ = cheerio.load(html);

        // tentar obter nome do município
        const municipio = ($('#barraConteudoTitulo h1 a').text().trim() || $('h1 a').text().trim() || c.entidade).trim();

        // procurar a tabela com os dados (várias possibilidades)
        const table = $('#montaTabela table').first().length ? $('#montaTabela table') : ($('table.tablesorter').first().length ? $('table.tablesorter') : $('#example'));

        if (table && table.length) {
          table.find('tbody tr').each((_, tr) => {
            const tds = $(tr).find('td').map((i, td) => $(td).text().trim()).get();

            // linha válida no exemplo tem 5 tds e o primeiro td com mês
            if (tds.length >= 5 && tds[0]) {
              const mesText = tds[0];
              const dataEntregaText = tds[2] || '';
              const unidade = tds[4] || '';

              // aplicar filtros: mes (por número) -> compara nome do mês em pt
              if (mes && mes !== '' && String(mes) !== '') {
                const desiredMonthName = monthNamesPt[String(parseInt(mes,10))];
                if (!mesText.toLowerCase().includes(desiredMonthName.toLowerCase())) {
                  return; // pula esta linha
                }
              }

              // filtro por data de entrega (frontend envia YYYY-MM-DD) -> converter e comparar
              if (dataEntrega && dataEntrega !== '') {
                const iso = parseDDMMYYYYtoISO(dataEntregaText);
                if (iso !== dataEntrega) return; // pula
              }

              results.push({
                mes: mesText,
                municipio,
                unidade_orcamentaria: unidade,
                data_entrega: dataEntregaText
              });
            }
          });
        } else {
          // tabela não encontrada
          results.push({ mes: 'ERRO', municipio: c.entidade, unidade_orcamentaria: '—', data_entrega: 'Tabela não encontrada' });
        }
      } catch (err) {
        console.error('erro ao processar', c.cod_tce, err.message);
        results.push({ mes: 'ERRO', municipio: c.entidade, unidade_orcamentaria: '—', data_entrega: `Erro: ${err.message}` });
      }

      // atraso de 2 segundos entre requests (requisito)
      await sleep(2000);
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
