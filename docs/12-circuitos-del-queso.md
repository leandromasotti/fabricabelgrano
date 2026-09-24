# Los circuitos del queso — respuesta a B3

**Fecha:** 2026-09-22 · **Fuente:** mensajes de Alexis Giuliatti del 22/9, 21:16–21:19

---

## Por qué importa

[02-preguntas-abiertas.md](02-preguntas-abiertas.md) marcaba **B3** con una advertencia:

> ⚠️ Para poder construir, asumí este circuito: **sal → maduración → envasado**. Es una
> inferencia, no un dato. Si el circuito real es otro, se cambia en un solo lugar
> (`DISPONIBLE_ENVASAR` en `server/index.js`).

Alexis acaba de dar el circuito real. **No es uno, son tres**, y el supuesto sólo cubría
el primero.

---

## Lo que dijo, textual

**Van a cámara de maduración sin antes envasar:**
Sardo · Reggianito · Sbrinz (parmesano) · Provolone · Pategrás · Fontina · Gouda

**Se salan y de ahí pasan a esperar envasado:**
Cremoso · Cremoso Extra · Por salut sin sal *(este no pasa por salado)* · Por salut con
sal · Provoleta · Queso barra (tybo)

**A base de masa, se envasan en el momento de elaboración:**
Muzzarella cilindro · Cremoso procesado · Muzzarella barra

---

## Lo que esto significa para el modelo

El sistema tiene hoy **dos** caminos, decididos por un solo flag:

```js
const DISPONIBLE_ENVASAR = 'CASE WHEN madura = 1 THEN salio_camara ELSE salio_de_sal END'
```

Alexis describe **cuatro**:

| # | Circuito | Quiénes | ¿Lo soporta hoy? |
|---|---|---|---|
| 1 | producción → sal → **cámara** → envasado | los 7 del primer grupo | ✅ sí |
| 2 | producción → sal → espera envasado | Cremoso, Cremoso Extra, Por salut c/sal, Provoleta, Tybo | ⚠️ parcial |
| 3 | producción → espera envasado (**sin sal**) | Por salut sin sal | ❌ no |
| 4 | producción → **envasado inmediato** (masa) | las dos muzzarellas, Cremoso procesado | ❌ no |

### El malentendido del flag `madura`

La distinción que hace Alexis **no es si el queso madura**, es **si madura antes o después
de envasarse**. El código usa `madura` para lo primero y lo interpreta como lo segundo.

Tres quesos del grupo 2 tienen `madura = true` en la base:

| Queso | `madura` | Días cargados | Alexis dice |
|---|---|---|---|
| Cremoso | true | 10 / 20 / 25 **confirmados** | sal → espera envasado |
| Tybo | true | 27 / 40 / 65 **confirmados** | sal → espera envasado |
| Provoleta | true | 20 / 30 / 60 provisorios | sal → espera envasado |

No es una contradicción: **maduran, pero después de envasarse**. Los del grupo 1 maduran
*desnudos*, y por eso su maduración bloquea el envasado; los del grupo 2 no.

**Consecuencia concreta hoy:** con `madura = 1`, `DISPONIBLE_ENVASAR` exige una salida de
cámara que para estos tres nunca va a existir. Un cremoso salado y listo **no aparece en
la lista de envasado**, y el operario ve la pantalla vacía sin saber por qué.

### Lo que falta es un segundo eje

Con un flag no alcanza. Hacen falta dos preguntas independientes:

- **¿pasa por saladero?** — Por salut sin sal y los de masa, no
- **¿madura antes de envasarse?** — sólo el grupo 1

```js
// Cómo quedaría
CASE WHEN madura_antes_de_envasar THEN salio_camara
     WHEN pasa_por_sal            THEN salio_de_sal
     ELSE producido END
```

Sigue siendo **un solo lugar**, como prometía el doc. Lo que cambia es el catálogo: dos
columnas nuevas en `tipos_queso`, editables desde el ABM.

---

## Lo que faltaba, y cómo se cerró (2026-09-24)

Las tres preguntas que bloqueaban el cambio las respondió el cliente:

| Pregunta | Respuesta | Qué se hizo |
|---|---|---|
| ¿Cremoso procesado? | *"es un queso nuevo, con similares características a la muzzarella"* | Alta, circuito de masa |
| ¿Mar del Plata? | *"es el Pategrás"* | Baja: es el mismo queso con otro nombre |
| ¿Cheddar y Ricota? | *"por ahora no están haciendo"* | Baja |

