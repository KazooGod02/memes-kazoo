import { firebaseConfig, OWNER_PASSWORD, PRIZE, DEADLINE, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./config.js";

/* ============================================================
   0. Utilidades
   ============================================================ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add("hidden"), 2600);
}

function showScreen(id) {
  $$(".screen").forEach((s) => s.classList.add("hidden"));
  $("#screen-" + id).classList.remove("hidden");
  window.scrollTo(0, 0);
}

/* ============================================================
   1. Identidad del usuario (localStorage)
   ============================================================ */
const LS = {
  introSeen: "stlp_introSeen",
  userId: "stlp_userId",
  userName: "stlp_userName",
  owner: "stlp_owner",
};

function getUserId() {
  let id = localStorage.getItem(LS.userId);
  if (!id) {
    id = uuid();
    localStorage.setItem(LS.userId, id);
  }
  return id;
}
const USER_ID = getUserId();
const getUserName = () => localStorage.getItem(LS.userName) || "";
const isOwner = () => localStorage.getItem(LS.owner) === "1";

/* ============================================================
   2. Capa de datos: Firebase real o Demo local
   ============================================================ */
const FIREBASE_ON = firebaseConfig && firebaseConfig.apiKey && firebaseConfig.apiKey !== "PEGA_AQUI";
let store;

if (FIREBASE_ON) {
  store = await makeFirebaseStore();
} else {
  store = makeLocalStore();
  console.warn("[Si te ríes pierdes] MODO DEMO local — pega tus claves de Firebase en config.js para activar el modo real.");
}

/* ---------- Subida de archivos a Cloudinary (gratis, sin tarjeta) ---------- */
function cloudinaryUpload(file, onProgress) {
  return new Promise((resolve, reject) => {
    if (!CLOUDINARY_CLOUD_NAME || CLOUDINARY_CLOUD_NAME === "PEGA_AQUI")
      return reject(new Error("Cloudinary no configurado (revisa config.js)"));
    const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/auto/upload`;
    const form = new FormData();
    form.append("file", file);
    form.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(e); }
      } else reject(new Error("Cloudinary " + xhr.status + ": " + xhr.responseText));
    };
    xhr.onerror = () => reject(new Error("Error de red al subir el archivo"));
    xhr.send(form);
  });
}

/* ---------- Firebase (Firestore = datos) + Cloudinary (archivos) ---------- */
async function makeFirebaseStore() {
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const {
    getFirestore, collection, addDoc, onSnapshot, query, orderBy,
    updateDoc, deleteDoc, doc, serverTimestamp,
  } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);
  const col = collection(db, "memes");

  return {
    subscribe(cb) {
      const q = query(col, orderBy("createdAt", "asc"));
      return onSnapshot(q, (snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        cb(list);
      });
    },
    async add(meme, file, onProgress) {
      let url = meme.url || "";
      if (file) {
        const res = await cloudinaryUpload(file, onProgress);
        url = res.secure_url;
      }
      await addDoc(col, {
        userId: USER_ID, userName: meme.userName, type: meme.type,
        url, storagePath: "", caption: meme.caption || "",
        decision: null, reviewed: false, createdAt: serverTimestamp(),
      });
    },
    async update(id, fields) { await updateDoc(doc(db, "memes", id), fields); },
    async remove(meme) { await deleteDoc(doc(db, "memes", meme.id)); },
  };
}

/* ---------- Demo local (localStorage) ---------- */
function makeLocalStore() {
  const KEY = "stlp_memes";
  const read = () => JSON.parse(localStorage.getItem(KEY) || "[]");
  const write = (l) => localStorage.setItem(KEY, JSON.stringify(l));
  let listeners = [];
  const emit = () => listeners.forEach((cb) => cb(read()));
  const fileToDataURL = (f) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });

  return {
    subscribe(cb) { listeners.push(cb); cb(read()); return () => { listeners = listeners.filter((x) => x !== cb); }; },
    async add(meme, file, onProgress) {
      let url = meme.url || "";
      if (file) {
        if (file.size > 4 * 1024 * 1024) toast("En demo local los archivos grandes pueden no guardarse. Con Firebase sí.");
        onProgress && onProgress(0.5);
        url = await fileToDataURL(file);
        onProgress && onProgress(1);
      }
      const list = read();
      list.push({ id: uuid(), userId: USER_ID, userName: meme.userName, type: meme.type, url,
        storagePath: "", caption: meme.caption || "", decision: null, reviewed: false, createdAt: Date.now() });
      try { write(list); } catch (e) { toast("Demo local lleno (archivo muy grande). Usa Firebase."); }
      emit();
    },
    async update(id, fields) { const l = read(); const m = l.find((x) => x.id === id); if (m) Object.assign(m, fields); write(l); emit(); },
    async remove(meme) { write(read().filter((x) => x.id !== meme.id)); emit(); },
  };
}

/* ============================================================
   3. Estado y render de la biblioteca
   ============================================================ */
let MEMES = [];
store.subscribe((list) => { MEMES = list; renderLibrary(); refreshOwnerUI(); });

/* ---------- detección de plataforma ---------- */
function platformOf(url) {
  try {
    const h = new URL(url).hostname.replace("www.", "");
    if (h.includes("youtube") || h === "youtu.be") return "youtube";
    if (h.includes("tiktok")) return "tiktok";
    if (h.includes("instagram")) return "instagram";
    return "web";
  } catch (e) { return "web"; }
}
function ytId(url) {
  try {
    const u = new URL(url);
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    if (u.hostname.replace("www.", "") === "youtu.be") return u.pathname.slice(1);
    const p = u.pathname.split("/");
    const i = p.findIndex((s) => s === "shorts" || s === "embed");
    if (i >= 0 && p[i + 1]) return p[i + 1];
  } catch (e) {}
  return null;
}
function tiktokId(url) { try { const m = new URL(url).pathname.match(/\/video\/(\d+)/); return m ? m[1] : null; } catch (e) { return null; } }
function igParts(url) { try { const m = new URL(url).pathname.match(/\/(reel|p|tv)\/([^/]+)/); return m ? { kind: m[1], code: m[2] } : null; } catch (e) { return null; } }
function shorten(u) { try { return new URL(u).hostname.replace("www.", ""); } catch (e) { return String(u).slice(0, 40); } }

function isVideoLink(m) {
  if (m.type !== "link") return false;
  const p = platformOf(m.url);
  if (p === "youtube" || p === "tiktok") return true;
  if (p === "instagram") { const ig = igParts(m.url); return ig && ig.kind !== "p"; }
  return false;
}
function typeEmoji(m) {
  if (m.type === "image") return "🖼️";
  if (m.type === "video") return "🎬";
  return isVideoLink(m) ? "🎬" : "🔗";
}
function typeLabel(m) {
  if (m.type === "image") return "Imagen";
  if (m.type === "video") return "Video";
  return platformOf(m.url) === "web" ? "Link" : (platformOf(m.url).charAt(0).toUpperCase() + platformOf(m.url).slice(1));
}

/* miniatura para la cuadrícula de la biblioteca */
function thumbHTML(m) {
  if (m.type === "image") return `<img src="${m.url}" alt="meme" loading="lazy" />`;
  if (m.type === "video") return `<video src="${m.url}" muted playsinline preload="metadata"></video>`;
  const p = platformOf(m.url);
  if (p === "youtube") {
    const id = ytId(m.url);
    if (id) return `<img class="yt-thumb" src="https://img.youtube.com/vi/${id}/hqdefault.jpg" alt="video" loading="lazy" onerror="this.outerHTML='<div class=&quot;link-card&quot;><span class=&quot;lk-ico&quot;>▶</span><span class=&quot;lk-name&quot;>YouTube</span></div>'" />`;
  }
  const name = p === "tiktok" ? "TikTok" : p === "instagram" ? "Instagram" : shorten(m.url);
  const ico = isVideoLink(m) ? "▶" : "🔗";
  return `<div class="link-card"><span class="lk-ico">${ico}</span><span class="lk-name">${escapeHtml(name)}</span></div>`;
}

/* reproductor grande para el detalle y el review */
function playerHTML(m) {
  if (m.type === "image") return `<img class="pl-media" src="${m.url}" alt="meme" />`;
  if (m.type === "video") return `<video class="pl-media" src="${m.url}" controls autoplay loop playsinline></video>`;
  const p = platformOf(m.url);
  if (p === "youtube") {
    const id = ytId(m.url);
    if (id) return `<div class="embed-wrap yt"><iframe src="https://www.youtube.com/embed/${id}?autoplay=1&mute=0&playsinline=1&rel=0" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></div>`;
  }
  if (p === "tiktok") {
    const id = tiktokId(m.url);
    if (id) return `<div class="embed-wrap vertical"><iframe src="https://www.tiktok.com/embed/v2/${id}" allow="autoplay; encrypted-media; fullscreen" scrolling="no" allowfullscreen></iframe></div>`;
  }
  if (p === "instagram") {
    const ig = igParts(m.url);
    if (ig) return `<div class="embed-wrap ${ig.kind === "p" ? "square" : "vertical"}"><iframe src="https://www.instagram.com/${ig.kind}/${ig.code}/embed" allow="autoplay; encrypted-media" scrolling="no"></iframe></div>`;
  }
  return `<div class="link-card big"><span class="lk-ico">🔗</span><a href="${m.url}" target="_blank" rel="noopener">${shorten(m.url)}</a></div>`;
}

function renderLibrary() {
  const grid = $("#meme-grid");
  const owner = isOwner();
  const visible = MEMES; // todos ven la biblioteca
  $("#empty-msg").classList.toggle("hidden", visible.length > 0);

  grid.innerHTML = visible.map((m) => {
    const mine = m.userId === USER_ID;
    const canEdit = mine || owner;
    const medal = m.decision === "first" ? "🥇 1º" : m.decision === "second" ? "🥈 2º" : m.decision === "third" ? "🥉 3º" : m.decision === "win" ? "GANÓ" : "";
    const winTag = medal ? `<span class="win-tag">${medal}</span>` : "";
    const actions = canEdit ? `
      <div class="actions">
        <button data-edit="${m.id}">Editar</button>
        <button class="del" data-del="${m.id}">Borrar</button>
      </div>` : "";
    return `
      <div class="meme ${(m.decision === "first" || m.decision === "win") ? "won" : ""}" data-id="${m.id}">
        ${winTag}
        <div class="media" data-open="${m.id}">
          <span class="type-badge">${typeEmoji(m)}</span>
          ${thumbHTML(m)}
        </div>
        <div class="info">
          <div class="by">por ${escapeHtml(m.userName || "anónimo")}${mine ? " (tú)" : ""}</div>
          <div class="cap">${m.caption ? escapeHtml(m.caption) : ""}</div>
        </div>
        ${actions}
      </div>`;
  }).join("");
}
function escapeHtml(s){ return String(s).replace(/[&<>"']/g,(c)=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }

/* clicks en la grid (editar / borrar / abrir) */
$("#meme-grid").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  const edit = e.target.closest("[data-edit]");
  const open = e.target.closest("[data-open]");
  if (del) return askDelete(del.dataset.del);
  if (edit) return openEdit(edit.dataset.edit);
  if (open) return openMeme(open.dataset.open);
});

/* ---------- vista de detalle (lightbox) ---------- */
function openMeme(id) {
  const m = MEMES.find((x) => x.id === id);
  if (!m) return;
  $("#view-media").className = "view-media " + (m.type === "link" ? "type-" + platformOf(m.url) : "type-" + m.type);
  $("#view-media").innerHTML = `<span class="type-badge">${typeEmoji(m)}</span>` + playerHTML(m);
  $("#view-badge").textContent = `${typeEmoji(m)} ${typeLabel(m)}`;
  $("#view-by").textContent = m.userName || "anónimo";
  $("#view-cap").textContent = m.caption || "";
  $("#view-cap").style.display = m.caption ? "" : "none";
  const openBtn = $("#view-open");
  if (m.type === "link") { openBtn.style.display = ""; openBtn.onclick = () => window.open(m.url, "_blank", "noopener"); }
  else { openBtn.style.display = "none"; }
  $("#view-modal").classList.remove("hidden");
  const vid = $("#view-media").querySelector("video");
  if (vid) { vid.muted = false; vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); }); }
}
function closeView() {
  $("#view-modal").classList.add("hidden");
  $("#view-media").innerHTML = ""; // detiene video/iframe
}
$("#view-close").onclick = closeView;
$("#view-modal").addEventListener("click", (e) => { if (e.target.id === "view-modal") closeView(); });

/* ============================================================
   4. Borrar / Editar
   ============================================================ */
function askDelete(id) {
  const m = MEMES.find((x) => x.id === id);
  if (!m) return;
  if (!(m.userId === USER_ID || isOwner())) return toast("Solo puedes borrar tus memes.");
  openConfirm("¿Borrar este meme?", "Esta acción no se puede deshacer.", "Borrar", () => {
    store.remove(m).then(() => toast("Meme borrado"));
  });
}

let editingId = null;
function openEdit(id) {
  const m = MEMES.find((x) => x.id === id);
  if (!m) return;
  if (!(m.userId === USER_ID || isOwner())) return toast("Solo puedes editar tus memes.");
  editingId = id;
  $("#edit-caption").value = m.caption || "";
  const linkI = $("#edit-link");
  if (m.type === "link") { linkI.classList.remove("hidden"); linkI.value = m.url; }
  else linkI.classList.add("hidden");
  $("#edit-modal").classList.remove("hidden");
}
$("#edit-cancel").onclick = () => $("#edit-modal").classList.add("hidden");
$("#edit-save").onclick = async () => {
  const m = MEMES.find((x) => x.id === editingId);
  if (!m) return;
  const fields = { caption: $("#edit-caption").value.trim() };
  if (m.type === "link") { const v = $("#edit-link").value.trim(); if (v) fields.url = v; }
  await store.update(editingId, fields);
  $("#edit-modal").classList.add("hidden");
  toast("Guardado");
};

/* ============================================================
   5. Flujo de navegación (intro → dot → nombre → upload → biblioteca)
   ============================================================ */
$("#prize-text").textContent = PRIZE;

$("#intro-btn").onclick = () => {
  localStorage.setItem(LS.introSeen, "1");
  routeAfterIntro();
};
function routeAfterIntro() {
  if (getUserName() || MEMES.length) goLibrary();
  else showScreen("dot");
}

$("#dot-btn").onclick = () => {
  if (getUserName()) showScreen("upload");
  else showScreen("name");
};

$("#name-btn").onclick = () => {
  const v = $("#name-input").value.trim();
  if (v.length < 2) return toast("Escribe un nombre válido");
  localStorage.setItem(LS.userName, v);
  showScreen("upload");
};
$("#name-input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#name-btn").click(); });

$("#fab-add").onclick = () => { if (getUserName()) showScreen("upload"); else showScreen("name"); };
$$("[data-goto]").forEach((b) => b.onclick = () => { const g = b.dataset.goto; if (g === "library") goLibrary(); else showScreen(g); });

function goLibrary() { showScreen("library"); refreshOwnerUI(); }

/* ============================================================
   6. Formulario de subida
   ============================================================ */
let currentType = "file";
let currentFiles = [];

$$(".type-tab").forEach((tab) => tab.onclick = () => {
  $$(".type-tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");
  currentType = tab.dataset.type;
  currentFiles = [];
  $("#file-input").value = "";
  $("#file-preview").classList.add("hidden");
  $("#file-preview").innerHTML = "";
  if (currentType === "link") {
    $("#file-zone").classList.add("hidden");
    $("#link-zone").classList.remove("hidden");
  } else {
    $("#file-zone").classList.remove("hidden");
    $("#link-zone").classList.add("hidden");
  }
});

$("#file-input").addEventListener("change", (e) => {
  const files = [...e.target.files];
  currentFiles = [];
  let tooBig = 0;
  for (const f of files) {
    if (f.size > 50 * 1024 * 1024) { tooBig++; continue; }
    currentFiles.push(f);
  }
  if (tooBig) toast(`${tooBig} archivo(s) de más de 50 MB se omitieron`);
  const prev = $("#file-preview");
  if (!currentFiles.length) { prev.classList.add("hidden"); prev.innerHTML = ""; return; }

  const extra = currentFiles.length - 12;
  const count = document.createElement("div");
  count.className = "multi-count";
  count.textContent = `${currentFiles.length} seleccionado${currentFiles.length > 1 ? "s" : ""}` +
    (currentFiles.length > 1 ? " · se subirán por separado" : "") + (extra > 0 ? ` (mostrando 12)` : "");
  const grid = document.createElement("div");
  grid.className = "multi-preview";
  currentFiles.slice(0, 12).forEach((f) => {
    const url = URL.createObjectURL(f);
    grid.insertAdjacentHTML("beforeend",
      (f.type || "").startsWith("video") ? `<video src="${url}" muted></video>` : `<img src="${url}" alt="" />`);
  });
  prev.innerHTML = "";
  prev.append(count, grid);
  prev.classList.remove("hidden");
});

$("#upload-btn").onclick = async () => {
  const caption = $("#caption-input").value.trim();
  const userName = getUserName();
  const btn = $("#upload-btn");
  const prog = $("#upload-progress");
  const bar = prog.querySelector(".bar");
  const pct = prog.querySelector(".pct");

  // ----- LINK (uno) -----
  if (currentType === "link") {
    const link = $("#link-input").value.trim();
    if (!link) return toast("Pega un link");
    try { new URL(link); } catch { return toast("Link no válido"); }
    btn.disabled = true; btn.textContent = "ENVIANDO...";
    try {
      await store.add({ type: "link", url: link, caption, userName });
      resetUploadForm(); toast("¡Meme enviado! 🎉"); goLibrary();
    } catch (err) { console.error(err); toast("Error al enviar. Revisa tu conexión."); }
    finally { btn.disabled = false; btn.textContent = "ENVIAR MEME"; }
    return;
  }

  // ----- ARCHIVOS (uno o varios) = posts separados -----
  if (!currentFiles.length) return toast("Elige al menos una foto o video");
  const files = currentFiles.slice();
  const total = files.length;
  btn.disabled = true;
  prog.classList.remove("hidden");
  let done = 0, ok = 0, fail = 0;

  for (const f of files) {
    const type = (f.type || "").startsWith("image") ? "image" : "video";
    btn.textContent = total > 1 ? `SUBIENDO ${done + 1}/${total}...` : "ENVIANDO...";
    try {
      await store.add({ type, caption, userName }, f, (p) => {
        bar.style.width = Math.round(((done + p) / total) * 100) + "%";
        pct.textContent = `${done + (p >= 1 ? 1 : 0)}/${total}`;
      });
      ok++;
    } catch (err) { console.error(err); fail++; }
    done++;
    bar.style.width = Math.round((done / total) * 100) + "%";
    pct.textContent = `${done}/${total}`;
  }

  resetUploadForm();
  btn.disabled = false; btn.textContent = "ENVIAR MEME";
  prog.classList.add("hidden"); bar.style.width = "0%";
  toast(fail ? `${ok} enviado(s), ${fail} fallaron` : total > 1 ? `¡${ok} memes enviados! 🎉` : "¡Meme enviado! 🎉");
  goLibrary();
};

function resetUploadForm() {
  currentFiles = [];
  $("#file-input").value = "";
  $("#link-input").value = "";
  $("#caption-input").value = "";
  $("#file-preview").classList.add("hidden");
  $("#file-preview").innerHTML = "";
}

/* ============================================================
   7. Modo dueño (Kazoo)
   ============================================================ */
/* modal de confirmación genérico (borrar / salir) */
let confirmCallback = null;
function openConfirm(title, text, okText, onOk) {
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text || "";
  $("#confirm-ok").textContent = okText || "Aceptar";
  confirmCallback = onOk;
  $("#confirm-modal").classList.remove("hidden");
}
function closeConfirm() { $("#confirm-modal").classList.add("hidden"); confirmCallback = null; }
$("#confirm-cancel").onclick = closeConfirm;
$("#confirm-ok").onclick = () => { const cb = confirmCallback; closeConfirm(); if (cb) cb(); };

/* modal de contraseña de dueño */
function promptOwner() {
  if (isOwner()) {
    openConfirm("¿Salir del modo Kazoo?", "Volverás a verlo como un usuario normal.", "Salir", () => {
      localStorage.removeItem(LS.owner); refreshOwnerUI(); renderLibrary(); toast("Modo dueño desactivado");
    });
    return;
  }
  $("#pass-input").value = "";
  $("#pass-modal").classList.remove("hidden");
  setTimeout(() => $("#pass-input").focus(), 60);
}
function submitPass() {
  if ($("#pass-input").value === OWNER_PASSWORD) {
    localStorage.setItem(LS.owner, "1");
    $("#pass-modal").classList.add("hidden");
    refreshOwnerUI(); renderLibrary();
    toast("Bienvenido, Kazoo");
    goLibrary();
  } else {
    toast("Contraseña incorrecta");
    $("#pass-input").value = "";
    $("#pass-input").focus();
  }
}
$("#pass-ok").onclick = submitPass;
$("#pass-cancel").onclick = () => $("#pass-modal").classList.add("hidden");
$("#pass-input").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPass(); });
$("#dot-lock").onclick = promptOwner;
$("#lib-lock").onclick = promptOwner;

function refreshOwnerUI() {
  const owner = isOwner();
  $("#owner-badge").classList.toggle("hidden", !owner);
  $("#owner-panel").classList.toggle("hidden", !owner);
  if (owner) {
    const byDec = (d) => MEMES.find((m) => m.decision === d);
    const first = byDec("first"), second = byDec("second"), third = byDec("third");
    const legacy = MEMES.filter((m) => m.decision === "win");
    const parts = [];
    if (first) parts.push(`🥇 <b>${escapeHtml(first.userName || "anónimo")}</b>`);
    if (second) parts.push(`🥈 ${escapeHtml(second.userName || "anónimo")}`);
    if (third) parts.push(`🥉 ${escapeHtml(third.userName || "anónimo")}`);
    if (!first && legacy.length) parts.push("Ganadores: " + legacy.map((w) => escapeHtml(w.userName || "anónimo")).join(", "));
    $("#winners-line").innerHTML = parts.join(" &nbsp;·&nbsp; ");
  }
}

/* ============================================================
   8. Review mode (tinder, solo dueño)
   ============================================================ */
let tourney = null;

$("#start-review").onclick = () => {
  if (!isOwner()) return;
  startTournament();
};

function startTournament() {
  const pool = MEMES.slice();
  tourney = { round: 1, pool, queue: [], survivors: [], lastEliminated: null, stage: "round", podium: {}, finalists: [], three: [] };
  $("#review-done").classList.add("hidden");
  showScreen("review");
  if (pool.length === 0) { toast("No hay memes todavía"); return goLibrary(); }
  if (pool.length === 1) { tourney.podium.first = pool[0]; return finishTournament(); }
  beginRound(pool);
}

function beginRound(pool) {
  if (pool.length <= 3) return enterEndgame(pool);
  tourney.pool = pool;
  tourney.queue = pool.slice();
  tourney.survivors = [];
  showRoundCard();
}

function setStage(stage) {
  tourney.stage = stage;
  $("#deck").classList.toggle("hidden", stage !== "round");
  $("#pick-stage").classList.toggle("hidden", stage !== "pick3rd");
  $("#final-stage").classList.toggle("hidden", stage !== "final");
  $("#review-done").classList.toggle("hidden", stage !== "done");
  const roundUI = stage === "round";
  $("#btn-no").classList.toggle("hidden", !roundUI);
  $("#btn-yes").classList.toggle("hidden", !roundUI);
  document.querySelector(".review-bottom").classList.toggle("hidden", !roundUI);
}

function shuffleArr(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
$("#shuffle-btn").onclick = () => {
  if (!tourney || tourney.stage !== "round" || tourney.busy) return;
  shuffleArr(tourney.queue);
  showRoundCard();
  toast("Memes barajados 🔀");
};

function showRoundCard() {
  if (!tourney.queue.length) return finishRound();
  setStage("round");
  const el = $("#deck");
  el.innerHTML = "";
  const m = tourney.queue[0];
  $("#review-count").textContent = `Ronda ${tourney.round} · ${tourney.queue.length} por ver`;
  const card = document.createElement("div");
  card.className = "rcard type-" + (m.type === "link" ? platformOf(m.url) : m.type);
  card.innerHTML = `
    <div class="stamp like">ME RÍO</div>
    <div class="stamp nope">AGUANTÉ</div>
    <div class="rmedia"><span class="type-badge">${typeEmoji(m)}</span>${playerHTML(m)}<div class="drag-layer" title="Arrástrame"></div></div>
    <div class="rinfo">
      <div class="by">${escapeHtml(m.userName || "anónimo")}</div>
      ${m.caption ? `<div class="cap">${escapeHtml(m.caption)}</div>` : ""}
    </div>`;
  el.appendChild(card);
  enableDrag(card);
  resetSides();
  const vid = card.querySelector("video");
  if (vid) { vid.muted = false; vid.play().catch(() => { vid.muted = true; vid.play().catch(() => {}); }); }
}

/* ---------- efecto de proximidad rojo/verde en los lados ---------- */
const reviewStage = $("#review-stage");
const sideLeft = $("#side-left"), sideRight = $("#side-right");
const btnNoEl = $("#btn-no"), btnYesEl = $("#btn-yes");
function setSides(l, r) {
  sideLeft.style.opacity = l;
  sideRight.style.opacity = r;
  btnNoEl.style.transform = `translateY(-50%) scale(${1 + l * 0.28})`;
  btnYesEl.style.transform = `translateY(-50%) scale(${1 + r * 0.28})`;
  btnNoEl.style.borderColor = l > 0.06 ? "var(--red)" : "";
  btnNoEl.style.color = l > 0.06 ? "var(--red)" : "";
  btnYesEl.style.borderColor = r > 0.06 ? "var(--green)" : "";
  btnYesEl.style.color = r > 0.06 ? "var(--green)" : "";
}
function resetSides() { setSides(0, 0); }
reviewStage.addEventListener("mousemove", (e) => {
  if (!tourney || tourney.stage !== "round") return;
  const rect = reviewStage.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;      // 0 (izq) .. 1 (der)
  const l = Math.max(0, Math.min(1, (0.5 - ratio) / 0.5)); // mientras más a la izq, más rojo
  const r = Math.max(0, Math.min(1, (ratio - 0.5) / 0.5)); // mientras más a la der, más verde
  setSides(l, r);
});
reviewStage.addEventListener("mouseleave", resetSides);

function enableDrag(card) {
  let startX = 0, dx = 0, dragging = false;
  const like = card.querySelector(".stamp.like");
  const nope = card.querySelector(".stamp.nope");
  const onDown = (x) => { dragging = true; startX = x; };
  const onMove = (x) => {
    if (!dragging) return;
    dx = x - startX;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 20}deg)`;
    like.style.opacity = dx > 0 ? Math.min(dx / 100, 1) : 0;
    nope.style.opacity = dx < 0 ? Math.min(-dx / 100, 1) : 0;
    setSides(dx < 0 ? Math.min(-dx / 140, 1) : 0, dx > 0 ? Math.min(dx / 140, 1) : 0);
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    if (dx > 100) roundDecide(true, card);
    else if (dx < -100) roundDecide(false, card);
    else { card.style.transform = ""; like.style.opacity = 0; nope.style.opacity = 0; resetSides(); }
    dx = 0;
  };
  card.addEventListener("mousedown", (e) => { e.preventDefault(); onDown(e.clientX); });
  window.addEventListener("mousemove", (e) => onMove(e.clientX));
  window.addEventListener("mouseup", onUp);
  card.addEventListener("touchstart", (e) => onDown(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchend", onUp);
}

$("#btn-yes").onclick = () => { if (tourney && tourney.stage === "round") { const c = $(".rcard"); if (c) roundDecide(true, c); } };
$("#btn-no").onclick = () => { if (tourney && tourney.stage === "round") { const c = $(".rcard"); if (c) roundDecide(false, c); } };

function animateOut(card, keep) {
  card.style.transition = "transform .35s, opacity .35s";
  card.style.transform = keep ? "translateX(140%) rotate(20deg)" : "translateX(-140%) rotate(-20deg)";
  card.style.opacity = "0";
}

function roundDecide(keep, card) {
  if (!tourney || tourney.stage !== "round" || tourney.busy) return;
  const m = tourney.queue.shift();
  if (!m) return;
  tourney.busy = true;
  animateOut(card, keep);
  if (keep) tourney.survivors.push(m); else tourney.lastEliminated = m;
  resetSides();
  setTimeout(() => {
    tourney.busy = false;
    tourney.queue.length ? showRoundCard() : finishRound();
  }, 320);
}

function finishRound() {
  const surv = tourney.survivors;
  if (surv.length === 0) { toast("Elige al menos uno 😅"); return beginRound(tourney.pool); }
  if (surv.length === tourney.pool.length) toast("No eliminaste ninguno; sigue quitando");
  tourney.round++;
  beginRound(surv);
}

/* ---------- endgame: 3er lugar y final ---------- */
function miniCard(m, action) {
  return `
    <div class="vs-card" data-${action}="${m.id}">
      <div class="vs-media"><span class="type-badge">${typeEmoji(m)}</span>${thumbHTML(m)}</div>
      <div class="vs-info">
        <div class="vs-name">${escapeHtml(m.userName || "anónimo")}</div>
        ${m.caption ? `<div class="vs-cap">${escapeHtml(m.caption)}</div>` : ""}
        <button class="vs-view ghost-btn small" data-view="${m.id}">Ver</button>
      </div>
    </div>`;
}

function enterEndgame(pool) {
  if (pool.length === 1) { tourney.podium.first = pool[0]; return finishTournament(); }
  if (pool.length === 2) {
    tourney.finalists = pool.slice();
    if (tourney.lastEliminated) tourney.podium.third = tourney.lastEliminated;
    return showFinal();
  }
  tourney.three = pool.slice();
  showPick3rd();
}

function showPick3rd() {
  setStage("pick3rd");
  $("#review-count").textContent = "Quedan 3";
  $("#pick-stage").innerHTML = `
    <h2 class="stage-title">🥉 Elige el 3er lugar</h2>
    <p class="stage-sub muted">Toca el que quede tercero. Los otros 2 pasan a la final.</p>
    <div class="vs-grid three">${tourney.three.map((m) => miniCard(m, "pick")).join("")}</div>`;
}

function showFinal() {
  setStage("final");
  $("#review-count").textContent = "FINAL";
  $("#final-stage").innerHTML = `
    <h2 class="stage-title">🥇 La final</h2>
    <p class="stage-sub muted">¿Cuál te hizo reír más? Ese gana; el otro queda 2º.</p>
    <div class="vs-grid two">${tourney.finalists.map((m) => miniCard(m, "win1")).join("")}</div>`;
}

function onStageClick(e) {
  const view = e.target.closest("[data-view]");
  if (view) { e.stopPropagation(); return openMeme(view.dataset.view); }
  const pick = e.target.closest("[data-pick]");
  if (pick) {
    tourney.podium.third = tourney.three.find((m) => m.id === pick.dataset.pick);
    tourney.finalists = tourney.three.filter((m) => m.id !== pick.dataset.pick);
    return showFinal();
  }
  const w = e.target.closest("[data-win1]");
  if (w) {
    tourney.podium.first = tourney.finalists.find((m) => m.id === w.dataset.win1);
    tourney.podium.second = tourney.finalists.find((m) => m.id !== w.dataset.win1);
    return finishTournament();
  }
}
$("#pick-stage").addEventListener("click", onStageClick);
$("#final-stage").addEventListener("click", onStageClick);

function podCol(m, place) {
  if (!m) return "";
  const medal = place === 1 ? "🥇" : place === 2 ? "🥈" : "🥉";
  const label = place === 1 ? "1er lugar" : place === 2 ? "2º lugar" : "3er lugar";
  return `
    <div class="pcol c${place}" data-view="${m.id}">
      <div class="pmedal">${medal}</div>
      <div class="pthumb"><span class="type-badge">${typeEmoji(m)}</span>${thumbHTML(m)}</div>
      <div class="pname">${escapeHtml(m.userName || "anónimo")}</div>
      <div class="pbar">${label}</div>
    </div>`;
}

async function finishTournament() {
  setStage("done");
  $("#review-count").textContent = "";
  const { first, second, third } = tourney.podium;
  $("#review-done").innerHTML = `
    <h2>🏆 Podio</h2>
    <p class="stage-sub muted">Toca un meme para verlo.</p>
    <div class="podium3">${podCol(second, 2)}${podCol(first, 1)}${podCol(third, 3)}</div>
    <button class="big-btn">Volver a la biblioteca</button>`;
  $("#review-done .big-btn").onclick = () => goLibrary();
  $("#review-done").querySelectorAll("[data-view]").forEach((el) => {
    el.onclick = () => openMeme(el.dataset.view);
  });
  if (first) showWin(first.userName);
  await persistPodium();
}

async function persistPodium() {
  const want = new Map();
  const { first, second, third } = tourney.podium;
  if (first) want.set(first.id, "first");
  if (second) want.set(second.id, "second");
  if (third) want.set(third.id, "third");
  for (const m of MEMES) {
    const v = want.get(m.id) || null;
    if ((m.decision || null) !== v) { try { await store.update(m.id, { decision: v }); } catch (e) {} }
  }
}

function showWin(name) {
  const ov = $("#win-overlay");
  ov.querySelector(".win-name").textContent = name || "anónimo";
  ov.classList.remove("hidden");
  launchConfetti(ov);
  setTimeout(() => ov.classList.add("hidden"), 2600);
}

function launchConfetti(ov) {
  for (let i = 0; i < 44; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "%";
    c.style.background = Math.random() < 0.25 ? "var(--green)" : `rgba(255,255,255,${0.6 + Math.random() * 0.4})`;
    c.style.animationDelay = Math.random() * 0.5 + "s";
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    ov.appendChild(c);
  }
  setTimeout(() => ov.querySelectorAll(".confetti").forEach((e) => e.remove()), 3000);
}

/* ============================================================
   Contador regresivo (hasta DEADLINE, hora Pacífico)
   ============================================================ */
const DEADLINE_MS = new Date(DEADLINE).getTime();
function tickCountdown() {
  const diff = DEADLINE_MS - Date.now();
  let text = "";
  if (!isNaN(DEADLINE_MS)) {
    if (diff <= 0) text = "¡TERMINADO!";
    else {
      const s = Math.floor(diff / 1000);
      const pad = (n) => String(n).padStart(2, "0");
      const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600),
        m = Math.floor((s % 3600) / 60), sec = s % 60;
      text = (d > 0 ? `${d}d ` : "") + `${pad(h)}:${pad(m)}:${pad(sec)}`;
    }
  }
  document.querySelectorAll("[data-cd]").forEach((el) => {
    el.textContent = text;
    el.classList.toggle("cd-ended", diff <= 0);
  });
}
setInterval(tickCountdown, 1000);
tickCountdown();

/* ============================================================
   9. Arranque
   ============================================================ */
function boot() {
  if (!localStorage.getItem(LS.introSeen)) {
    showScreen("intro");
  } else {
    routeAfterIntro();
  }
  refreshOwnerUI();
}
boot();
