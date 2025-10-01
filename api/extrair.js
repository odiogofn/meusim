// /api/extrair.js
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";    // forma ESM correta
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY; // service role, backend-only
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Variáveis de ambiente SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY não configuradas!");
}
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalizarTexto(txt) {
  if (!txt && txt !== 0) return null;
  const s = String(txt).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
  return s === "" ? null : s;
}

export default async function handler(req, res) {
  try {
    // aceita POST (body) ou GET (query)
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const ano = String(params.ano || "").trim();

    if (!ano) {
      return res.status(400).json({ error: 'Parâmetro "ano" é obrigatório (envia ano no body JSON ou ?ano=)' });
    }

    // buscar clientes ativos = 'sim'
    const { data: clientes, error: errCli } = await supabase
      .from("clientes")
      .select("id, entidade, cod_tce, ativo")
      .eq("ativo", "sim")
      .order("cod_tce", { ascending: true });

    if (errCli) {
      console.error("Erro buscando clientes:", errCli);
      return res.status(500).json({ error: "Erro ao buscar clientes", details: errCli.message || errCli });
    }
    if (!clientes || clientes.length === 0) {
      return res.status(200).json({ message: "Nenhum cliente ativo encontrado", resultados: [], progresso: [] });
    }

    const resultados = [];
    const progresso = [];

    for (let i = 0; i < clientes.length; i++) {
      const c = clientes[i];
      // garantir cod com 3 dígitos (001, 010, 123)
      const cod = String(c.cod_tce ?? "").padStart(3, "0");
      const entidade = c.entidade ?? "[sem nome]";
      const pos = `${i + 1}/${clientes.length}`;

      progresso.push(`⏳ ${entidade} (${pos}) em andamento`);
      console.log(`➡️ ${entidade} (${pos}) -> iniciando`);

      // montar URL correta usando o ano do filtro
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod}/versao/${ano}`;

      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Extração TCE; +contato)",
            Accept: "text/html,application/xhtml+xml",
          },
        });

        if (!response.ok) {
          const msg = `HTTP ${response.status}`;
          console.warn(`${entidade} (${pos}) - ${msg}`);
          progresso.push(`❌ ${entidade} (${pos}) - ${msg}`);
          resultsPushError(entidade, cod, pos, msg);
          await sleep(2000);
          continue;
        }

        const html = await response.text();
        const $ = load(html);

        // localizar a tabela preferencialmente pelo id #example, ou montaTabela, ou tablesorter, ou primeira tabela
        let table = $("#example");
        if (!table.length) table = $("#montaTabela table").first();
        if (!table.length) table = $("table.tablesorter").first();
        if (!table.length) table = $("table").first();

        if (!table.length) {
          const msg = "Tabela não encontrada";
          console.warn(`${entidade} (${pos}) - ${msg}`);
          progresso.push(`❌ ${entidade} (${pos}) - ${msg}`);
          await sleep(2000);
          continue;
        }

        // percorre linhas do tbody
        const linhasExtraidas = [];
        table.find("tbody tr").each((_, tr) => {
          const tds = $(tr).find("td");
          // pular linhas com colspan vazio etc.
          if (!tds || tds.length < 5) return;

          const mesRaw = $(tds[0]).text();
          const mes = normalizarTexto(mesRaw);
          // se coluna mês vazia, pular (linha de separador)
          if (!mes) return;

          const data_limite = normalizarTexto($(tds[1]).text());
          const data_entrega = normalizarTexto($(tds[2]).text());
          const situacao = normalizarTexto($(tds[3]).text());
          const unidade = normalizarTexto($(tds[4]).text());

          const registro = {
            entidade,
            cod_tce: cod,
            mes,
            data_limite,
            data_entrega,
            situacao,
            unidade_orcamentaria: unidade,
            ano,
          };

          linhasExtraidas.push(registro);
        });

        // inserir linhas válidas coletadas para este município (se houver)
        if (linhasExtraidas.length > 0) {
          // opcional: inserir em lote (melhor performance)
          const { error: insertErr } = await supabase.from("consultas").insert(linhasExtraidas);
          if (insertErr) {
            console.error(`Erro ao inserir consultas para ${entidade}:`, insertErr);
            progresso.push(`❌ ${entidade} (${pos}) - erro ao salvar`);
            // não interromper o loop, apenas registra
          } else {
            progresso.push(`✅ ${entidade} (${pos}) concluído — ${linhasExtraidas.length} registros`);
            // acumular resultados resumidos para retorno
            resultados.push({ entidade, cod_tce: cod, registros: linhasExtraidas.length });
          }
        } else {
          progresso.push(`⚠️ ${entidade} (${pos}) — nenhuma linha válida encontrada`);
        }
      } catch (errFetch) {
        console.error(`Erro ao processar ${entidade} (${pos}):`, errFetch);
        progresso.push(`❌ ${entidade} (${pos}) — erro: ${errFetch.message || String(errFetch)}`);
      }

      // intervalo de 2s entre requisições
      if (i < clientes.length - 1) await sleep(2000);
    } // fim loop clientes

    progresso.push("💾 Extração finalizada.");
    return res.status(200).json({ sucesso: true, progresso, resultados });

    // função auxiliar local (se quiser usar para criar objeto de erro)
    function resultsPushError(entidadeName, codName, posStr, message) {
      // opcional: acumular info de erro nos resultados
      // resultados.push({ entidade: entidadeName, cod_tce: codName, registros: 0, erro: message });
    }
  } catch (err) {
    console.error("ERRO GERAL /api/extrair:", err);
    return res.status(500).json({ error: err.message || "Erro interno" });
  }
}
