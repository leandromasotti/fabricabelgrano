# Cajones: formatos variables y pallets incompletos

**Fecha:** 2026-09-16 · **Fuente:** mensajes de Alexis Giuliatti del 16/9, 09:01–09:05
**Actualizado:** 2026-09-22 — cambió la lista de formatos, ver abajo.

---

## ⚠️ Actualización del 2026-09-22

La lista de abajo es lo que el cliente dijo el 16/9 y se deja como está, porque es el
registro de lo que se pidió. **Pero los formatos ya no son esos.** El 22/9 el cliente
resolvió nombrar los cajones por lo que realmente los distingue —cuántas unidades
entran— en vez de por el cliente que se los lleva:

| Antes | Ahora |
|---|---|
| Cajón lácteo (40 × 18) | **Cajón lácteo x 18** (40 × 18 = 720 L) — mismo registro, renombrado |
| Cajón Sancor (40 × 18) | de baja |
| Cajón La Serenísima (40 × 18) | de baja |
| — | **Cajón lácteo x 20** (40 × 20 = 800 L) — nuevo, **provisorio** |

Los tres eran el mismo cajón de 40 × 18 con distinto nombre, así que la distinción no
aportaba nada y sí ocupaba tres tarjetas en la tablet. La que sí importa es x 18 contra
x 20, que es la que cambia los litros del pallet.

Las bajas son bajas, no borrados: en Supabase ya hay un pallet registrado como "Cajón
Sancor" y tiene que seguir llamándose así en el historial.

**Los 40 bultos del x 20 son deducción, no dato.** Salen de que el cliente lo justificó
diciendo "en un solo pallet meten más litros", lo que implica el mismo pallet con más
unidades adentro. Por eso queda marcado como provisorio hasta que Alexis lo confirme
desde `/app/envases`.

Aplicado a las dos bases con `migraciones/002-cajones-y-obenac.js --confirmar`.

---

## Lo que dijo el cliente

Los formatos de cajón que se usan hoy:

| Formato | Bultos por pallet | Unidades por bulto | Litros |
|---|---|---|---|
| Cajones lácteos | 40 | 18 | 720 |
| Cajones Sancor | 40 | 18 | 720 |
| Cajones La Serenísima | 40 | 18 | 720 |
| Palanganas | 30 | 18 | 540 |
| Bandejones de colores | 30 | 18 | 540 |

Y tres complicaciones, textuales:

> *"al haber tantos cajones y por lo general son casi todos los cajones por 18 unidades
> dentro de cada cajon. pero hay clientes que piden cajones x 20 unidades porque en un
> solo pallet meten mas litros y nosotros accedemos por tener poco espacio en los
> camiones"*

> *"a lo ultimo de la produccion, puede suceder que el que arma los pedidos, pida por
> ejemplo un pallet con 20 cajones solamente o 15 cajones por 18 unidades. esto suele
> pasar pocas veces al dia. pero como hacer para poder llevarlo y que no deje de ser
> intuitivo y rapido de cargar. Lo que tenemos que lograr es que no se convierta en algo
> engorroso"*

> *"nosotros estamos intentando pasar de cajones, todo a cajas y que eso seria mucho mas
> facil. quizas a futuro ni necesitemos la parte de cajones. pero hoy la necesitamos"*

---

## La restricción que manda

**"Que no se convierta en algo engorroso."** El caso raro no puede cobrarle nada al caso
frecuente. Un paso de "¿cuántos cajones?" en el flujo le costaría un toque a los cientos
de pallets completos para servir a los pocos que no lo son.

Por eso la corrección va **después** de registrar, no antes:

```
operario → marca → producto → cajón          ← 4 toques, idénticos a antes
                                ↓
                        PALLET REGISTRADO
                        40 × 18 · 720 L
                   [DESHACER]  [SEGUIR]
                   [ No fue un pallet completo ]   ← sólo lo toca quien lo necesita
```

Al tocarlo se abre el teclado numérico que las tablets ya usan en quesería, con un
segundo botón para pasar a las unidades por bulto. El resultado se muestra **mientras se
teclea** —"20 × 18 = 360 L"— que es lo que hace que alguien note un 200 donde iba 20
cuando todavía se puede arreglar.

Cae dentro de la ventana de 60 segundos que ya existía, y la cuenta regresiva se congela
mientras el teclado está abierto: si venciera por debajo, la corrección quedaría a medias
sin forma de completarla.

**Sin red funciona igual.** Si el pallet todavía está en la cola, la corrección se aplica
**sobre el item encolado** en vez de mandarse aparte: viaja una sola vez y ya correcta.
Si ya viajó, se manda por `client_id` —la misma clave que hace idempotente la
sincronización—, así que llega bien haya viajado el alta o no.

---

## Lo que se guarda

`registros_pallet` gana dos columnas: **`bultos`** y **`unidades_por_bulto`**, copiadas
del formato en el alta.

No son overrides con NULL = "el estándar". Se guardan **siempre**, por la misma razón por
la que ya se congelaban los litros: si dentro de seis meses alguien edita "Cajón lácteo"
de 40×18 a 40×20, un pallet de agosto tiene que seguir diciendo 40×18. Un registro que
depende de una tabla editable para explicarse no es un registro, es una consulta.

En la lista del día y en la pantalla de consulta, el `15 × 18` **sólo aparece cuando el
pallet no fue el formato completo**. Mostrarlo en todas las filas convierte en ruido justo
lo que hay que poder distinguir de un vistazo.

---

## Activo y orden: ya existían

