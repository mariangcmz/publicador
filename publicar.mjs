// Publica en IG/FB lo que en cola.json ya tiene hora. Lo corre GitHub Actions cada 15 min.
// Token: secreto META_TOKEN (usuario del sistema, login unificado, no caduca). IDs por marca en cuentas.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const V = 'v24.0';
const COLA = new URL('./cola.json', import.meta.url);
const CUENTAS = new URL('./cuentas.json', import.meta.url);

export const pendientes = (cola, ahora = new Date()) =>
  cola.filter(p => p.estado === 'pendiente' && new Date(p.fecha) <= ahora);

async function api(ruta, token, params = {}, metodo = 'POST') {
  const url = `https://graph.facebook.com/${V}/${ruta}`;
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
    const { status_code } = await api(id, token, { fields: 'status_code' }, 'GET');
    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') throw new Error(`contenedor ${id}: ${status_code}`);
    await new Promise(r => setTimeout(r, 10_000));
  }
  throw new Error(`contenedor ${id}: no terminó en 10 min`);
}

async function publicarIG(p, token, igId) {
  const crear = async (url, extra = {}) => {
    const tipo = esVideo(url)
      ? { media_type: p.tipo === 'reel' ? 'REELS' : 'VIDEO', video_url: url }
      : { image_url: url };
    const { id } = await api(`${igId}/media`, token, { ...tipo, ...extra });
    if (esVideo(url)) await esperarContenedor(id, token);
    return id;
  };
  let id;
  if (p.tipo === 'carrusel') {
    const hijos = [];
    for (const url of p.media) hijos.push(await crear(url, { is_carousel_item: 'true' }));
    ({ id } = await api(`${igId}/media`, token, { media_type: 'CAROUSEL', children: hijos.join(','), caption: p.caption }));
    await esperarContenedor(id, token);
  } else {
    id = await crear(p.media[0], { caption: p.caption });
  }
  const pub = await api(`${igId}/media_publish`, token, { creation_id: id });
  return `ig:${pub.id}`;
}

async function publicarFB(p, token, pageId) {
  // shortcut: video sale como video normal (/videos), no como Reel de FB; cambiar a video_reels si hace falta.
  if (p.tipo === 'carrusel') throw new Error('carrusel en FB no soportado todavía');
  const { access_token: pageToken } = await api(pageId, token, { fields: 'access_token' }, 'GET');
  const url = p.media[0];
  const r = esVideo(url)
    ? await api(`${pageId}/videos`, pageToken, { file_url: url, description: p.caption })
    : await api(`${pageId}/photos`, pageToken, { url, caption: p.caption });
  return `fb:${r.post_id ?? r.id}`;
}

async function main() {
  const cola = JSON.parse(readFileSync(COLA, 'utf8'));
  const cuentas = JSON.parse(readFileSync(CUENTAS, 'utf8'));
  const token = process.env.META_TOKEN;
  for (const p of pendientes(cola)) {
    const id = cuentas[p.cuenta]?.[p.red];
    try {
      if (!token) throw new Error('falta secreto META_TOKEN');
      if (!id) throw new Error(`falta ${p.cuenta}.${p.red} en cuentas.json`);
      p.resultado = p.red === 'ig' ? await publicarIG(p, token, id) : await publicarFB(p, token, id);
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
