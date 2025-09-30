// api/extracao.js
import fetch from "node-fetch";

export default async function handler(req, res) {
  try {
    const { cod_tce, ano } = req.query;

    if (!cod_tce || !ano) {
      return res
        .status(400)
        .json({ error: "Parâmetros cod_tce e ano são obrigatórios" });
    }

    // monta a URL do tribunal
    const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod_tce}/versao/${ano}`;

    // chama o TCE do lado do servidor (evita CORS no navegador)
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; VercelBot/1.0)",
      },
    });

    if (!response.ok) {
      throw new Error(`Erro ao acessar TCE: ${response.status}`);
    }

    const html = await response.text();

    res.status(200).json({ html });
  } catch (error) {
    console.error("Erro na função extracao:", error.message);
    res.status(500).json({ error: "Erro na extração", details: error.message });
  }
}
