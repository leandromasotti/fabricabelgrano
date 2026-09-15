# Fábrica Belgrano — Preguntas abiertas

Derivadas de [01-requerimientos.md](01-requerimientos.md). Ordenadas por impacto: las **A** cambian
el diseño del sistema, las **B** cambian el diseño de una pantalla, las **C** definen alcance, las
**D** son de proyecto.

Formato pensado para llevar a una charla y completar en el momento.

---

## A. Bloqueantes — sin esto no se puede diseñar el modelo de datos

### A1. Confirmar cuatro nombres del sector lechería
Se hicieron **dos transcripciones independientes** (modelos `small` y `medium`). La mayoría de los
términos quedaron resueltos por coincidencia entre ambas; sobreviven estos cuatro, todos del sector
lechería, que es justamente la fase 1.

| Lo que dicen las transcripciones | Resolución | Estado |
|---|---|---|
| "lácteos del grano" | **Lácteos Belgrano** (razón social: Lácteos Del Salado SRL) | ✅ resuelto por la web |
| "el gavida" | **Leche Entera Largavida** — es un producto del catálogo | ✅ resuelto por la web |
| "el screma" | **Leche Descremada** | ✅ resuelto por la web |
| "marca ovenac" | sin identificar | ❌ **pendiente** |
| "Central Lechera" | marca de terceros, razón social sin verificar | ⚠️ menor |

**La única que queda es "Ovenac".** Y ahora la pregunta correcta no es cómo se escribe, sino:

> **¿Cuáles marcas son propias y cuáles de terceros?** La empresa es *Lácteos Del Salado SRL* y la
> marca comercial es *Lácteos Belgrano*, pero en el audio se dice *"marca Ovenac, **que es
> nuestra**"*, lo que sugiere **más de una marca propia**. Hay que mapear: marca → ¿propia o
> maquila para terceros?

**Por qué importa:** son las opciones de los combos que los operarios de lechería van a tocar todos
los días, desde el primer día del piloto.

