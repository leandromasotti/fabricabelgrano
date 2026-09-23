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

## Lo que falta antes de tocar código

### Un queso que no existe en el catálogo

**Cremoso procesado** está en la lista de Alexis y **no está en `tipos_queso`**. Hay que
darlo de alta.

### Tres quesos que Alexis no clasificó

Están en el catálogo y no aparecen en ninguno de los tres grupos:

| Queso | `madura` hoy | Días |
|---|---|---|
| Cheddar en barra | true | 65 / 95 / 180 confirmados |
| Mar del Plata | true | 32 / 48 / 70 confirmados |
| Ricota | false | — |

Por los días confirmados, Cheddar y Mar del Plata **parecen** del grupo 1, y Ricota del
grupo 4. Pero es inferencia, y es exactamente el tipo de inferencia que generó B3. **Hay
que preguntarlo.**

### Dos nombres que no coinciden

- La base dice **Parmesano**; Alexis dice **Sbrinz (parmesano)**
- La base dice **Por Salut**; Alexis distingue **Por salut con sal** y **sin sal** (las dos
  están, pero conviene renombrar la primera para que se lean como par)

---

## Estado de B3

**Respondida en lo esencial.** Queda cerrar los tres quesos sin clasificar y el alta de
Cremoso procesado antes de cambiar `DISPONIBLE_ENVASAR`.
