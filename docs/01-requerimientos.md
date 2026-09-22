# Fábrica Belgrano — Requerimientos iniciales

**Fuente:** 7 notas de voz del 2026-09-10 (16:48 a 17:01), en [requerimientos/](../requerimientos/).
**Transcripciones:** [requerimientos/transcripciones/](../requerimientos/transcripciones/) — dos pasadas (`small` y `medium`), complementarias entre si. `large-v3` no entra en la RAM disponible.
**Estado:** borrador 2 — terminos del dominio confirmados por doble transcripcion.

> **Cómo leer este documento**
> - **[A*n* mm:ss]** = sale textual del audio *n* en ese minuto.
> - 🔸 **Inferencia** = interpretación mía, no dicha explícitamente. Confirmar o corregir.
> - ❓ = tiene una pregunta asociada en [02-preguntas-abiertas.md](02-preguntas-abiertas.md).

---

## 1. Contexto y objetivo

### La empresa
Datos del sitio oficial <https://lacteosbelgrano.com.ar/> (consultado 2026-09-11):

| | |
|---|---|
| **Razón social** | Lácteos Del Salado SRL |
| **Marca** | Lácteos Belgrano |
| **Planta** | Ruta 29 Km 78,7 — General Belgrano, Prov. de Buenos Aires |
| **Trayectoria** | Empresa familiar, más de 40 años |
| **Canales** | Venta directa de fábrica (martes, jueves, viernes y sábados), minorista en Chascomús, mayorista, 3 unidades de reparto propias y distribuidores provinciales |

⚠️ Los canales de venta son **cuatro**, y los audios solo describen el de pedidos mayoristas. Ver
pregunta **C5**.

### El proyecto
Fábrica de lácteos y quesos que hoy registra su producción **en papel y cartón**. El objetivo es
digitalizar el seguimiento con **tablets fijas en cada sector**, para tener **control y datos de
producción en tiempo real** **[A7 00:57-01:04]**: qué se produjo, cuándo, quién lo hizo y dónde
está cada lote.

Situación actual descrita:
- En lechería hay un sistema "muy precario pero bastante aceitado": marcan en un cartón cada pallet
  que arman, con la marca y el tipo de producto **[A2 00:21-00:52]**.
- En armado de pedidos, el encargado baja un papel con el pedido, el operario pesa los quesos y
  **anota los pesos a mano**, después sube el papel para que se facture **[A6 00:30-00:54]**.

🔸 **Inferencia:** el dolor principal no es solo registrar, sino que la información llegue **a
tiempo** a quien factura y a quien planifica, sin depender de que alguien suba un papel.

---

## 2. Flujo productivo (columna vertebral del sistema)

Cada paso de este flujo es un punto de captura de datos.

```
            ┌──────────────┐
            │  LECHERÍA    │  pallets de leche, por marca y tipo
            └──────┬───────┘
                   │
            ┌──────▼───────────┐
            │  QUESERÍA        │  el maestro quesero arma la tina
            │  (producción)    │  corte + prensado → N piezas (variable)
            └──────┬───────────┘
                   │  mismo día
            ┌──────▼───────┐
            │  SALADERO    │  marca ENTRADA y SALIDA de sal
            └──────┬───────┘
                   │
            ┌──────▼─────────────┐
            │ CÁMARA DE DESNUDO  │  queso sin envasar
            └──────┬─────────────┘
                   │
      ┌────────────┴────────────┐
      │                         │
┌─────▼────────┐        ┌───────▼──────────┐
│  ENVASADO    │        │   MADURACIÓN     │  pasta dura y semidura
│ barras,      │        │ sardo, reggianito│
│ cremoso      │        │ parmesano /      │
│ (sardo NO    │        │ pategrás, mar    │
│  se envasa)  │        │ del plata, fontina│
└─────┬────────┘        └───────┬──────────┘
      │                         │
      └────────────┬────────────┘
                   │
        ┌──────────▼───────────┐
        │ CÁMARA PREPARACIÓN   │  stock listo para vender
        │    DE PEDIDOS        │
        └──────────┬───────────┘
                   │
            ┌──────▼───────┐
            │  ARMADO DE   │  se pesa cada pieza
            │   PEDIDOS    │
            └──────┬───────┘
                   │
            ┌──────▼───────┐
            │ FACTURACIÓN  │  "arriba", el encargado (Andrés)
            └──────────────┘
```

❓ Envasado y maduración aparecen como sectores separados, pero no quedó claro el orden entre ellos
ni qué quesos pasan por cada uno (el sardo no se envasa pero sí madura). Ver pregunta **B3**.

---

## 3. Puestos de captura (tablets)

