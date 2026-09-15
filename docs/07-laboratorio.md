# Laboratorio y control de proceso — análisis del material

**Fuente:** [requerimientos/laboratorio/](../requerimientos/laboratorio/) — 4 fotos de planillas,
3 notas de voz y un texto de referencia, entregados el 2026-09-15.
**Estado:** análisis completo — planillas y audios.

---

## 1. El hallazgo principal

El laboratorio **no es un sector más al final del circuito**. Está atravesado en todas las etapas
que ya tenemos construidas, y las planillas en papel lo demuestran: las mismas columnas que registra
hoy el sistema, más una o dos de control.

| Planilla en papel | Qué agrega sobre lo que ya registramos |
|---|---|
| Litros por tambo | **Todo un sector nuevo**: la leche cruda que entra |
| Elaboración de quesos | **pH** en bajada, control 1 y final, cada uno con su hora |
| Saladero | **pH** de ingreso y de salida |
| Muestras de leche | **Ensayo de vida útil**: control a 7 / 15 / 21 / 28 días |

Dicho de otra forma: **tres de las cuatro planillas son las pantallas que ya existen, con una
columna de más.** Eso las vuelve muy baratas de incorporar.

---

## 2. Recepción de leche cruda — el sector que falta

La foto *"litros por tambo"* muestra dos cosas superpuestas.

**Una hoja manuscrita** del 05.09.26 con pares tambo → litros:

```
 5    4500        4    1413
 2    3500       14    3832
 6    6000       15    6175
```

**Y un ticket impreso** que dice:

```
LÁCTEOS DEL SALADO S.R.L.
       RECEPCIÓN
REMITO Nro ... 09:019:40
TAMBO Nro .......... 14
LITROS .......... 3832
TEMP. ............ 12,3
Día/Hra: 2026-09-05-10:19
```

### Lo que esto revela

🚨 **Ya hay un equipo que mide y emite ticket.** Litros, temperatura, número de tambo, remito y
fecha/hora salen impresos. La hoja manuscrita es una **transcripción a mano de esos tickets**, y de
ahí Juana lo pasa a un Excel *("y se hacen las cuentas en base a eso")*.

O sea: el dato nace digital, se copia a mano a un papel, y se vuelve a tipear en un Excel. **Dos
transcripciones manuales de un número que ya existía en limpio.**

❓ **Pregunta que vale plata:** ¿ese equipo tiene salida serie / USB / red, o genera algún archivo?
Si la tiene, la recepción se captura sola y no hay nada que tipear. Si no, la tablet reemplaza la
hoja manuscrita y elimina una de las dos transcripciones.

### Por qué importa más allá de ahorrar tipeo

Es **el dato que le faltaba al sistema para cerrar el círculo**. Hasta ahora podíamos decir cuántas
piezas de queso salieron, pero no de cuánta leche. Con la recepción cargada aparece el número que
la fábrica hoy no puede ver: **litros de leche cruda → kilos de queso**, el rendimiento real de la
materia prima.

También aparece la **temperatura de recepción**, que es un control de calidad: la leche tiene que
llegar fría, y 12,3 °C es un dato que alguien mira.

### Entidad nueva: el tambo

Los tambos están numerados (2, 4, 5, 6, 14, 15). Son los proveedores de leche cruda. Hoy no existen
en el sistema.

---

## 3. pH — ya está en las planillas de dos sectores que tenemos

### Planilla diaria de elaboración de quesos

Columnas: `FECHA · TIPO DE QUESO · CANT · HORARIO BAJADA/pH · CONTROL 1 (hora, pH) · FINAL (hora, pH)
· OBSERVACIONES`

Comparado con la pantalla de quesería que ya existe:

| Columna | ¿Ya lo registramos? |
|---|---|
| Fecha · Tipo de queso · Cantidad | ✅ sí |
| Horario de bajada | ✅ es el timestamp del registro |
| **pH de bajada** | ❌ falta |
| **Control 1: hora + pH** | ❌ falta |
| **Final: hora + pH** | ❌ falta |

