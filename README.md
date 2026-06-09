# 📷 Fotos de Abuela

Panel web para ver y organizar las fotos de Google Photos de tu abuela,
usando OAuth 2.0 — sin apps, sin instalar nada en su celular.

---

## Flujo completo

```
Tú abres http://localhost:3000/qr
→ Sale un QR
→ Tu abuela lo escanea con su celular
→ Inicia sesión con Google y aprueba el permiso
→ Tú recargas http://localhost:3000 y ves sus fotos
```

---

## Configuración (una sola vez)

### 1. Google Cloud Console

1. Ve a https://console.cloud.google.com y crea un proyecto nuevo (ej: `fotos-abuela`)
2. Busca y habilita la **"Photos Library API"**
3. Ve a **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
4. Tipo de aplicación: **Aplicación web**
5. Nombre: el que quieras
6. En **"URIs de redireccionamiento autorizados"** agrega:
   ```
   http://localhost:3000/auth/callback
   ```
7. Guarda y copia el **Client ID** y **Client Secret**
8. En **"Pantalla de consentimiento OAuth"**:
   - Tipo de usuario: **Externo**
   - Agrega el correo de tu abuela en "Usuarios de prueba"

### 2. Edita server.js

Abre `server.js` y reemplaza estas líneas con tus credenciales:

```js
const CLIENT_ID     = 'TU_CLIENT_ID.apps.googleusercontent.com';
const CLIENT_SECRET = 'TU_CLIENT_SECRET';
```

### 3. Instala y ejecuta

```bash
npm install
npm start
```

---

## Uso

| URL | Para quién | Qué hace |
|-----|-----------|----------|
| `http://localhost:3000` | Tú | Panel con todas las fotos |
| `http://localhost:3000/qr` | Tú | Genera el QR para tu abuela |
| `http://IP_LOCAL:3000/auth` | Tu abuela | Página de inicio de sesión con Google |

---

## Notas de privacidad

- Las fotos **no se guardan** en el servidor. Solo se muestran usando las URLs temporales de Google Photos (válidas ~1 hora).
- El servidor corre en tu computadora (`localhost`), las fotos nunca salen de la red de Google.
- Si quieres descargar fotos, usa el botón "⬇ Descargar original" en el panel.
- Para cerrar la sesión: `http://localhost:3000/logout`