Se mencionaron explícitamente **6 tablets**, una por sector:

| # | Sector | Qué registra | Referencia |
|---|--------|--------------|------------|
| 1 | Lechería | Pallets armados: marca y tipo de producto | [A2 00:21-01:00] |
| 2 | Quesería (producción) | Operario + tipo de queso + cantidad producida por tina | [A3 00:42-01:05] |
| 3 | Saladero | Entrada y salida de sal | [A3 01:24-01:27] |
| 4 | Envasado | Cantidad de quesos envasados, por tipo | [A4 00:23-01:03] |
| 5 | Maduración | Qué hay en cámara y cuándo entró | [A5 00:08-00:51] |
| 6 | Armado de pedidos | Cliente, piezas y **peso** de cada queso | [A6 00:00-01:39] |

Además, un **puesto de escritorio "arriba"** para el encargado, donde ve los pedidos armados y
factura **[A6 01:11-01:28]**.

**Requerimientos de hardware/instalación** **[A2 00:00-00:20]**:
- Interfaz **muy simple** — "hay que crearlo más simple".
- Las tablets quedan **fijas en un lugar**, montadas **en la pared a una altura cómoda**.
- ✅ **Confirmado por el cliente (2026-09-11):** van **amuradas a la pared**, no son móviles, y el
  lugar está apto para el montaje. Hay **internet en la fábrica**.
- 🔸 **Inferencia:** son puestos compartidos por varios operarios, no dispositivos personales. Esto
  define el modelo de identificación (ver 4.1).
- ⚠️ Que haya internet en la fábrica no garantiza **cobertura dentro de las cámaras frigoríficas**,
  que son cajas metálicas. Es lo único que podría forzar un modo offline. Ver pregunta **D2**.

---

## 4. Requerimientos transversales

### 4.1 Trazabilidad de operario, fecha y hora
> "todo lo que mientras se pueda tener con fecha y hora es un lujo... que me diga operario, fecha y
> hora" **[A4 00:00-00:18]**

- Cada registro guarda **operario + fecha + hora**.
- La identificación es **por nombre, de una lista**: "que se pueda seleccionar por nombre de
  operario" **[A3 00:48-00:52]**.
- ❓ Sin contraseña ni PIN, entonces. Ver pregunta **B1**.

### 4.2 El horario no es un metadato, es un dato de proceso
> "que figure el horario que se hizo eso, porque eso después te da un tiempo... entre que el pH
> llega donde tiene que llegar" **[A3 01:00-01:13]**

El timestamp de producción se usa para **controlar el proceso** (evolución del pH hasta el ingreso
al saladero), no solo para auditoría. Esto lo vuelve un requerimiento **funcional**, no técnico.

### 4.3 Las cantidades son variables, no fijas
> "no siempre salen las mismas... depende de la altura de la masa, de lo que rindió. Un día te
> pueden salir 120 sardos, al otro día 117, al otro día 124" **[A3 00:24-00:42]**

El sistema **no puede asumir un rendimiento fijo por tina**: la cantidad producida se ingresa a mano
en cada una. 🔸 **Inferencia:** el rendimiento real vs. esperado es un indicador que van a querer
ver, aunque no lo hayan pedido.

---

## 5. Requerimientos por sector

### 5.1 Lechería — punto de arranque
> "por ahí es por donde yo arrancaría porque es lo más fácil para probar, porque ya está como hecho,
> obviamente es súper precario, pero sería lo más simple de hacer" **[A2 01:01-01:12]**

- Registrar cada **pallet** armado.
- ⚠️ **Corregido el 2026-09-14:** los litros **no son fijos por pallet**. Un pallet puede armarse
  en **caja** (70 × 12 sachets de 1 L = 840 L, confirmado) o en **palangana** — dos tipos distintos,
  con cantidades que el cliente todavía no tiene. Por eso el envase es una **elección del operario
  en cada pallet**, no una propiedad del producto.
  - Un pallet es **homogéneo**: una marca, un tipo de leche, un envase. No se mezcla.
  - Los pallets en un formato sin confirmar **se registran igual** y sus litros quedan en nulo.
    Al cargar el formato en `/envases.html` se completan solos.
- ✅ **Equivalencia del formato en caja (2026-09-13):** **70 cajas de 12 litros = 840 litros**. El cliente razona en litros, no en pallets, así que el equivalente se muestra en
  el tablero LED, en los reportes y en la consulta del día.
  - 🔸 La equivalencia se guarda **por producto** (no como constante) y se **congela en cada
    registro**: si mañana cambia el tamaño de la caja, los pallets históricos conservan la
    equivalencia que era cierta el día que se armaron, y los reportes viejos no se reescriben solos.