Ejemplos leídos de la planilla: Barra 148 con control a las 8:15 pH 5,40 · Cremoso 161 a las 10:25 ·
Masa 243 con final 8:00 pH 5,19.

### Planilla de saladero

Columnas: `TIPOS DE QUESOS · CANTIDAD · FECHA DE INGRESO · FECHA DE SALIDA · HORARIO ·
PH INGRESO · PH SALIDO DE SAL · FIRMA · OBSERVACIONES`

| Columna | ¿Ya lo registramos? |
|---|---|
| Tipo, cantidad, ingreso, salida, horario | ✅ sí |
| Firma | ✅ es el operario |
| **pH de ingreso** | ❌ falta |
| **pH de salida de sal** | ❌ falta |

Valores típicos leídos: ingreso entre 5,04 y 5,55 · salida entre 5,20 y 5,40.

> **Esto cierra el círculo del audio 3.** El cliente había dicho: *"que figure el horario que se
> hizo eso, porque eso después te da un tiempo, entre que el pH llega donde tiene que llegar"*.
> Nosotros registramos el horario, pero **el pH nunca se nos pidió explícitamente** — y acá está,
> en las dos planillas, con varias mediciones por tina.

---

## 4. Ensayo de vida útil de la leche

La planilla *"muestra de leche temperatura ambiente"* tiene:

`FECHA · TIPO DE MUESTRA · FECHA ELABORACIÓN · FECHA DE VENCIMIENTO · CANT./SACHET ·
7 DÍAS · 15 DÍAS · 21 DÍAS · 28 DÍAS · OBSERVACIONES`

Se toma una muestra de un lote, se deja a temperatura ambiente, y se controla a los 7, 15, 21 y 28
días para ver si aguanta. Es el control de vida útil de la leche larga vida.

La columna *"Cant./Sachet"* trae códigos tipo `15:08A`, `7:03B`, `11:28A` — 🔸 parecen el **código
de lote impreso en el sachet**: hora de envasado más la línea (A/B). Confirmar.

> El texto que acompaña dice: *"Acá se ve si todo va bien o salta alguna alarma"* y **"esto sería lo
> más crítico y necesario en momentos exactos de saber de laboratorio"**. O sea que el cliente
> señala este control como lo más importante del laboratorio.

**La buena noticia:** es exactamente el mismo problema que maduración. Una muestra ingresa en una
fecha y hay que controlarla a los N días. La maquinaria de estados —falta / apto / vencido— y de
alertas ya está construida; cambian los plazos y el vocabulario, no la lógica.

---

## 4b. Lo que agregan los audios

Los tres audios corrigen y completan el análisis de las fotos en cuatro puntos.

### El cliente pide explícitamente un sector laboratorio
> *"Yo necesitaría armar como un espacio así, **tipo un sector laboratorio en el sistema**, que
> puedan meter esos datos"* **[A2 00:55]**

No es una inferencia nuestra: lo pidió con esas palabras.

### ⚠️ Sí hay análisis fisicoquímicos — corrige lo que decían las fotos
> *"No todos dieron los mismos litros... entra con cierta **acidez**, con cierta cantidad de
> **proteína**, con todos los **análisis que se le hacen a la leche**, y se anotan"* **[A2 00:42-00:50]**

Mirando solo las planillas yo había concluido que no hacía falta un módulo de análisis de
composición. **Estaba equivocado.** Las fotos que llegaron son de control de proceso, pero el audio
deja claro que a cada recepción se le miden acidez, proteína y otros parámetros, y que se anotan.

Y hay un motivo de negocio detrás: **de eso salen los pagos a los tambos.**