**Las bajas son bajas, no borrados.** Cheddar tiene 9 tinas registradas y Mar del Plata 7
(948 piezas): esa producción tiene que seguir mostrando su nombre en el historial.

> ⚠️ **Mar del Plata queda con su historial aparte.** Si el cliente quiere que esas 7 tinas
> pasen a contar como Pategrás, es una decisión suya: reasignarlas reescribiría producción
> ya registrada, y eso no lo decide el código. Mientras tanto, los reportes muestran los
> dos por separado.

### Dos nombres que siguen sin coincidir

No se tocaron porque el cliente no los confirmó:

- La base dice **Parmesano**; Alexis dice **Sbrinz (parmesano)**
- La base dice **Por Salut**; Alexis distingue **Por salut con sal** y **sin sal** (las dos
  están, pero conviene renombrar la primera para que se lean como par)

---

## Cómo quedó implementado

Dos columnas nuevas en `tipos_queso`, editables desde el ABM:

```js
const DISPONIBLE_ENVASAR = `
  CASE WHEN madura_antes_de_envasar = 1 THEN salio_camara
       WHEN pasa_por_sal = 1            THEN salio_de_sal
       ELSE cantidad END`
```

Y un detalle que salió al probarlo: `espera_desde` era
`COALESCE(salida_camara_fecha, ultima_salida)`, y para los quesos de masa las dos son NULL
—no tienen salida de cámara ni de sal—, así que quedaban sin fecha y el `ORDER BY` los
mandaba a un extremo de la lista. Justo a los que hay que envasar en el momento. Ahora cae
a `fecha_hora`, que es cuando se produjeron.

```
node migraciones/004-circuitos-del-queso.js --confirmar
```

Aplicada a Docker, Supabase y el SQLite local. Verificada en los **dos motores** con los
cuatro casos: masa disponible al producirse, cremoso al salir de sal, pategrás recién al
salir de cámara, y sardo que nunca aparece.

---

## Corrección del 2026-09-24: el tybo no va a cámara

> *"El queso tybo No debe aparecer en Maduracion, es un queso barra que funciona como el
> cremoso."*

Venía con `madura = 1` y días de referencia de semiduro (25/40/65), que el seed carga como
punto de partida para que el sistema arranque mostrando algo — nunca salieron de la
fábrica. Ese flag lo hacía aparecer en la tablet de maduración esperando entrar a cámara.

Su circuito de **envasado** ya era correcto desde la migración 004 (sal → espera
envasado). Lo que faltaba era sacarlo de la **cámara**, que es una pregunta distinta.

Son tres flags y conviene tenerlos separados en la cabeza:

| Flag | Pregunta que responde |
|---|---|
| `pasa_por_sal` | ¿va al saladero? |
| `madura` | ¿aparece en la tablet de maduración? |
| `madura_antes_de_envasar` | ¿esa maduración bloquea el envasado? |

Aplicado con `migraciones/005-tybo-no-madura.js` a las tres bases.

### ⚠️ Dos que quedan raros, y hay que preguntar

**Cremoso** —el queso que el cliente usó como referencia para el tybo— **sí aparece hoy en
maduración**: `madura = 1`, con días 10/15/20 marcados como **confirmados por una persona**
desde el ABM. Si el tybo "funciona como el cremoso" y el tybo no va a cámara, entonces el
cremoso tampoco debería. No se tocó porque alguien confirmó esos días a mano y deshacerlo
sin preguntar sería pisar una decisión.

**Provoleta** está exactamente en la misma situación en que estaba el tybo: `madura = 1`,
`madura_antes_de_envasar = 0`, días provisorios. Nadie dijo nada de ella.

---

## Un hueco que esta corrección destapó

La migración 004 cambió `DISPONIBLE_ENVASAR` —que arma la **lista** de lo que falta
envasar— pero **no** la validación del `POST /api/envasado`, que seguía con la lógica vieja
de `madura`. Resultado: para un queso con `madura = 1` y `madura_antes_de_envasar = 0`
(provoleta, cremoso) la pantalla lo ofrecía y el servidor lo rechazaba con "excede lo que
salió de la cámara", sin que el operario pudiera entender por qué.

El criterio vive ahora en una sola función, `circuitoDe()`, que usan la lista y la
validación. Y hay un test que recorre varios quesos comparando las dos respuestas: si
alguna vez vuelven a divergir, falla.

---

## Estado de B3

✅ **Cerrada.**
