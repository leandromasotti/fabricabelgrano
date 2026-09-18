# Fábrica Belgrano — Seguimiento de producción

Sistema de registro de producción para **Lácteos Del Salado SRL** (marca *Lácteos Belgrano*),
General Belgrano, Buenos Aires. Reemplaza el registro en papel y cartón por tablets amuradas en
cada sector de la planta.

**Estado: circuito completo** — lechería, quesería, saladero, envasado y armado de pedidos,
más despacho, reportes y un tablero para pantalla LED de planta.
Ver [docs/04-plan-mvp.md](docs/04-plan-mvp.md) para el alcance y las fases siguientes.

## Cómo correrlo

### La primera vez

```bash
npm install          # backend
npm run web:install  # escritorio (React)
npm run web:build    # compila el escritorio a public/app
npm run seed         # marcas, productos, tipos de queso y operarios de ejemplo
npm start            # http://localhost:3000
```

El escritorio queda en **`/app`** y las tablets en la raíz (`/lecheria.html` y compañía).

### El día a día

```bash
npm run dev          # servidor con recarga al guardar
```

Con eso alcanza para usar el sistema entero, porque `public/app` ya está compilado.
**Sólo hace falta `npm run web:build` después de tocar algo dentro de `web/`.**

### Trabajando sobre el escritorio

Dos terminales: el servidor por un lado y Vite por el otro, que recarga el navegador
al guardar sin recompilar nada.

```bash
npm run dev          # terminal 1: API en :3017
npm run web          # terminal 2: front en :5173, con proxy de /api al 3017
```

Se entra por **http://localhost:5173/app**. Al terminar, `npm run web:build` para que
el servidor sirva la versión compilada.

Vite reenvía al servidor de siempre todo lo que no es del escritorio: la API, las tablets
de planta, el tablero LED y el lanzador. Sin eso, abrir el tablero desde `:5173` devolvía
un error de Vite —*"did you mean to visit /app/tablero.html"*— que manda a una URL que no
existe. **Los dos puertos muestran el sistema completo**, sólo que `:5173` recarga el
escritorio al guardar.

### Qué base usa

```
.env.local con DATABASE_URL  ->  PostgreSQL
sin .env.local               ->  SQLite (data/fabrica.db)
```

Los scripts de npm cargan `.env.local` solos. Volver a SQLite es renombrar ese archivo:
no hay nada que cambiar en el código. Para levantar el PostgreSQL local:

```bash
docker start postgres   # si el contenedor ya existe
```

`.env.local` está gitignoreado porque lleva la contraseña. El contenido es:

```
DATABASE_URL=postgres://postgres:LA_CLAVE@localhost:5432/fabrica_belgrano
PORT=3017
```

Antes de usarlo en la fábrica, cargar los operarios reales y verificar los backups:

```bash
# Los operarios se cargan desde /app/maestros, agrupados por sector.
# El script sigue existiendo para cargar muchos de una vez:
npm run operarios -- lecheria "Juan Pérez" "Carlos Gómez"
npm run backup                                           # copia manual
```

El servidor hace un backup **al arrancar** y otro **a las 16:30** (la fábrica trabaja de 8 a 16),
conservando las últimas 30 copias en `data/backups/`.

> ⚠️ **No copiar `fabrica.db` a mano.** SQLite corre en modo WAL: lo recién escrito vive en
> `fabrica.db-wal` hasta el checkpoint. En este proyecto el `.db` llegó a pesar 28 KB con un `-wal`
> de 2 MB — copiar solo el `.db` se hubiera llevado casi nada. `npm run backup` usa `VACUUM INTO`,
> que escribe una base completa y consistente sin bloquear a nadie.
>
> Y un backup en el mismo disco que la base no es un backup: hay que sacarlo del servidor.

Para ver los reportes con volumen realista, hay un generador de datos de ejemplo.
**No correrlo contra la base de la fábrica:**

```bash
npm run demo          # 30 días de producción simulada
npm run demo -- 90    # 90 días
```

### Arrancar de cero

Vacía la producción registrada —pallets, tinas, saladero, maduración, envasado, pedidos,
recepciones— y **conserva los catálogos**: operarios, marcas, productos, quesos, formatos
de envase, clientes y tambos. Es lo que hay que correr antes del piloto, para empezar con
todo configurado pero sin un solo registro de prueba.

```bash
npm run limpiar               # NO borra: muestra qué borraría
npm run limpiar -- --confirmar # borra
```

El modo por defecto es la simulación a propósito: este es justo el script que uno no
quiere haber ejecutado sin querer. Además se niega a correr si `DATABASE_URL` apunta a
una base que no sea local, y borra todo dentro de una transacción — o queda vacío del
todo, o queda como estaba. Los `id` vuelven a empezar en 1.

Para usar otro puerto: `PORT=3017 npm start`