- Por **marca**: Central Lechera, **Lácteos Belgrano**, y **Obenac (marca propia)**.
- Por **tipo**: ✅ **confirmado contra el catálogo web** — **Leche Entera**, **Leche Entera
  Largavida**, **Leche Descremada** **[A2 00:41-01:00]**.
- ❓ La grafía de **Obenac** quedó confirmada por el cliente el 2026-09-22 (con B). Ver pregunta **A1**.

🔸 **Inferencia importante:** que produzcan bajo marcas de terceros *y* una propia sugiere trabajo
de **maquila para terceros**. Si es así, la trazabilidad por marca/cliente tiene implicancias
regulatorias y contractuales que no aparecieron en los audios. Ver pregunta **A3**.

### 5.1b Lechería · yogures — **tablet separada**
> Definido con el cliente el 2026-09-14.

- Es **otra tablet**: dos puestos distintos, dos pantallas (`/lecheria.html` y `/yogures.html`).
- Solo **dos sabores**: vainilla y frutilla.
- Se produce en **dos marcas**. ⚠️ **Obenac NO hace yogur** — el sistema lo modela como "qué
  familia de producto hace cada marca", no como un caso especial.
- Se registra **caja por caja**, no por pallet. Cada caja lleva ~500 sachets.
- ❓ El cliente dio las 500 unidades como **aproximadas** y decidió dejarlas fijas. Queda
  configurable: si al contarlas resulta que varían, conviene que el operario cargue la cantidad
  real — igual que el rinde de la tina.
- ❓ *"Los trabajan por kilos también"*, pero el **peso del sachet no está confirmado**. Hasta que
  lo esté, los kilos quedan sin calcular y la pantalla no muestra nada en vez de inventar.

### 5.2 Quesería (producción)
- El maestro quesero arma **la tina** de un tipo de queso (ej. sardo) **[A3 00:08-00:22]**.
- Al terminar **corte y prensado**, el operario registra tipo de queso + cantidad obtenida
  **[A3 00:42-01:00]**.
- Debe quedar el **horario** del registro (ver 4.2).

### 5.3 Saladero
- Registrar **entrada a sal** y **salida de sal** **[A3 01:13-01:27]**.
- El ingreso al saladero es **el mismo día** que la producción **[A3 01:13-01:20]**.
- ❓ ¿Se registra por pieza, por tina o por lote? Ver pregunta **B2**.

### 5.4 Envasado
- El queso sale del saladero "desnudo" y va a la **cámara de desnudo** **[A4 00:29-00:42]**.
- El operario registra **cuántos quesos envasó** **[A4 00:52-01:03]**.
- **Se envasan:** barras, cremoso. **No se envasa:** sardo **[A4 00:42-00:52]**.
- Al envasarse, el queso pasa a estado **"listo para vender"** y ubicación **cámara de preparación
  de pedidos** **[A4 01:03-01:09]**.

### 5.5 Maduración
- Aplica a **pasta dura** (sardo, **reggianito**, parmesano) y **pasta semidura** (pategrás, mar del
  plata❓, fontina) **[A5 00:17-00:35]**.
- ⚠️ El catálogo web lista **más quesos de los que aparecen en los audios**, y *"mar del plata"* no
  figura en él. Ver punto 8 y pregunta **C6**.
- Necesita saber **qué hay** y **cuándo entró**, para calcular **días de maduración**
  **[A5 00:35-00:51]**.
- Caso de uso concreto: saber si el pategrás ya tiene los días para **"abrir ojos"**
  **[A5 00:43-00:51]**.
- 🔸 **Inferencia:** esto implica alertas o un tablero por días de maduración, no un mero registro.
  No se pidió explícitamente. Ver pregunta **C2**.

### 5.6 Armado de pedidos — el de mayor impacto en el negocio

El problema de fondo **[A6 00:13-00:27]**:
> "el queso no se vende por piezas — si bien te lo piden por piezas, se vende por piezas, pero como
> cada queso pesa distinto, se pesan todos los quesos"

🔸 **Inferencia:** se **pide por pieza** pero se **factura por kilo**, y por eso hay que pesar pieza
por pieza. Confirmar (pregunta **A2**), porque define todo el modelo de datos del pedido.

**Flujo actual** **[A6 00:30-00:54]**:
1. El encargado baja y le entrega **el papel** al operario de pedidos.
2. El operario arma el pedido y pesa los quesos.
3. **Anota los pesos a mano.**
4. Sube el papel → el encargado factura.

