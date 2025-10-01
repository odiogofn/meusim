// api/extrair.js
import fetch from "node-fetch";
import cheerio from "cheerio";
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
  if(!n) return null;
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
    // aceitar POST (body) ou GET (query)
    const params = req.method === 'POST' ? (req.body || {}) : (req.query || {});
    const { ano, mes, dataEntrega } = params;

    if (!ano) return res.status(400).json({ error: 'Parâmetro "ano" é obrigatório' });

    // pega clientes ativos = 'sim' (usar service role)
    const { data: clientes, error: errCli } = await supabase
      .from('clientes')
      .select('*')
      .eq('ativo', 'sim')
      .order('cod_tce', { ascending: true });

    if (errCli) {
      console.error('Erro ao buscar clientes:', errCli);
      return res.status(500).json({ error: errCli.message });
    }
    if (!clientes || clientes.length === 0) {
      return res.status(200).json([]);
    }

    // preparar filtros
    let mesFilterName = null;
    if (mes && String(mes).trim() !== '') {
      // aceita número (1..12) ou nome
      mesFilterName = /^\d+$/.test(String(mes).trim()) ? monthNumberToName(mes) : String(mes).trim();
    }
    const dataFilterISO = dataEntrega && dataEntrega !== '' ? String(dataEntrega) : null;

    const results = [];

    // processa clientes sequencialmente, com 2s entre requests
    for (let i = 0; i < clientes.length; i++) {
      const c = clientes[i];
      const codRaw = c.cod_tce ?? c['cod.tce'] ?? c.codTce ?? '';
      const cod = String(codRaw || '').padStart(3, '0');
      const entidade = c.entidade ?? c.Entidade ?? c.nome ?? '—';
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod}/versao/${ano}`;

      try {
        console.log(`Buscando (${i+1}/${clientes.length}): ${url}`);
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Extração TCE; +contato)',
            'Accept': 'text/html,application/xhtml+xml'
          },
          // timeout não controlado aqui; Vercel controla
        });

        if (!response.ok) {
          console.warn(`HTTP ${response.status} para ${url}`);
          results.push({ cod_tce: cod, municipio: entidade, error: `HTTP ${response.status}` });
          // esperar 2s antes do próximo
          await sleep(2000);
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        // tentar obter nome do município na página
        const municipioName = ($('#barraConteudoTitulo h1 a').text().trim() ||
                               $('h1 a').first().text().trim() ||
                               entidade).trim();

        // localizar tabela (varias possibilidades)
        let table = $('#example');
        if (!table.length) table = $('#montaTabela table').first();
        if (!table.length) table = $('table.tablesorter').first();
        if (!table.length) table = $('table').first();

        if (!table || !table.length) {
          results.push({ cod_tce: cod, municipio: municipioName, error: 'Tabela não encontrada' });
          await sleep(2000);
          continue;
        }

        // percorrer linhas da tabela (tbody tr)
        table.find('tbody tr').each((idx, tr) => {
          const tds = $(tr).find('td').map((j, td) => $(td).text().trim()).get();
          if (!tds || tds.length < 5) return; // pular linhas vazias/colspan

          const mesText = tds[0] || '';
          const dataEntregaText = tds[2] || '';
          const unidade = tds[4] || '';

          // aplicar filtro de mês (se fornecido)
          if (mesFilterName) {
            if (!mesText.toLowerCase().includes(mesFilterName.toLowerCase())) return;
          }
          // aplicar filtro de dataEntrega (se fornecido) - comparar ISO
          if (dataFilterISO) {
            const iso = parseDDMMYYYYtoISO(dataEntregaText);
            if (!iso || iso !== dataFilterISO) return;
          }

          results.push({
            cod_tce: cod,
            municipio: municipioName,
            mes: mesText,
            unidade_orcamentaria: unidade,
            data_entrega: dataEntregaText
          });
        });

      } catch (err) {
        console.error(`Erro ao processar ${cod} (${entidade}):`, err);
        results.push({ cod_tce: cod, municipio: entidade, error: err.message || String(err) });
      }

      // intervalo de 2s entre requisições (requisito)
      await sleep(2000);
    }

    return res.status(200).json(results);
  } catch (err) {
    console.error('ERRO GERAL em /api/extrair:', err);
    return res.status(500).json({ error: err.message || 'Erro interno na extração' });
  }
}
