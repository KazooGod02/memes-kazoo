# 😂 Si me haces reír, ganas $20 USD — reto de memes de Kazoo

Página web donde tus amigos suben memes (video, imagen o link) para intentar hacerte reír.
Si un meme te hace reír → **ese usuario gana el premio ($20 USD)**.

- **Intro** que se ve una sola vez (explica el reto y el premio).
- Punto blanco con **+** sobre fondo negro para subir.
- Pide el **nombre una sola vez**.
- **Biblioteca** de memes: cada usuario edita/borra **solo los suyos**.
- **Tú (Kazoo)** ves y controlas **todos** los memes.
- Pestaña **"EMPEZAR (solo para mí)"**: pasas los memes tipo Tinder
  (✕ a la izquierda = aguanté, ✓ a la derecha = me reí → ese usuario gana).

---

## ▶️ Probarla YA (modo demo)

Ábrela con cualquier servidor local (no funciona con doble-clic por seguridad de los navegadores):

```
# opción 1: Python
python -m http.server 5500
# opción 2: Node
npx serve
```

Luego entra a `http://localhost:5500`.
En **modo demo** los memes se guardan solo en TU navegador — sirve para ver el diseño.
Para recibir memes de otras personas necesitas Firebase (abajo).

---

## 🔑 Tu contraseña de dueño (Kazoo)

En `config.js` cambia:

```js
export const OWNER_PASSWORD = "kazoo-2024";   // ← pon TU clave secreta
```

Para activar el modo dueño: toca el candado 🔒 (arriba a la derecha) y escribe la clave.
Ahí aparece el botón **EMPEZAR (solo para mí)** y puedes borrar/editar todo.

---

La app usa **dos servicios gratis, sin tarjeta**:
- **Firebase Firestore** → guarda los DATOS de los memes (nombre, tipo, link, ganador…).
- **Cloudinary** → guarda los ARCHIVOS (videos e imágenes). Los links no usan nada.

### A) Firebase Firestore (datos)

1. Entra a <https://console.firebase.google.com> → **Agregar proyecto** (nombre libre, plan **Spark** gratis).
2. Menú **Compilación → Firestore Database** → *Crear base de datos* → **modo de prueba** → Crear.
3. Icono ⚙️ → **Configuración del proyecto** → baja a *Tus apps* → icono **`</>`** (Web) → registra la app.
4. Copia el objeto `firebaseConfig` que te da y **pégalo en `config.js`** reemplazando los `"PEGA_AQUI"`.
5. En **Firestore → pestaña Reglas**, pega esto y **Publicar**:
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /memes/{doc} { allow read, write: if true; }
  }
}
```
> ⚠️ No necesitas activar **Storage** de Firebase (ese pide plan de pago). Los archivos van a Cloudinary.

### B) Cloudinary (videos e imágenes) — gratis, sin tarjeta

1. Crea cuenta en <https://cloudinary.com> (botón *Sign up free*, no pide tarjeta).
2. En el panel (Dashboard) copia tu **Cloud name** y pégalo en `config.js` → `CLOUDINARY_CLOUD_NAME`.
3. Ve a **Settings (⚙️) → Upload → Upload presets → Add upload preset**.
4. En **Signing Mode** elige **Unsigned**. Copia el **nombre** del preset (o ponle uno, ej. `memes_unsigned`) → **Save**.
5. Pega ese nombre en `config.js` → `CLOUDINARY_UPLOAD_PRESET`.

> Las reglas/preset abiertos permiten que cualquiera con el link suba. Perfecto para una
> actividad casual entre amigos. No subas cosas privadas.

Guarda `config.js`, recarga la página y ¡listo! Ya es cross-device.

---

## 🚀 Subir a GitHub Pages

1. Crea un repositorio en GitHub y sube **estos archivos** (que queden en la raíz del repo):
   `index.html`, `styles.css`, `app.js`, `config.js`, `README.md`.
2. En el repo: **Settings → Pages**.
3. En *Build and deployment* → *Source*: **Deploy from a branch**.
4. Branch: **main** / carpeta **/ (root)** → **Save**.
5. Espera ~1 min. Tu página queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

Comparte ese link con tus amigos. Tú entras al mismo link, tocas el 🔒, pones tu clave y
usas **EMPEZAR (solo para mí)**.

---

## 📁 Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Estructura de las pantallas |
| `styles.css` | Diseño (fondo negro, punto blanco, tarjetas) |
| `app.js` | Toda la lógica (Firebase + demo, review, dueño) |
| `config.js` | **Lo único que editas**: clave de dueño, premio y claves de Firebase |