| Pantalla | URL | Para quién |
|---|---|---|
| Lanzador | `/` | Solo para probar; cada tablet abre su sector en modo kiosco |
| Lechería | `/lecheria.html` | Tablet amurada: pallets por marca y tipo |
| Quesería | `/queseria.html` | Tablet amurada: tinas y piezas obtenidas |
| Saladero | `/saladero.html` | Tablet amurada: entrada y salida de sal |
| Maduración | `/maduracion.html` | Tablet amurada: entrada y salida de cámara, con estado por lote |
| Envasado | `/envasado.html` | Tablet amurada: lo que ya está listo para envasar |
| Armado de pedidos | `/pedidos.html` | Tablet amurada: armar, pesar pieza por pieza y cerrar |
| **Tablero LED** | `/tablero.html` | **Pantalla colgada en planta. No se toca, se mira.** |

Y el escritorio, que corre en React bajo `/app`:

| Pantalla | URL | Para quién |
|---|---|---|
| Nuevo pedido | `/app/nuevo-pedido` | Administración: alta e impresión de las hojas de armado |
| Despacho | `/app/despacho` | Encargado: pedidos en tiempo real y facturación |
| Reportes | `/app/reportes` | Encargado: búsqueda por fecha y tipo, gráficos, rendimiento |
| Leche cruda | `/app/leche-cruda` | Encargado: litros por tambo, para liquidar |
| Envases | `/app/envases` | Encargado: litros de cada formato de pallet y kilos por bin |
| Días de maduración | `/app/maduracion-dias` | Encargado: corregir los días por tipo de queso |
| Datos maestros | `/app/maestros` | Encargado: operarios por sector, clientes, tambos y marcas |
| Tablero LED | `/app/tablero-led` | Encargado: qué secciones muestra la pantalla de planta |
| Consulta de lechería | `/app/consulta` | Encargado: detalle del día y anulaciones |

> Las versiones anteriores de esas siete siguen en disco (`/reportes.html`,
> `/despacho.html`, …) y andan. Si algo del escritorio nuevo falla, se entra por ahí y
> se sigue trabajando.

## Stack

Node + Express, con **PostgreSQL o SQLite** según haya `DATABASE_URL`. Los dos motores exponen
la misma API asíncrona y el código de arriba no sabe cuál está usando.

El front son **dos cosas distintas a propósito**:

- **Tablets de planta** (`public/*.html`): JS vanilla, sin build step, con service worker y cola
  offline. Tienen que arrancar instantáneo y funcionar sin red — es lo que no puede fallar a las
  6 de la mañana en lechería. Se dejan como están al menos hasta el piloto.
- **Escritorio** (`web/`): React 19 + TypeScript estricto + Vite, Tailwind v4 y TanStack Query.
  Acá hay tablas, filtros, impresión y siete pantallas: es donde un framework rinde y donde el
  riesgo de rehacer es bajo.

El razonamiento completo está en [docs/08-arquitectura-nube.md](docs/08-arquitectura-nube.md).

## Estructura

```
server/
  db.js          elige el motor según DATABASE_URL
  db-pg.js       adaptador PostgreSQL (traduce el dialecto en un solo lugar)
  db-sqlite.js   adaptador SQLite, con el esquema y las migraciones
  seed.js        datos iniciales
  demo.js        generador de datos de ejemplo (solo desarrollo)
  index.js       API REST
public/
  comun.js       cola offline, estado de red, reloj corregido, helpers de UI
  lecheria.*     tablet de lechería
  queseria.*     tablet de quesería (teclado numérico para el rinde)
  saladero.*     tablet de saladero (tinas ordenadas por tiempo de espera)
  reportes.*     gráficos y búsqueda para el encargado
  styles.css     diseño para uso con guantes
  sw.js          service worker (cachea el app shell)
  app/           ¡generado! salida de `npm run web:build`, no se versiona
web/             escritorio en React + TS
  src/api/       tipos del dominio y hooks de datos
  src/graficos/  los gráficos, en SVG declarativo
  src/pantallas/ una por pantalla
  src/ui/        primitivos compartidos y formato de números
migraciones/     esquema PostgreSQL y migración desde SQLite
docs/            relevamiento, requerimientos, preguntas y plan
requerimientos/  audios originales y transcripciones
```

## Decisiones que conviene conocer antes de tocar el código

**La hora la pone el servidor.** Las tablets amuradas se desconfiguran y nadie las mira. Acá el
horario no es un metadato: se usa para controlar la evolución del pH entre producción y saladero.
La tablet calcula su desfasaje contra el servidor y lo aplica solo cuando registra sin red.

**`client_id` es UNIQUE y eso es la sincronización offline.** Cada registro lleva un UUID generado
en la tablet. Si la cola reenvía algo que ya llegó, el servidor devuelve el original en vez de
duplicarlo. Sin eso, un reintento crea pallets fantasma.

**Nunca se borra un registro: se marca `anulado`.** Cuesta lo mismo y no se pierde información.

**La confirmación es optimista.** El operario ve "PALLET REGISTRADO" antes de que el POST vuelva.
Ya soltó el pallet y agarró el siguiente; que el dato llegue es problema del sistema, no suyo.

