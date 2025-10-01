import cheerio from "cheerio";
import fetch from "node-fetch";
import { supabase } from "./supabaseClient.js";

export default async function handler(req, res) {
  try {
    const ano = 2025;
    const { data: clientes } = await supabase
      .from("clientes")
      .select("entidade, cod_tce")
      .eq("ativo", "sim");

    if (!clientes || clientes.length === 0) {
      return res.json({ erro: "Nenhum cliente ativo encontrado." });
    }

    let resultados = [];
    let progresso = [];

    for (let i = 0; i < clientes.length; i++) {
      const { entidade, cod_tce } = clientes[i];
      const contador = `${i + 1}/${clientes.length}`;

      try {
        console.log(`🔎 Extraindo ${entidade} (${contador})`);

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

        progresso.push(`✅ ${entidade} (${contador}) concluído`);
      } catch (err) {
        console.error(`Erro em ${entidade}:`, err);
        progresso.push(`❌ ${entidade} (${contador}) falhou`);
      }
    }

    // salvar no Supabase
    if (resultados.length > 0) {
      const { error } = await supabase.from("consultas").insert(resultados);
      if (error) {
        console.error("Erro ao salvar:", error.message);
        progresso.push("❌ Erro ao salvar no banco.");
      } else {
        progresso.push("💾 Dados salvos com sucesso no banco.");
      }
    } else {
      progresso.push("⚠️ Nenhum dado extraído.");
    }

    return res.json({ progresso });
  } catch (err) {
    console.error("Erro geral:", err);
    return res.status(500).json({ erro: err.message });
  }
}
