// ============================================================
//  Sincroniza un canal de Discord -> memes de la web
//  (Firestore para datos, Cloudinary para archivos)
//  Se ejecuta desde GitHub Actions cada ~10 min.
// ============================================================

// --- valores públicos (ya están en config.js del repo) ---
const FB_PROJECT = "memes-kazoo";
const FB_KEY = "AIzaSyCkMaWCb6_KY-L_t4srnnMyN6dDxIcDY_0";
const CLOUD = "l2hcls7r";
const PRESET = "memes_unsigned";

// --- secretos (vienen de GitHub Actions) ---
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL = process.env.DISCORD_CHANNEL_ID;

// --- límites por corrida (para no exceder tiempo) ---
const MAX_PAGES = 6;     // 6 x 100 = hasta 600 mensajes revisados por corrida
const MAX_ITEMS = 40;    // sube como máx 40 memes por corrida (el resto en la siguiente)

const FS = `https://firestore.googleapis.com/v1/projects/${FB_PROJECT}/databases/(default)/documents`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!TOKEN || !CHANNEL) {
  console.error("Faltan DISCORD_TOKEN o DISCORD_CHANNEL_ID (revisa los secretos de GitHub).");
  process.exit(1);
}

/* ---------- Discord ---------- */
async function dget(path) {
  const r = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (r.status === 429) {
    const j = await r.json().catch(() => ({}));
    const wait = (j.retry_after || 1) * 1000 + 250;
    console.log(`Rate limit, esperando ${wait}ms`);
    await sleep(wait);
    return dget(path);
  }
  if (!r.ok) throw new Error(`Discord ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

async function fetchNewMessages(afterId) {
  let after = afterId || "0";
  const out = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const batch = await dget(`/channels/${CHANNEL}/messages?limit=100&after=${after}`);
    if (!batch.length) break;
    out.push(...batch);
    // el lote viene del más nuevo al más viejo -> avanzamos con el id más alto
    after = batch.map((m) => m.id).reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b));
    if (batch.length < 100) break;
    await sleep(400);
  }
  out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)); // cronológico
  return out;
}

/* ---------- extraer medios de un mensaje ---------- */
const VIDEO_LINK = /(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)/i;
const URL_RE = /https?:\/\/[^\s<>()]+/g;

function kindByName(name = "") {
  const n = name.toLowerCase();
  if (/\.(mp4|mov|webm|mkv|avi|m4v)$/.test(n)) return "video";
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(n)) return "image";
  return null;
}

function itemsFromMessage(msg) {
  const items = [];
  for (const a of msg.attachments || []) {
    let kind = null;
    const ct = a.content_type || "";
    if (ct.startsWith("image/")) kind = "image";
    else if (ct.startsWith("video/")) kind = "video";
    else kind = kindByName(a.filename);
    if (kind) items.push({ kind, src: a.url });
  }
  const urls = (msg.content || "").match(URL_RE) || [];
  for (const u of urls) if (VIDEO_LINK.test(u)) items.push({ kind: "link", src: u });
  return items;
}

function captionOf(msg) {
  return (msg.content || "").replace(URL_RE, "").replace(/\s+/g, " ").trim().slice(0, 140);
}

/* ---------- Cloudinary ---------- */
async function cloudinaryUpload(fileUrl) {
  const res = await fetch(fileUrl);
  if (!res.ok) throw new Error(`descarga adjunto ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const form = new FormData();
  form.append("file", new Blob([buf]), "upload");
  form.append("upload_preset", PRESET);
  const up = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/auto/upload`, { method: "POST", body: form });
  const j = await up.json();
  if (!j.secure_url) throw new Error(`Cloudinary: ${JSON.stringify(j).slice(0, 200)}`);
  return j.secure_url;
}

/* ---------- Firestore REST (reglas abiertas) ---------- */
const sv = (s) => ({ stringValue: String(s) });
const bv = (b) => ({ booleanValue: !!b });
const tv = (iso) => ({ timestampValue: iso });
const nv = () => ({ nullValue: null });

async function fsGet(path) {
  const r = await fetch(`${FS}/${path}?key=${FB_KEY}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Firestore GET ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

async function loadState() {
  const doc = await fsGet("sync/discord");
  return doc?.fields?.lastMessageId?.stringValue || "";
}
async function saveState(lastMessageId) {
  const r = await fetch(`${FS}/sync/discord?key=${FB_KEY}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: { lastMessageId: sv(lastMessageId), updatedAt: tv(new Date().toISOString()) } }),
  });
  if (!r.ok) throw new Error(`Firestore state ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

async function loadExistingDiscordIds() {
  const set = new Set();
  let pageToken = "";
  do {
    const url = `${FS}/memes?key=${FB_KEY}&pageSize=300&mask.fieldPaths=discordId` + (pageToken ? `&pageToken=${pageToken}` : "");
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Firestore list ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    for (const d of j.documents || []) {
      const id = d.fields?.discordId?.stringValue;
      if (id) set.add(id);
    }
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  return set;
}

async function createMeme(doc) {
  const r = await fetch(`${FS}/memes?key=${FB_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: {
      userId: sv(doc.userId), userName: sv(doc.userName), type: sv(doc.type),
      url: sv(doc.url), storagePath: sv(""), caption: sv(doc.caption),
      decision: nv(), reviewed: bv(false), createdAt: tv(doc.createdAt),
      source: sv("discord"), discordId: sv(doc.discordId),
    } }),
  });
  if (!r.ok) throw new Error(`Firestore create ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

/* ---------- main ---------- */
(async () => {
  const lastId = await loadState();
  console.log(`Último mensaje sincronizado: ${lastId || "(ninguno, primer arranque)"}`);

  const messages = await fetchNewMessages(lastId);
  console.log(`Mensajes nuevos a revisar: ${messages.length}`);
  if (!messages.length) { console.log("Nada nuevo. Listo."); return; }

  const existing = await loadExistingDiscordIds();
  let uploaded = 0, skipped = 0, lastProcessed = lastId;

  for (const msg of messages) {
    if (uploaded >= MAX_ITEMS) { console.log(`Tope de ${MAX_ITEMS} por corrida; el resto en la próxima.`); break; }
    if (msg.author?.bot) { lastProcessed = msg.id; continue; }

    const items = itemsFromMessage(msg);
    const caption = captionOf(msg);
    const userName = msg.author?.global_name || msg.author?.username || "discord";

    for (let i = 0; i < items.length; i++) {
      if (uploaded >= MAX_ITEMS) break;
      const it = items[i];
      const discordId = `${msg.id}-${i}`;
      if (existing.has(discordId)) { skipped++; continue; }
      try {
        const url = it.kind === "link" ? it.src : await cloudinaryUpload(it.src);
        await createMeme({
          userId: `discord:${msg.author.id}`, userName, type: it.kind, url,
          caption, createdAt: msg.timestamp, discordId,
        });
        uploaded++;
        console.log(`+ ${it.kind} de ${userName} (${discordId})`);
      } catch (e) {
        console.error(`! Error con ${discordId}: ${e.message}`);
      }
    }
    lastProcessed = msg.id;
  }

  if (lastProcessed && lastProcessed !== lastId) await saveState(lastProcessed);
  console.log(`Hecho. Subidos: ${uploaded}, ya existían: ${skipped}. Nuevo puntero: ${lastProcessed}`);
})().catch((e) => { console.error("FALLO:", e); process.exit(1); });
