/**
 * fotos-abuela / server.js
 * ─────────────────────────────────────────────
 * 1. Tu abuela escanea el QR → abre /auth en su celular
 * 2. Inicia sesión con Google y aprueba el permiso de Google Photos
 * 3. El servidor guarda el token y carga todas sus fotos
 * 4. Tú abres http://localhost:3000 y las ves en el panel
 * ─────────────────────────────────────────────
 * Instalar: npm install express googleapis qrcode
 * Ejecutar: node server.js
 */

const express  = require('express');
const { google } = require('googleapis');
const QRCode   = require('qrcode');
const http     = require('http');

const app  = express();
const PORT = 3000;

// ─── CONFIGURA AQUÍ TUS CREDENCIALES DE GOOGLE CLOUD ───────────────────────
// 1. Ve a https://console.cloud.google.com
// 2. Crea un proyecto → habilita "Google Photos Library API"
// 3. Credenciales → OAuth 2.0 → Tipo: Aplicación web
// 4. URL de redireccionamiento: http://localhost:3000/auth/callback
const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URL  = process.env.REDIRECT_URL; 'https://fotos-abuela-production.up.railway.app/auth/callback';
// ───────────────────────────────────────────────────────────────────────────

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

// Estado en memoria (para uso personal/local)
let sessionTokens  = null;   // tokens de la abuela
let cachedPhotos   = [];     // lista de mediaItems de Google Photos
let lastSync       = null;   // fecha del último sync

// ─── UTILIDADES ─────────────────────────────────────────────────────────────

// Detecta la IP local para construir la URL del QR

function getLocalIP() {
  return process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
}

// Carga todas las fotos paginando por la API de Google Photos
async function fetchAllPhotos(auth) {
  const items = [];
  let pageToken = null;
  const base = 'https://photoslibrary.googleapis.com/v1/mediaItems';

  do {
    const url = base + `?pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${auth.credentials.access_token}` }
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    if (data.mediaItems) items.push(...data.mediaItems);
    pageToken = data.nextPageToken || null;
  } while (pageToken);

  return items;
}

// ─── RUTAS ───────────────────────────────────────────────────────────────────

// Página principal → panel de fotos (para ti, en el navegador)
app.get('/', (req, res) => {
  if (!sessionTokens) {
    // Nadie ha iniciado sesión todavía
    return res.send(pageSinSesion());
  }
  res.send(panelFotos());
});

// Genera el QR y la URL de autorización que recibirá tu abuela
app.get('/qr', async (req, res) => {
  const localIP = getLocalIP();
  const authLink = localIP === 'localhost' 
    ? `http://localhost:${PORT}/auth`
    : `https://${localIP}/auth`;
  const qrDataURL = await QRCode.toDataURL(authLink, { width: 300, margin: 2 });
  res.send(pageQR(authLink, qrDataURL));
});

// Página de inicio de sesión con Google (tu abuela abre esto desde el QR)
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/photoslibrary.readonly',
      'https://www.googleapis.com/auth/userinfo.email',
    ],
    prompt: 'consent',
  });
  res.redirect(url);
});

// Google redirige aquí después de que tu abuela aprueba el permiso
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.send(pageError('Permiso rechazado: ' + error));
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    sessionTokens = tokens;

    // Carga las fotos en segundo plano
    cachedPhotos = [];
    lastSync     = null;
    fetchAllPhotos(oauth2Client)
      .then(items => {
        cachedPhotos = items;
        lastSync     = new Date();
        console.log(`✅  ${items.length} fotos cargadas`);
      })
      .catch(err => console.error('Error cargando fotos:', err));

    // Respuesta inmediata para tu abuela
    res.send(pageExito());
  } catch (err) {
    console.error(err);
    res.send(pageError('Error al conectar con Google: ' + err.message));
  }
});

