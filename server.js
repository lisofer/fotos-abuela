const express = require('express');
const { google } = require('googleapis');
const QRCode = require('qrcode');
const http = require('http');

const app = express();
const PORT = 3000;

console.log('CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'OK' : 'FALTA');
console.log('CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'OK' : 'FALTA');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URL  = process.env.REDIRECT_URL || 'https://fotos-abuela-production.up.railway.app/auth/callback';

const oauth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

function getLocalIP() {
  return process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost';
}

// ─── RUTAS ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.send(panelFotos());
});

app.get('/qr', async (req, res) => {
  const localIP = getLocalIP();
  const authLink = localIP === 'localhost'
    ? `http://localhost:${PORT}/auth`
    : `https://${localIP}/auth`;
  const qrDataURL = await QRCode.toDataURL(authLink, { width: 300, margin: 2 });
  res.send(pageQR(authLink, qrDataURL));
});

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

// Google redirige aquí con el code → lo intercambiamos por access_token
// y lo mandamos al panel vía URL hash (nunca toca el servidor de nuevo)
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) return res.send(pageError('Permiso rechazado: ' + error));

  try {
    const { tokens } = await oauth2Client.getToken(code);
    // Redirigimos al panel con el token en el hash (no va al servidor)
    res.redirect(`/?token=${tokens.access_token}`);
  } catch (err) {
    res.send(pageError('Error al conectar con Google: ' + err.message));
  }
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
      --bg: #F7F4EF; --surface: #FFFFFF; --ink: #1C1917;
      --mid: #78716C; --accent: #C26E3A; --accent2: #6B7FBF;
      --border: #E5E1DA; --radius: 10px;
    }
    body { font-family: 'DM Sans', sans-serif; background: var(--bg); color: var(--ink); min-height: 100vh; }
    a { color: inherit; text-decoration: none; }
    .serif { font-family: 'DM Serif Display', serif; }
  </style>
`;

function pageQR(authLink, qrDataURL) {
  return `<!DOCTYPE html><html><head>${css}<title>QR para Abuela</title>
  <style>
    body { display:flex; align-items:center; justify-content:center; min-height:100vh; padding:2rem; }
    .card {
      background:var(--surface); border:1px solid var(--border); border-radius:16px;
      padding:2.5rem 2rem; max-width:420px; width:100%; text-align:center;
      display:flex; flex-direction:column; gap:1.2rem;
      box-shadow:0 4px 40px rgba(0,0,0,.07);
    }
    .tag { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase; color:var(--accent); font-weight:500; }
    h1 { font-family:'DM Serif Display',serif; font-size:1.9rem; line-height:1.2; }
    .qr-wrap { background:white; border-radius:12px; padding:1rem; display:inline-block; border:2px solid var(--border); margin:.5rem auto; }
    .qr-wrap img { display:block; width:220px; height:220px; }
    p { color:var(--mid); font-size:.88rem; line-height:1.6; }
    code { background:var(--bg); padding:.25rem .6rem; border-radius:6px; font-size:.8rem; word-break:break-all; color:var(--accent2); }
  </style></head><body>
  <div class="card">
    <span class="tag">Paso 1 de 2</span>
    <h1 class="serif">Muéstrale este QR a tu abuela</h1>
    <div class="qr-wrap"><img src="${qrDataURL}" alt="QR"></div>
    <p>Ella lo escanea, inicia sesión con Google y aprueba el permiso. Eso es todo.</p>
    <code>${authLink}</code>
  </div>
</body></html>`;
}

function pageError(msg) {
  return `<!DOCTYPE html><html><head>${css}<title>Error</title></head><body style="display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="text-align:center;padding:2rem">
    <div style="font-size:2.5rem">⚠️</div>
    <h1 class="serif" style="font-family:'DM Serif Display',serif;margin:.5rem 0">Algo salió mal</h1>
    <p style="color:var(--mid)">${msg}</p>
    <a href="/auth" style="color:var(--accent)">Intentar de nuevo</a>
  </div>
