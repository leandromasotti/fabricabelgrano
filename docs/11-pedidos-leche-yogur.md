# Pedidos de leche y yogur

**Fecha:** 2026-09-22 · **Pedido por:** el cliente, junto con el cambio de cajones

---

## Qué cambió

Hasta acá un pedido **era de queso**. La línea tenía `tipo_queso_id NOT NULL` y se cumplía
pesando pieza por pieza, porque cada queso pesa distinto — que es todo lo que describía el
audio 6.

Ahora una línea puede ser de tres clases:

| Clase | Qué identifica la línea | Unidad de `cantidad_pedida` | Cómo se cumple |
|---|---|---|---|
| **queso** | tipo de queso | piezas | pesando cada pieza (`pedido_pesos`) |
| **leche** | producto + marca + **formato** | bultos (cajones) | contando (`pedido_cantidades`) |
| **yogur** | producto + marca | unidades | contando (`pedido_cantidades`) |

---

## Las tres decisiones, y por qué

### La leche se pide en cajones, no en pallets ni en litros

Confirmado con el cliente el 22/9. Es lo que hace que el formato sea **parte del pedido** y
no un detalle del armado: pedir "40 cajones de Entera" sin decir si son x 18 o x 20 son
80 litros de diferencia en el mismo pallet.

Encaja con cómo lo describió Alexis en su momento:

> *"hay clientes que piden cajones x 20 unidades porque en un solo pallet meten mas litros
> y nosotros accedemos por tener poco espacio en los camiones"*

> *"puede suceder que el que arma los pedidos, pida por ejemplo un pallet con 20 cajones
> solamente"*

Las dos frases hablan de **cajones**, no de pallets ni de litros. Los litros los calcula el
sistema a partir del formato, y se muestran mientras se teclea.

### El armador carga lo que realmente preparó

No alcanza con marcar la línea como lista. El caso de "un pallet con 20 cajones solamente"
es exactamente el de entregar menos de lo pedido, y la factura tiene que salir por lo que
salió del depósito. Es la misma razón por la que el queso se pesa en vez de asumir el peso.

### Una tabla nueva y no un campo `cantidad_entregada`

`pedido_cantidades` guarda **una fila por carga**, igual que `pedido_pesos`. Un total pisado
en la línea perdería tres cosas que el sistema ya tiene:

- **deshacer de a una** carga, no todo el renglón
- **cola offline idempotente** por `client_id`, igual que el resto de las tablets
- **a qué hora** se preparó cada cosa

---

## Qué NO se mezcla

Los totales del pedido se calculan **por clase**, nunca sumados entre sí:

```
piezas / gramos          -> sólo queso
bultos / litros          -> sólo leche
unidades_yogur           -> sólo yogur
```

Sumar cajones de leche con piezas de queso da un número que no significa nada, y ese objeto
es del que sale el remito. En el CSV cada fila lleva su columna `unidad`, y los totales van
en filas separadas.

Lo mismo en las pantallas: el pie de la tablet y la tarjeta de Despacho muestran los kilos
de queso y los litros de leche por separado. Un pedido de sola leche mostraba "0 piezas ·
0,000 kg", que se lee como que no se armó nada.

---

## Las guardas

El modelo impide las combinaciones que no existen, en la base y no sólo en el código:

- `CHECK` de clase: una línea es de queso **o** de producto, nunca las dos ni ninguna
- leche **sin formato** → 400; yogur **con formato** → 400
- una marca que no hace esa familia → 400 (Obenac no hace yogur)
- **pesar** una línea de leche → 400; **contar** una de queso → 400
- índice único parcial: el mismo producto+marca+formato no se repite en un pedido; si se
  carga dos veces se suma en la línea que ya está

---

## Cómo se aplicó

```
node migraciones/003-pedidos-leche-yogur.js               # muestra qué haría
node migraciones/003-pedidos-leche-yogur.js --confirmar   # aplica
```

Aditiva: no toca ninguna fila existente. Las líneas de queso que ya había quedaron igual,
con las columnas nuevas en NULL. Corrida contra Docker (53 pedidos), Supabase (2) y el
SQLite local (13), sin pérdida de datos en ninguna.

---

## Lo que quedó afuera

**El alta rápida desde la tablet sigue siendo sólo de queso.** El armador puede crear un
pedido desde `pedidos.html` si le llega uno por teléfono, y ese atajo no ofrece leche ni
yogur. La carga normal —la del escritorio, en `/app/nuevo-pedido` y en Despacho— sí las
tiene. Se dejó así porque meter tres solapas con producto, marca y formato en una pantalla
que se opera con guantes es un problema de diseño distinto, y no es el camino por el que
entran los pedidos hoy.
