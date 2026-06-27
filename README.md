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

Dentro de `.env`, cambia `THE_ODDS_API_KEY=put_your_key_here` por tu clave real. El ejemplo ya esta configurado para cuidar una cuota gratis: pocas ligas, una region y solo mercado principal. Cuando el proveedor responda eventos, la app cambia de `demo-fallback` a datos en vivo y mantiene la pantalla actualizada por streaming local.

Modo recomendado para empezar gratis con MLB + Copa Mundial FIFA:

```env
ODDS_REGIONS=us
ODDS_MARKETS=h2h
SPORT_KEYS=baseball_mlb,soccer_fifa_world_cup
POLL_INTERVAL_MS=10800000
```

Con esta configuracion se consulta MLB y Copa Mundial, mercado ganador del juego y una region. En The Odds API normalmente eso equivale a 1 credito por liga consultada cuando hay datos disponibles; con 500 creditos gratis y refresco cada 3 horas queda cerca de 480 creditos al mes si ambas ligas devuelven eventos todo el mes.

Si quieres solo la Copa Mundial, usa:

```env
SPORT_KEYS=soccer_fifa_world_cup
```

Variables utiles:

- `PORT`: puerto local, por defecto `4173`.
- `POLL_INTERVAL_MS`: intervalo de consulta al proveedor, por defecto `10800000` con API para cuidar cuota gratis.
- `LIVE_TICK_INTERVAL_MS`: intervalo del stream visual en la app, por defecto `1000`.
- `EVENT_CACHE_TTL_HOURS`: horas que conserva eventos recientes para marcarlos en vivo por horario aunque el proveedor ya no devuelva cuotas.
- `SPORT_KEYS`: lista separada por comas de deportes/ligas soportadas por el proveedor.
- `ODDS_REGIONS`: regiones de casas para The Odds API.
- `ODDS_MARKETS`: mercados de cuotas, por defecto `h2h`; usa `h2h,spreads,totals` solo si tienes mas cuota.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APP_BASE_URL`: activan inicio con Google real.
- `SESSION_TTL_HOURS`: duracion de sesion.

El conector usa el endpoint de cuotas de The Odds API con momios decimales y fechas ISO. Las plataformas como Draftea o Playdoit requieren una API oficial, feed autorizado o acuerdo de datos; si no hay clave autorizada, el dashboard mantiene el modo demo y deja visible el estado del proveedor.

## Seguridad y cuenta

- Registro con nombres, apellidos, usuario, correo y/o telefono.
- Correo, telefono y usuario son unicos para reducir multicuentas.
- Contrasenas con hash `scrypt`.
- Sesion en cookie `HttpOnly`, `SameSite=Strict` y token CSRF.
- Recuperacion por codigo de verificacion. En local, sin proveedor SMS/correo, los codigos quedan en `data/recovery-outbox.json`; en produccion debe conectarse un proveedor como Twilio, SendGrid, SES o equivalente.
- Perfil, configuracion de momios, fuente de cuotas, consejos de juego responsable y politicas de privacidad.
