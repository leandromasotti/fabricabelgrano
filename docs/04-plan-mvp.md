# Fábrica Belgrano — Plan y MVP

**Fecha:** 2026-09-11
**Basado en:** [01-requerimientos.md](01-requerimientos.md) · [02-preguntas-abiertas.md](02-preguntas-abiertas.md)

---

## 1. ¿Se puede arrancar con preguntas abiertas?

Sí, y esta sección explica por qué, porque no es obvio.

Quedan **dos preguntas bloqueantes** sin responder:

- **B2** — ¿se traza la pieza individual de queso o alcanza con cantidades? (la que más cambia el
  presupuesto)
- **A5** — ¿el sistema factura, se integra, o solo muestra kilos?

**Ninguna de las dos toca el sector lechería.** Lechería registra *pallet + marca + tipo + operario
+ hora*. No hay piezas que trazar, no hay kilos que facturar, no hay pedidos. Es el único sector
del circuito que está completamente aislado de las dos incógnitas.

Eso no es casualidad: es exactamente la razón por la que el cliente propuso empezar ahí
**[A2 01:01-01:12, A7 00:00-00:09]**. Tenía razón, y ahora tenemos la justificación técnica además
de la operativa.

> **El argumento de fondo:** una pantalla funcionando en la pared genera mejores requerimientos que
> cualquier cuestionario. Cuando el operario de lechería use el sistema una semana, vamos a saber
> cosas sobre B2 y B4 que hoy nadie puede contestar en una reunión.

---

## 2. Qué es el MVP

**Una sola pantalla, en una sola tablet, en lechería.** Nada más.

### Alcance incluido
- Registrar un pallet: operario → marca → tipo de leche → confirmar.
- Sello automático de fecha y hora.
- Ver los últimos registros del turno en la misma pantalla.
- Deshacer el último registro (ver 4.3).
- Una pantalla de consulta simple para el encargado, desde la PC de arriba.

### Alcance explícitamente excluido
No entra nada de esto en el MVP, aunque aparezca en los requerimientos:

| Fuera del MVP | Por qué |
|---|---|
| Stock / inventario | Depende de C5 (los 4 canales de venta) |
| Pedidos y facturación | Depende de A2 y A5 |
| Maduración y alertas | Fase 2 |
| Usuarios y permisos | Para una lista de nombres no hace falta |
| Reportes | No sabemos qué quieren ver (C1) |
| Yogures | Depende de C6 |

### El criterio de éxito no es técnico
El MVP no se valida con que ande. Se valida con esto:

> **Después de una semana, ¿el operario de lechería sigue usando la tablet, o volvió al cartón?**

Ese es el riesgo real del proyecto y ningún diseño lo predice. Se mide.

---

## 3. Modelo de datos del MVP

Cinco tablas. Deliberadamente chico.

```
operarios              marcas                  productos
---------              ------                  ---------
id                     id                      id
nombre                 nombre                  nombre
sector                 es_propia (bool)        familia  ('leche')
activo                 activo                  activo

registros_pallet
----------------
id
fecha_hora        timestamp del servidor, no del cliente
operario_id       FK
marca_id          FK
producto_id       FK
anulado           bool  -- nunca se borra, se marca
anulado_por       FK operarios
anulado_en        timestamp
```

**Datos iniciales conocidos:**
- Marcas: Central Lechera, Lácteos Belgrano, Ovenac *(pendiente de confirmar — pregunta A1)*
- Productos: Leche Entera, Leche Entera Largavida, Leche Descremada ✅ *(confirmados contra el
  catálogo oficial)*
- Operarios: **falta la lista** — es el único dato que bloquea el arranque.

**Tres decisiones de diseño que conviene tomar ahora:**

1. **Nunca borrar, marcar anulado.** Cuesta lo mismo y evita perder información desde el día uno.
2. **La hora la pone el servidor.** Las tablets colgadas en una pared se desconfiguran y nadie las
   mira. Como el horario es un dato de proceso (4.2 en requerimientos), no puede depender del reloj
   de la tablet.
3. **Toda escritura pasa por una sola función.** Si después aparece que hay que funcionar offline
   (pregunta D2), la cola se agrega en un solo lugar en vez de en toda la app.

✅ **Contestado (2026-09-13):** un pallet son **70 cajas de 12 litros = 840 litros**, y es fijo.
El cliente pidió ver el equivalente en litros en el tablero, los reportes y la consulta.

Queda una pregunta derivada: **¿se cierra alguna vez un pallet incompleto?** Si a veces se arma con
menos cajas, los litros quedarían sobreestimados. Hoy el sistema asume pallet completo siempre.

---

## 4. Diseño de la pantalla

### 4.1 Principios, en orden de importancia

