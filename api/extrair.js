import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end("Método não permitido");
  }

  const { ano } = req.query;

  try {
    // Configurar resposta SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Buscar clientes ativos
    const { data: clientes, error: errClientes } = await supabase
      .from("clientes")
      .select("cod_tce, entidade")
      .eq("ativo", "sim");

    if (errClientes) throw errClientes;
    if (!clientes || clientes.length === 0) {
      res.write(`data: Nenhum cliente ativo encontrado\n\n`);
      return res.end();
    }

    let resultados = [];

    res.write(
      `data: Executando /api/extrair — aguarde (será sequencial e respeita 2s entre cada município)...\n\n`
    );

    for (let i = 0; i < clientes.length; i++) {
      const { entidade, cod_tce } = clientes[i];
      const contador = `${i + 1}/${clientes.length}`;

      res.write(`data: ⏳ ${entidade} (${contador}) em andamento\n\n`);

      try {
        const url = `https://municipios-transparencia.tce.ce.gov.br/index.php/municipios/prestacao/mun/${cod_tce}/versao/ano/${ano}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Falha HTTP ${response.status}`);

        const html = await response.text();
        const $ = cheerio.load(html);

        $("#example tbody tr").each((_, row) => {
          const tds = $(row).find("td");
          if (tds.length >= 5 && $(tds[0]).text().trim() !== "") {
            resultados.push({
              municipio: entidade,
              mes: $(tds[0]).text().trim(),
              data_entrega: $(tds[2]).text().trim(),
              unidade_orcamentaria: $(tds[4]).text().trim(),
              ano: ano,
            });
          }
        });

        res.write(`data: ✅ ${entidade} (${contador}) concluído\n\n`);
      } catch (err) {
        res.write(`data: ❌ ${entidade} (${contador}) falhou\n\n`);
      }

      // esperar 2s entre cada município
      await new Promise(r => setTimeout(r, 2000));
    }

    if (resultados.length > 0) {
      const { error: errInsert } = await supabase
        .from("consultas")
        .insert(resultados);

      if (errInsert) {
        res.write(`data: ⚠️ Erro ao salvar no banco\n\n`);
      } else {
        res.write(`data: 💾 Dados salvos com sucesso\n\n`);
      }
    }

    res.write(`data: FIM\n\n`);
    res.end();
  } catch (err) {
    console.error("Erro na extração:", err);
    res.write(`data: ❌ Erro na extração\n\n`);
    res.end();
  }
}
