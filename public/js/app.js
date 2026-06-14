// ─────────────────────────────────────────────
//  app.js  –  Lobby de JamSync
// ─────────────────────────────────────────────

function generarCodigo() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 7; i++) {
    if (i === 2) { c += '-'; continue; }
    c += chars[Math.floor(Math.random() * chars.length)];
  }
  return c; // ej: "XK-4829A"
}

function crearSala() {
  const nombre    = document.getElementById('input-nombre-crear').value.trim();
  const nombreSala = document.getElementById('input-nombre-sala').value.trim();

  if (!nombre) {
    resaltar('input-nombre-crear');
    return;
  }
  if (!nombreSala) {
    resaltar('input-nombre-sala');
    return;
  }

  const codigo = generarCodigo();
  guardarEIr(nombre, codigo, nombreSala);
}

function unirseASala() {
  const nombre  = document.getElementById('input-nombre-unirse').value.trim();
  const codigo  = document.getElementById('input-codigo').value.trim().toUpperCase();

  if (!nombre) {
    resaltar('input-nombre-unirse');
    return;
  }
  if (!codigo) {
    resaltar('input-codigo');
    return;
  }

  guardarEIr(nombre, codigo, codigo);
}

function guardarEIr(nombre, codigo, nombreSala) {
  sessionStorage.setItem('js_nombre',     nombre);
  sessionStorage.setItem('js_codigo',     codigo);
  sessionStorage.setItem('js_nombreSala', nombreSala);
  window.location.href = '/sala.html';
}

function resaltar(id) {
  const el = document.getElementById(id);
  el.style.borderColor = 'var(--danger)';
  el.focus();
  setTimeout(() => { el.style.borderColor = ''; }, 1500);
}