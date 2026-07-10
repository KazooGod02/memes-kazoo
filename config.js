// ============================================================
//  CONFIGURACIÓN  —  edita SOLO este archivo
// ============================================================

// 1) TU CONTRASEÑA SECRETA DE DUEÑO (Kazoo)
//    Con esta clave activas el modo dueño en tu dispositivo:
//    ver la biblioteca completa, borrar/editar todo y abrir
//    la pestaña "EMPEZAR SOLO PARA MI".
export const OWNER_PASSWORD = "kazoo0209";

// 2) EL PREMIO que se muestra en el intro
export const PRIZE = "$20 USD";

// 2b) FECHA LÍMITE del reto (el contador llega a 0 aquí).
//     Está en hora del Pacífico. En julio el Pacífico es PDT (UTC-7).
//     Formato: "AAAA-MM-DDTHH:MM:SS-07:00"
export const DEADLINE = "2026-07-10T17:00:00-07:00"; // viernes 10 jul, 5:00 PM Pacífico

// 3) CLAVES DE FIREBASE (Firestore) — guarda los DATOS de los memes
//    Mientras esto tenga "PEGA_AQUI", la app corre en MODO DEMO
//    (los memes se guardan solo en TU navegador, sirve para probar).
//    Cuando pegues tus claves reales, se activa el modo cross-device.
//    Pasos: mira el README.md
export const firebaseConfig = {
  apiKey: "AIzaSyCkMaWCb6_KY-L_t4srnnMyN6dDxIcDY_0",
  authDomain: "memes-kazoo.firebaseapp.com",
  projectId: "memes-kazoo",
  storageBucket: "memes-kazoo.firebasestorage.app",
  messagingSenderId: "414404319067",
  appId: "1:414404319067:web:d07884a7ec8d08d3fa2c7e",
  measurementId: "G-73Q18G0VPR",
};

// 4) CLOUDINARY — guarda los ARCHIVOS (videos e imágenes). Gratis, sin tarjeta.
//    - CLOUD_NAME: el "Cloud name" de tu panel de Cloudinary.
//    - UPLOAD_PRESET: el nombre de un "upload preset" en modo Unsigned.
//    Pasos: mira el README.md. (Los links no usan esto.)
export const CLOUDINARY_CLOUD_NAME = "l2hcls7r";
export const CLOUDINARY_UPLOAD_PRESET = "memes_unsigned";
