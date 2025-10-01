import fetch from "node-fetch";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { cod_tce, ano, mes } = req.body;

    if (!cod_tce || !ano) {
      return res.status(400).json({ error: "Parâmetros obrigatórios: cod_tce e ano" });
    }

    // 🔹 Exemplo de URL (ajuste para o endpoint real do Tribunal)
    const url = `https://www.tceaplicado.gov.br/consultas/${cod_tce}/${ano}`;

    const resposta = await fetch(url);
    if (!resposta.ok) {
      return res.status(500).json({ error: "Falha ao acessar o Tribunal" });
    }

    const html = await resposta.text();
    const $ = cheerio.load(html);

    let dados = [];

    $("table.tablesorter tbody tr").each((i, el) => {
      const cols = $(el).find("td");
      if (cols.length >= 5) {
        const registro = {
          mes: $(cols[0]).text().trim(),
          data_limite: $(cols[1]).text().trim(),
          data_entrega: $(cols[2]).text().trim(),
          situacao: $(cols[3]).text().trim(),
          unidade: $(cols[4]).text().trim(),
        };

        if (!mes || registro.mes.toLowerCase() === mes.toLowerCase()) {
          dados.push(registro);
        }
      }
    });

    return res.status(200).json({ dados });
  } catch (err) {
    console.error("Erro na extração:", err);
    return res.status(500).json({ error: "Erro desconhecido" });
  }
}