**Flujo pedido** **[A6 01:02-01:39]**:
1. El pedido llega a la tablet **por una de dos vías**: el operario **lo arma él mismo**, o
   **lo recibe de Andrés** (el encargado) — *"él puede armar el pedido **o** recibir el pedido de
   Andrés"* **[A6 01:02-01:11]**. ❓ Ver pregunta **C4**.
2. Registra **los kilos ahí mismo**.
3. El encargado lo ve **en tiempo real en su máquina de arriba**.
4. Puede facturar **pedido por pedido**, sin esperar a que se terminen todos.

Detalle operativo **[A6 01:28-01:39]**: suele haber **4 o 5 clientes en simultáneo**; hay que saber
qué cliente se armó y con cuántos quesos.

---

## 6. Estrategia de implementación (pedida explícitamente)

El audio 7 define el enfoque, y es una restricción del proyecto, no una sugerencia:

> "la parte de queso vamos como por partes, porque imagino que desarrollar todo junto tarda mucho...
> y además de que tarde mucho, ya si vamos por partes vamos encontrando cosas a corregir... seguro
> aparezca algo a corregir o a mejorar o hacer distinto" **[A7 00:09-00:45]**

**Fase 1 — arranque** **[A7 00:36-01:04]**
- Lechería (piloto: el proceso ya está estandarizado en papel).
- Quesería / producción.
- Saladero.
- Meta: *"tener control y datos de producción y saladero en tiempo real"*.

**Fase 2** **[A7 00:45-00:56]**
- Envasado.
- Maduración.

**Fase 3** 🔸 **Inferencia** — no fue asignada a ninguna fase, pero es el de mayor retorno
- Armado de pedidos + vista del encargado.
- ❓ Vale la pena discutir si conviene adelantarla: es donde hoy se pierde más tiempo. Ver
  pregunta **A4**.

Expectativa explícita de **iteración y corrección** sobre lo entregado. 🔸 **Inferencia:** conviene
acordar desde el arranque un ciclo de feedback corto y un criterio de qué entra como corrección y
qué como alcance nuevo.

---

## 8. Catálogo real vs. lo mencionado en los audios

Del sitio oficial. **Esta es la lista que alimenta los desplegables de las tablets**, y es bastante
más larga que la de los audios.

| Familia | Productos del catálogo web | ¿Apareció en los audios? |
|---|---|---|
| **Leches** | Leche Entera, Leche Entera Largavida, Leche Descremada | ✅ las tres |
| **Yogures** | Yogures Bebibles, Yogur Entero Firme | ❌ **nunca se mencionaron** |
| **Quesos blandos** | Queso Cremoso, Queso Cremoso Extra, Mozzarella cilindro, Mozzarella barra, Queso Por Salut, Queso Por Salut sin sal | parcial — solo "cremoso" y "las barras" |
| **Quesos semiduros** | Gouda, Pategras, Fontina, Tybo, Cheddar en barra, Ricota | parcial — solo pategrás y fontina |
| **Quesos duros** | Sardo, Reggianito, Provolone, Provoleta, Parmesano | parcial — sardo, reggianito, parmesano |

**Tres observaciones que importan para el alcance:**

1. 🚨 **Los yogures no aparecen en ningún audio.** Son una línea entera con un proceso
   completamente distinto: no hay tina, ni saladero, ni maduración. Si hay que incluirlos, es un
   flujo nuevo, no una opción más en un desplegable. Ver pregunta **C6**.
2. **"Las barras"** que se mencionan en envasado **[A4 00:46]** probablemente sean **Mozzarella
   barra** y/o **Cheddar en barra**, que sí están en el catálogo.
3. **"Mar del Plata"** (mencionado en maduración) **no figura en el catálogo web**. Puede ser un
   producto que no publicaron, un queso que hacen para terceros, o un error de las dos
   transcripciones. Confirmar.

---

## 7. Temas ausentes en los audios

Necesarios para poder estimar, y hoy sin ninguna definición:

- **Facturación**: se menciona como destino de los datos, pero no si el sistema factura, se integra
  con un sistema existente, o solo muestra los kilos.
- **Stock e inventario**: se deduce del flujo, pero nunca se pidió un módulo de stock.
- **Reportes y tableros**: ningún audio pide un reporte concreto.
- **Clientes y pedidos**: de dónde salen los pedidos que hoy bajan en papel.
- **Usuarios y permisos** más allá de "seleccionar operario por nombre".
- **Conectividad y ambiente** en planta: cámaras frigoríficas, humedad, lavados, WiFi.
- **Volumen**: cuántos operarios, piezas por día, pedidos por día.
- **Plazos, presupuesto y quién opera el sistema** una vez entregado.

Convertidos en preguntas concretas en [02-preguntas-abiertas.md](02-preguntas-abiertas.md).
