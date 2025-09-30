// api/update_cliente.js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).end();
    const { cod_tce, ativo } = req.body;
    if (!cod_tce || !ativo) return res.status(400).json({ error: 'cod_tce e ativo são obrigatórios' });

    const { error } = await supabase.from('clientes').update({ ativo }).eq('cod_tce', String(cod_tce));
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
}