// API JSON: devuelve la lista de fotos con sus URLs temporales
app.get('/api/photos', async (req, res) => {
  if (!sessionTokens) return res.status(401).json({ error: 'Sin sesión' });

  // Refresca token si está vencido
  if (sessionTokens.expiry_date && Date.now() > sessionTokens.expiry_date - 60000) {
    try {
      const { credentials } = await oauth2Client.refreshAccessToken();
      sessionTokens = credentials;
      oauth2Client.setCredentials(credentials);
    } catch {
      sessionTokens = null;
      return res.status(401).json({ error: 'Token expirado' });
    }
  }

  const page  = parseInt(req.query.page  || '0');
  const limit = parseInt(req.query.limit || '40');
  const query = (req.query.q || '').toLowerCase();

  let items = cachedPhotos;
  if (query) {
    items = items.filter(i =>
      (i.filename || '').toLowerCase().includes(query) ||
      (i.mediaMetadata?.creationTime || '').includes(query)
    );
  }

  const total = items.length;
  const slice = items.slice(page * limit, page * limit + limit);

  res.json({
    total,
    page,
    syncing: lastSync === null,
    lastSync: lastSync?.toISOString(),
    photos: slice.map(item => ({
      id:       item.id,
      filename: item.filename,
      date:     item.mediaMetadata?.creationTime,
      width:    item.mediaMetadata?.width,
      height:   item.mediaMetadata?.height,
      isVideo:  item.mimeType?.startsWith('video'),
      // =w400-h400-c → thumbnail cuadrado 400px
      thumb:    item.baseUrl + '=w400-h400-c',
      // =d → descarga original
      full:     item.baseUrl + '=d',
    }))
  });
});

// Cierra la sesión
app.get('/logout', (req, res) => {
  sessionTokens = null;
  cachedPhotos  = [];
  lastSync      = null;
  res.redirect('/');
});

// ─── HTML ─────────────────────────────────────────────────────────────────────

const css = `
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Serif+Display:ital@0;1&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:      #F7F4EF;
      --surface: #FFFFFF;
      --ink:     #1C1917;
      --mid:     #78716C;
      --accent:  #C26E3A;
      --accent2: #6B7FBF;
      --border:  #E5E1DA;
      --radius:  10px;
    }
    body {
      font-family: 'DM Sans', sans-serif;
      background: var(--bg);
      color: var(--ink);
      min-height: 100vh;
    }
    a { color: inherit; text-decoration: none; }
    .serif { font-family: 'DM Serif Display', serif; }
  </style>
`;

function pageSinSesion() {
  return `<!DOCTYPE html><html><head>${css}<title>Fotos de Abuela</title>
  <style>
    .hero {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; min-height: 100vh; text-align: center;
      padding: 2rem; gap: 1.5rem;
    }
    .tag { font-size: .75rem; letter-spacing: .12em; text-transform: uppercase;
           color: var(--accent); font-weight: 500; }
    h1 { font-size: clamp(2.4rem, 6vw, 3.8rem); line-height: 1.1;
         font-family: 'DM Serif Display', serif; max-width: 18ch; }
    h1 em { color: var(--accent); font-style: italic; }
    p { color: var(--mid); max-width: 38ch; line-height: 1.6; }
    .btn {
      display: inline-flex; align-items: center; gap: .6rem;
      padding: .8rem 1.8rem; border-radius: 999px;
      background: var(--ink); color: #fff; font-size: .9rem; font-weight: 500;
      transition: background .2s, transform .15s;
    }
    .btn:hover { background: var(--accent); transform: translateY(-1px); }
    .btn.outline {
      background: transparent; color: var(--ink);
      border: 1.5px solid var(--border);
    }
    .btn.outline:hover { background: var(--ink); color: #fff; }
    .actions { display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center; }
    .step {
      display: flex; gap: .8rem; align-items: flex-start;
      max-width: 26rem; text-align: left;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1rem 1.2rem;
    }
    .step-num {
      flex-shrink: 0; width: 28px; height: 28px;
      border-radius: 50%; background: var(--accent);
      color: #fff; font-size: .8rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .step-body strong { display: block; margin-bottom: .2rem; font-size: .9rem; }
    .step-body span { color: var(--mid); font-size: .82rem; line-height: 1.5; }
    .steps { display: flex; flex-direction: column; gap: .75rem; width: 100%; max-width: 26rem; }
  </style></head><body>
  <div class="hero">
    <span class="tag">Álbum familiar</span>
    <h1 class="serif">Los recuerdos de <em>abuela</em>, siempre contigo</h1>
    <p>Cuando ella inicie sesión desde su celular, sus fotos aparecerán aquí ordenadas y listas para guardar.</p>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-body">
          <strong>Genera el código QR</strong>
          <span>Muéstrale el QR a tu abuela para que abra el enlace en su celular.</span>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-body">
          <strong>Ella inicia sesión con Google</strong>
          <span>Aprueba el permiso de solo lectura en Google Photos — sin contraseña compartida.</span>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-body">
          <strong>Tú ordenas sus recuerdos</strong>
          <span>Las fotos aparecen aquí. Navégalas, descárgalas y organízalas juntos.</span>
        </div>
      </div>
    </div>

    <div class="actions">
      <a class="btn" href="/qr">📱 Ver código QR para abuela</a>
      <a class="btn outline" href="/auth">Iniciar sesión yo mismo</a>
    </div>
  </div>
</body></html>`;
}