### El circuito del dato de recepción, en sus palabras
> *"Es lo que arroja el **caudalímetro**, que después se pasa a mano... y se guardan los papelitos
> acá, hasta que Juana los carga al sistema que tiene para preparar las cuentas de los tambos.
> Entonces yo tendría que poder, **en vez de cargarlo a un papel, cargarlo al sistemita** y tener
> el control ahí"* **[A2 01:06-01:36]**

Confirma lo que se veía en la foto: caudalímetro → papel → papelitos guardados → Excel de Juana.
**Juana es quien prepara los pagos de los tambos y las cuentas de los clientes** **[A2 00:23-00:32]**.

### Prioridad del cliente, dicha por él
> *"Lo que **más me interesa** es la cantidad de litros que ingresan"* **[A3 00:00]**

Esto reordena la propuesta: la recepción va primero, no el pH.

### Requerimiento nuevo: reportes imprimibles
> *"Yo quiero largar un reporte, lo largo y **lo imprimo** y me guardo un reporte **semanal, o día,
> o lo que quiera**"* **[A2 01:37-01:42]**

Los reportes que existen hoy se ven en pantalla y exportan CSV. Falta que se puedan **imprimir
prolijos**, por día o por semana.

### La pantalla de muestras NO es una tablet con guantes
> *"Eso por ahí es un poco más elaborado, y acá necesitaría que **tenga un teclado**, que puedan
> seleccionar, escribir y todas esas cosas"* **[A3 00:13-00:25]**

Es una distinción de diseño importante. Todas las pantallas de planta se construyeron con botones
grandes y **cero teclado**, porque el operario tiene guantes. La de laboratorio es al revés: alguien
sentado, escribiendo, con fechas y observaciones en texto libre.

**Campos que enumera para la muestra** **[A3 00:25-00:38]**: marca · si es entera o descremada ·
fecha de vencimiento · fecha de elaboración · cantidad de sachet · **la hora en que entró a
sachet** · los controles a 7, 15, 21 y 28 días · observaciones.

> Eso aclara la columna *"Cant./Sachet"* de la planilla: son **dos datos**, la cantidad y la hora de
> envasado. Los códigos `15:08A` y `7:03B` son la hora más la línea.

También menciona *"muestras de estufa"* **[A3 00:13]**, mientras la planilla dice "temperatura
ambiente". ❓ Puede haber dos ensayos distintos, o ser el mismo con otro nombre.

---

## 5. Qué propongo agregar al MVP, y en qué orden

> ## ✅ CONSTRUIDO (2026-09-15)
>
> **Respuestas del cliente que definieron el diseño:**
> - El caudalímetro **no tiene salida de datos** todavía — están trabajando en automatizarlo.
>   Por eso la carga es manual, y la pantalla se hizo para copiar el ticket rápido: los pasos van
>   en el mismo orden en que salen impresos (tambo → litros → temperatura).
> - **El pago al tambo se hace hoy sumando las cantidades a mano.** Eso cambió cuál era la parte
>   valiosa: la pantalla de carga solo mueve el tipeo de lugar; **el reporte por tambo es lo que
>   hace desaparecer la suma**.
> - Los análisis siguen sin definirse, así que **no se construyeron**. Nada inventado.
>
> **Qué quedó:** `/recepcion.html` (tablet) y `/leche-cruda.html` (reporte imprimible por tambo,
> con filtro por fecha y por tambo, export CSV y vista de impresión sin filtros ni botones).
>
> La temperatura se carga como la balanza de pedidos: dígitos desde la derecha, sin tecla de coma.
> Teclear 1-2-3 da 12,3 °C. Y las entregas por encima de 8 °C se resaltan — umbral provisorio, falta
> el límite real de la fábrica.

### Primero: recepción de leche cruda con sus análisis
**Por qué:** el cliente dijo que es lo que más le interesa, y es el sector que cierra el circuito.
Reemplaza la hoja manuscrita y habilita el rendimiento real litros → queso.
**Qué lleva:** tambo · litros · temperatura · remito · fecha y hora · **acidez, proteína y los demás
análisis** que se le hacen a cada recepción.
**Costo:** medio. Sector nuevo, entidad nueva (tambos), pantalla nueva.

