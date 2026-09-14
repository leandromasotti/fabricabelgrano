# Fábrica Belgrano — Seguimiento de producción

Sistema de registro de producción para **Lácteos Del Salado SRL** (marca *Lácteos Belgrano*),
General Belgrano, Buenos Aires. Reemplaza el registro en papel y cartón por tablets amuradas en
cada sector de la planta.

**Estado: circuito completo** — lechería, quesería, saladero, envasado y armado de pedidos,
más despacho, reportes y un tablero para pantalla LED de planta.
Ver [docs/04-plan-mvp.md](docs/04-plan-mvp.md) para el alcance y las fases siguientes.

## Cómo correrlo

```bash
npm install
npm run seed      # marcas, productos, tipos de queso y operarios de ejemplo
npm start         # http://localhost:3000
```

Antes de usarlo en la fábrica, cargar los operarios reales y verificar los backups:

```bash
npm run operarios                                        # ver los que hay
npm run operarios -- lecheria "Juan Pérez" "Carlos Gómez"  # reemplazar los de un sector
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
| Despacho | `/despacho.html` | Encargado: pedidos en tiempo real y facturación |
| Reportes | `/reportes.html` | Encargado: búsqueda por fecha y tipo, gráficos, rendimiento |
| Días de maduración | `/maduracion-dias.html` | Encargado: corregir los días por tipo de queso |
| Consulta del día | `/consulta.html` | Encargado: detalle de lechería y anulaciones |

## Stack

Node + Express + SQLite, front en JS vanilla con service worker. Sin build step: lo que está en
`public/` es lo que corre en la tablet.

No se usó un framework de front a propósito — son tres pantallas de formulario que tienen que
arrancar instantáneo y funcionar sin red. El razonamiento completo está en
[docs/04-plan-mvp.md](docs/04-plan-mvp.md).

## Estructura

```
server/
  db.js          esquema y conexión SQLite
  seed.js        datos iniciales
  demo.js        generador de datos de ejemplo (solo desarrollo)
  index.js       API REST
public/
  comun.js       cola offline, estado de red, reloj corregido, helpers de UI
  lecheria.*     tablet de lechería
  queseria.*     tablet de quesería (teclado numérico para el rinde)
  saladero.*     tablet de saladero (tinas ordenadas por tiempo de espera)
  reportes.*     gráficos y búsqueda para el encargado
  consulta.html  detalle del día de lechería
  styles.css     diseño para uso con guantes
  sw.js          service worker (cachea el app shell)
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
provisorios en la base y la pantalla lo dice. Se corrigen desde `/maduracion-dias.html`, y al
guardarlos dejan de ser provisorios: un `npm run seed` posterior ya no los pisa. Al salir de cámara
se guardan los **días reales**, así que el sistema aprende cuánto madura cada queso en esa planta.

**`[hidden]` lleva `!important` a propósito.** El `[hidden]` del navegador es solo `display:none`
sin `!important`, así que cualquier clase con `display:flex` lo anula en silencio. Como acá se
muestra y se esconde todo con `hidden`, tiene que ganar siempre — ya causó dos bugs.

**El color de cada serie sigue a la entidad, no a su posición en los datos.** Cambiar el filtro de
fechas no repinta los gráficos: si "azul" significara un producto distinto en cada vista, comparar
dos períodos induciría a error.

## Próximo paso: el piloto

Hay 12 pantallas construidas y **ningún operario tocó una sola**. Antes de seguir agregando
funcionalidad corresponde poner una tablet en lechería y mirar una semana.

El plan completo —qué instalar, qué medir, qué preguntar y qué decidir al final— está en
[docs/05-piloto.md](docs/05-piloto.md).

**Lo único que bloquea:** la lista real de operarios de lechería.

## Lo que falta para uso real (no bloquea el piloto)

- **ABM de datos maestros** — hoy agregar un operario o un cliente necesita un desarrollador.
- **Merma y descarte** — un queso que se rompe no tiene cómo salir del sistema.
- **Ajuste de inventario** — no hay forma de decir "conté y hay 98, no 105".
- **Los otros tres canales de venta** — solo se descuenta el mayorista; la venta directa, el local
  de Chascomús y los camiones de reparto no descuentan nada.
- **Autenticación** — hoy no hay ninguna. Imprescindible antes de que esto salga a internet.

Los tres del medio son la misma enfermedad: el sistema sabe sumar pero no restar.
