# Poner el prototipo online

Para que el cliente lo mire desde su casa durante semanas, sin depender de que tu máquina
esté prendida.

---

## Lo que hay que entender antes de elegir hosting

**La base es un archivo.** `data/fabrica.db` es SQLite: no hay servidor de base de datos
aparte. Eso trae una consecuencia que decide todo lo demás:

> **El hosting tiene que darte un disco persistente.**

Sin disco persistente, cada despliegue empieza con la base vacía y el cliente pierde todo lo
que haya cargado. Eso descarta:

- El plan gratis de **Render** (sin disco; además duerme la app)
- Cualquier cosa **serverless** (Vercel, Netlify Functions, Cloudflare Workers)
- Cualquier hosting **estático** (GitHub Pages) — la app tiene 39 endpoints, necesita Node

Y trae una segunda consecuencia: **una sola instancia**. Dos procesos escribiendo el mismo
archivo SQLite se corrompen entre sí. No escalar horizontalmente no es una limitación acá —
la fábrica tiene seis tablets, no seis mil.

---

## Antes de exponerlo: la clave

```bash
ACCESO_CLAVE="lo-que-elijas" npm start
```

Sin esa variable el sistema **no pide nada**, que es lo correcto en local y dentro de la red
de la fábrica. Con ella, pide usuario y clave para todo (`ACCESO_USUARIO` por defecto es
`belgrano`).

**No la subas al repo.** Se carga como variable de entorno / secret del hosting.

> En la instalación real en planta la configuración correcta es otra: tablets sin clave y
> escritorio con clave. Son dos amenazas distintas — en planta el riesgo es que alguien
> registre a nombre de otro; en internet, que un desconocido anule pedidos. El operario con
> guantes no puede tipear una contraseña.

---

## Opción recomendada: Fly.io

Ya está el `fly.toml` y el `Dockerfile` en el repo.

```bash
fly launch --no-deploy            # crea la app, no despliega todavía
fly volumes create datos --size 1 # 1 GB sobra: la base de un año pesa unos pocos MB
fly secrets set ACCESO_CLAVE="la-clave-que-le-pasás-al-cliente"
fly deploy
```

La región ya está en `eze` (Buenos Aires), que es lo que importa para que responda rápido
desde la fábrica.

## Alternativa igual de válida: Railway

Más simple de arrancar, un poco más caro a la larga.

1. Conectás el repo de GitHub.
2. Railway detecta el `Dockerfile` solo.
3. Agregás un **Volume** montado en `/data`.
4. Variables: `ACCESO_CLAVE` (y nada más — `DB_PATH` y `BACKUP_DIR` ya vienen del Dockerfile).

## Si preferís un VPS

Cualquier máquina con Docker:

```bash
docker build -t fabrica .
docker run -d --restart=always -p 80:3000 \
  -v /srv/fabrica:/data \
  -e ACCESO_CLAVE="la-clave" \
  fabrica
```

Falta ponerle HTTPS adelante (Caddy resuelve el certificado solo).

---

## El primer arranque

`npm start` corre el seed antes de levantar el servidor, y el seed es idempotente. En un
volumen vacío eso carga marcas, productos, tipos de queso, clientes y operarios de ejemplo.
En un volumen con datos, no toca nada.

Después del primer despliegue, cargá los operarios reales:

```bash
fly ssh console -C "npm run operarios -- lecheria 'Juan Pérez' 'Carlos Gómez'"
```

---

## Backups en la nube — leer esto

El servidor hace un backup al arrancar y otro a las 16:30, y los guarda en
`/data/backups/`, que es **el mismo volumen que la base**.

Eso protege contra *"borré algo sin querer"*. **No protege contra perder el volumen.**

Para el prototipo alcanza. Antes de que esto sea el sistema real de la fábrica, los backups
tienen que salir del servidor — un `fly ssh sftp get` programado, un bucket, o lo que sea,
pero afuera.

```bash
# bajar el backup más reciente a tu máquina
fly ssh console -C "ls -t /data/backups" | head -1
fly ssh sftp get /data/backups/<archivo>
```

---

## Qué NO subir al repo

Ya está en el `.gitignore`, pero conviene saber por qué:

| Excluido | Motivo |
|---|---|
| `requerimientos/*.ogg` | Notas de voz del cliente hablando de su negocio. Las transcripciones sí se suben. |
| `data/` | La base y los backups. Nunca al repo. |
| `node_modules/` | Se reconstruye con `npm ci`. |

Y la clave de acceso va como variable de entorno, nunca en el código.

**El repo conviene que sea privado** igual: tiene el catálogo de productos, las marcas y la
estructura de costos implícita de un cliente real.
