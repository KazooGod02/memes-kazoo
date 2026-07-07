// ============================================================
//  Sincroniza un canal de Discord -> memes de la web
//  Usa el MISMO SDK de Firebase que la web (reglas abiertas)
//  + Cloudinary para los archivos. Corre desde GitHub Actions.
// ============================================================
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, setDoc, Timestamp } from "firebase/firestore";

// --- config pública (igual que config.js del repo) ---
const firebaseConfig = {
  apiKey: "AIzaSyCkMaWCb6_KY-L_t4srnnMyN6dDxIcDY_0",
  authDomain: "memes-kazoo.firebaseapp.com",
  projectId: "memes-kazoo",
  storageBucket: "memes-kazoo.firebasestorage.app",
  messagingSenderId: "414404319067",
  appId: "1:414404319067:web:d07884a7ec8d08d3fa2c7e",
};
const CLOUD = "l2hcls7r";
const PRESET = "memes_unsigned";

// --- secretos (GitHub Actions) ---
const TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL = process.env.DISCORD_CHANNEL_ID;

// --- límites por corrida ---
const MAX_PAGES = 6;    // hasta 600 mensajes revisados por corrida
const MAX_ITEMS = 40;   // hasta 40 memes subidos por corrida

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!TOKEN || !CHANNEL) {
  console.error("Faltan DISCORD_TOKEN o DISCORD_CHANNEL_ID (revisa los secretos de GitHub).");
  process.exit(1);
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

/* ---------- Discord ---------- */
async function dget(path) {
  const r = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${TOKEN}` } });
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
    after = batch.map((m) => m.id).reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b));
    if (batch.length < 100) break;
    await sleep(400);
  }
  out.sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)); // cronológico
  return out;
}

/* ---------- extraer medios ---------- */
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

/* ---------- Firestore (SDK, reglas abiertas) ----------
   El puntero se guarda en memes/_discord_state SIN campo createdAt,
   así la web (que ordena por createdAt) nunca lo muestra. */
const STATE_DOC = doc(db, "memes", "_discord_state");
async function loadState() {
  const snap = await getDoc(STATE_DOC);
  return snap.exists() ? snap.data().lastMessageId || "" : "";
}
async function saveState(lastMessageId) {
  await setDoc(STATE_DOC, { lastMessageId, updatedAt: Timestamp.now() });
}
async function loadExistingDiscordIds() {
  const set = new Set();
  const snap = await getDocs(collection(db, "memes"));
  snap.forEach((d) => { const id = d.data().discordId; if (id) set.add(id); });
  return set;
}
async function createMeme(m) {
  await addDoc(collection(db, "memes"), {
    userId: `discord:${m.authorId}`, userName: m.userName, type: m.type, url: m.url,
    storagePath: "", caption: m.caption, decision: null, reviewed: false,
    createdAt: Timestamp.fromDate(new Date(m.createdAt)), source: "discord", discordId: m.discordId,
  });
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
        await createMeme({ authorId: msg.author.id, userName, type: it.kind, url, caption, createdAt: msg.timestamp, discordId });
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
})().then(() => process.exit(0)).catch((e) => { console.error("FALLO:", e); process.exit(1); });
