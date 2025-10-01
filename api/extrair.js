import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY; // Service role, pq grava no banco
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { data: clientes, error: errorClientes } = await supabase
      .from("clientes")
      .select("id, municipio, cod_tce")
      .eq("ativo", "sim");

    if (errorClientes) throw errorClientes;

    for (let i = 0; i < clientes.length; i++) {
      const cliente = clientes[i];
      const url = `https://www.tce.someapi.gov.br/consulta?cod=${cliente.cod_tce}`;
      const response = await fetch(url);

      if (!response.ok) throw new Error(`Falha ao acessar ${url}`);

      const html = await response.text();
      const $ = cheerio.load(html);

      // Exemplo: pegar as células da tabela
      const linhas = [];
      $("table tr").each((_, el) => {
        const cols = $(el).find("td").map((_, td) => $(td).text().trim()).get();
        if (cols.length) linhas.push(cols);
      });

      // Salva cada linha no Supabase
      for (const linha of linhas) {
        await supabase.from("consultas").insert({
          mes: linha[0] || null,
          municipio: cliente.municipio,
          orgao: linha[1] || null,
          data: linha[2] || null,
        });
      }

      // delay 2s entre cada município
      await new Promise((r) => setTimeout(r, 2000));
    }

    res.json({ message: "Extração concluída com sucesso" });
  } catch (error) {
    console.error("Erro na extração:", error);
    res.status(500).json({ error: error.message });
  }
}