</body></html>`;
}

function panelFotos() {
  return `<!DOCTYPE html><html><head>${css}<title>Fotos de Abuela</title>
  <style>
    header {
      position:sticky; top:0; z-index:10;
      background:rgba(247,244,239,.92); backdrop-filter:blur(10px);
      border-bottom:1px solid var(--border);
      display:flex; align-items:center; gap:1rem;
      padding:.75rem 1.5rem; flex-wrap:wrap;
    }
    header h1 { font-family:'DM Serif Display',serif; font-size:1.3rem; flex:1; }
    #searchInput {
      border:1.5px solid var(--border); border-radius:999px;
      padding:.45rem 1rem; font-size:.85rem; font-family:inherit;
      background:var(--surface); outline:none; width:220px;
    }
    #searchInput:focus { border-color:var(--accent); }
    .pill {
      padding:.35rem .9rem; border-radius:999px; font-size:.8rem;
      border:1.5px solid var(--border); background:transparent;
      cursor:pointer; font-family:inherit; transition:all .2s;
    }
    .pill:hover { background:var(--ink); color:#fff; border-color:var(--ink); }
    .status { font-size:.78rem; color:var(--mid); display:flex; align-items:center; gap:.4rem; }
    .dot { width:8px; height:8px; border-radius:50%; background:var(--accent); animation:pulse 1.4s infinite; }
    @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
    .dot.done { background:#4CAF50; animation:none; }
    .grid {
      display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr));
      gap:6px; padding:1rem 1.2rem;
    }
    .thumb {
      aspect-ratio:1; overflow:hidden; border-radius:6px;
      background:var(--border); cursor:pointer; position:relative;
      transition:transform .18s, box-shadow .18s;
    }
    .thumb:hover { transform:scale(1.03); box-shadow:0 6px 24px rgba(0,0,0,.15); }
    .thumb img { width:100%; height:100%; object-fit:cover; display:block; }
    .thumb .overlay {
      position:absolute; inset:0; background:linear-gradient(to top,rgba(0,0,0,.55),transparent 50%);
      opacity:0; transition:opacity .2s; display:flex; align-items:flex-end; padding:.5rem;
    }
    .thumb:hover .overlay { opacity:1; }
    .overlay span { color:#fff; font-size:.72rem; }
    .video-badge {
      position:absolute; top:.4rem; right:.4rem;
      background:rgba(0,0,0,.6); color:#fff; font-size:.65rem;
      padding:.2rem .4rem; border-radius:4px;
    }
    .pagination { display:flex; justify-content:center; gap:.5rem; padding:1.5rem; flex-wrap:wrap; }
    .page-btn {
      padding:.4rem .9rem; border-radius:6px; border:1.5px solid var(--border);
      background:var(--surface); cursor:pointer; font-size:.83rem; transition:all .15s;
    }
    .page-btn:hover { background:var(--ink); color:#fff; border-color:var(--ink); }
    .page-btn.active { background:var(--accent); color:#fff; border-color:var(--accent); }
    #total { font-size:.82rem; color:var(--mid); text-align:center; padding:.5rem; }
    #lb {
      display:none; position:fixed; inset:0; background:rgba(0,0,0,.92);
      z-index:100; align-items:center; justify-content:center; flex-direction:column; gap:1rem;
    }
    #lb.open { display:flex; }
    #lb img { max-width:90vw; max-height:80vh; border-radius:8px; object-fit:contain; }
    #lb-info { color:#ccc; font-size:.82rem; }
    #lb-close { position:fixed; top:1rem; right:1.2rem; color:#fff; font-size:1.8rem; cursor:pointer; }
    #lb-dl {
      padding:.5rem 1.4rem; border-radius:999px; background:var(--accent);
      color:#fff; font-size:.85rem; cursor:pointer; border:none; font-family:inherit;
    }
    .login-screen {
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      min-height:100vh; text-align:center; padding:2rem; gap:1.5rem;
    }
    .btn {
      display:inline-flex; align-items:center; gap:.6rem;
      padding:.8rem 1.8rem; border-radius:999px;
      background:var(--ink); color:#fff; font-size:.9rem; font-weight:500;
      transition:background .2s; border:none; cursor:pointer; font-family:inherit;
    }
    .btn:hover { background:var(--accent); }
    footer { text-align:center; padding:1.5rem; color:var(--mid); font-size:.78rem; }
    .spinner { text-align:center; padding:3rem; color:var(--mid); }
    .empty { text-align:center; padding:4rem 2rem; color:var(--mid); }
  </style></head><body>

  <!-- Pantalla de login (se oculta cuando hay token) -->
  <div id="loginScreen" class="login-screen">
    <span style="font-size:.75rem;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:500">Álbum familiar</span>
    <h1 class="serif" style="font-size:clamp(2rem,5vw,3.2rem);line-height:1.1">Los recuerdos de <em style="color:var(--accent);font-style:italic">abuela</em></h1>
    <p style="color:var(--mid);max-width:36ch;line-height:1.6">Iniciá sesión con la cuenta de Google de tu abuela para ver sus fotos.</p>
    <a href="/auth" class="btn">Iniciar sesión con Google</a>
    <a href="/qr" class="btn" style="background:transparent;color:var(--ink);border:1.5px solid var(--border)">📱 Ver QR para su celular</a>
  </div>

  <!-- Panel de fotos (se muestra cuando hay token) -->
  <div id="photoPanel" style="display:none">
    <header>
      <h1 class="serif">📷 Fotos de Abuela</h1>
      <input id="searchInput" type="search" placeholder="Buscar…">
      <button class="pill" onclick="setFilter('all')">Todas</button>
      <button class="pill" onclick="setFilter('photo')">Fotos</button>
      <button class="pill" onclick="setFilter('video')">Videos</button>
      <span class="status" id="status">
        <span class="dot" id="dot"></span>
        <span id="statusTxt">Cargando…</span>
      </span>
      <button class="pill" style="margin-left:auto" onclick="logout()">Cerrar sesión</button>
    </header>
    <div id="total"></div>
    <div id="grid" class="grid"><div class="spinner">Cargando fotos…</div></div>
    <div id="pagination" class="pagination"></div>
  </div>

  <!-- Lightbox -->
  <div id="lb">
    <span id="lb-close" onclick="closeLb()">✕</span>
    <img id="lb-img" src="" alt="">
    <div id="lb-info"></div>
    <button id="lb-dl" onclick="downloadFull()">⬇ Descargar original</button>
  </div>

  <footer>Solo lectura · las fotos no se guardan en este servidor</footer>

<script>
  let accessToken = null;
  let allPhotos = [];
  let currentPage = 0;
  let currentFilter = 'all';
  let currentQuery = '';
  let currentFullUrl = '';
  const LIMIT = 40;

  // Al cargar, chequear si hay token en la URL
  window.addEventListener('load', () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      accessToken = token;
      // Limpiar el token de la URL sin recargar
      window.history.replaceState({}, '', '/');
      showPanel();
      loadAllPhotos();
    }
    // Chequear sessionStorage por si recargó
    else if (sessionStorage.getItem('gtoken')) {
      accessToken = sessionStorage.getItem('gtoken');
      showPanel();
      loadAllPhotos();
    }
  });

  function showPanel() {
    sessionStorage.setItem('gtoken', accessToken);
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('photoPanel').style.display = 'block';
  }

  function logout() {
    sessionStorage.removeItem('gtoken');
    window.location.href = '/';
  }

  // Llama directo a la API de Google Photos desde el navegador
  async function loadAllPhotos() {
    const dot = document.getElementById('dot');
    const txt = document.getElementById('statusTxt');
    dot.className = 'dot';
    txt.textContent = 'Sincronizando fotos…';

    allPhotos = [];
    let pageToken = null;

    try {
      do {
        const body = { pageSize: 100 };
        if (pageToken) body.pageToken = pageToken;

        const res = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(body)
        });

        const data = await res.json();
        if (data.error) throw new Error(data.error.message);
        if (data.mediaItems) allPhotos.push(...data.mediaItems);
        pageToken = data.nextPageToken || null;
      } while (pageToken);

      dot.className = 'dot done';
      txt.textContent = 'Listo · ' + new Date().toLocaleTimeString();
      renderPage();
    } catch (err) {
      dot.className = 'dot';
      dot.style.background = '#e53e3e';
      txt.textContent = 'Error: ' + err.message;
    }
  }

  function setFilter(f) {
    currentFilter = f;
    currentPage = 0;
    renderPage();
  }

  function renderPage() {
    let items = allPhotos;
    if (currentQuery) {
      items = items.filter(i =>
        (i.filename||'').toLowerCase().includes(currentQuery) ||
        (i.mediaMetadata?.creationTime||'').includes(currentQuery)
      );
    }
    if (currentFilter === 'photo') items = items.filter(i => !i.mimeType?.startsWith('video'));
    if (currentFilter === 'video') items = items.filter(i => i.mimeType?.startsWith('video'));

    document.getElementById('total').textContent =
      items.length + ' archivo' + (items.length !== 1 ? 's' : '');

    const slice = items.slice(currentPage * LIMIT, currentPage * LIMIT + LIMIT);

    if (!slice.length) {
      document.getElementById('grid').innerHTML = '<div class="empty">No se encontraron archivos</div>';
      document.getElementById('pagination').innerHTML = '';
      return;
    }

    document.getElementById('grid').innerHTML = slice.map(p => \`
      <div class="thumb" onclick="openLb('\${p.baseUrl}=w800', '\${p.baseUrl}=d', '\${p.filename}', '\${p.mediaMetadata?.creationTime||''}')">
        <img src="\${p.baseUrl}=w400-h400-c" alt="\${p.filename}" loading="lazy">
        <div class="overlay"><span>\${formatDate(p.mediaMetadata?.creationTime)}</span></div>
        \${p.mimeType?.startsWith('video') ? '<span class="video-badge">▶ video</span>' : ''}
      </div>
    \`).join('');

    renderPagination(items.length);
  }

  function renderPagination(total) {
    const pages = Math.ceil(total / LIMIT);
    if (pages <= 1) { document.getElementById('pagination').innerHTML = ''; return; }
    let html = '';
    if (currentPage > 0) html += \`<button class="page-btn" onclick="goPage(\${currentPage-1})">← Anterior</button>\`;
    const start = Math.max(0, currentPage - 2);
    const end = Math.min(pages - 1, currentPage + 2);
    for (let i = start; i <= end; i++) {
      html += \`<button class="page-btn \${i===currentPage?'active':''}" onclick="goPage(\${i})">\${i+1}</button>\`;
    }
    if (currentPage < pages - 1) html += \`<button class="page-btn" onclick="goPage(\${currentPage+1})">Siguiente →</button>\`;
    document.getElementById('pagination').innerHTML = html;
  }

  function goPage(p) { currentPage = p; renderPage(); window.scrollTo(0,0); }

  function formatDate(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleDateString('es-AR', { year:'numeric', month:'short', day:'numeric' }); }
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
    a.target = '_blank';
    a.click();
  }

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLb(); });

  let searchTimer;
  document.getElementById('searchInput').addEventListener('input', e => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentQuery = e.target.value.toLowerCase(); currentPage = 0; renderPage(); }, 400);
  });
</script>
</body></html>`;
}

// ─── ARRANQUE ────────────────────────────────────────────────────────────────
http.createServer(app).listen(PORT, () => {
  const ip = getLocalIP();
  console.log('\n────────────────────────────────────────');
  console.log('📷  Fotos de Abuela — servidor iniciado');
  console.log('────────────────────────────────────────');
  console.log(\`🖥  Panel:       http://localhost:\${PORT}\`);
  console.log(\`📱  QR:          http://localhost:\${PORT}/qr\`);
  console.log(\`🌐  URL pública: https://\${ip}/auth\`);
  console.log('────────────────────────────────────────\n');
});