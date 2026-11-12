# Mudar la base de Supabase al PostgreSQL del hosting

**Fecha:** 2026-11-10
**Para qué:** dejar de depender de Supabase y poner la base en el PostgreSQL de
smarterasp.net, que es donde ya está contratado el hosting.

---

## Qué cambia en el código

**Nada.** La URL de la base es una variable de entorno desde el primer día
([`08-arquitectura-nube.md`](08-arquitectura-nube.md)), y `server/db.js` elige el motor
según esté definida o no. Mudar la base es cambiar un string en dos lugares.

Lo único que cambia de verdad es **a qué servidor apuntan las tablets**, y eso no se nota
hasta que algo falla. Por eso este documento es más sobre lo que hay que verificar que
sobre lo que hay que escribir.

---

## Dónde va el connection string

| Dónde | Cómo |
|---|---|
| Tu máquina | `.env.local`, línea `DATABASE_URL=...`. Está en `.gitignore`: no se sube nunca. |
| Vercel | Panel → Settings → Environment Variables → `DATABASE_URL`. Hay que **volver a desplegar** para que tome el valor nuevo. |
| Servidor de planta | el `.env.local` de ese servidor —es el que leen `npm start` y el seed—. Lo escribe solo `instalar\planta.ps1`; ver [14-servidor-en-planta.md](14-servidor-en-planta.md). |

### El deploy que falla en `npm ci` y no tiene nada que ver con la base

El 2026-11-10 el despliegue murió así:

```
gyp ERR! node -v v26.13.0
make: *** [better_sqlite3.target.mk:122] Error 1
Command "npm ci" exited with 1
```

Ni siquiera llegaba al código. `package.json` declaraba `"node": ">=20"`, o sea *cualquiera
de 20 para arriba*, y Vercel eligió la **26**; `better-sqlite3` no tiene binario precompilado
para esa versión, intentó compilarlo desde C++ y falló. Dos cambios, cada uno vale por sí
solo:

- **El major quedó fijo** (`"node": "22.x"`). Subir de versión mayor es una decisión, no
  algo que deba pasar solo entre dos despliegues.
- **`better-sqlite3` pasó a `optionalDependencies`**, que es lo que realmente es:
  `server/db.js` la importa sólo si NO hay `DATABASE_URL`, así que en la nube no se carga
  nunca. Ahora, si no hay binario, `npm ci` sigue de largo en vez de voltear el deploy.

La URL tiene esta forma:

```
postgres://USUARIO:CLAVE@HOST:PUERTO/NOMBRE_DE_LA_BASE?sslmode=verify-full
```

**Si la contraseña tiene `@`, `/`, `:` o `#`, hay que escaparla** (`@` → `%40`). Si no, la
URL se parte en el lugar equivocado y el error que sale habla de un host que no existe, no
de la contraseña.

### El panel de smarterasp la da en otro formato

Lo que entrega el panel es un connection string de **.NET / Npgsql**:

```
Host=pg8001.site4now.net;Port=6432;Database=...;Username=...;Password=...
```

**Node no entiende eso**: toma el string entero como si fuera el nombre del host, y el
error que sale no se parece en nada a la causa. Hay que pasarlo a URL, campo por campo.

### Lo medido en este hosting (2026-11-10)

| | |
|---|---|
| Versión | PostgreSQL **18.4** — de sobra para el `GENERATED ... STORED` del esquema |
| Puerto | **6432**, no el 5432 de siempre. El 5432 ni contesta |
| TLS | **TLS 1.3 con certificado válido** → `sslmode=verify-full` |
| `max_connections` | 1000 |
| Permisos | el usuario crea y borra tablas sin problema |

---

## El `sslmode`, que es donde se pierde la tarde

`sslmode` en una URL de Node **no significa lo mismo que en psql**:

| Valor | Qué hace acá |
|---|---|
| *(ausente)* o `disable` | **sin cifrar** — y sin aviso ninguno |
| `no-verify` | cifra y **no** valida el certificado. Para un certificado autofirmado |
| `require` | hoy cifra y valida la cadena entera, pero **imprime un aviso de deprecación** y va a cambiar de significado en la próxima versión mayor de `pg` |
| `verify-full` | cifra y valida. Lo mismo que `require` hace hoy, dicho de una forma que no va a cambiar |

Dos trampas, las dos silenciosas:

- **Sin `sslmode`, la conexión viaja en claro.** No falla, no avisa: anda. Lo verifiqué
  mirando el socket, que da `Socket` sin cifrar contra `TLSSocket` + TLS 1.3 cuando el
  `sslmode` está puesto.
