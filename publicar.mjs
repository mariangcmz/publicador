// Publica en IG/FB lo que en cola.json ya tiene hora. Lo corre GitHub Actions cada 15 min.
// Tokens: secretos IG_<CUENTA> (Instagram Login) y FB_<CUENTA> (token de página), ej. IG_DONITA.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const V = 'v24.0';
const COLA = new URL('./cola.json', import.meta.url);

export const pendientes = (cola, ahora = new Date()) =>
  cola.filter(p => p.estado === 'pendiente' && new Date(p.fecha) <= ahora);

async function api(host, ruta, token, params = {}, metodo = 'POST') {
  const url = new URL(`https://${host}/${V}/${ruta}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = metodo === 'GET'
    ? await fetch(`${url}?${body}`)
    : await fetch(url, { method: 'POST', body });
  const json = await res.json();
  if (json.error) throw new Error(`${ruta}: ${json.error.message}`);
  return json;
}

const esVideo = u => /\.(mp4|mov)(\?|$)/i.test(u);

async function esperarContenedor(id, token) {
  for (let i = 0; i < 60; i++) { // hasta 10 min
    const { status_code } = await api('graph.instagram.com', id, token, { fields: 'status_code' }, 'GET');
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`contenedor ${id}: ${status_code}`);
    await new Promise(r => setTimeout(r, 10_000));
  }
  throw new Error(`contenedor ${id}: no terminó en 10 min`);
}

async function publicarIG(p, token) {
  const ig = (h, r, x) => api(h ?? 'graph.instagram.com', r, token, x);
  const { user_id } = await api('graph.instagram.com', 'me', token, { fields: 'user_id' }, 'GET');
  const crear = async (url, extra = {}) => {
    const tipo = esVideo(url)
      ? { media_type: p.tipo === 'reel' ? 'REELS' : 'VIDEO', video_url: url }
      : { image_url: url };
    const { id } = await ig(null, `${user_id}/media`, { ...tipo, ...extra });
    if (esVideo(url)) await esperarContenedor(id, token);
    return id;
  };
  let id;
  if (p.tipo === 'carrusel') {
    const hijos = [];
    for (const url of p.media) hijos.push(await crear(url, { is_carousel_item: 'true' }));
    ({ id } = await ig(null, `${user_id}/media`, { media_type: 'CAROUSEL', children: hijos.join(','), caption: p.caption }));
    await esperarContenedor(id, token);
  } else {
    id = await crear(p.media[0], { caption: p.caption });
  }
  const pub = await ig(null, `${user_id}/media_publish`, { creation_id: id });
  return `ig:${pub.id}`;
}

async function publicarFB(p, token) {
  // shortcut: video sale como video normal (/videos), no como Reel de FB; cambiar a video_reels si hace falta.
  if (p.tipo === 'carrusel') throw new Error('carrusel en FB no soportado todavía');
  const url = p.media[0];
  const r = esVideo(url)
    ? await api('graph.facebook.com', 'me/videos', token, { file_url: url, description: p.caption })
    : await api('graph.facebook.com', 'me/photos', token, { url, caption: p.caption });
  return `fb:${r.post_id ?? r.id}`;
}

async function main() {
  const cola = JSON.parse(readFileSync(COLA, 'utf8'));
  for (const p of pendientes(cola)) {
    const token = process.env[`${p.red.toUpperCase()}_${p.cuenta.toUpperCase()}`];
    try {
      if (!token) throw new Error(`falta secreto ${p.red.toUpperCase()}_${p.cuenta.toUpperCase()}`);
      p.resultado = p.red === 'ig' ? await publicarIG(p, token) : await publicarFB(p, token);
      p.estado = 'publicado';
    } catch (e) {
      p.estado = 'error';
      p.resultado = e.message;
    }
    p.procesado = new Date().toISOString();
    // guarda tras cada post para no republicar si algo falla después
    writeFileSync(COLA, JSON.stringify(cola, null, 2) + '\n');
    console.log(p.id, p.estado, p.resultado);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
