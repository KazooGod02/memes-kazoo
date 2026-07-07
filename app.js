import { firebaseConfig, OWNER_PASSWORD, PRIZE, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./config.js";

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

function mediaHTML(m, cover = true) {
  if (m.type === "image") return `<img src="${m.url}" alt="meme" />`;
  if (m.type === "video") return `<video src="${m.url}" ${cover ? "muted playsinline" : "controls playsinline"}></video>`;
  // link
  const embed = toEmbed(m.url);
  if (embed && !cover) return `<iframe src="${embed}" allowfullscreen allow="autoplay; encrypted-media"></iframe>`;
  return `<div class="link-card"><span class="lk-ico">🔗</span><a href="${m.url}" target="_blank" rel="noopener">${shorten(m.url)}</a></div>`;
}
function shorten(u){ try{ return new URL(u).hostname.replace("www.",""); }catch(e){ return u.slice(0,40); } }
function toEmbed(u) {
  try {
    const url = new URL(u);
    if (url.hostname.includes("youtube.com") && url.searchParams.get("v")) return `https://www.youtube.com/embed/${url.searchParams.get("v")}`;
    if (url.hostname === "youtu.be") return `https://www.youtube.com/embed/${url.pathname.slice(1)}`;
  } catch (e) {}
  return null;
}

function renderLibrary() {
  const grid = $("#meme-grid");
  const owner = isOwner();
  const visible = MEMES; // todos ven la biblioteca
  $("#empty-msg").classList.toggle("hidden", visible.length > 0);

  grid.innerHTML = visible.map((m) => {
    const mine = m.userId === USER_ID;
    const canEdit = mine || owner;
    const winTag = m.decision === "win" ? `<span class="win-tag">🏆 GANÓ</span>` : "";
    const actions = canEdit ? `
      <div class="actions">
        <button data-edit="${m.id}">✏️ Editar</button>
        <button class="del" data-del="${m.id}">🗑️ Borrar</button>
      </div>` : "";
    return `
      <div class="meme ${m.decision === "win" ? "won" : ""}" data-id="${m.id}">
        ${winTag}
        <div class="media" data-open="${m.id}">${mediaHTML(m, true)}</div>
        <div class="info">
          <div class="by">por ${escapeHtml(m.userName || "anónimo")}${mine ? " (tú)" : ""}</div>
          ${m.caption ? `<div class="cap">${escapeHtml(m.caption)}</div>` : ""}
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

function openMeme(id) {
  const m = MEMES.find((x) => x.id === id);
  if (!m) return;
  if (m.type === "link") window.open(m.url, "_blank", "noopener");
  else if (m.type === "video") { const v = document.querySelector(`.meme[data-id="${id}"] video`); if (v) { v.muted = false; v.paused ? v.play() : v.pause(); } }
}

/* ============================================================
   4. Borrar / Editar
   ============================================================ */
function askDelete(id) {
  const m = MEMES.find((x) => x.id === id);
  if (!m) return;
  if (!(m.userId === USER_ID || isOwner())) return toast("Solo puedes borrar tus memes.");
  if (confirm("¿Borrar este meme?")) store.remove(m).then(() => toast("Meme borrado"));
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
let currentType = "video";
let currentFile = null;

$$(".type-tab").forEach((tab) => tab.onclick = () => {
  $$(".type-tab").forEach((t) => t.classList.remove("active"));
  tab.classList.add("active");
  currentType = tab.dataset.type;
  currentFile = null;
  $("#file-preview").classList.add("hidden");
  $("#file-preview").innerHTML = "";
  const fileI = $("#file-input");
  if (currentType === "link") {
    $("#file-zone").classList.add("hidden");
    $("#link-zone").classList.remove("hidden");
  } else {
    $("#file-zone").classList.remove("hidden");
    $("#link-zone").classList.add("hidden");
    fileI.accept = currentType === "video" ? "video/*" : "image/*";
    $("#drop-text").textContent = currentType === "video" ? "Elegir video" : "Elegir imagen";
  }
});

$("#file-input").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  if (f.size > 50 * 1024 * 1024) { toast("Máximo 50 MB"); e.target.value = ""; return; }
  currentFile = f;
  const url = URL.createObjectURL(f);
  const prev = $("#file-preview");
  prev.innerHTML = currentType === "video"
    ? `<video src="${url}" controls playsinline></video>`
    : `<img src="${url}" alt="preview" />`;
  prev.classList.remove("hidden");
});

$("#upload-btn").onclick = async () => {
  const caption = $("#caption-input").value.trim();
  const userName = getUserName();
  let meme = { type: currentType, caption, userName };
  let file = null;

  if (currentType === "link") {
    const link = $("#link-input").value.trim();
    if (!link) return toast("Pega un link");
    try { new URL(link); } catch { return toast("Link no válido"); }
    meme.url = link;
  } else {
    if (!currentFile) return toast(`Elige ${currentType === "video" ? "un video" : "una imagen"}`);
    file = currentFile;
  }

  const btn = $("#upload-btn");
  btn.disabled = true; btn.textContent = "ENVIANDO...";
  const prog = $("#upload-progress");
  if (file) prog.classList.remove("hidden");

  try {
    await store.add(meme, file, (p) => {
      prog.querySelector(".bar").style.width = Math.round(p * 100) + "%";
      prog.querySelector(".pct").textContent = Math.round(p * 100) + "%";
    });
    resetUploadForm();
    toast("¡Meme enviado! 🎉");
    goLibrary();
  } catch (err) {
    console.error(err);
    toast("Error al enviar. Revisa tu conexión / Firebase.");
  } finally {
    btn.disabled = false; btn.textContent = "ENVIAR MEME";
    prog.classList.add("hidden"); prog.querySelector(".bar").style.width = "0%";
  }
};

function resetUploadForm() {
  currentFile = null;
  $("#file-input").value = "";
  $("#link-input").value = "";
  $("#caption-input").value = "";
  $("#file-preview").classList.add("hidden");
  $("#file-preview").innerHTML = "";
}

/* ============================================================
   7. Modo dueño (Kazoo)
   ============================================================ */
function promptOwner() {
  if (isOwner()) { if (confirm("Ya estás en modo Kazoo. ¿Salir del modo dueño?")) { localStorage.removeItem(LS.owner); refreshOwnerUI(); renderLibrary(); toast("Modo dueño desactivado"); } return; }
  const pass = prompt("Contraseña de Kazoo:");
  if (pass == null) return;
  if (pass === OWNER_PASSWORD) {
    localStorage.setItem(LS.owner, "1");
    refreshOwnerUI(); renderLibrary();
    toast("👑 Bienvenido, Kazoo");
    goLibrary();
  } else toast("Contraseña incorrecta");
}
$("#dot-lock").onclick = promptOwner;
$("#lib-lock").onclick = promptOwner;

function refreshOwnerUI() {
  const owner = isOwner();
  $("#owner-badge").classList.toggle("hidden", !owner);
  $("#owner-panel").classList.toggle("hidden", !owner);
  if (owner) {
    const winners = MEMES.filter((m) => m.decision === "win");
    $("#winners-line").innerHTML = winners.length
      ? "🏆 Ganadores: " + winners.map((w) => escapeHtml(w.userName || "anónimo")).join(", ")
      : "";
  }
}

/* ============================================================
   8. Review mode (tinder, solo dueño)
   ============================================================ */
let deck = [];
$("#start-review").onclick = () => {
  if (!isOwner()) return;
  deck = MEMES.filter((m) => !m.reviewed).slice();
  $("#review-done").classList.add("hidden");
  showScreen("review");
  renderDeck();
};

function renderDeck() {
  const el = $("#deck");
  el.innerHTML = "";
  $("#review-count").textContent = deck.length ? `${deck.length} por ver` : "";
  if (!deck.length) { $("#review-done").classList.remove("hidden"); return; }

  // solo la carta de arriba (primera) es interactiva
  const m = deck[0];
  const card = document.createElement("div");
  card.className = "rcard";
  card.innerHTML = `
    <div class="stamp like">ME RÍO</div>
    <div class="stamp nope">AGUANTÉ</div>
    <div class="rmedia">${mediaHTML(m, false)}</div>
    <div class="rinfo">
      <div class="by">${escapeHtml(m.userName || "anónimo")}</div>
      ${m.caption ? `<div class="cap">${escapeHtml(m.caption)}</div>` : ""}
    </div>`;
  el.appendChild(card);
  enableDrag(card);
}

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
  };
  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    if (dx > 110) decide("win", card);
    else if (dx < -110) decide("skip", card);
    else { card.style.transform = ""; like.style.opacity = 0; nope.style.opacity = 0; }
    dx = 0;
  };
  card.addEventListener("mousedown", (e) => onDown(e.clientX));
  window.addEventListener("mousemove", (e) => onMove(e.clientX));
  window.addEventListener("mouseup", onUp);
  card.addEventListener("touchstart", (e) => onDown(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchmove", (e) => onMove(e.touches[0].clientX), { passive: true });
  card.addEventListener("touchend", onUp);
}

$("#btn-yes").onclick = () => { const c = $(".rcard"); if (c) decide("win", c); };
$("#btn-no").onclick = () => { const c = $(".rcard"); if (c) decide("skip", c); };

async function decide(decision, card) {
  const m = deck.shift();
  if (!m) return;
  // animación de salida
  card.style.transition = "transform .35s, opacity .35s";
  card.style.transform = decision === "win" ? "translateX(140%) rotate(20deg)" : "translateX(-140%) rotate(-20deg)";
  card.style.opacity = "0";

  await store.update(m.id, { reviewed: true, decision });
  if (decision === "win") showWin(m.userName);

  setTimeout(renderDeck, 320);
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
    c.style.background = `hsl(${Math.random() * 360},90%,62%)`;
    c.style.animationDelay = Math.random() * 0.5 + "s";
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    ov.appendChild(c);
  }
  setTimeout(() => ov.querySelectorAll(".confetti").forEach((e) => e.remove()), 3000);
}

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
