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
COOKIE_SECURE=true
ODDS_REGIONS=us
ODDS_MARKETS=h2h
SPORT_KEYS=baseball_mlb,soccer_fifa_world_cup
POLL_INTERVAL_MS=10800000
LIVE_TICK_INTERVAL_MS=1000
SCORE_POLL_INTERVAL_MS=300000
EVENT_CACHE_TTL_HOURS=36
SESSION_TTL_HOURS=12
```

6. Para que los registros de usuarios no se pierdan en Render, conecta una base de datos gratis en Supabase y agrega tambien:

```env
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
SUPABASE_KV_TABLE=pickpro_kv
```

En Supabase, abre `SQL Editor` y ejecuta:

```sql
create table if not exists public.pickpro_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

Guarda `SUPABASE_SERVICE_ROLE_KEY` solo en Render. No la subas a GitHub ni la pegues en el frontend.

## Dominio propio

Para un dominio como `pickpro.mx` o `tupickpro.com` normalmente debes comprar el dominio. Si ya tienes uno, en Render entra a `Settings > Custom Domains`, agrega tu dominio y copia los registros DNS que te pida Render en el panel donde compraste el dominio.

## Importante

Si no configuras Supabase, la app guarda usuarios en `data/users.json`. Eso sirve para pruebas locales, pero en hosting gratis los archivos pueden reiniciarse en despliegues o reinicios. En Render usa Supabase para cuentas reales.
