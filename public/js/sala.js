// ─────────────────────────────────────────────
//  sala.js  –  JamSync
// ─────────────────────────────────────────────

// ── Estado recuperado de sessionStorage (lo guarda app.js) ──
const nombre    = sessionStorage.getItem('js_nombre') || 'Anon';
const codigoSala = sessionStorage.getItem('js_codigo')  || '';
const nombreSala = sessionStorage.getItem('js_nombreSala') || codigoSala;

if (!codigoSala) {
  // Si alguien entra directo a sala.html sin pasar por el lobby
  window.location.href = '/';
}

// ── Socket ──
const socket = io();

// Colores deterministas por nombre
const COLORS = ['#7C5CFF','#FF5C7A','#3DFFB0','#FFB347','#5CE1FF','#FF8C5C','#C45CFF','#5CFF8C'];
function colorDeNombre(nom) {
  let h = 0;
  for (let i = 0; i < nom.length; i++) h = (h * 31 + nom.charCodeAt(i)) & 0xFFFFFF;
  return COLORS[Math.abs(h) % COLORS.length];
}

// ── YouTube Player ──
let player       = null;
let ytListo      = false;
let videoActual  = null;
let duracion     = 0;
let tickInterval = null;
let ignoreSync   = false;   // evitar loop al recibir sync
let cola         = [];
let indexActual  = -1;

// ── UI refs ──
const displayNombreSala = document.getElementById('display-nombre-sala');
const displayCodigoSala = document.getElementById('display-codigo-sala');
const avatarStack       = document.getElementById('avatar-stack');
const pantalla          = document.getElementById('pantalla-vacia');
const ytDiv             = document.getElementById('yt-player');
const nowPlayingBar     = document.getElementById('now-playing-bar');
const npTitulo          = document.getElementById('np-titulo');
const btnPlay           = document.getElementById('btn-play');
const iconPlay          = document.getElementById('icon-play');
const iconPause         = document.getElementById('icon-pause');
const btnPrev           = document.getElementById('btn-prev');
const btnNext           = document.getElementById('btn-next');
const progressTrack     = document.getElementById('progress-track');
const progressFill      = document.getElementById('progress-fill');
const timeCurrent       = document.getElementById('time-current');
const timeTotal         = document.getElementById('time-total');
const volumeSlider      = document.getElementById('volume-slider');
const inputBuscar       = document.getElementById('input-buscar');
const btnBuscar         = document.getElementById('btn-buscar');
const resultsList       = document.getElementById('results-list');
const colaList          = document.getElementById('cola-list');
const colaVacia         = document.getElementById('cola-vacia');
const colaCount         = document.getElementById('cola-count');
const chatMessages      = document.getElementById('chat-messages');
const chatInput         = document.getElementById('chat-input');
const btnEnviar         = document.getElementById('btn-enviar');

// ── Inicializar header ──
displayNombreSala.textContent = nombreSala;
displayCodigoSala.textContent = codigoSala;

displayCodigoSala.addEventListener('click', () => {
  navigator.clipboard.writeText(codigoSala).then(() => {
    displayCodigoSala.textContent = '¡Copiado!';
    setTimeout(() => { displayCodigoSala.textContent = codigoSala; }, 1500);
  });
});

// ── Tabs ──
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const id = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('tab-' + id).classList.add('active');
  });
});

// ─────────────────────────────────────────────
//  YouTube IFrame API
// ─────────────────────────────────────────────
function onYouTubeIframeAPIReady() {
  ytListo = true;
}

function crearPlayer(videoId, startSeconds = 0, autoplay = true) {
  pantalla.style.display = 'none';
  ytDiv.style.display    = 'block';

  if (player) {
    player.loadVideoById({ videoId, startSeconds });
    if (!autoplay) player.pauseVideo();
    return;
  }

  player = new YT.Player('yt-player', {
    videoId,
    playerVars: {
      autoplay: autoplay ? 1 : 0,
      controls: 0,
      modestbranding: 1,
      rel: 0,
      start: Math.floor(startSeconds),
    },
    events: {
      onReady:       onPlayerReady,
      onStateChange: onPlayerStateChange,
    }
  });
}

