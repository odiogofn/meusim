// api/extrair.js
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { cod_tce, ano } = req.body;

    if (!cod_tce || !ano) {
      return res.status(400).json({ error: "Parâmetros cod_tce e ano são obrigatórios" });
    }

    // Monta URL
    const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod_tce}/versao/${ano}`;
    console.log("🔎 Buscando URL:", url);

    // Faz o fetch
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
      }
    });

    if (!response.ok) {
      throw new Error(`Falha ao buscar página: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Exemplo: pega o nome do município no <h3>
    const municipio = $("h3").first().text().trim();

    // Exemplo: pega todas as linhas da primeira tabela
    const dados = [];
    $("table tbody tr").each((i, el) => {
      const cols = $(el).find("td").map((j, td) => $(td).text().trim()).get();
      if (cols.length > 0) {
        dados.push(cols);
      }
    });

    // Retorna dados
    return res.status(200).json({
      url,
      municipio,
      registros: dados.length,
      dados
    });

  } catch (err) {
    console.error("❌ Erro durante extração:", err);
    return res.status(500).json({
      error: err.message || "Erro interno na extração"
    });
  }
}
