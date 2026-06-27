# Publicar PickPro

## Opcion rapida para probar en telefono

Sirve para ver la app desde tu celular sin comprar dominio. Tu computadora debe estar prendida y el servidor local debe seguir abierto.

1. Inicia PickPro:

```powershell
cd C:\Users\emili\Documents\Codex\2026-06-26\ctre\outputs\edgepulse-predictor
.\start.ps1
```

2. Instala Cloudflare Tunnel o usa la descarga oficial de `cloudflared`.

3. En otra ventana de PowerShell ejecuta:

```powershell
cloudflared tunnel --url http://localhost:4173
```

4. Copia la URL `https://...trycloudflare.com` que aparezca y abre esa URL en tu telefono.

## Opcion recomendada para tener URL publica

Render puede publicar esta app como servicio Node y te da un subdominio HTTPS gratis tipo:

```text
https://pickpro.onrender.com
```

Pasos:

1. Crea un repositorio en GitHub.

2. Sube el proyecto. No subas `.env`; ya esta protegido por `.gitignore`.

```powershell
cd C:\Users\emili\Documents\Codex\2026-06-26\ctre\outputs\edgepulse-predictor
git init
git add .
git commit -m "Publicar PickPro"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/pickpro.git
git push -u origin main
```

3. En Render crea un `Web Service` conectado a ese repositorio.

4. Usa:

```text
Build Command: npm install
Start Command: npm start
```

5. En Environment Variables agrega:

```env
THE_ODDS_API_KEY=tu_clave
APP_BASE_URL=https://TU_URL_DE_RENDER
COOKIE_SECURE=true
ODDS_REGIONS=us
ODDS_MARKETS=h2h
SPORT_KEYS=baseball_mlb,soccer_fifa_world_cup
POLL_INTERVAL_MS=10800000
LIVE_TICK_INTERVAL_MS=1000
EVENT_CACHE_TTL_HOURS=36
SESSION_TTL_HOURS=12
```

6. Si luego conectas Google login, agrega tambien:

```env
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

## Dominio propio

Para un dominio como `pickpro.mx` o `tupickpro.com` normalmente debes comprar el dominio. Si ya tienes uno, en Render entra a `Settings > Custom Domains`, agrega tu dominio y copia los registros DNS que te pida Render en el panel donde compraste el dominio.

## Importante

La app actual guarda usuarios en `data/users.json`. Eso sirve para pruebas, pero en un hosting gratis los archivos pueden reiniciarse en despliegues o reinicios. Antes de abrir registros a muchas personas, conviene migrar usuarios a una base de datos como Supabase, Neon, Postgres o SQLite con disco persistente.
