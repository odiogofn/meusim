// api/salvar.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function parseDDMMYYYYtoISO(s){
  if(!s) return null;
  const m = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if(!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ error: 'rows deve ser um array' });

    // normalizar data de entrega para ISO (date) quando possível
    const payload = rows.map(r => ({
      mes: r.mes || null,
      municipio: r.municipio || null,
      unidade_orcamentaria: r.unidade_orcamentaria || null,
      data_entrega: parseDDMMYYYYtoISO(r.data_entrega) // pode retornar null -> será inserido como null
    }));

    const { data, error } = await supabase.from('consultas').insert(payload).select();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ inserted: data.length, data });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
