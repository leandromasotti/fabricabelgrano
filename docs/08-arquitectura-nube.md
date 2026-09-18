# Salir del MVP: arquitectura, Supabase y qué UI

**Fecha:** 2026-09-15
**Decisiones tomadas:** la planta **no puede parar** si se cae internet · se arranca
**migrando el esquema a Supabase**.

---

## 1. Lo que la primera decisión implica

*"La planta no puede parar"* descarta la arquitectura simple —Supabase como única base y
las tablets hablándole directo— porque en ese caso un corte de internet frena el registro
de producción.

Lo que queda es esto:

```
       FÁBRICA                                    NUBE
  ┌──────────────────┐                    ┌──────────────────┐
  │ Servidor local   │   registros  ──▶   │    Supabase      │
  │ (PC / NUC)       │                    │                  │
  │                  │   ◀── catálogos    │  · reportes      │
  │ · 8 tablets      │                    │  · acceso remoto │
  │ · escribe SIEMPRE│                    │  · backups       │
  │ · anda sin red   │                    │  · auth          │
  └──────────────────┘                    └──────────────────┘
```

**Quién es dueño de qué** — esto es lo que hace que la sincronización sea simple:

| Dato | Dueño | Por qué |
|---|---|---|
| Registros de producción | **Fábrica** | Se generan en las tablets y no pueden esperar a internet |
| Catálogos y configuración | **Nube** | Se editan desde escritorio, no son urgentes |
| Pedidos | **Nube** | Los carga una administrativa, con internet |
| Reportes | **Nube** | Se leen, no se escriben |

Sin datos con dos dueños, no hay conflictos que resolver.

---

## 2. Por qué la sincronización acá es tratable

En el caso general sincronizar dos bases es un problema feo. Acá no, por una propiedad
que el modelo ya tiene:

> **Casi todo son ALTAS con un `client_id` único, no modificaciones.**

Un pallet, una tina, un movimiento de saladero, una pesada: se insertan y no se tocan
más. No existe "dos personas editaron la misma fila". Y `client_id UNIQUE` hace que
reenviar un registro sea inofensivo: llega dos veces, se guarda una.

Eso ya está construido y probado — es la cola offline de las tablets. **Sincronizar la
fábrica con la nube es el mismo mecanismo, un nivel más arriba.**

Las excepciones son pocas y conocidas:
- `anulado` — es un flag que solo va de false a true, idempotente por naturaleza
- Configuración (días de maduración, formatos de envase) — dueño único: la nube
- Estados de pedido — dueño único: la nube

---

## 3. Sobre el framework

### Lo que cambió mi opinión

Cuando dije que no a Next.js había dos pantallas de formulario. Hoy hay 14, y **la mitad
son de escritorio con tablas, filtros e impresión** — que es donde un framework rinde.

Pero el argumento más fuerte no es ese. Es este:

> Rompí una pantalla entera porque un `id` del HTML no coincidía con el `$('unidad')` del
> JS. Un carácter. Ningún operario podía envasar nada, y solo se detectaba abriendo el
> navegador. **Con componentes tipados ese bug no compila.**

Lo mismo con el renombre de `caja` a `bin`: 23 referencias a mano, verificadas con un
agente. Con TypeScript, el compilador las lista en dos segundos.

### Next.js sí o no

Primero, algo que conviene sacar del medio: **el framework no decide nada sobre tablet vs
computadora.** Las dos son la misma web app; lo que cambia es el diseño de la interfaz.

Lo que Next.js aporta de verdad es **servidor**. Y acá hay una particularidad: con esta
arquitectura **ya hay un servidor, el de la fábrica**. Next agregaría un segundo runtime
en la nube para hacer lo que Supabase ya hace.

**Recomendación: React + TypeScript + Vite**, como SPA servida tanto por el servidor local
como por la nube. Misma app, dos orígenes, según dónde esté parado el que la usa.