> **Ya resueltos, no hace falta preguntarlos:** `tina` (confirmado literal: *"el maestro quesero
> hace la tina"*), `quesería`, `cámara de desnudo`, `envasado`, `kilaje`, `reggianito`, y que el
> encargado es **Andrés**.

### A2. El pedido: ¿se pide por pieza y se factura por kilo?
Del audio 6 se entiende que el cliente pide *"3 pategrás"* pero la factura sale por los kilos reales
pesados. **¿Es así?**

> Nota: la frase original quedó trabada en las dos transcripciones (*"el queso no se vende por pieza,
> si bien te lo piden por pieza, se vende por pieza, pero como cada queso pesa distinto, se pesan
> todos"*). No es un error de transcripción, es un trabalenguas al hablar — pero deja la duda sin
> cerrar. **Una factura real la contesta sin preguntar nada.**

Si es así, cada línea de pedido tiene: cantidad pedida (piezas) → piezas efectivamente entregadas →
peso de cada pieza → kilos totales → precio por kilo.

- ¿Se pesa **pieza por pieza** o el total del pedido de ese tipo de queso?
- ¿Hay quesos que sí se vendan por unidad a precio fijo?
- ¿Puede entregarse una cantidad distinta a la pedida? ¿Se acepta, se avisa, se rechaza?

**Por qué importa:** es la diferencia entre un modelo de pedido simple y uno con doble unidad de
medida. Cambia el diseño de toda la pantalla de armado.

### A3. ¿Producen para terceros (maquila)? — **casi confirmado**
Se mencionan al menos tres marcas ("Central Lechera", "Lácteos Belgrano", "Ovenac") y el sitio
oficial solo publica productos bajo **Lácteos Belgrano**. Eso hace muy probable que se produzca
para terceros. Si es así:
- ¿Hay que poder reportarle a cada marca su producción por separado?
- ¿Hay requisitos de trazabilidad por normativa (SENASA, bromatología) que el sistema deba cubrir?
- ¿La leche que entra ya viene asignada a una marca, o se asigna al producir?

**Por qué importa:** puede convertir un registro interno en un sistema con obligaciones externas.

### A4. ¿Armado de pedidos entra antes de lo planeado?
El plan es lechería → producción → saladero → envasado → maduración, y armado de pedidos quedó sin
fase asignada. Pero **es donde hoy se pierde tiempo concreto y medible**: el encargado espera a que
suba el papel para poder facturar.

- ¿Hay una razón para dejarlo para el final, o simplemente no se ordenó?
- Si se adelanta, ¿el beneficio se nota antes que con lechería?

**Por qué importa:** define si el proyecto muestra valor en la semana 3 o en el mes 4.

### A5. ¿Qué pasa con la facturación?
Se nombra varias veces pero nunca se define.
- ¿Con qué facturan hoy? (sistema, Excel, AFIP directo, un contador)
- ¿El sistema nuevo **factura**, **le pasa datos** al que factura, o solo **muestra los kilos** para
  que alguien los cargue a mano?
- Si hay que integrar: ¿qué sistema es y tiene API/exportación?

**Por qué importa:** es la diferencia entre un proyecto de captura de datos y uno con integración
contable/fiscal.

---

## B. Definiciones funcionales — cambian pantallas concretas

### B1. Identificación del operario: ¿nombre solo, o nombre + PIN?
Se pidió "seleccionar por nombre de operario" en una tablet **compartida y colgada en la pared**.

- ¿Alcanza con elegir el nombre de una lista, sin validación?
- ¿Importa que alguien pueda registrar producción a nombre de otro (por error o a propósito)?
- ¿Cuántos operarios hay por sector? (una lista de 8 nombres y una de 60 son pantallas distintas)
- ¿Rota la gente entre sectores?

### B2. ¿Cuál es la unidad que se sigue: la pieza, la tina o el lote?
Esta es **la decisión estructural del sistema**. Hoy los audios mezclan los tres niveles:
- Producción registra **cantidades por tina** ("120 sardos").
- Saladero marca entrada y salida — ¿de las 120 piezas juntas o de a una?
- Envasado cuenta **piezas** envasadas.
- Armado de pedidos pesa **pieza por pieza**.

**Preguntas:**
- ¿Una tina entra y sale del saladero como un bloque, o las piezas se van moviendo sueltas?
- ¿Se puede saber de qué tina salió una pieza concreta que está en la cámara?
- ¿Hace falta saberlo, o alcanza con cantidades por tipo de queso?

**Por qué importa:** si hace falta trazar la pieza individual, cada queso necesita identificación
física (etiqueta, código). Si alcanza con cantidades, el sistema es mucho más simple. **Es la
pregunta que más cambia el presupuesto.**

### B3. El circuito envasado / maduración — **hay un supuesto en el código**

⚠️ Para poder construir, asumí este circuito: **sal → maduración → envasado**. Un queso que madura
entra a cámara al salir de sal, y recién cuando sale de cámara queda disponible para envasar. El
sardo, que no se envasa, sale de cámara y ya está listo.

Es una inferencia, no un dato. **Si el circuito real es otro, se cambia en un solo lugar**
(`DISPONIBLE_ENVASAR` en `server/index.js`); nada más depende de eso. Pero mientras tanto el sistema
va a impedir envasar un pategrás que no pasó por cámara, así que conviene confirmarlo antes del
piloto de esos sectores.

Lo que sigue sin quedar claro:
- El sardo **no se envasa** pero **sí madura**. ¿Va de saladero directo a maduración?
- Los que sí se envasan (barras, cremoso), ¿maduran antes o después de envasarse?
- ¿La "cámara de desnudo" y la "cámara de maduración" son la misma o distintas?
- ¿Hay quesos que salgan a la venta sin madurar?

Un diagrama de las cámaras físicas de la planta resolvería esto en dos minutos.

### B6. ¿Cuánto tarda normalmente una tina en entrar a sal? — **surgió al construir**
El sistema ya calcula el intervalo entre producción e ingreso al saladero, porque es
el dato del control de pH. Pero para que sirva de alerta hay que saber qué es normal:

- ¿Cuál es el intervalo esperado entre que se cierra la tina y entra a la sal?
- ¿A partir de cuántas horas se considera que hubo un problema?
- ¿Varía por tipo de queso?

Hoy el código usa **4 h** como umbral para resaltar una tina demorada y **12 h** para
contar una entrada como "marcada tarde". Los dos son provisorios e inventados por mí:
están en `public/saladero.js` (`MINUTOS_DEMORA`) y `server/index.js` (`TARDE`).

**Por qué importa:** con el número real, la pantalla de saladero pasa de registrar a
avisar. Sin él, es solo una lista ordenada.

> Nota de implementación: el tiempo se reporta como **mediana, no promedio**. Durante
> las pruebas, dos tinas viejas recibieron su entrada a sal semanas después y movieron
> el promedio de 3,7 h a 15 h. Eso va a pasar en planta cada vez que alguien se olvide
> de marcar. La mediana ignora esos casos y, aparte, el sistema los cuenta como
> "marcadas +12 h tarde" — que es una señal operativa en sí misma, no ruido.

### B7. Lechería — lo que falta para cerrar el sector (2026-09-14)

**Formatos de pallet.** Solo el de caja está confirmado. Faltan **dos números** por cada tipo
de palangana:
- ¿Cuántas palanganas entran en un pallet?
- ¿Cuántos sachets entran en una palangana?

✅ *El sachet de leche es de **1 litro** en todos los formatos (confirmado 2026-09-15), así que ya
está cargado y no hace falta preguntarlo.*

Se cargan en `/envases.html` sin tocar código, y los pallets ya registrados con ese formato se
completan solos.

**Yogur.**
- ¿Cuánto pesa un sachet? Sin ese dato los kilos no se pueden calcular, y **"los trabajan por
  kilos"** era parte del requerimiento.
- Las cajas, ¿traen **siempre** 500 sachets o varía? El cliente lo dio como aproximado. Si varía,
  el operario debería cargar la cantidad real en vez de que el sistema multiplique por un número
  que nadie garantiza — es el mismo caso que el rinde de la tina.
- ✅ *Los operarios de yogures son **distintos** a los de leches y las tablets van en sectores
  diferentes (confirmado 2026-09-15). El sistema ya los maneja como listas separadas:
  `npm run operarios -- yogures "..."`.*

### B4. Correcciones y errores
Nadie lo mencionó, y es lo primero que va a pasar en producción:
- Si un operario carga 120 en vez de 12, ¿puede corregirlo él? ¿Hasta cuándo?
- ¿Alguien tiene que autorizar la corrección?
- ¿Queda registro de que se corrigió?
- ¿Qué pasa si se olvidan de marcar la salida del saladero y se dan cuenta al otro día?

### B5. Merma, descarte y reproceso
Tampoco se mencionó:
- ¿Se descartan quesos? ¿En qué etapa se detecta?
- ¿Hay que registrar el descarte y su motivo?
- ¿Un queso puede volver atrás en el circuito?

---

## C. Alcance — definen qué se construye y qué no

### C1. ¿Qué quiere ver el encargado, y en qué pantalla?
Se pidió "control y datos en tiempo real", pero nunca se dijo *qué datos* ni *en qué formato*.

- ¿Qué es lo primero que querría ver al abrir el sistema a la mañana?
- ¿Y a fin de mes?
- ¿En la PC de arriba, en el celular, o ambos?
- Concretamente: ¿producción del día, stock por cámara, pedidos pendientes, rendimiento por tina?

**Sugerencia:** pedirle que describa la pantalla ideal, aunque sea dibujada en papel. Es la forma
más rápida de descubrir requerimientos que no se dicen.

> **Ya hay algo construido para reaccionar contra.** La pantalla de reportes
> (`/reportes.html`) tiene producción por día, por tipo de queso, pallets por marca,
> rendimiento por tina y filtros por fecha y queso. No sale de ningún pedido: son los
> reportes que se desprenden de los datos que ya se capturan. **Mostrárselos es más
> útil que preguntar**, porque criticar algo concreto es mucho más fácil que describir
> algo que no existe.

### C2. Maduración — **construido, faltan los días reales**

Ya está implementado: la pantalla de maduración muestra cada lote con su estado, y el tablero LED
lo refleja. Se resolvieron tres cosas por diseño que conviene que el cliente valide:

1. **El reloj arranca al entrar a la cámara, no al producir.** El audio dice *"sé **cuándo
   entraron**"* **[A5 00:43]**. Entre producir y madurar hay saladero, y contar esos días como
   maduración declararía apto un queso todavía verde.
2. **Cuatro estados, no dos**: falta / apto / en su punto / se pasa. Un queso no pasa de no-apto a
   apto un martes a las 8; con un solo umbral el sistema falla justo en los bordes, que es donde se
   decide. El estado "se pasa" es el que más plata cuida: avisa del queso que se está yendo de punto
   en la cámara, que hoy nadie ve hasta abrirlo.
3. **El sistema sugiere, el quesero decide.** El estado es una referencia visible; la salida se
   registra cuando él lo dispone. Al salir se guardan los **días reales**, así que a las pocas
   semanas el sistema sabe cuánto madura cada queso *en esa cámara y en esa época*, que vale más
   que cualquier número teórico.

🚨 **Lo único que falta: los días reales por tipo de queso.** Hoy están cargados **valores de
referencia que yo inventé**, marcados como provisorios en la base y anunciados como tales en la
pantalla. Se corrigen en `/maduracion-dias.html` sin tocar código, y al guardarlos dejan de ser
provisorios — un seed posterior ya no los pisa.

Pendiente de confirmar con el quesero:
- Los días mínimo / óptimo / máximo de cada queso.
- ¿Varían por estación? (la cámara no se comporta igual en enero que en julio)
- ¿Hay que **avisar** cuando un lote llega al punto, o alcanza con consultarlo?
- **¿Dónde está físicamente cada lote en la cámara?** Saber que hay 120 pategrás aptos no sirve si
  nadie sabe en qué estantería están. No aparece en ningún audio, pero en una cámara con cientos de
  piezas la ubicación es la mitad del problema. Es un campo barato de agregar y probablemente sea
  lo que más agradezcan.

### C3. ¿Hace falta un módulo de stock?
Del flujo se deduce un inventario por cámara, pero nunca se pidió.
- ¿Quieren saber "cuántos pategrás hay hoy en la cámara" como número consultable?
- ¿Se hacen recuentos físicos? ¿Con qué frecuencia?
- ¿Qué se hace hoy cuando el número real no coincide con el anotado?

### C4. ¿De dónde salen los pedidos? — **subió de prioridad**
El audio 6 dice que el operario *"puede armar el pedido **o** recibir el pedido de Andrés"*: son
**dos vías de origen distintas**. Eso implica que la tablet necesita una pantalla de alta de pedido
con lista de clientes, no solo una bandeja de entrada.

- ¿Cuándo arma el pedido el operario por su cuenta y cuándo se lo manda Andrés?
- ¿Puede el mismo cliente entrar por las dos vías el mismo día? ¿Qué pasa si se duplica?

Y lo original: hoy "bajan en papel". Antes de eso, ¿dónde estaban?
- ¿Los toma el encargado por teléfono/WhatsApp? ¿Hay un sistema de ventas?
- ¿El sistema nuevo tiene que **cargar** pedidos, o solo recibir los que el encargado le pase?
- ¿Hay una lista de clientes que haya que mantener?

### C5. Los cuatro canales de venta — ¿cuáles entran al sistema?
El sitio oficial declara **cuatro canales**, y los audios describen solo uno:

| Canal | ¿Aparece en los audios? |
|---|---|
| Mayorista (pedidos que arma "el chico de los pedidos") | ✅ es el único descrito |
| **Venta directa de fábrica** (martes, jueves, viernes y sábados) | ❌ |
| **Local minorista en Chascomús** | ❌ |
| **3 unidades de reparto propias + distribuidores provinciales** | ❌ |

- ¿La venta directa de fábrica descuenta del mismo stock que los pedidos mayoristas? Si no se
  registra, el stock del sistema va a estar siempre mal.
- ¿Las 3 unidades de reparto cargan mercadería que hay que descontar de la cámara?
- ¿El local de Chascomús se abastece desde esta planta?

**Por qué importa:** si el sistema va a decir "cuántos pategrás hay en la cámara", tiene que
conocer **todas las salidas**, no solo la mayorista. Un módulo de stock que ignora tres de cuatro
canales da números falsos, y un número falso es peor que no tener número.

### C6. ¿Los yogures entran en el alcance?
El catálogo incluye **Yogures Bebibles** y **Yogur Entero Firme**, y **no se mencionan en ningún
audio**.

- ¿Se producen en esta misma planta?
- ¿Hay que registrarlos también, o quedan afuera?

**Por qué importa:** el yogur no pasa por tina, saladero ni maduración. No es "un producto más en
la lista": es un **flujo productivo distinto**, con sus propias pantallas. Que se haya omitido
puede significar que queda fuera de alcance, o que simplemente no se mencionó — y la diferencia
entre esas dos cosas es grande.

### C7. Productos del catálogo que no aparecieron
Los audios nombran ~8 quesos; el catálogo lista **17 productos**. Faltan por mencionar: Gouda,
Tybo, Cheddar en barra, Ricota, Provolone, Provoleta, Mozzarella (cilindro y barra), Por Salut y
Por Salut sin sal, Queso Cremoso Extra.

- ¿Se producen todos en esta planta o algunos se compran/tercerizan?
- ¿Todos siguen el mismo circuito (tina → saladero → envasado/maduración)?
- La **ricota** casi seguro tiene un proceso distinto (se hace del suero). ¿Se registra?
- Y al revés: **"Mar del Plata"** se menciona en maduración pero **no está en el catálogo web**.
  ¿Existe? ¿Es para terceros?

**Por qué importa:** cada familia con circuito propio es una pantalla más. Necesitamos **la lista
real de lo que se produce**, no la comercial.

---

## D. Proyecto y contexto

### D1. Volumen y escala
- ¿Cuántas piezas se producen por día? ¿Cuántas tinas?
- ¿Cuántos pedidos por día? ¿Cuántos clientes activos?
- ¿Cuántos operarios usarían el sistema en total?
- ¿Cuántos turnos? ¿Trabajan sábados?

### D2. Ambiente físico y conectividad — **parcialmente resuelto**

✅ **Confirmado por el cliente (2026-09-11):** hay internet en la fábrica, y el lugar está apto para
amurar las tablets a la pared.

Queda abierto, y es lo que hay que mirar durante la recorrida:
- **Cobertura de WiFi sector por sector**, no "hay internet en la fábrica". El punto crítico son las
  **cámaras frigoríficas**: son cajas metálicas aisladas y se comportan como jaula de Faraday. Es
  habitual que el router llegue perfecto a la oficina y muera al cerrar la puerta de la cámara.
- Si en alguna cámara no hay señal: ¿se pone un AP adentro, o el sistema tiene que **funcionar
  offline y sincronizar** al salir? Esto último cambia la arquitectura, así que conviene saberlo
  antes de escribir la primera línea.
- **¿Hay toma de corriente en cada uno de los 6 puntos?** Amurada significa alimentación fija; una
  tablet colgada sin enchufe cerca es un problema de obra, no de software.
- ¿Los sectores se lavan con agua a presión? (define si hace falta gabinete estanco)
- ¿Los operarios usan guantes? (define el tamaño de los botones)
- Temperatura de las cámaras: las tablets de consumo no arrancan bien en frío.

### D3. Las tablets — **parcialmente resuelto**

✅ **Confirmado:** van **amuradas a la pared, fijas**. No son dispositivos móviles, y el cliente
considera que eso no es un problema operativo.

🔸 **Implicación de diseño:** si la tablet no se mueve, **el operario camina hasta ella**. En cinco
de los seis sectores eso es indistinto, pero en **armado de pedidos** importa: el operario pesa cada
queso y carga el peso, así que la tablet tiene que estar **al lado de la balanza**, no en la otra
punta del sector. Vale confirmarlo en la recorrida y, si se puede, marcar el punto exacto.

Queda abierto:
- ¿Ya las tienen o hay que comprarlas?
- ¿Android? ¿Presupuesto por equipo?
- ¿Quién hace la instalación eléctrica y el montaje?
- ❓ **¿La balanza es digital?** Si tiene salida serie/USB, el peso podría entrar solo en lugar de
  tipearlo — menos errores y más rápido. Si es analógica, se carga a mano y no hay más que hablar.

### D4. Expectativas de plazo
- ¿Hay una fecha objetivo para la Fase 1?
- ¿Hay algún evento del negocio que la condicione (auditoría, temporada alta, certificación)?

### D5. Quién mantiene esto
- Cuando entre un operario nuevo, ¿quién lo agrega a la lista?
- Cuando saquen un queso nuevo, ¿quién lo da de alta?
- ¿Alguien en la fábrica puede administrar el sistema, o cada cambio vuelve al desarrollador?

### D6. ¿Hubo intentos anteriores?
- ¿Probaron antes digitalizar esto? ¿Qué pasó?
- ¿Hay resistencia esperable de los operarios al cambio de papel a tablet?

**Por qué importa:** en planta, un sistema que los operarios no quieren usar simplemente no se usa,
y el papel vuelve solo.

---

## Sugerencia para la próxima charla

Tres cosas que valen más que las respuestas a todas estas preguntas juntas:

1. **Una recorrida por la planta**, aunque sea filmada con el celular, siguiendo el camino del queso
   de punta a punta. Resuelve B2, B3 y D2 de una sola vez.
2. **Una foto del cartón de lechería** y **del papel de pedidos** que usan hoy. El formulario en
   papel que la gente ya usa es el mejor borrador de la pantalla que hay que hacer.
3. **Media hora con el operario de armado de pedidos**, no con el encargado. Es quien va a usar la
   parte más compleja del sistema.
