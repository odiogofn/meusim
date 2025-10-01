import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Método não permitido" });
  }

  try {
    const { data: clientes, error: errorClientes } = await supabase
      .from("clientes")
      .select("id, entidade, cod_tce")  // entidade no lugar de municipio
      .eq("ativo", "sim");

    if (errorClientes) throw errorClientes;

    for (let i = 0; i < clientes.length; i++) {
      const cliente = clientes[i];
      const url = `https://www.tce.someapi.gov.br/consulta?cod=${cliente.cod_tce}`;
      const response = await fetch(url);

      if (!response.ok) throw new Error(`Falha ao acessar ${url}`);

      const html = await response.text();
      const $ = cheerio.load(html);

      const linhas = [];
      $("table tr").each((_, el) => {
        const cols = $(el).find("td").map((_, td) => $(td).text().trim()).get();
        if (cols.length) linhas.push(cols);
      });

      for (const linha of linhas) {
        await supabase.from("consultas").insert({
          mes: linha[0] || null,
          entidade: cliente.entidade,   // salva o nome do município certo
          orgao: linha[1] || null,
          data: linha[2] || null,
        });
      }

      console.log(`✅ Salvo ${cliente.entidade} (${i + 1}/${clientes.length})`);

      await new Promise((r) => setTimeout(r, 2000));
    }

    res.json({ message: "Extração concluída com sucesso" });
  } catch (error) {
    console.error("Erro na extração:", error);
    res.status(500).json({ error: error.message });
  }
}