**El botón DESHACER de 60 segundos.** Cubre el error real —"toqué el botón de al lado"— sin tener
que definir todavía un modelo de permisos y auditoría. Lo que cae fuera de esa ventana se corrige
desde la pantalla del encargado.

**La tina es la unidad de producción, no la pieza.** Está confirmada literal en el audio 3. Modelar
por tina deja abiertas las dos respuestas posibles a la pregunta B2: si mañana hace falta trazar la
pieza individual, las piezas cuelgan de la tina sin rehacer el esquema.

**El saladero suma eventos, no guarda un estado.** Entradas y salidas son movimientos con cantidad,
así que una tina puede entrar entera y salir en tandas sin que haya que decidirlo de antemano. El
servidor no deja salar más de lo producido ni sacar más de lo que hay adentro.

**El tiempo producción → sal se reporta como mediana, no promedio.** Cuando alguien se olvida de
marcar una entrada y la carga al otro día, ese registro vale miles de minutos y destruye cualquier
promedio. La mediana no se mueve, y esas demoras se cuentan aparte — porque una tina marcada 20 h
tarde es una señal operativa, no ruido para descartar.

**Los pesos se guardan en gramos enteros, nunca en kilos con decimales.** Sumar floats acumula
error, y este número termina en una factura. En la tablet se cargan como en una balanza: los dígitos
entran desde la derecha y no hay tecla de coma, así que no existe el error de correr el decimal —
que acá sería un error de diez veces en una factura.

**El tablero LED separa FLUJO de STOCK.** "Hoy se hicieron 420 piezas" se reinicia cada día; "hay
3.248 en sal" es una foto del momento. Mezclarlos hace que nadie sepa si un número que bajó es bueno
o malo, así que cada tarjeta dice cuál es. Y si se cae la red, la pantalla conserva el último dato y
solo cambia el indicador: una pared en blanco no se distingue de "no se produjo nada".

**La maduración se cuenta desde el ingreso a la cámara, no desde la producción.** El audio dice
"sé cuándo entraron". Entre producir y madurar hay saladero, y contar esos días declararía apto un
queso todavía verde.

**Los días de maduración cargados son de referencia, no de la fábrica.** Están marcados como
provisorios en la base y la pantalla lo dice. Se corrigen desde `/app/maduracion-dias`, y al
guardarlos dejan de ser provisorios: un `npm run seed` posterior ya no los pisa. Al salir de cámara
se guardan los **días reales**, así que el sistema aprende cuánto madura cada queso en esa planta.

**`[hidden]` lleva `!important` a propósito.** El `[hidden]` del navegador es solo `display:none`
sin `!important`, así que cualquier clase con `display:flex` lo anula en silencio. Como acá se
muestra y se esconde todo con `hidden`, tiene que ganar siempre — ya causó dos bugs.

**El color de cada serie sigue a la entidad, no a su posición en los datos.** Cambiar el filtro de
fechas no repinta los gráficos: si "azul" significara un producto distinto en cada vista, comparar
dos períodos induciría a error.

## Ponerlo online

Para darle una URL pública al cliente: **[docs/10-online-vercel-supabase.md](docs/10-online-vercel-supabase.md)**
(Vercel + Supabase, gratis). El repo ya trae `vercel.json` listo; sólo hay que cargar
`DATABASE_URL` y `ACCESO_CLAVE`.

La opción con servidor propio —Fly.io, Docker— está en [docs/06-despliegue.md](docs/06-despliegue.md).

Lo esencial en tres líneas:

1. **Poné la clave.** `ACCESO_CLAVE="..."` como variable de entorno. Sin ella el sistema no
   pide nada — correcto en local y en la red de la fábrica, inaceptable en internet.
2. **El hosting necesita disco persistente.** La base es un archivo SQLite: sin volumen, cada
   despliegue la borra. Eso descarta Render free, serverless y hosting estático.
3. **Una sola instancia.** Dos procesos escribiendo el mismo archivo SQLite se corrompen.

Hay `Dockerfile` y `fly.toml` listos. Railway y cualquier VPS con Docker funcionan igual.

## Próximo paso: el piloto

Hay 16 pantallas construidas y **ningún operario tocó una sola**. Antes de seguir agregando
funcionalidad corresponde poner una tablet en lechería y mirar una semana.

El plan completo —qué instalar, qué medir, qué preguntar y qué decidir al final— está en
[docs/05-piloto.md](docs/05-piloto.md).

**Lo único que bloquea:** la lista real de operarios de lechería — que ahora se carga
desde `/app/maestros` sin tocar código.

## Lo que falta para uso real (no bloquea el piloto)

- **Merma y descarte** — un queso que se rompe no tiene cómo salir del sistema.
- **Ajuste de inventario** — no hay forma de decir "conté y hay 98, no 105".
- **Los otros tres canales de venta** — solo se descuenta el mayorista; la venta directa, el local
  de Chascomús y los camiones de reparto no descuentan nada.
- **Autenticación** — hoy no hay ninguna. Imprescindible antes de que esto salga a internet.

Los tres del medio son la misma enfermedad: el sistema sabe sumar pero no restar.
