# Una URL pública: Vercel + Supabase

**Fecha:** 2026-09-16
**Para qué:** que Alexis entre desde internet y cargue pallets de prueba, sin depender de
que haya una máquina prendida en ningún lado.

---

## Esto NO es la instalación de la fábrica

Conviene decirlo primero, porque son dos cosas distintas y confundirlas sale caro.

En [`08-arquitectura-nube.md`](08-arquitectura-nube.md) quedó decidido que **la planta no
puede parar si se cae internet**. Eso obliga a un servidor local en la fábrica, y no hay
hosting que lo reemplace.

Lo de acá es un **ambiente de prueba**: una URL para mirar, tocar y opinar. Cuando el
sistema entre en planta, esta instalación queda como lo que ya era —el lado nube del
dibujo de la sección 1 de ese documento— y el servidor local sigue siendo el que aguanta
la producción.

---

## Por qué recién ahora se puede

El documento [`06-despliegue.md`](06-despliegue.md) descartaba serverless de plano, y
tenía razón: *"la base es un archivo"*. SQLite necesita un disco que sobreviva al
despliegue, y una función serverless no tiene disco ni tiene proceso.

**Eso dejó de ser cierto cuando la base pasó a PostgreSQL.** Sin archivo local, el
servidor se vuelve una pieza sin estado: recibe un request, consulta la base, contesta. Es
exactamente la forma que espera Vercel.

---

## Qué hace falta

| | Para qué | Costo |
|---|---|---|
| **Supabase** | La base PostgreSQL | Gratis |
| **Vercel** | Correr el sistema y darle la URL | Gratis |
| Un repo en GitHub | De ahí despliega Vercel | Gratis (privado) |

---

## 1. La base en Supabase

Crear el proyecto y, en el **SQL Editor**, pegar y ejecutar
[`migraciones/001-esquema.sql`](../migraciones/001-esquema.sql) entero. Crea las 19 tablas,
los índices, los CHECK y deja RLS activada.

Después, los catálogos —marcas, productos, quesos, operarios, formatos, las secciones del
tablero— desde tu propia máquina, apuntando a Supabase:

```bash
DATABASE_URL="postgres://…supabase…" npm run seed
```

**La cadena de conexión que hay que usar es la del pooler**, no la directa. En Supabase
está en *Project Settings → Database → Connection string → **Transaction pooler***, y
termina en el puerto **6543**. La directa (5432) abre una conexión real por cada llamada y
con serverless se agota sola.

> No hace falta migrar los datos de tu Postgres local. Son de prueba, y lo que Alexis
> necesita es una base limpia donde cargar los suyos.

## 2. El sistema en Vercel

Importar el repo. La configuración ya está en [`vercel.json`](../vercel.json) y no hay que
tocar nada en la interfaz. Sólo las variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | La del pooler, puerto 6543 |
| `ACCESO_CLAVE` | **Obligatoria.** La que le pases a Alexis |
| `ACCESO_USUARIO` | Opcional, por defecto `belgrano` |

Sin `ACCESO_CLAVE` el sistema **no pide nada**. Eso está bien en la red de la fábrica —el
operario con guantes no puede tipear una contraseña— y es inaceptable en una URL pública
con el catálogo, las marcas y la estructura comercial de un cliente real adentro.

## 2b. Los nombres reales

El seed deja operarios genéricos —`Operario 1`, `Operario 2`— y clientes `Cliente 1..5`.
Desde **`/app/maestros`** se cargan los reales: operarios agrupados por sector, clientes,
tambos y marcas. Es lo primero que Alexis va a querer tocar, y ya no necesita a nadie con
una terminal abierta.

Un operario nuevo aparece en su tablet al instante. Dar de baja lo saca de las pantallas
pero no del historial: sus registros anteriores siguen mostrando su nombre.

## 3. Probarlo

Entrar a la URL, poner usuario y clave, y cargar un pallet desde `/lecheria.html`. Si
aparece en `/app/consulta`, está todo conectado.

---

## Lo que hubo que cambiar en el código

**El servidor se exporta además de arrancarse.** `server/index.js` termina en un
`app.listen()` sólo cuando se lo ejecuta directo; si alguien lo importa, devuelve la app.
Es lo que permite que el mismo código corra como proceso en la fábrica y como función en
la nube, sin dos versiones que mantener sincronizadas.

**Todo pasa por Express, también los archivos.** La tentación era dejar que Vercel sirviera
`public/` desde su CDN: más rápido y gratis. Pero entonces las tablets y el tablero
saldrían **sin pasar por la clave**, y la parte que uno quiere cerrada quedaría abierta.
Por eso la salida estática apunta a una carpeta vacía y un `rewrite` manda todo a la
función. Con un solo tester, la diferencia de velocidad no existe.

**El pool de conexiones se achica solo.** Un servidor de verdad atiende ocho tablets desde
un proceso y le sirve un pool de diez conexiones. En serverless, cada invocación puede ser
un proceso nuevo: diez por instancia agota el límite de la base en minutos, y el síntoma no
es un error claro sino timeouts intermitentes que parecen "la app anda lenta". Con la
variable `VERCEL` presente, el pool baja a una conexión y el pooler de Supabase hace el
resto.

---

## Cuatro cosas que conviene saber de antemano

**El plan gratis de Vercel es para uso no comercial.** Esto es un proyecto pagado por un
cliente. Para unas semanas de prueba es una zona gris que nadie mira; si queda como algo
permanente, corresponde el plan pago (unos 20 USD por mes) o mudarlo a un hosting común.

**Supabase pausa los proyectos gratis tras una semana sin actividad.** Si Alexis entra cada
tanto, se va a encontrar la base dormida y hay que despertarla desde el panel. No se pierde
nada, pero sorprende.

**La clave es una sola para todo el mundo.** No hay usuarios, no hay permisos y no queda
registro de quién hizo qué más allá del operario que se elige en pantalla. Alcanza para
probar; no alcanza para producción, y por eso el paso 3 del plan es autenticación de
verdad.

**Lo que Alexis cargue va a quedar mezclado con lo que haya.** Antes del piloto real,
para arrancar de cero:

```bash
npm run limpiar -- --confirmar --remota=db.xxxx.supabase.co
```

Contra una base remota no alcanza con `--confirmar`: hay que **escribir el host**. Se pide
a mano a propósito — es la diferencia entre vaciar la base de pruebas y vaciar la de
producción por tener mal el `.env`.

---

## Qué está probado y qué no

Se probó **el código**: la app importada como función, con la clave activada, sirviendo API,
tablets, tablero y escritorio por el mismo camino que usaría Vercel, incluida la carga de
un pallet de punta a punta.

**No se probó el despliegue en sí.** La configuración de `vercel.json` —el rewrite, el
`includeFiles`, la carpeta de salida vacía— sólo se confirma desplegando. Si el primer
intento falla, va a ser ahí.
