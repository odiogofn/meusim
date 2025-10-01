import * as cheerio from "cheerio";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// 🔹 Função para normalizar células
function normalizarTexto(txt) {
  if (!txt) return null;
  const limpado = txt.replace(/\s+/g, " ").trim();
  return limpado === "" ? null : limpado;
}

export default async function handler(req, res) {
  try {
    const { cod_tce, municipio } = req.query;
    if (!cod_tce) {
      return res.status(400).json({ error: "Faltou o código do TCE" });
    }

    // 🔹 Faz o request ao site do TCE
    const response = await fetch(
      `https://www.tce.someapi.gov.br/consulta?cod=${cod_tce}`
    );
    if (!response.ok) {
      throw new Error(`Erro ao acessar TCE: ${response.status}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const linhas = [];

    // 🔹 Percorre cada linha da tabela
    $("table tr").each((i, el) => {
      const cols = $(el).find("td");
      if (cols.length >= 4) {
        const mes = normalizarTexto($(cols[0]).text());
        const municipioExtraido = normalizarTexto($(cols[1]).text());
        const orgao = normalizarTexto($(cols[2]).text());
        const data = normalizarTexto($(cols[3]).text());

        linhas.push({
          mes,
          municipio: municipioExtraido || municipio, // se não tiver na tabela, usa o passado
          orgao,
          data,
          cod_tce,
        });
      }
    });

    // 🔹 Salva no Supabase
    if (linhas.length > 0) {
      const { error } = await supabase.from("consultas").insert(linhas);
      if (error) {
        console.error("Erro ao salvar:", error);
        return res.status(500).json({ error: "Erro ao salvar no Supabase" });
      }
    }

    return res.status(200).json({ ok: true, registros: linhas.length });
  } catch (err) {
    console.error("Erro extrair:", err);
    return res.status(500).json({ error: err.message });
  }
}
