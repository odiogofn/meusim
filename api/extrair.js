// api/extrair.js
import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const monthNamesPt = {
  '1': 'Janeiro','2': 'Fevereiro','3': 'Março','4': 'Abril','5': 'Maio','6': 'Junho',
  '7': 'Julho','8': 'Agosto','9': 'Setembro','10': 'Outubro','11': 'Novembro','12': 'Dezembro'
};

function monthNumberToName(n){
  if(!n && n !== 0) return null;
  const v = Number(n);
  if (isNaN(v)) return null;
  return monthNamesPt[String(v)] || null;
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
    const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const { ano, mes, dataEntrega } = params;

    if (!ano) {
      return res.status(400).json({ error: 'Parâmetro "ano" é obrigatório' });
    }

    // preparar filtros
    let mesFilterName = null;
    if (mes && String(mes).trim() !== '') {
      mesFilterName = /^\d+$/.test(String(mes).trim()) ? monthNumberToName(mes) : String(mes).trim();
    }
    const dataFilterISO = dataEntrega && dataEntrega !== '' ? String(dataEntrega) : null;

    // buscar clientes ativos
    const { data: clientes, error: errCli } = await supabase
      .from('clientes')
      .select('id, entidade, cod_tce, ativo')
      .eq('ativo', 'sim')
      .order('cod_tce', { ascending: true });

    if (errCli) {
      console.error('Erro ao buscar clientes:', errCli);
      return res.status(500).json({ error: 'Erro ao buscar clientes', details: errCli.message || errCli });
    }

    if (!clientes || clientes.length === 0) {
      return res.status(200).json([]);
    }

    const results = [];

    for (let i = 0; i < clientes.length; i++) {
      const c = clientes[i];
      const raw = c.cod_tce ?? c['cod.tce'] ?? c.codTce ?? '';
      const cod = String(raw).padStart(3, '0');
      const entidade = c.entidade ?? '—';
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod}/versao/${ano}`;

      try {
        console.log(`(${i+1}/${clientes.length}) Fetching: ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Extração TCE; contact)',
            'Accept': 'text/html,application/xhtml+xml'
          }
        });

        if (!response.ok) {
          console.warn(`HTTP ${response.status} for ${url}`);
          await sleep(2000);
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const municipioName = ($('#barraConteudoTitulo h1 a').text().trim()
                                || $('#barraConteudoTitulo h1').text().trim()
                                || $('h1 a').first().text().trim()
                                || entidade).trim();

        let table = $('#example');
        if (!table.length) table = $('#montaTabela table').first();
        if (!table.length) table = $('table.tablesorter').first();
        if (!table.length) table = $('table').first();

        if (!table || !table.length) {
          console.warn(`Tabela não encontrada em ${url}`);
          await sleep(2000);
          continue;
        }

        table.find('tbody tr').each((_, tr) => {
          const tds = $(tr).find('td').map((j, td) => $(td).text().trim()).get();
          if (!tds || tds.length < 5) return;

          const mesText = tds[0] || '';
          const dataLimiteText = tds[1] || '';
          const dataEntregaText = tds[2] || '';
          const situacaoText = tds[3] || '';
          const unidade = tds[4] || '';

          // filtros
          if (mesFilterName) {
            if (!mesText.toLowerCase().includes(String(mesFilterName).toLowerCase())) return;
          }
          if (dataFilterISO) {
            const iso = parseDDMMYYYYtoISO(dataEntregaText);
            if (!iso || iso !== dataFilterISO) return;
          }

          // 🚨 Apenas envia pro JSON se TODOS os campos exigidos estiverem preenchidos
          if (mesText && municipioName && unidade && dataEntregaText) {
            results.push({
              mes: mesText,
              municipio: municipioName,
              unidade_orcamentaria: unidade,
              data_entrega: dataEntregaText
            });
          }
        });

      } catch (errFetch) {
        console.error(`Erro ao processar ${cod} (${entidade}):`, errFetch);
      }

      await sleep(4000);
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error('ERRO GERAL /api/extrair:', err);
    return res.status(500).json({ error: err.message || 'Erro interno na extração' });
  }
}