🚨 **Antes de construir hay que responder una pregunta:** ¿el caudalímetro tiene salida de datos
—serie, USB, red, un archivo—? Cambia por completo el diseño. Con salida, la recepción se captura
sola. Sin salida, la pantalla reemplaza la hoja manuscrita y elimina **una** de las dos
transcripciones que hoy existen.

### Segundo: pH en quesería y saladero
**Por qué:** son campos en pantallas que ya existen y las planillas ya los piden. El mayor encaje
con el menor esfuerzo.
**Costo:** bajo.
**Cuidado:** el pH se mide **varias veces por tina** (bajada, control 1, final). No es un campo
único: es una serie de mediciones con hora, igual que los pesos de un pedido.

### Tercero: muestras y ensayo de vida útil
**Por qué:** el cliente lo marcó como lo más crítico del laboratorio, y reutiliza la lógica de
maduración casi tal cual: ingresa en una fecha, se controla a los N días.
**Costo:** bajo-medio, porque el patrón ya está resuelto.
**Distinto a todo lo demás:** esta pantalla es **de escritorio, con teclado**. El cliente lo pidió
así — hay fechas, códigos de lote y observaciones en texto libre. No es una tablet con guantes.

### Cuarto: reportes imprimibles
**Por qué:** *"lo largo, lo imprimo y me guardo un reporte semanal o del día"*. Hoy los reportes
viven en pantalla y exportan CSV; falta una vista para imprimir.
**Costo:** bajo. Es una hoja de estilos de impresión sobre los reportes que ya existen.

### Lo que sigue sin pedirse
Un LIMS completo con trazabilidad de instrumentos, calibraciones y firmas digitales. Nada de eso
aparece en el material.

---

## 6. Preguntas que abre este material

1. 🚨 **¿El caudalímetro tiene salida de datos?** (serie, USB, red, archivo). Es la pregunta más
   importante de todas: decide si la recepción se captura sola o se tipea.
1b. **¿Qué análisis se le hacen a cada recepción, exactamente?** El audio menciona acidez y
   proteína "y todos los análisis". Hace falta la lista completa con sus unidades y sus rangos
   aceptables, porque de ahí salen los pagos a los tambos.
1c. **¿Cómo se calcula el pago a un tambo?** ¿Por litro, o por litro ajustado por calidad? Si el
   sistema va a reemplazar la planilla de Juana, esto define qué tiene que poder calcular — o si
   solo entrega los datos y el cálculo sigue en su Excel.
2. **¿Cuántos tambos hay y cómo se identifican?** Se ven los números 2, 4, 5, 6, 14, 15.
3. **¿Qué se hace con la temperatura de recepción?** ¿Hay un límite a partir del cual se rechaza
   la leche?
4. **¿Qué valores de pH son correctos en cada etapa?** Sin el rango esperado el sistema solo
   registra; con el rango, avisa. Es lo mismo que pasó con los días de maduración.
5. **¿Cuántos controles de pH hay por tina?** La planilla muestra bajada, control 1 y final —
   ¿siempre son tres, o varía?
6. ✅ *"Cant./Sachet" son **dos datos**: la cantidad de sachets y la **hora de envasado**
   (resuelto por el audio 3). Los códigos `15:08A` serían hora más línea — confirmar la letra.*
6b. **¿"Muestras de estufa" y "temperatura ambiente" son el mismo ensayo?** El audio dice estufa,
   la planilla dice ambiente. Pueden ser dos controles distintos.
7. **¿Quién hace los controles?** ¿Un laboratorista, o el mismo operario de cada sector? Define si
   es una tablet más o campos en las tablets que ya están.
8. **¿Qué pasa cuando un control sale mal?** ¿Se descarta el lote, se reprocesa, se avisa a
   alguien? Eso es lo que convierte el registro en una alarma útil.
