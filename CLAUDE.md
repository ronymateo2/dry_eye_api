# CLAUDE.md — dry-eye-api

## Qué es este proyecto

**NeuroEye Log (Weqe) — API** es el backend de una PWA de salud para pacientes con ojo seco neuropático. Registra dolor en 5 zonas, gotas oculares, viales de gotas, sueño, higiene palpebral, síntomas, triggers y observaciones clínicas. Calcula correlaciones Spearman entre sueño y dolor.

**Público objetivo:** pacientes hispanohablantes. Toda la UI del cliente está en español.

---

## Stack

| Capa | Tecnología |
|---|---|
| Runtime | Cloudflare Workers |
| Framework | Hono 4.6 |
| Base de datos | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM (`drizzle-orm/d1`) |
| Auth | Google OAuth2 + JWT HS256 (Web Crypto API) |

---

## Comandos

```bash
npm run dev              # wrangler dev --port 8787
npm run build            # dry-run wrangler deploy
npm run deploy           # wrangler deploy (producción)
npm run db:migrate:local # Aplica migraciones a D1 local
npm run db:migrate       # Aplica migraciones a D1 producción
```

---

## Estructura

```
src/
├── index.ts              # Entry point — app Hono, CORS, rutas montadas
├── middleware/
│   └── auth.ts           # Valida Bearer JWT, inyecta userId + userTimezone en contexto
├── routes/
│   ├── auth.ts           # GET /auth/google, GET /auth/google/callback
│   ├── user.ts           # GET/PUT /user/me
│   ├── check-ins.ts      # POST /check-ins
│   ├── drops.ts          # POST /drops, GET /drops/last
│   ├── drop-types.ts     # CRUD + reorder /drop-types
│   ├── sleep.ts          # GET/PUT /sleep/today
│   ├── hygiene.ts        # POST /hygiene, GET /hygiene/today|dashboard|sessions
│   ├── triggers.ts       # POST /triggers
│   ├── symptoms.ts       # POST /symptoms
│   ├── observations.ts   # CRUD + occurrences /observations
│   ├── medications.ts    # CRUD + reorder /medications
│   ├── dashboard.ts      # GET /dashboard (analytics)
│   ├── history.ts        # GET /history, GET /history/more
│   ├── report.ts         # GET /report (PDF-ready data)
│   ├── vials.ts          # CRUD /vials
│   └── vial-instances.ts # POST /vial-instances, GET /vial-instances/active|history
├── db/
│   ├── schema.ts         # Drizzle ORM table definitions (sqlite-core)
│   └── index.ts          # getDb(d1) factory — exporta todas las tablas
└── lib/
    ├── jwt.ts            # signToken / verifyToken / makePayload (HS256)
    ├── utils.ts          # getDayKey, dayKeyToUtcStart, buildLastDayKeys
    ├── stats.ts          # getSpearmanCorrelation
    └── domain-types.ts   # TriggerType union
```

---

## Variables de entorno (`.dev.vars`)

```
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
JWT_SECRET=
FRONTEND_URL=http://localhost:5173
```

## Bindings Wrangler

- `DB` → Cloudflare D1, nombre `weqe-db`

---

## Patrones de respuesta

```json
// Éxito
{ "ok": true, ...data }

// Error
HTTP 400 / 401 / 404  +  texto plano o JSON con mensaje
```

---

## Convenciones API

- Timestamps en **UTC ISO 8601**
- `day_key` = `YYYY-MM-DD` en timezone del usuario (`dy_users.timezone`, default `America/Bogota`)
- UUIDs generados en el **cliente** — endpoints usan `ON CONFLICT(id) DO UPDATE` (soporte offline-first)
- Consultas complejas usan `DB.batch()` para paralelismo
- **ORM**: Drizzle ORM — usar query builder tipado; `sql\`...\`` solo para expresiones complejas (date arithmetic, NULLS LAST, COALESCE)
- **No usar** `c.env.DB.prepare().bind()` directamente — siempre pasar por `getDb(c.env.DB)`

---

## Base de datos (D1 / SQLite)

Migraciones en `migrations/`. Schema en `src/db/schema.ts` (`sqlite-core`). Para migrar a Postgres: cambiar imports a `pg-core` y ajustar driver.

### Tablas principales

| Tabla | Propósito |
|---|---|
| `dy_users` | Perfiles de usuario + timezone |
| `dy_accounts` | Cuentas OAuth (Google) |
| `dy_check_ins` | Check-ins de dolor: 5 zonas + stress (0-10) + trigger + notas |
| `dy_drops` | Aplicaciones de gotas (cantidad, ojo, tipo) |
| `dy_drop_types` | Tipos de gota por usuario (sort_order) |
| `dy_sleep` | Sueño diario: `day_key` único, horas, calidad |
| `dy_triggers` | Triggers: tipo (8 opciones) + intensidad (1-3) |
| `dy_symptoms` | Síntomas registrados |
| `dy_medications` | Medicamentos con dosis, frecuencia, notas |
| `dy_clinical_observations` | Tipos de observación clínica definidos por el usuario |
| `dy_observation_occurrences` | Instancias de observaciones (intensidad 1-10, duración) |
| `dy_lid_hygiene` | Sesiones de higiene palpebral (raw) |
| `dy_hygiene_daily` | Resumen diario de higiene |
| `dy_hygiene_stats` | Estadísticas globales de higiene por usuario |
| `dy_vials` | Configuración de viales desechables por tipo de gota (duración en horas) |
| `dy_vial_instances` | Instancias de viales abiertos/descartados (started_at, ended_at, status) |

### Enums usados en SQL

- `sleep_quality`: `muy_malo | malo | regular | bueno | excelente`
- `eye`: `left | right | both`
- `trigger_type`: `climate | humidifier | stress | screens | tv | ergonomics | exercise | other`
- `hygiene_status`: `completed | skipped | partial`
- `friction_type`: `mental | logistics | none`
- `observation_eye`: `right | left | both | none`

---

## Convenciones de código

- **TypeScript strict** activado
- **Sin comentarios** salvo que el WHY no sea obvio
- Simplicity First — mínimo código que resuelve el problema
- Cambios quirúrgicos — no "mejorar" código adyacente que no es parte de la tarea