function pageQR(authLink, qrDataURL) {
  return `<!DOCTYPE html><html><head>${css}<title>QR para Abuela</title>
  <style>
    body { display:flex; align-items:center; justify-content:center;
           min-height:100vh; padding:2rem; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 16px; padding: 2.5rem 2rem;
      max-width: 420px; width: 100%; text-align: center;
      display: flex; flex-direction: column; gap: 1.2rem;
      box-shadow: 0 4px 40px rgba(0,0,0,.07);
    }
    .tag { font-size: .72rem; letter-spacing: .12em; text-transform: uppercase;
           color: var(--accent); font-weight: 500; }
    h1 { font-family: 'DM Serif Display', serif; font-size: 1.9rem; line-height: 1.2; }
    .qr-wrap { background: white; border-radius: 12px; padding: 1rem;
               display:inline-block; border: 2px solid var(--border); margin: .5rem auto; }
    .qr-wrap img { display:block; width:220px; height:220px; }
    p { color: var(--mid); font-size: .88rem; line-height: 1.6; }
    code { background: var(--bg); padding: .25rem .6rem; border-radius: 6px;
           font-size: .8rem; word-break: break-all; color: var(--accent2); }
    .back { font-size: .82rem; color: var(--mid); }
    .back a { color: var(--accent); text-decoration: underline; }
  </style></head><body>
  <div class="card">
    <span class="tag">Paso 1 de 2</span>
    <h1 class="serif">Muéstrale este QR a tu abuela</h1>
    <div class="qr-wrap"><img src="${qrDataURL}" alt="QR"></div>
    <p>Ella lo escanea con la cámara de su celular, inicia sesión con Google y aprueba el permiso. Eso es todo.</p>
    <code>${authLink}</code>
    <p class="back">Cuando ella haya iniciado sesión, <a href="/">vuelve al panel</a> para ver sus fotos.</p>
  </div>
</body></html>`;
}

function pageExito() {
  return `<!DOCTYPE html><html><head>${css}<title>¡Listo!</title>
  <style>
    body { display:flex; align-items:center; justify-content:center;
           min-height:100vh; padding:2rem; }
    .card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 16px; padding: 2.5rem 2rem;
      max-width: 360px; width: 100%; text-align: center;
      display: flex; flex-direction: column; gap: 1rem;
      box-shadow: 0 4px 40px rgba(0,0,0,.07);
    }
    .icon { font-size: 3.5rem; }
    h1 { font-family: 'DM Serif Display', serif; font-size: 2rem; }
    p { color: var(--mid); line-height: 1.6; font-size: .9rem; }
  </style></head><body>
  <div class="card">
    <div class="icon">✅</div>
    <h1 class="serif">¡Conexión lista!</h1>
    <p>Tus fotos están siendo cargadas. Puedes cerrar esta pantalla — quien tenga el panel abierto ya puede verlas.</p>
    <p style="font-size:.8rem;color:var(--mid)">Gracias por compartir tus recuerdos 💛</p>
  </div>
</body></html>`;
}

function pageError(msg) {
  return `<!DOCTYPE html><html><head>${css}<title>Error</title>
  <style>
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:2rem; }
    .card {
      background:var(--surface); border:1px solid var(--border); border-radius:16px;
      padding:2.5rem 2rem; max-width:360px; width:100%; text-align:center;
      display:flex; flex-direction:column; gap:1rem;
    }
    h1 { font-family:'DM Serif Display',serif; font-size:1.8rem; }
    p { color:var(--mid); font-size:.88rem; }
    a { color:var(--accent); text-decoration:underline; }
  </style></head><body>
  <div class="card">
    <div style="font-size:2.5rem">⚠️</div>
    <h1>Algo salió mal</h1>
    <p>${msg}</p>
    <p><a href="/auth">Intentar de nuevo</a></p>
  </div>
</body></html>`;
}

