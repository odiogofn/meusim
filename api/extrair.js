// /api/extrair.js
import { createClient } from "@supabase/supabase-js";
import { load } from "cheerio";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
    const params = req.method === "POST" ? (req.body || {}) : (req.query || {});
    const ano = String(params.ano || "").trim();

    if (!ano) {
      return res.status(400).json({ error: 'Parâmetro "ano" é obrigatório (envia ano no body JSON ou ?ano=)' });
    }

    // buscar clientes ativos
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
      const cod = String(c.cod_tce ?? "").padStart(3, "0");
      const entidade = c.entidade ?? "[sem nome]";

      progresso.push(`⏳ Processando ${entidade}...`);
      console.log(`➡️ ${entidade} -> iniciando`);

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
          console.warn(`${entidade} - ${msg}`);
          progresso.push(`❌ ${entidade} - ${msg}`);
          await sleep(2000);
          continue;
        }

        const html = await response.text();
        const $ = load(html);

        let table = $("#example");
        if (!table.length) table = $("#montaTabela table").first();
        if (!table.length) table = $("table.tablesorter").first();
        if (!table.length) table = $("table").first();

        if (!table.length) {
          const msg = "Tabela não encontrada";
          console.warn(`${entidade} - ${msg}`);
          progresso.push(`❌ ${entidade} - ${msg}`);
          await sleep(2000);
          continue;
        }

        const linhasExtraidas = [];
        table.find("tbody tr").each((_, tr) => {
          const tds = $(tr).find("td");
          if (!tds || tds.length < 5) return;

          const mes = normalizarTexto($(tds[0]).text());
          if (!mes) return;

          const data_limite = normalizarTexto($(tds[1]).text());
          const data_entrega = normalizarTexto($(tds[2]).text());
          const situacao = normalizarTexto($(tds[3]).text());
          const unidade = normalizarTexto($(tds[4]).text());

          linhasExtraidas.push({
            entidade,
            cod_tce: cod,
            mes,
            data_limite,
            data_entrega,
            situacao,
            unidade_orcamentaria: unidade,
          });
        });

        if (linhasExtraidas.length > 0) {
          const { error: insertErr } = await supabase.from("consultas").insert(linhasExtraidas);
          if (insertErr) {
            console.error(`Erro ao inserir consultas para ${entidade}:`, insertErr);
            progresso.push(`❌ ${entidade} - erro ao salvar`);
          } else {
            progresso.push(`✅ ${entidade} concluído — ${linhasExtraidas.length} registros`);
            resultados.push({ entidade, cod_tce: cod, registros: linhasExtraidas.length });
          }
        } else {
          progresso.push(`⚠️ ${entidade} — nenhuma linha válida encontrada`);
        }
      } catch (errFetch) {
        console.error(`Erro ao processar ${entidade}:`, errFetch);
        progresso.push(`❌ ${entidade} — erro: ${errFetch.message || String(errFetch)}`);
      }

      if (i < clientes.length - 1) await sleep(2000);
    }

    progresso.push("💾 Extração finalizada.");
    return res.status(200).json({ sucesso: true, progresso, resultados });

  } catch (err) {
    console.error("ERRO GERAL /api/extrair:", err);
    return res.status(500).json({ error: err.message || "Erro interno" });
  }
}