function onPlayerReady(e) {
  e.target.setVolume(parseInt(volumeSlider.value));
  duracion = player.getDuration();
  actualizarTimeTotal(duracion);
  iniciarTick();
}

function onPlayerStateChange(e) {
  const reproduciendo = e.data === YT.PlayerState.PLAYING;

  // Actualizar icono
  iconPlay.style.display  = reproduciendo ? 'none' : 'block';
  iconPause.style.display = reproduciendo ? 'block' : 'none';

  if (!ignoreSync) {
    const ts = player.getCurrentTime();
    socket.emit('sync-video', {
      videoId: videoActual?.videoId,
      timestamp: ts,
      reproduciendo
    });
  }

  if (e.data === YT.PlayerState.ENDED) {
    siguienteVideo();
  }
}

function iniciarTick() {
  clearInterval(tickInterval);
  tickInterval = setInterval(() => {
    if (!player || typeof player.getCurrentTime !== 'function') return;
    const t = player.getCurrentTime();
    duracion  = player.getDuration() || duracion;
    actualizarBarra(t, duracion);
  }, 500);
}

// ─────────────────────────────────────────────
//  Controles
// ─────────────────────────────────────────────
btnPlay.addEventListener('click', () => {
  if (!player) return;
  const state = player.getPlayerState();
  if (state === YT.PlayerState.PLAYING) {
    player.pauseVideo();
  } else {
    player.playVideo();
  }
});

btnNext.addEventListener('click', () => siguienteVideo());
btnPrev.addEventListener('click', () => anteriorVideo());

volumeSlider.addEventListener('input', () => {
  if (player) player.setVolume(parseInt(volumeSlider.value));
});

progressTrack.addEventListener('click', (e) => {
  if (!player || !duracion) return;
  const rect  = progressTrack.getBoundingClientRect();
  const ratio = (e.clientX - rect.left) / rect.width;
  const newT  = ratio * duracion;
  player.seekTo(newT, true);
  socket.emit('sync-video', {
    videoId: videoActual?.videoId,
    timestamp: newT,
    reproduciendo: player.getPlayerState() === YT.PlayerState.PLAYING
  });
});

// ─────────────────────────────────────────────
//  Cola
// ─────────────────────────────────────────────
function reproducirVideoEnIndice(idx) {
  if (idx < 0 || idx >= cola.length) return;
  indexActual = idx;
  videoActual = cola[idx];

  npTitulo.textContent     = videoActual.titulo;
  nowPlayingBar.style.display = 'flex';

  crearPlayer(videoActual.videoId, 0, true);
  renderCola();
}

function siguienteVideo() {
  if (indexActual + 1 < cola.length) {
    reproducirVideoEnIndice(indexActual + 1);
  }
}

function anteriorVideo() {
  if (indexActual - 1 >= 0) {
    reproducirVideoEnIndice(indexActual - 1);
  }
}