- **`pg_stat_ssl` miente acá**, y es una mentira razonable: el puerto 6432 es un pooler, así
  que esa vista informa la pata *pooler → Postgres*, no la tuya. Da `ssl = false` aunque tu
  conexión esté cifrada. Para saber de verdad hay que mirar el socket del cliente.

El error de `verify-full` contra un certificado autofirmado sería
`self-signed certificate in certificate chain`, y es fácil leerlo como un problema de
credenciales. No lo es. Está anotado también en `server/db-pg.js`, al lado del pool.

---

## Antes de mudar: tres cosas que pueden no estar

1. **La versión.** El esquema usa `GENERATED ... STORED`, que es **PostgreSQL 12 en
   adelante**. `herramientas/mudar-base.mjs` lo chequea en la primera línea y se planta si
   no da.
2. **El acceso remoto.** Muchos hostings compartidos tienen el Postgres cerrado al mundo y
   hay que habilitarlo, a veces declarando tu IP. Si el error es `ETIMEDOUT` o
   `ECONNREFUSED`, es esto y no la clave.
3. **Que Vercel llegue.** Es lo mismo que el punto anterior pero peor: Vercel sale por IPs
   que cambian. **Si el hosting exige lista blanca de IPs, el sitio en Vercel no va a poder
   conectarse**, y hay que mover el sistema al propio hosting o a un servidor con IP fija.
   Conviene averiguarlo antes de mudar los datos, no después.

---

## La mudanza

`herramientas/mudar-base.mjs` copia de un PostgreSQL a otro. Las dos URLs van por variable
de entorno para que la contraseña no quede escrita en ningún archivo.

```bash
# 1. Ensayo: conecta a las dos puntas, cuenta filas y dice qué haría. No escribe nada.
ORIGEN='postgres://...supabase...' DESTINO='postgres://...hosting...?sslmode=no-verify' \
  node herramientas/mudar-base.mjs

# 2. La mudanza de verdad.
ORIGEN='...' DESTINO='...' node herramientas/mudar-base.mjs --confirmar
```

Lo que hace, en orden:

1. **Arma el esquema en el destino** con `001-esquema.sql` y las migraciones `002..00N`.
   No copia el esquema del origen: ese trae encima lo que Supabase le agregó por abajo
   (roles `anon`/`authenticated`, RLS, grants) y no entra del otro lado. De paso, que las
   columnas queden iguales en las dos puntas es la prueba de que la cadena de migraciones
   reproduce producción; si no coinciden, se planta y las muestra.
2. **Vacía el catálogo que dejaron las migraciones.** Varias migraciones insertan filas
   (los motivos de la 006, los formatos de yogur de la 009), así que un destino recién
   armado no está vacío. Esas mismas filas llegan del origen con los ids que las FK ya
   apuntan. Sólo vacía si el esquema se creó en esa misma corrida: sobre una base que ya
   existía no borra nada.
3. **Copia los datos** en orden de dependencia, calculado con las FK reales de la base y no
   con una lista a mano. Los ids se conservan: son las FK de todo lo demás.
4. **Acomoda las secuencias.** Sin esto la primera carga desde una tablet choca con un id
   que ya existe, porque los ids entraron a mano y la secuencia quedó en 1.
5. **Verifica** que cada tabla tenga la misma cantidad de filas de los dos lados.

### Después

```bash
# Que el sistema levante contra la base nueva.
DATABASE_URL='postgres://...hosting...' npm start
```

`npm start` corre el seed antes del servidor. **El seed es idempotente**: sobre la base
mudada no agrega nada (probado el 2026-11-10).

---

## Volver atrás

Mientras Supabase siga vivo, volver es cambiar `DATABASE_URL` de nuevo y redesplegar. Por
eso **conviene no dar de baja Supabase el mismo día**: la vuelta atrás vale lo que vale
justamente porque la base vieja sigue ahí, intacta, con los datos hasta el momento de la
mudanza.

Lo que no vuelve solo es lo que se haya cargado **después** de mudar. Si hay que volver
pasada una jornada de producción, esas cargas quedan en el hosting y hay que traerlas a
mano.

---

## El backup de `supabase-backup/` no sirve para esto

Es un volcado de **cluster** (`pg_dumpall`) del 24-10-2026: trae los roles internos de
Supabase y los esquemas `auth`, `storage`, `realtime`. Nada de eso entra en una base de
hosting compartido, donde hay un usuario y ninguna capacidad de superusuario. Y además es
de octubre: no tiene las migraciones 007, 008 ni 009.

Sirve como respaldo histórico. Para mudar, el origen es la base viva.
