import cheerio from "cheerio";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { ano } = req.body;

    // busca clientes ativos
    const { data: clientes, error } = await supabase
      .from("clientes")
      .select("cod_tce, entidade")
      .eq("ativo", "sim");

    if (error) throw error;
    if (!clientes || clientes.length === 0) {
      return res.status(400).json({ error: "Nenhum cliente ativo encontrado" });
    }

    const resultados = [];

    // processar sequencialmente com delay de 2s
    for (let i = 0; i < clientes.length; i++) {
      const cliente = clientes[i];
      const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cliente.cod_tce}/versao/1/${ano}`;
      console.log(`Extraindo: ${cliente.entidade} (${i + 1}/${clientes.length}) -> ${url}`);

      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Falha ao acessar " + url);

      const html = await resp.text();
      const $ = cheerio.load(html);

      $("table.tablesorter tbody tr").each((_, el) => {
        const cols = $(el).find("td");
        if (cols.length >= 5) {
          resultados.push({
            entidade: cliente.entidade,
            mes: $(cols[0]).text().trim(),
            data_limite: $(cols[1]).text().trim(),
            data_entrega: $(cols[2]).text().trim(),
            situacao: $(cols[3]).text().trim(),
            unidade: $(cols[4]).text().trim(),
            ano: ano
          });
        }
      });

      // respeitar limite de 2s
      await new Promise(r => setTimeout(r, 2000));
    }

    // salvar no supabase
    if (resultados.length > 0) {
      const { error: insertError } = await supabase
        .from("consultas")
        .insert(resultados);

      if (insertError) throw insertError;
    }

    return res.status(200).json({ total: resultados.length, resultados });
  } catch (err) {
    console.error("Erro:", err);
    return res.status(500).json({ error: err.message });
  }
}
