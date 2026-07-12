# PickPro

Aplicacion web local para analizar eventos deportivos, comparar cuotas y generar estimaciones de probabilidad en tiempo real. No promete resultados perfectos: las predicciones son modelos probabilisticos y deben tratarse como apoyo analitico.

## Ejecutar

```powershell
cd C:\Users\emili\Documents\Codex\2026-06-26\ctre\outputs\edgepulse-predictor
.\start.ps1
```

Abre `http://localhost:4173`. La app pide registro o inicio de sesion antes de mostrar picks.

## Conectar datos reales

Por defecto usa un feed demo. Para cuotas reales con The Odds API:

```powershell
Copy-Item .env.example .env
notepad .env
.\start.ps1
```

Dentro de `.env`, cambia `THE_ODDS_API_KEY=put_your_key_here` por tu clave real. El ejemplo ya esta configurado para cuidar una cuota gratis: pocas ligas, una region y solo mercado principal. Cuando el proveedor responda eventos, la app muestra datos en vivo y mantiene la pantalla actualizada por streaming local. Si el proveedor no devuelve partidos reales, PickPro no inventa eventos.

Modo recomendado para una cuota gratis de 500 creditos, enfocado solo en futbol:

```env
ODDS_REGIONS=us
ODDS_MARKETS=h2h
SPORT_KEYS=soccer_mexico_ligamx,soccer_epl,soccer_uefa_champs_league,soccer_uefa_europa_league,soccer_spain_la_liga
POLL_INTERVAL_MS=43200000
SCORE_POLL_INTERVAL_MS=1800000
PROVIDER_CREDIT_RESERVE=60
```

La app consulta Liga MX, Premier League, Champions League, Europa League y La Liga. Usa una region y solo el mercado principal. Las cuotas se consultan como maximo cada 12 horas; los marcadores se consultan cada 30 minutos unicamente cuando hay un partido dentro de su ventana en vivo. Al llegar a la reserva configurada, PickPro deja de gastar creditos y conserva los ultimos eventos reales en cache.

Si quieres reducir aun mas el consumo, usa solo tres ligas:

```env
SPORT_KEYS=soccer_mexico_ligamx,soccer_epl,soccer_uefa_champs_league
```

Variables utiles:

- `PORT`: puerto local, por defecto `4173`.
- `POLL_INTERVAL_MS`: intervalo de consulta al proveedor; PickPro impone un minimo de `43200000` (12 horas) con la cuota gratis.
- `LIVE_TICK_INTERVAL_MS`: intervalo del stream visual en la app, por defecto `1000`.
- `SCORE_POLL_INTERVAL_MS`: refresco de marcadores oficiales solo durante partidos activos; minimo `1800000` (30 minutos).
- `PROVIDER_CREDIT_RESERVE`: creditos que PickPro intenta conservar sin gastar, por defecto `60`.
- `EVENT_CACHE_TTL_HOURS`: horas que conserva eventos recientes para marcarlos en vivo por horario aunque el proveedor ya no devuelva cuotas.
- `SPORT_KEYS`: lista separada por comas de deportes/ligas soportadas por el proveedor.
- `ODDS_REGIONS`: regiones de casas para The Odds API.
- `ODDS_MARKETS`: mercados de cuotas, por defecto `h2h`; usa `h2h,spreads,totals` solo si tienes mas cuota.
- `SESSION_TTL_HOURS`: duracion de sesion.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_KV_TABLE`: guardan usuarios en Supabase para que las cuentas sobrevivan reinicios y despliegues en Render.

El conector usa el endpoint de cuotas de The Odds API con momios decimales y fechas ISO. Las plataformas como Draftea o Playdoit requieren una API oficial, feed autorizado o acuerdo de datos; si no hay clave autorizada, el dashboard mantiene el modo demo y deja visible el estado del proveedor.

## Usuarios persistentes en Render

Render gratis no debe usarse como almacenamiento permanente de cuentas. Para que los registros no se pierdan, crea una tabla en Supabase:

```sql
create table if not exists public.pickpro_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
```

Luego agrega en Render:

```env
SUPABASE_URL=https://TU_PROYECTO.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu_service_role_key
SUPABASE_KV_TABLE=pickpro_kv
```

La clave `service_role` debe quedarse solo en variables de entorno del servidor.

## Seguridad y cuenta

- Registro con nombres, apellidos, usuario, correo y/o telefono.
- Correo, telefono y usuario son unicos para reducir multicuentas.
- Contrasenas con hash `scrypt`.
- Sesion en cookie `HttpOnly`, `SameSite=Strict` y token CSRF.
- Recuperacion por codigo de verificacion. En local, sin proveedor SMS/correo, los codigos quedan en `data/recovery-outbox.json`; en produccion debe conectarse un proveedor como Twilio, SendGrid, SES o equivalente.
- Perfil, configuracion de momios, fuente de cuotas, consejos de juego responsable y politicas de privacidad.
