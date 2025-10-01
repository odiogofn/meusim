import cheerio from "cheerio";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// Conecta ao Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { ano } = req.body;
    if (!ano) {
      return res.status(400).json({ error: "Ano não informado" });
    }

    // Busca clientes ativos
    const { data: clientes, error: errClientes } = await supabase
      .from("clientes")
      .select("cod_tce, entidade")
      .eq("ativo", "sim");

    if (errClientes) {
      return res.status(500).json({ error: "Erro no Supabase", details: errClientes });
    }

    let resultados = [];

    // Percorre clientes ativos
    for (const cliente of clientes) {
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cliente.cod_tce}/versao/${ano}`;
      console.log("🔎 Acessando:", url);

      try {
        const response = await fetch(url);
        if (!response.ok) {
          console.error(`Erro HTTP ${response.status} para ${cliente.entidade}`);
          continue;
        }

        const html = await response.text();
        const $ = cheerio.load(html);

        const linhas = $("#example tbody tr");
        if (linhas.length === 0) {
          console.warn(`⚠️ Nenhuma linha encontrada para ${cliente.entidade}`);
          continue;
        }

        linhas.each((_, el) => {
          const tds = $(el).find("td");
          if (tds.length >= 5) {
            resultados.push({
              mes: $(tds[0]).text().trim(),
              data_limite: $(tds[1]).text().trim(),
              data_entrega: $(tds[2]).text().trim(),
              situacao: $(tds[3]).text().trim(),
              unidade: $(tds[4]).text().trim(),
              municipio: cliente.entidade,
              ano: ano
            });
          }
        });
      } catch (errFetch) {
        console.error(`❌ Erro ao buscar dados do TCE para ${cliente.entidade}`, errFetch);
      }
    }

    // Salva no Supabase apenas se tiver dados
    if (resultados.length > 0) {
      await supabase.from("consultas").insert(resultados);
    }

    return res.status(200).json({ sucesso: true, dados: resultados });
  } catch (err) {
    console.error("❌ Erro geral:", err);
    return res.status(500).json({ error: "Erro ao extrair", details: err.message });
  }
}
