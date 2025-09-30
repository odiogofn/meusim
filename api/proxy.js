// api/proxy.js (Vercel Serverless Function)
export default async function handler(req, res) {
  const url = req.query.url;
  if (!url) return res.status(400).send("missing url");
  try {
    const response = await fetch(url, { headers: { "User-Agent": "ConsultaTCE/1.0" } });
    const text = await response.text();
    // retorna como html
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.status(response.status).send(text);
  } catch (err) {
    res.status(500).send("proxy error: " + err.message);
  }
}