La idea de tener un campo `activo` para ir dando de baja formatos sin tocar código, y un
`orden` para poner el más usado primero, **ya estaba en la base desde el diseño del
esquema**. El catálogo que consumen las tablets ya filtraba por `activo` y ordenaba por
`orden`.

Lo que faltaba era poder editarlos, y poder **dar de alta un formato nuevo**: hasta ahora
agregar un cajón necesitaba un desarrollador. Con cinco formatos que además están en
camino de desaparecer —*"estamos intentando pasar de cajones, todo a cajas"*—, que eso lo
maneje el encargado es la diferencia entre acompañar ese cambio o ir atrás de él.

Un formato dado de baja **desaparece de la tablet pero no de la configuración**: se puede
reactivar, y los pallets históricos que lo usan siguen mostrando su nombre.

---

## Lo que queda abierto

**Las palanganas que ya estaban cargadas.** El sistema tiene dos formatos llamados
`Palangana` y `Palangana 2`, sin equivalencia, con 6 y 2 pallets registrados. La lista de
Alexis trae "palanganas 30 × 18" y "bandejones de colores 30 × 18". **No se asumió que
sean los mismos**: cargarles esos números completaría en silencio los litros de esos ocho
pallets, y si el mapeo estuviera mal serían ocho registros con litros inventados. Hay que
confirmarlo con la planta antes de tocarlos.

**Con qué frecuencia aparece el cajón × 20.** Si resulta habitual para ciertos clientes,
conviene que sea su propia tarjeta en la tablet ("Cajón lácteo × 20") en vez de una
corrección: es un formato más en el catálogo y ya se puede crear sin código. Si es
ocasional, la corrección alcanza. Hoy sirven las dos y la decisión no bloquea nada.


---

# Tablero LED configurable

**Fecha:** 2026-09-16

La implementación es por sectores y no todos arrancan juntos. Mientras lechería ya carga
y quesería todavía no, una sección del tablero en cero **no dice "no se produjo", dice
"esto no anda"**. Un tablero con tres números reales vale más que uno con seis donde la
mitad son ceros que nadie sabe interpretar.

Seis secciones se encienden y apagan desde **`/app/tablero-led`**:

| Sección | Qué muestra |
|---|---|
| Leche cruda recibida | Litros del día, entregas, temperatura máxima |
| Pallets de lechería | Pallets por marca y tipo de leche |
| Yogures | Bins del día y su equivalencia aproximada |
| Circuito del queso | Producido, esperando sal, en saladero, para envasar, envasado |
| Pedidos | Pendientes, en armado, listos para facturar |
| Atención | Tinas demoradas y quesos desnudos hace mucho |

La configuración **viaja dentro de `/api/tablero`**, que la pantalla ya pide cada 10
segundos: apagar una sección desde el escritorio se ve en la pared sola, sin que nadie
vaya hasta la máquina que la maneja.

**El orden no es configurable, y es a propósito.** Los bloques tienen formas muy
distintas —una fila de cifras, cinco tarjetas iguales, una lista— y reordenarlos no es
mover cajas. Prometerlo en la interfaz sería prometer algo que el layout no puede
cumplir.

## Lo que hubo que cambiar en el layout

El tablero era un `grid` con filas declaradas (`auto auto 1fr auto`). Con secciones que
se apagan, cada bloque oculto corría a los demás a la fila de otro. Pasó a `flex`, donde
lo que no está simplemente no ocupa. Lo mismo dentro del panel de lechería.

Dos detalles que sólo aparecen probando:

- **Los separadores verticales** quedaban colgando del borde cuando la primera sección
  estaba apagada. Se resuelve con `*:not([hidden]) ~ *:not([hidden])`, que es literalmente
  "todo lo visible que tenga algo visible antes", o sea todo menos el primero.
- **Quién llena el alto sobrante.** Con el circuito del queso apagado quedaba una franja
  de contenido arriba y medio metro de negro abajo, que en una pared se lee como que la
  pantalla se colgó. Ahora crece el circuito si está, y si no, el último bloque visible.

Y el mismo bug de siempre: `[hidden]` del navegador es sólo `display:none` **sin**
`!important`, así que la clase que hace crecer un bloque (`display:flex`) lo anulaba en
silencio. Esta pantalla no carga `styles.css`, donde esa regla ya existía. Es la tercera
vez que aparece en el proyecto.

## Dos bugs que destapó poder dar de baja un formato

**Un formato dado de baja no se podía editar.** La pantalla mostraba la fila con sus
campos y el botón Guardar devolvía 404. Hay que poder corregir un formato retirado antes
de volver a activarlo.

**Y el más serio: un pallet encolado sin red se descartaba en silencio.** El helper
`existe()` filtraba por `activo`. Si el encargado daba de baja un cajón a las 10:00 y una
tablet tenía un pallet de las 09:50 esperando red en ese formato, al sincronizar el
servidor lo rechazaba como inválido y **la cola lo borraba** —porque borrar lo inválido es
justamente lo que evita que la cola se trabe para siempre—. El operario vio "PALLET
REGISTRADO" y el registro no quedaba en ningún lado.

`activo` significa "no lo ofrezcas más", no "rechazá lo que ya pasó": es un filtro del
**catálogo**, y ahí es donde se aplica. Un id inactivo sólo puede llegar de un registro
viejo en camino, y eso es legítimo: el pallet se armó de verdad. El arreglo vale para
operarios, marcas, productos, quesos y clientes, que tenían exactamente el mismo problema
latente.