function panelFotos() {
  return `<!DOCTYPE html><html><head>${css}<title>Fotos de Abuela</title>
  <style>
    header {
      position: sticky; top: 0; z-index: 10;
      background: rgba(247,244,239,.92); backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--border);
      display: flex; align-items: center; gap: 1rem;
      padding: .75rem 1.5rem; flex-wrap: wrap;
    }
    header h1 { font-family:'DM Serif Display',serif; font-size:1.3rem; flex:1; }
    #searchInput {
      border: 1.5px solid var(--border); border-radius: 999px;
      padding: .45rem 1rem; font-size: .85rem; font-family: inherit;
      background: var(--surface); outline: none; width: 220px;
      transition: border-color .2s;
    }
    #searchInput:focus { border-color: var(--accent); }
    .pill {
      padding: .35rem .9rem; border-radius: 999px; font-size: .8rem;
      border: 1.5px solid var(--border); background: transparent;
      cursor: pointer; font-family: inherit; transition: all .2s;
    }
    .pill:hover, .pill.active { background: var(--ink); color: #fff; border-color: var(--ink); }
    .status {
      font-size: .78rem; color: var(--mid); display: flex; align-items: center; gap: .4rem;
    }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); animation: pulse 1.4s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    .dot.done { background:#4CAF50; animation:none; }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 6px; padding: 1rem 1.2rem;
    }
    .thumb {
      aspect-ratio: 1; overflow: hidden; border-radius: 6px;
      background: var(--border); cursor: pointer; position: relative;
      transition: transform .18s, box-shadow .18s;
    }
    .thumb:hover { transform: scale(1.03); box-shadow: 0 6px 24px rgba(0,0,0,.15); }
    .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
    .thumb .overlay {
      position:absolute; inset:0; background:linear-gradient(to top,rgba(0,0,0,.55) 0%, transparent 50%);
      opacity:0; transition:opacity .2s; display:flex; align-items:flex-end; padding:.5rem;
    }
    .thumb:hover .overlay { opacity:1; }
    .overlay span { color:#fff; font-size:.72rem; }
    .video-badge {
      position:absolute; top:.4rem; right:.4rem;
      background:rgba(0,0,0,.6); color:#fff; font-size:.65rem;
      padding:.2rem .4rem; border-radius:4px;
    }

    .pagination {
      display:flex; justify-content:center; gap:.5rem; padding:1.5rem; flex-wrap:wrap;
    }
    .page-btn {
      padding:.4rem .9rem; border-radius:6px; border:1.5px solid var(--border);
      background:var(--surface); cursor:pointer; font-size:.83rem;
      transition: all .15s;
    }
    .page-btn:hover { background:var(--ink); color:#fff; border-color:var(--ink); }
    .page-btn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    .page-btn:disabled { opacity:.4; cursor:default; }

    #total { font-size:.82rem; color:var(--mid); text-align:center; padding:.5rem; }

    /* Lightbox */
    #lb {
      display:none; position:fixed; inset:0; background:rgba(0,0,0,.92);
      z-index:100; align-items:center; justify-content:center; flex-direction:column;
      gap:1rem;
    }
    #lb.open { display:flex; }
    #lb img { max-width:90vw; max-height:80vh; border-radius:8px; object-fit:contain; }
    #lb-info { color:#ccc; font-size:.82rem; }
    #lb-close {
      position:fixed; top:1rem; right:1.2rem; color:#fff; font-size:1.8rem;
      cursor:pointer; line-height:1;
    }
    #lb-dl {
      padding:.5rem 1.4rem; border-radius:999px; background:var(--accent);
      color:#fff; font-size:.85rem; cursor:pointer; border:none; font-family:inherit;
    }
    #lb-dl:hover { background:var(--ink); }

    footer { text-align:center; padding:1.5rem; color:var(--mid); font-size:.78rem; }
    .empty { text-align:center; padding:4rem 2rem; color:var(--mid); }
    .spinner { text-align:center; padding:3rem; color:var(--mid); font-size:.9rem; }
  </style></head><body>

<header>
  <h1 class="serif">📷 Fotos de Abuela</h1>
  <input id="searchInput" type="search" placeholder="Buscar por nombre o fecha…">
  <button class="pill" onclick="loadPhotos(0, 'all')">Todas</button>
  <button class="pill" onclick="loadPhotos(0, 'photo')">Fotos</button>
  <button class="pill" onclick="loadPhotos(0, 'video')">Videos</button>
  <span class="status" id="status"><span class="dot" id="dot"></span><span id="statusTxt">Cargando…</span></span>
  <a href="/logout" class="pill" style="margin-left:auto">Cerrar sesión</a>
</header>

<div id="total"></div>
<div id="grid" class="grid"><div class="spinner">Cargando fotos…</div></div>
<div id="pagination" class="pagination"></div>

<!-- Lightbox -->
<div id="lb">
  <span id="lb-close" onclick="closeLb()">✕</span>
  <img id="lb-img" src="" alt="">
  <div id="lb-info"></div>
  <button id="lb-dl" onclick="downloadFull()">⬇ Descargar original</button>
</div>

<footer>Solo lectura · las fotos no se guardan en este servidor</footer>

<script>
  let currentPage = 0;
  let currentFilter = 'all';
  let currentQuery = '';
  let totalPhotos = 0;
  let currentFullUrl = '';
  const LIMIT = 40;

  async function loadPhotos(page = 0, filter = currentFilter, query = currentQuery) {
    currentPage   = page;
    currentFilter = filter;
    currentQuery  = query;

    document.getElementById('grid').innerHTML = '<div class="spinner">Cargando…</div>';

    const params = new URLSearchParams({ page, limit: LIMIT });
    if (query) params.set('q', query);

    const res  = await fetch('/api/photos?' + params);
    const data = await res.json();

    // Estado de sincronización
    const dot = document.getElementById('dot');
    const txt = document.getElementById('statusTxt');
    if (data.syncing) {
      dot.className = 'dot';
      txt.textContent = 'Sincronizando fotos…';
      setTimeout(() => loadPhotos(page, filter, query), 4000);
    } else {
      dot.className = 'dot done';
      const d = new Date(data.lastSync);
      txt.textContent = 'Actualizado ' + d.toLocaleTimeString();
    }

    let photos = data.photos;
    if (filter === 'photo') photos = photos.filter(p => !p.isVideo);
    if (filter === 'video') photos = photos.filter(p => p.isVideo);
    totalPhotos = data.total;

    document.getElementById('total').textContent =
      totalPhotos + ' archivo' + (totalPhotos !== 1 ? 's' : '') + ' en la cuenta';

    const grid = document.getElementById('grid');
    if (!photos.length) {
      grid.innerHTML = '<div class="empty">No se encontraron archivos</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    grid.innerHTML = photos.map(p => \`
      <div class="thumb" onclick="openLb('\${p.thumb}', '\${p.full}', '\${p.filename}', '\${p.date || ''}')">
        <img src="\${p.thumb}" alt="\${p.filename}" loading="lazy">
        <div class="overlay"><span>\${formatDate(p.date)}</span></div>
        \${p.isVideo ? '<span class="video-badge">▶ video</span>' : ''}
      </div>
    \`).join('');

    renderPagination(data.total);
  }

  function renderPagination(total) {
    const pages = Math.ceil(total / LIMIT);
    if (pages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
    let html = '';
    const start = Math.max(0, currentPage - 2);
    const end   = Math.min(pages - 1, currentPage + 2);
    if (currentPage > 0) html += \`<button class="page-btn" onclick="loadPhotos(\${currentPage-1})">← Anterior</button>\`;
    for (let i = start; i <= end; i++) {
      html += \`<button class="page-btn \${i===currentPage?'active':''}" onclick="loadPhotos(\${i})">\${i+1}</button>\`;
    }
    if (currentPage < pages - 1) html += \`<button class="page-btn" onclick="loadPhotos(\${currentPage+1})">Siguiente →</button>\`;
    document.getElementById('pagination').innerHTML = html;
  }

  function formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('es-MX', { year:'numeric', month:'short', day:'numeric' }); }
    catch { return iso; }
  }

  function openLb(thumb, full, name, date) {
    currentFullUrl = full;
    document.getElementById('lb-img').src = thumb;
    document.getElementById('lb-info').textContent = name + (date ? ' · ' + formatDate(date) : '');
    document.getElementById('lb').classList.add('open');
  }
  function closeLb() {
    document.getElementById('lb').classList.remove('open');
    document.getElementById('lb-img').src = '';
  }
  function downloadFull() {
    const a = document.createElement('a');
    a.href = currentFullUrl;
    a.download = '';
    a.target = '_blank';
    a.click();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });

  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadPhotos(0, currentFilter, e.target.value), 400);
  });

  // Carga inicial
  loadPhotos();
</script>
</body></html>`;
}

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, async () => {
  const ip = getLocalIP();
  console.log('\n────────────────────────────────────────');
  console.log('📷  Fotos de Abuela — servidor iniciado');
  console.log('────────────────────────────────────────');
  console.log(`🖥  Panel (tú):      http://localhost:${PORT}`);
  console.log(`📱  QR para abuela:  http://localhost:${PORT}/qr`);
  console.log(`🌐  URL local:       http://${ip}:${PORT}/auth`);
  console.log('────────────────────────────────────────\n');
});