function renderCola() {
  colaList.innerHTML = '';
  colaCount.textContent = `${cola.length} video${cola.length !== 1 ? 's' : ''}`;

  if (cola.length === 0) {
    colaList.appendChild(colaVacia);
    colaVacia.style.display = 'block';
    return;
  }

  cola.forEach((v, i) => {
    const el = document.createElement('div');
    el.className = 'cola-item' + (i === indexActual ? ' activo' : '');
    el.innerHTML = `
      <span class="cola-num">${i === indexActual ? '▶' : i + 1}</span>
      <div class="cola-thumb"><img src="${v.thumbnail}" alt=""></div>
      <div class="cola-info">
        <div class="cola-item-title">${escHtml(v.titulo)}</div>
        <div class="cola-item-channel">${escHtml(v.canal)}</div>
      </div>
      <button class="cola-remove" data-i="${i}" title="Quitar">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.classList.contains('cola-remove')) return;
      reproducirVideoEnIndice(i);
      // Sincronizar con la sala
      socket.emit('sync-video', {
        videoId: cola[i].videoId,
        timestamp: 0,
        reproduciendo: true
      });
    });
    el.querySelector('.cola-remove').addEventListener('click', () => {
      cola.splice(i, 1);
      if (indexActual >= cola.length) indexActual = cola.length - 1;
      socket.emit('cola-agregar', cola); // reenviar cola completa
      renderCola();
    });
    colaList.appendChild(el);
  });
}

// ─────────────────────────────────────────────
//  Búsqueda
// ─────────────────────────────────────────────
async function buscar() {
  const q = inputBuscar.value.trim();
  if (!q) return;

  resultsList.innerHTML = '<div style="padding:16px 14px;color:var(--muted);font-size:12px;">Buscando…</div>';

  try {
    const res  = await fetch('/api/buscar?q=' + encodeURIComponent(q));
    const data = await res.json();

    if (!data.length) {
      resultsList.innerHTML = '<div style="padding:16px 14px;color:var(--muted);font-size:12px;">Sin resultados</div>';
      return;
    }

    resultsList.innerHTML = '';
    data.forEach(video => {
      const el = document.createElement('div');
      el.className = 'result-item';
      el.innerHTML = `
        <div class="result-thumb">
          <img src="${video.thumbnail}" alt="">
          <div class="result-thumb-overlay">▶</div>
        </div>
        <div class="result-info">
          <div class="result-title">${escHtml(video.titulo)}</div>
          <div class="result-channel">${escHtml(video.canal)}</div>
        </div>
        <button class="add-btn" title="Agregar a la cola">+</button>
      `;
      el.querySelector('.add-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        socket.emit('cola-agregar', video);
        // Feedback visual
        const btn = e.currentTarget;
        btn.textContent = '✓';
        btn.style.color = 'var(--success)';
        setTimeout(() => { btn.textContent = '+'; btn.style.color = ''; }, 1500);
      });
      // Clic en resultado → agregar y reproducir si no hay nada
      el.addEventListener('click', () => {
        socket.emit('cola-agregar', video);
      });
      resultsList.appendChild(el);
    });
  } catch {
    resultsList.innerHTML = '<div style="padding:16px 14px;color:var(--danger);font-size:12px;">Error al buscar. Revisá la API key.</div>';
  }
}

inputBuscar.addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); });
btnBuscar.addEventListener('click', buscar);

// ─────────────────────────────────────────────
//  Chat
// ─────────────────────────────────────────────
function enviarMensaje() {
  const txt = chatInput.value.trim();
  if (!txt) return;
  socket.emit('chat-mensaje', txt);
  chatInput.value = '';
}

btnEnviar.addEventListener('click', enviarMensaje);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') enviarMensaje(); });

document.querySelectorAll('.emoji-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    chatInput.value += btn.dataset.emoji;
    chatInput.focus();
  });
});

function agregarMensaje({ nombre: nom, texto, hora }) {
  const color  = colorDeNombre(nom);
  const initia = nom.charAt(0).toUpperCase();

  const el = document.createElement('div');
  el.className = 'msg';
  el.innerHTML = `
    <div class="msg-avatar" style="background:${color}22;color:${color};">${initia}</div>
    <div class="msg-body">
      <div class="msg-meta">
        <span class="msg-name" style="color:${color};">${escHtml(nom)}</span>
        <span class="msg-time">${hora}</span>
      </div>
      <div class="msg-text">${escHtml(texto)}</div>
    </div>
  `;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function agregarMensajeSistema(texto) {
  const el = document.createElement('div');
  el.className = 'msg-system';
  el.innerHTML = `<span>${escHtml(texto)}</span>`;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// ─────────────────────────────────────────────
//  Socket.io – eventos
// ─────────────────────────────────────────────
socket.on('connect', () => {
  socket.emit('unirse-sala', { codigo: codigoSala, nombre });
});

socket.on('estado-sala', (estado) => {
  // Restaurar cola
  if (estado.cola?.length) {
    cola = estado.cola;
    renderCola();
  }
  // Restaurar video actual
  if (estado.videoActual) {
    videoActual = cola.find(v => v.videoId === estado.videoActual) || { videoId: estado.videoActual, titulo: '', canal: '', thumbnail: '' };
    indexActual = cola.findIndex(v => v.videoId === estado.videoActual);
    npTitulo.textContent = videoActual.titulo;
    nowPlayingBar.style.display = 'flex';

    // Esperar a que la API de YT esté lista
    const intentar = () => {
      if (ytListo) {
        crearPlayer(estado.videoActual, estado.timestamp, estado.reproduciendo);
      } else {
        setTimeout(intentar, 300);
      }
    };
    intentar();
  }
});

socket.on('sync-video', (data) => {
  if (!ytListo) return;

  ignoreSync = true;

  if (data.videoId && data.videoId !== videoActual?.videoId) {
    // Cambió el video
    videoActual  = cola.find(v => v.videoId === data.videoId) || { videoId: data.videoId, titulo: '', canal: '', thumbnail: '' };
    indexActual  = cola.findIndex(v => v.videoId === data.videoId);
    npTitulo.textContent = videoActual.titulo || '';
    nowPlayingBar.style.display = 'flex';
    crearPlayer(data.videoId, data.timestamp, data.reproduciendo);
  } else if (player) {
    // Mismo video: sincronizar posición si hay desfase > 2s
    const diff = Math.abs(player.getCurrentTime() - data.timestamp);
    if (diff > 2) player.seekTo(data.timestamp, true);

    if (data.reproduciendo && player.getPlayerState() !== YT.PlayerState.PLAYING) {
      player.playVideo();
    } else if (!data.reproduciendo && player.getPlayerState() === YT.PlayerState.PLAYING) {
      player.pauseVideo();
    }
  }

  setTimeout(() => { ignoreSync = false; }, 500);
});

socket.on('cola-actualizada', (nuevaCola) => {
  const eraVacia   = cola.length === 0;
  cola = nuevaCola;
  renderCola();

  // Si no había nada reproduciéndose, arranca automáticamente
  if (eraVacia && cola.length > 0 && !videoActual) {
    reproducirVideoEnIndice(0);
    socket.emit('sync-video', {
      videoId: cola[0].videoId,
      timestamp: 0,
      reproduciendo: true
    });
  }
});

socket.on('chat-mensaje', agregarMensaje);

socket.on('usuario-entro', ({ nombre: nom }) => {
  agregarMensajeSistema(`${nom} se unió a la sala`);
  actualizarAvatares(nom, 'entro');
});

socket.on('usuario-salio', ({ nombre: nom }) => {
  agregarMensajeSistema(`${nom} salió de la sala`);
  actualizarAvatares(nom, 'salio');
});

// ─────────────────────────────────────────────
//  Avatares en el header
// ─────────────────────────────────────────────
const usuariosConectados = new Set();

function actualizarAvatares(nom, accion) {
  if (accion === 'entro') usuariosConectados.add(nom);
  else usuariosConectados.delete(nom);

  avatarStack.innerHTML = '';
  [...usuariosConectados].slice(0, 5).forEach(n => {
    const color = colorDeNombre(n);
    const div   = document.createElement('div');
    div.className = 'avatar';
    div.style.background = color + '33';
    div.style.color = color;
    div.title = n;
    div.textContent = n.charAt(0).toUpperCase();
    avatarStack.appendChild(div);
  });
}

// Agregar al propio usuario al conectar
actualizarAvatares(nombre, 'entro');

// ─────────────────────────────────────────────
//  Utilidades
// ─────────────────────────────────────────────
function fmtTiempo(s) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${ss}`;
}

function actualizarBarra(t, d) {
  timeCurrent.textContent = fmtTiempo(t);
  timeTotal.textContent   = fmtTiempo(d);
  progressFill.style.width = d > 0 ? `${(t / d) * 100}%` : '0%';
}

function actualizarTimeTotal(d) {
  timeTotal.textContent = fmtTiempo(d);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}


