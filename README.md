# dry-eye-api

Backend de **NeuroEye Log (Weqe)** — PWA de salud para pacientes con ojo seco neuropático.

Construido con **Hono 4.6** corriendo en **Cloudflare Workers** con base de datos **D1 (SQLite)**.

## Stack

- [Hono](https://hono.dev/) — framework web ultraligero para edge
- [Cloudflare Workers](https://workers.cloudflare.com/) — runtime serverless
- [Cloudflare D1](https://developers.cloudflare.com/d1/) — SQLite en el edge
- [Drizzle ORM](https://orm.drizzle.team/) — ORM tipado para D1
- Google OAuth2 + JWT HS256 (Web Crypto API)

## Requisitos

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- Cuenta de Cloudflare con D1 habilitado

## Setup local

1. Clona el repo e instala dependencias:
   ```bash
   npm install
   ```

2. Crea el archivo `.dev.vars` con las variables de entorno:
   ```
   GOOGLE_CLIENT_ID=tu_client_id
   GOOGLE_CLIENT_SECRET=tu_client_secret
   JWT_SECRET=string_aleatorio_seguro
   FRONTEND_URL=http://localhost:5173
   ```

3. Crea y migra la base de datos local:
   ```bash
   npm run db:migrate:local
   ```

4. Levanta el servidor de desarrollo:
   ```bash
   npm run dev
   # → http://localhost:8787
   ```

## Comandos

| Comando | Descripción |
|---|---|
| `npm run dev` | Servidor local en puerto 8787 |
| `npm run build` | Build de prueba (dry-run) |
| `npm run deploy` | Deploy a Cloudflare Workers |
| `npm run db:migrate:local` | Aplica migraciones a D1 local |
| `npm run db:migrate` | Aplica migraciones a D1 producción |

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/auth/google` | Inicia flujo OAuth |
| `GET` | `/auth/google/callback` | Callback OAuth, retorna JWT |
| `GET` | `/user/me` | Perfil del usuario |
| `POST` | `/check-ins` | Registra dolor (5 zonas) |
| `POST` | `/drops` | Registra aplicación de gotas |
| `GET` | `/drops/last` | Última gota registrada |
| `GET/PUT` | `/sleep/today` | Sueño del día |
| `GET` | `/dashboard` | Analytics + correlaciones Spearman |
| `GET` | `/history` | Historial paginado |
| `GET` | `/report` | Datos para reporte PDF |

Todos los endpoints protegidos requieren `Authorization: Bearer <jwt>`.

## Estructura

```
src/
├── index.ts          # Entry point, CORS, rutas montadas
├── middleware/auth.ts # Validación JWT
├── routes/           # Un archivo por recurso
├── db/
│   ├── schema.ts     # Tablas Drizzle (sqlite-core)
│   └── index.ts      # getDb(d1) factory
└── lib/              # JWT, utils, stats, tipos
migrations/           # SQL aplicado con wrangler d1
```

## Deploy

```bash
# 1. Configura los secrets en Cloudflare
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put JWT_SECRET

# 2. Crea la base de datos (primera vez)
npm run db:create

# 3. Aplica migraciones en producción
npm run db:migrate

# 4. Deploy
npm run deploy
```

## Cliente web

La PWA que consume esta API vive en [dry_eye_web](https://github.com/ronymateo2/dry_eye_web).