Next.js no sería un error, pero acá es una pieza de más.

### Qué se rehace y qué no

| | Pantallas | Líneas | Qué se hizo |
|---|---|---|---|
| Escritorio | 7 | ~1.400 | **Rehecho** en React + TS, en `/app` |
| Tablets de planta | 8 | ~2.200 | **Sin tocar**, al menos hasta el piloto |
| Tablero LED | 1 | 287 | **Sin tocar.** No tiene interacción; funciona |

Las tablets son código offline-first que funciona, y son justo lo que no puede fallar a
las 6 de la mañana en lechería. Reescribirlas es el mayor riesgo con la menor ganancia.

Las dos versiones conviven en el mismo dominio sin problema: son rutas distintas.

---

## 4. Orden propuesto

**1. Esquema en Postgres** ← *hecho y **probado contra PostgreSQL 16***:
[`migraciones/001-esquema.sql`](../migraciones/001-esquema.sql)

**2. Migrar los datos** ← *hecho y **probado con los datos reales***:
[`migraciones/migrar-desde-sqlite.js`](../migraciones/migrar-desde-sqlite.js) (`npm run migrar`)

Las 893 filas entran sin violar un solo CHECK, y los totales del negocio —litros de leche
cruda, litros envasados, piezas de queso, gramos pesados— coinciden exactamente con
SQLite.

> **La migración encontró un problema que no se veía:** el esquema nuevo exige que un
> queso aparezca una sola vez por pedido, y en los datos había un pedido con Cremoso
> cargado dos veces (100 y 20 piezas). La primera versión del script lo descartaba **en
> silencio** con `ON CONFLICT DO NOTHING` — se perdían 20 piezas pedidas. Ahora las
> **suma**, que es lo mismo que hace la pantalla nueva, y repunta las pesadas de la línea
> fusionada para que no queden huérfanas.
>
> Es exactamente el tipo de cosa que aparece al migrar de verdad y no al planificar.

**2b. Apuntar el servidor actual a Postgres** ← *hecho y **corriendo***.
El sistema que ya existe funciona igual, pero contra Postgres en vez de SQLite. Valor
inmediato: backups administrados y datos accesibles desde afuera. **Sin tocar una sola
pantalla.**

El motor se elige con una variable de entorno, no con una rama de código:

```bash
node --env-file=.env.local server/index.js   # DATABASE_URL definida -> PostgreSQL
node server/index.js                         # sin ella              -> SQLite
```

Volver atrás es borrar una línea del `.env.local`. Eso importa más de lo que parece: es
la diferencia entre "probemos Postgres" y "migremos a Postgres".

Los dos motores pasan las mismas tres baterías: 37 lecturas, 18 escrituras de punta a
punta (recepción → quesería → saladero → maduración → envasado → pedido pesado) y 20
pruebas sobre las rutas de anulación y cambio de estado.

> **Las diferencias de dialecto que aparecieron** están todas resueltas dentro del
> adaptador o en una consulta, no repartidas por los 51 endpoints: `GROUP BY` con
> columnas de otra tabla, subconsultas del `FROM` sin alias, el alias de salida usado en
> `HAVING`, los booleanos que en SQLite eran 0/1, `date(x, '-14 days')`, y los parámetros
> que quedaban sin tipo deducible.

> **Lo que la migración destapó y no tenía nada que ver con Postgres:** convertir los 51
> endpoints a `async` dejó 21 lugares con la forma `await consulta.run(...).changes`. Eso
> se parsea como `await (consulta.run(...).changes)`: la propiedad se pide sobre la
> **promesa**, no sobre el resultado, y vale `undefined` siempre. Sin ruido, sin
> excepción, sin log.
>
> Las consecuencias eran reales y silenciosas: anular dos veces devolvía 200 las dos
> veces (`undefined === 0` es falso, así que el 404 nunca salía), el seed se salteaba
> marcas y clientes en una base nueva, y el aviso de *"N pallets completados"* no
> aparecía nunca. Con SQLite sincrónico el mismo código funcionaba; lo rompió el
> `async`, no el motor.
>
> Aparte había una validación —que el queso de una línea de pedido exista— escrita sin
> `await`: `!promesa` es siempre falso, así que no validaba nada.

