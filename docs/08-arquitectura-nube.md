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

| | Pantallas | Líneas | Qué hacer |
|---|---|---|---|
| Escritorio | 6 | ~1.400 | **Rehacer.** Es donde duele y donde el riesgo es bajo |
| Tablets de planta | 8 | ~2.200 | **Dejar como están**, al menos hasta el piloto |
| Tablero LED | 1 | 287 | **Dejar.** No tiene interacción; funciona |

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

**2b. Apuntar el servidor actual a Postgres.**
El sistema que ya existe sigue funcionando igual, pero contra Postgres en vez de SQLite.
Valor inmediato: backups administrados y datos accesibles desde afuera. **Sin tocar una
sola pantalla.**

**3. Auth de verdad**, aprovechando que Supabase la trae. Con la distinción que ya
conocemos: tablets sin clave, escritorio con clave.

**4. Escritorio en React + TS**, pantalla por pantalla, empezando por reportes.

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