1. **Cero teclado.** Todo es tocar botones. No hay un solo campo de texto.
2. **Cero scroll.** Todo entra en una pantalla. Si no entra, se reduce el alcance.
3. **Botones grandes.** El operario puede tener guantes o las manos mojadas.
4. **Feedback inmediato y visible desde lejos.** Tiene que quedar clarísimo que el registro entró.
5. **Máximo 3 toques** para registrar un pallet.

### 4.2 El flujo

```
┌─────────────────────────────────────────────┐
│  ¿Quién sos?                                │
│  ┌────────┐ ┌────────┐ ┌────────┐          │
│  │ JUAN   │ │ CARLOS │ │ MIGUEL │   ...    │
│  └────────┘ └────────┘ └────────┘          │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  JUAN  ·  Marca                    [cambiar]│
│  ┌──────────────┐ ┌──────────────┐         │
│  │ LÁCTEOS      │ │ CENTRAL      │         │
│  │ BELGRANO     │ │ LECHERA      │         │
│  └──────────────┘ └──────────────┘         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  JUAN · LÁCTEOS BELGRANO           [cambiar]│
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ ENTERA   │ │ LARGAVIDA│ │DESCREMADA│    │
│  └──────────┘ └──────────┘ └──────────┘    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│        ✓  PALLET REGISTRADO                 │
│           14:32                             │
│                          [ DESHACER ]  60s  │
│  ─────────────────────────────────────────  │
│  Hoy: 14 pallets                            │
│  14:32  Belgrano · Entera      · Juan       │
│  14:18  Belgrano · Largavida   · Juan       │
│  13:55  Central  · Descremada  · Carlos     │
└─────────────────────────────────────────────┘
```

La lista de abajo no es decorativa: es lo que reemplaza al cartón como **memoria visible del
turno**. Hoy el operario mira el cartón y ve lo que lleva hecho. Si la tablet no le da eso, va a
extrañar el cartón.

### 4.3 El botón DESHACER resuelve un problema abierto

La pregunta **B4** (correcciones y errores) no está contestada, y normalmente eso obliga a definir
permisos, autorizaciones y auditoría antes de codificar.

**Un deshacer de 60 segundos sobre el último registro evita toda esa discusión** y cubre el 90% de
los errores reales, que son "toqué el botón de al lado". Lo que quede fuera de esa ventana se
corrige desde la pantalla del encargado. La discusión completa de permisos se pospone hasta tener
datos reales de cuántas correcciones hacen falta.

---

## 5. Cronograma

| Hito | Qué se entrega | Depende de |
|---|---|---|
| **H0 — Datos** | Lista de operarios de lechería, confirmación de marcas, foto del cartón | **cliente** |
| **H1 — MVP en el aire** | La pantalla de registro andando, accesible desde la tablet | H0 |
| **H2 — En la pared** | Tablet amurada, WiFi verificado en el sector, una semana de uso real | H1 + instalación |
| **H3 — Ajustes** | Correcciones de lo que aparezca en esa semana | H2 |
| **H4 — Consulta** | Pantalla del encargado con el listado del día y exportación | H3 |
| **H5 — Fase 1 completa** | Producción (quesería) + saladero | H4 + respuesta a B2 |
| **H6 — Reportes** | Búsqueda por fecha y tipo, gráficos, rendimiento por tina | H5 |

> **Estado real (2026-09-11):** H1, H5 y H6 ya están construidos y verificados. Lo que
> falta para llegar a **H2 — el hito que importa** no es código: son los datos del
> cliente (lista de operarios) y la instalación física.

**H2 es el hito que importa.** Todo lo anterior es preparación; recién ahí se sabe si el enfoque
funciona.

**H5 no necesitó B2 después de todo.** Modelar por **tina** —que está confirmada
literal en el audio— dejó las dos respuestas posibles: si mañana hace falta trazar la
pieza individual, las piezas cuelgan de la tina sin rehacer el esquema. La pregunta
sigue abierta, pero ya no bloquea.

**Lo que sí quedó atado a B2.** Para entonces ya vamos a tener una semana de uso real y la respuesta
va a ser mucho más fácil de obtener — probablemente observándolos en vez de preguntando.

---

## 6. Lo único que bloquea el arranque

De todo lo pendiente, **una sola cosa impide empezar hoy**:

> 🚨 **La lista de nombres de los operarios de lechería.**

Marcas y productos ya los tenemos (confirmados contra el catálogo oficial). El resto de las
preguntas abiertas afectan fases posteriores, no al MVP.

Lo demás es **deseable pero no bloqueante**: la foto del cartón (mejora el diseño pero no lo
impide) y la verificación de WiFi en el sector (afecta al despliegue, no al desarrollo).
