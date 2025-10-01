import cheerio from "cheerio";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

// conecta ao Supabase
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

    // busca clientes ativos
    const { data: clientes, error: errClientes } = await supabase
      .from("clientes")
      .select("cod_tce, entidade")
      .eq("ativo", "sim");

    if (errClientes) {
      return res.status(500).json({ error: "Erro no Supabase", details: errClientes });
    }

    let resultados = [];

    // percorre os clientes ativos
    for (const cliente of clientes) {
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cliente.cod_tce}/versao/${ano}`;

      const response = await fetch(url);
      if (!response.ok) {
        console.error(`Erro ao acessar ${url}`);
        continue;
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // pega as linhas da tabela
      $("#example tbody tr").each((_, el) => {
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
    }

    // salva no Supabase
    if (resultados.length > 0) {
      await supabase.from("consultas").insert(resultados);
    }

    return res.status(200).json({ sucesso: true, dados: resultados });
  } catch (err) {
    console.error("Erro extrair:", err);
    return res.status(500).json({ error: "Erro ao extrair", details: err.message });
  }
}