**3. Auth de verdad**, aprovechando que Supabase la trae. Con la distinción que ya
conocemos: tablets sin clave, escritorio con clave.

**4. Escritorio en React + TS** ← *hecho: **las 7 pantallas** están portadas y andando
en `/app`*.

**Stack elegido:** React 19 + TypeScript estricto + Vite, Tailwind v4 y TanStack Query.
Sin Next.js, por lo de la sección 3: ya hay un servidor —el de la fábrica— y Next
agregaría un segundo runtime para hacer lo que Supabase ya hace.

**Cómo conviven las dos versiones.** El escritorio nuevo vive bajo `/app` y las tablets
siguen siendo archivos HTML en la raíz. Son rutas distintas del mismo origen: no hay
segundo dominio, ni proxy, ni fecha de corte. El menú lateral lista las pantallas viejas
junto a las nuevas, marcadas como tales, para que durante la migración se llegue a todo
desde un solo lado.

```bash
npm run web          # desarrollo: Vite en :5173, la API sigue en :3017
npm run web:build    # compila a public/app, que el Express ya sirve
```

**Lo que el tipado ya evitó no es hipotético.** La pantalla de envasado se rompió entera
porque un `id` del HTML no coincidía con el `$('unidad')` del JS; acá los gráficos, las
columnas de tabla y las respuestas de la API son tipos, y esa clase de error no compila.

**Decisiones de forma que se conservaron del original**, porque no eran estéticas:
producción por día = columnas de un solo tono (una serie en el tiempo); piezas por queso
= barras horizontales (magnitudes ordenadas, nombres largos); pallets por marca =
apiladas con tres hues categóricos; rendimiento = tabla y no gráfico (17 categorías con
seis medidas cada una). La paleta es la misma que ya había pasado el validador.

> **Portar la pantalla destapó un bug que llevaba semanas ahí:** el filtro de queso se
> aplicaba **solo al detalle**. Con "Pategrás" elegido, la pantalla mostraba 13.690
> piezas producidas —de todos los quesos—, la tabla de rendimiento con los 17, y abajo
> un listado con Pategrás solo. Es **exactamente** el mismo problema que ya habíamos
> arreglado con el filtro de tambo en leche cruda, en otra pantalla.
>
> Ahora el filtro entra en las cuatro consultas que faltaban (piezas por día,
> rendimiento, tiempos a sal, en sal ahora) y los números cierran entre sí. Lo que **no**
> se filtra —leche y yogur, que no tienen tipo de queso— lo dice en el número mismo:
> *"no filtra por queso"*. Dos cifras que no responden al mismo filtro no pueden verse
> iguales.
>
> El arreglo es en la API, así que la pantalla vieja (`/reportes.html`) también quedó
> bien.

**Las otras seis pantallas.** Despacho, Nuevo pedido, Leche cruda, Envases, Días de
maduración y Consulta de lechería. Lo que cambió, además de la tecnología:

> **Despacho pedía el detalle de cada pedido en cada refresco**, estuviera desplegado o
> no. Con 21 pedidos en el tablero eran **264 requests por minuto**, la mayoría de
> detalles que nadie estaba mirando. Ahora el detalle sólo se pide mientras su tarjeta
> está abierta: medido en 11 segundos, **44 requests contra 2**.
>
> De paso desapareció el `Set` global que guardaba qué tarjetas estaban desplegadas. Era
> un parche para que el refresco no cerrara el detalle cada 5 segundos justo mientras
> alguien controlaba un pedido; con componentes, el estado vive en la tarjeta y el
> problema no existe.

> **La hoja de armado se imprimía a destiempo.** La versión anterior la construía dentro
> del handler del botón y llamaba a `window.print()` en la línea siguiente; en React eso
> imprime el DOM anterior, porque el estado se aplica de forma asíncrona. Ahora las hojas
> están siempre montadas y ocultas por CSS, así que el botón sólo llama a `print()` — y
> el **Ctrl+P del navegador**, que antes sacaba una hoja vacía, ahora también funciona.

> **Tres filtros salían de su propia respuesta filtrada** (quesos en Reportes, tambos en
> Leche cruda). Elegir una opción dejaba el desplegable con esa sola adentro: un control
> que se destruye a sí mismo al usarlo. Ahora salen del catálogo, que es estable.

Las decisiones de forma de los gráficos y el CSS de impresión —columnas en blanco altas
para escribir con guantes, un pedido que nunca se parte entre dos páginas— se portaron
tal cual: no eran estéticas.

**5. Sincronización fábrica ↔ nube**, que es lo que hace real el "la planta no puede
parar". Va acá y no antes porque hasta este punto se puede vivir con la base en la nube
y el servidor local como proxy.

**6. Las tablets, si hace falta.** Probablemente no haga falta.

---

## 5. Lo que cambia el esquema al pasar a Postgres

No es una traducción mecánica; hay cuatro mejoras reales.

**Las fechas dejan de ser texto.** En SQLite guardábamos strings ISO y calculábamos el día
con `date(fecha_hora, 'localtime')`, que depende de la zona del proceso. **Eso ya nos costó
un bug**: el reporte por rango se comía el día de hoy porque una fecha se parseaba como UTC
y se formateaba como local. En Postgres son `TIMESTAMPTZ` y el día sale de una función que
declara la zona explícitamente.

**Los decimales dejan de ser punto flotante.** Temperatura, pH y pesos pasan a `NUMERIC`
con precisión declarada. Es la misma razón por la que los pesos de pedidos se guardan en
gramos enteros: estos números terminan en liquidaciones a tambos y en facturas.

**Los booleanos son booleanos.** `anulado INTEGER` con valores 0 y 1 pasa a `BOOLEAN`.

**Las reglas viven en la base.** Los rangos de litros (50 a 60.000), la coherencia de los
días de maduración, que un formato de envase esté completo o marcado provisorio: hoy son
chequeos en JavaScript, y en Postgres son `CHECK` que ninguna ruta de código puede saltear.

---

## 6. Dos advertencias

### Row Level Security no es opcional

Sin RLS, la clave anónima de Supabase deja **leer y escribir todo** desde cualquier
navegador. El esquema la activa en todas las tablas y **sin políticas**, que es el default
seguro: nadie entra con la clave anónima hasta que se decida quién debe poder qué.

Se abre a propósito, no por olvido.

### Probado en local, falta Supabase

El esquema y la migración corren contra **PostgreSQL 16 en Docker**. Supabase usa 15 y
todo lo que se usa existe en ambas —columnas generadas, identity, enums, RLS— pero el
primer `supabase db push` es el que lo confirma de verdad.

Para reproducirlo:

```bash
docker exec postgres psql -U postgres -c "CREATE DATABASE fabrica_belgrano"
docker exec -i postgres psql -U postgres -d fabrica_belgrano < migraciones/001-esquema.sql
npm run migrar > migraciones/datos.sql
docker exec -i postgres psql -U postgres -d fabrica_belgrano < migraciones/datos.sql
```

### Nada de esto fue usado por un operario todavía

Hay 14 pantallas y **ninguna la tocó alguien de la fábrica**. Migrar la base es de bajo
riesgo y da valor solo. Rehacer la UI antes del piloto significa rehacer algo que no
sabemos si está bien planteado.

Si el operario de lechería pide algo que cambia el flujo, es mucho más barato descubrirlo
ahora que después de migrar seis pantallas.
