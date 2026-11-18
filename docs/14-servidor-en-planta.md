# El sistema en un servidor de la planta

Instalar la app y la base PostgreSQL en una máquina Windows de la fábrica, y que las
tablets le peguen por la red local.

**Estado:** el instalador está escrito y probado en modo revisión. La instalación completa
no se corrió todavía en ninguna máquina — eso es lo que se prueba con el servidor real.

---

## Por qué local

En una fábrica las tablets **son** el sistema. Con todo en la nube, que se caiga internet
en Ruta 29 Km 78,7 es que se caiga el registro de producción: la cola offline aguanta, pero
nadie ve nada y la cola crece. Con el servidor adentro, "se cayó internet" deja de ser un
evento de producción.

Lo que se gana, en orden de importancia:

1. **El sistema no depende de internet.** Ni del hosting, ni de Vercel, ni del enlace.
2. **Latencia cero.** Hoy cada toque de botón es un viaje a Virginia.
3. **El dato vive donde se produce.**

Lo que se pierde está más abajo, en [Lo que esta instalación NO resuelve](#lo-que-esta-instalación-no-resuelve).
Vale la pena leerlo antes y no después.

---

## ⚠️ Lo primero: dos bases NO pueden ser las dos la verdadera

Mientras Vercel siga prendido van a existir dos Postgres: el del hosting (que usa Vercel) y
el de la planta. **Son dos realidades distintas.**

El día que un operario cargue producción de verdad en planta mientras alguien prueba en
Vercel, quedan dos conjuntos de datos **imposibles de unir**: las dos bases arrancan sus
`IDENTITY` en 1, así que el pallet 847 existe de los dos lados y es otro pallet.

> **La regla, desde el día uno: en cada momento hay UNA sola base real.**
>
> Vercel con datos de prueba, planta como producción desde que arranca el piloto.

Mover los datos de una a otra ya está resuelto y probado: `herramientas/mudar-base.mjs`
copia de un PostgreSQL a otro ([docs/13](13-base-en-el-hosting.md)).

```bash
# Traer lo que esté en el hosting a la base de planta.
ORIGEN='postgres://...hosting...' DESTINO='postgres://belgrano:...@localhost:5432/fabrica_belgrano' \
  node herramientas/mudar-base.mjs            # ensayo, no escribe nada
ORIGEN='...' DESTINO='...' node herramientas/mudar-base.mjs --confirmar
```

---

## Antes de ir a la fábrica

| | Por qué |
|---|---|
| **UPS** | Sin UPS, un corte de luz corta el registro de producción de toda la planta. Hoy ese riesgo no existe; con esta instalación lo estamos creando. |
| **Cable, no WiFi** | El servidor es el único punto por el que pasa todo. Entre cámaras frigoríficas, lavados y humedad, el WiFi es el tramo que se cae solo. |
| **IP fija** (o reserva en el router) | Las tablets llevan la URL amurada igual que el soporte. Si la IP cambia, las ocho dejan de encontrar el servidor a la vez. |
| **PostgreSQL 17 o 18** | Piso duro: la 12, porque el esquema usa columnas `GENERATED ... STORED`. Conviene igualar al hosting, que corre 18.4. |
| **Node 22 LTS** | `package.json` fija `22.x`. |
| **Horas activas de Windows Update** | El reinicio automático de madrugada es el asesino clásico de estos despliegues. |

El instalador chequea todo lo que se puede chequear desde software; la UPS y las horas
activas las tiene que mirar una persona.

---

## Mandarle el paquete a la fábrica

Si la instalación la hace otra persona, el paquete se arma con un comando:

```powershell
powershell -ExecutionPolicy Bypass -File herramientasrmar-paquete.ps1
```

Deja `FabricaBelgrano-planta.zip` (unos 2 MB) en el escritorio, listo para subir.

**No armes ese zip a mano.** En el repo conviven `.env.local` (la contraseña del
PostgreSQL del hosting y la de Supabase), las claves SSH `cuenta_4x`, `data/` y
`supabase-backup/`. Arrastrar la carpeta se lleva las cuatro, y el paquete anda igual:
no hay forma de darse cuenta. El script parte de `git archive` —sólo lo versionado, o
sea que todo eso queda afuera por definición—, agrega `node_modules` y `public/app`
(que no se versionan y sin los cuales no arranca), y al final revisa el resultado y
**aborta** si apareció algo que no corresponde.

Adentro del zip, en la raíz, quedan los tres archivos que abre quien instala:
`LEEME.txt`, `1-REVISAR.cmd` y `2-INSTALAR.cmd`.

> **Lo que el zip NO trae: Node y PostgreSQL.** Son dos instaladores que se bajan de
> internet (están linkeados en el `LEEME.txt`). Si el servidor de la fábrica no tiene
> internet, hay que bajarlos aparte y subirlos al mismo Drive.

---

## Instalar

El instalador tiene dos modos, igual que las migraciones del proyecto: **sin `-Confirmar`
no escribe nada.**

### 1. Revisar

No necesita Administrador y no toca la máquina. Esto es lo que conviene correr primero en
un servidor que no conocemos:

```powershell
powershell -ExecutionPolicy Bypass -File instalar\planta.ps1
```

Reporta la versión de Windows, el disco, si el equipo **se suspende**, si el reloj está
sincronizado, las IPs **de las placas físicas** (ignora las de WSL, Hyper-V y VPN, que son
las que uno amura por error), si el puerto está libre, Node, PostgreSQL y si el repo está
completo. Cierra con un veredicto: **SE PUEDE INSTALAR** o qué falta.

### 2. Instalar

Como Administrador:

```powershell
powershell -ExecutionPolicy Bypass -File instalar\planta.ps1 -Confirmar -CopiaBackup D:\backups
```

Pide la clave del superusuario `postgres` por pantalla (no queda en el historial de
comandos) y hace, en orden:

1. Apaga la suspensión y la hibernación con el equipo enchufado.
2. Crea el rol `belgrano` y la base `fabrica_belgrano`. **El rol no es superusuario**: es
   dueño de su esquema y de nada más.
3. Escribe `.env.local` con una contraseña generada de 32 caracteres **alfanuméricos** —
   sin `@ : / ? # %`, que adentro de una URL parten el string en el lugar equivocado y dan
   un error que habla de un host inexistente. Ya nos pasó con el hosting.
4. Arma el esquema con `mudar-base.mjs --solo-esquema --confirmar` (`001-esquema.sql` +
   las migraciones `002..00N`) y carga el catálogo con el seed, que es idempotente.
5. Abre el puerto en el firewall **sólo para la red local**.
6. Registra la tarea `FabricaBelgrano`, que levanta el servidor al arrancar Windows **sin
   que nadie inicie sesión**.
7. Registra `FabricaBelgrano-backup`: `pg_dump` todos los días a las 22:00.
8. Lo arranca y comprueba que conteste. Termina imprimiendo la URL de cada tablet.

Correrlo dos veces no rompe nada: si el rol o la base ya existen, no los pisa, y si
`.env.local` ya existe **no lo toca**.

### Parámetros

| | |
|---|---|
| `-Puerto 3000` | Si 3000 está ocupado. |
| `-CopiaBackup D:\backups` | Segundo destino del backup. **Ponelo.** |
| `-Base` / `-Usuario` | Nombres de la base y del rol. |
| `-HostPg` / `-PuertoPg` | Si PostgreSQL no está en `localhost:5432`. |
| `-SinBackup` | No registra la tarea de backup. |

---

## Las tablets

El instalador imprime la lista al terminar. Con la IP del servidor en `192.168.0.10`:

| Tablet | URL |
|---|---|
| Recepción | `http://192.168.0.10:3000/recepcion.html` |
| Lechería | `http://192.168.0.10:3000/lecheria.html` |
| **Yogures + Lechería** | `http://192.168.0.10:3000/planta.html?sectores=yogures,lecheria` |
| Quesería + Saladero | `http://192.168.0.10:3000/planta.html` |
| Envasado | `http://192.168.0.10:3000/envasado.html` |
| Maduración | `http://192.168.0.10:3000/maduracion.html` |
| Armado de pedidos | `http://192.168.0.10:3000/pedidos.html` |
| Escritorio | `http://192.168.0.10:3000/app` |

### El modo kiosco cambia: no más PWA

**`http://192.168.x.x` no es un "contexto seguro"**, así que Chrome no registra el service
worker ni ofrece instalar la app. Esto es lo que cambia:

| | Sobre `http://` en la LAN |
|---|---|
| Cola offline (`localStorage` + `fetch`) | **anda** — no toca el service worker |
| Catálogo cacheado | **anda** — también `localStorage` |
| Caché del app shell (`public/sw.js`) | se pierde |
| Instalar como PWA / pantalla completa | se pierde |

Lo importante sobrevive: la regla de oro del proyecto —*el operario nunca pierde un
registro*— vive en `comun.js`, no en el service worker.

**La salida recomendada no es pelear con el certificado: es cambiar de herramienta de
kiosco.** Un navegador kiosco para Android (Fully Kiosk Browser es el estándar, licencia de
unos €7 por tablet) da:

- pantalla completa de verdad, sin barra de direcciones
- **arranque automático después de un corte de luz** — algo que la PWA nunca hizo
- pantalla siempre encendida
- URL bloqueada: el operario no puede irse a otro lado
- todo eso sobre `http://`, sin certificados

Para una tablet amurada con teclado y mouse eso es mejor que la PWA, no un parche.

> La alternativa —un certificado real, con un dominio apuntando a la IP privada— es
> factible, pero necesita que el router resuelva ese nombre **localmente**. Si depende del
> DNS público, te quedás sin sistema justo cuando se cae internet, que es exactamente el
> caso que esta instalación existe para cubrir.

---

## El día a día

```powershell
# ¿está andando?
Get-ScheduledTask FabricaBelgrano | Get-ScheduledTaskInfo

Stop-ScheduledTask  -TaskName FabricaBelgrano
Start-ScheduledTask -TaskName FabricaBelgrano

# el log (lo del servidor y lo del envoltorio que lo relevanta)
Get-Content data\logs\servidor.log -Tail 50 -Wait
```

### Backups

Van a `data\backups\fabrica-AAAA-MM-DD-HHmm.dump`, formato `custom`, se guardan 30 días.

```powershell
# a mano, ahora
powershell -ExecutionPolicy Bypass -File instalar\backup.ps1 -Copia D:\backups

# restaurar
pg_restore --clean --if-exists -d "postgres://belgrano:CLAVE@localhost:5432/fabrica_belgrano" archivo.dump
```

`npm run backup` **no sirve acá**: usa `VACUUM INTO`, que es de SQLite, y con PostgreSQL se
planta a propósito en vez de fingir que hizo algo.

> Un backup en el mismo disco que la base protege contra *"borré algo sin querer"*. **No
> protege contra que el disco muera.** Por eso `-CopiaBackup`.

### Después de un `git pull`

```powershell
npm install
Stop-ScheduledTask -TaskName FabricaBelgrano
Start-ScheduledTask -TaskName FabricaBelgrano
```

Si el pull trae una migración nueva, corrés `node migraciones/0NN-....js --confirmar` antes
de levantarlo.

---

## Los datos maestros reales (una sola vez, 2026-11-17)

La instalación del 16/11 dejó la base con los **placeholders del seed**: dieciséis operarios
llamados "Operario 1" y seis tambos con número y sin nombre. No fue un error de la
instalación sino de dónde vivían los datos: las listas reales —treinta y tres personas,
dieciséis tambos— las había cargado la fábrica a mano desde `/app/maestros` y estaban
**sólo** en la base de Supabase, que no se migró y que ya no existe. Se recuperaron del
backup `supabase-backup/db_cluster-24-10-2026@00-44-28.backup.gz`, que es la última copia
que queda; el extracto legible está en `instalacion en servidor/maestros-en-la-nube.txt`.

**Los tres archivos viajan juntos, y el seed no es opcional.** Si se copia la migración sin
`server/seed.js`, el seed viejo vuelve a insertar los catorce placeholders la próxima vez
que alguien corra `npm start` o `npm run seed`, y quedan mezclados con la gente real en la
lista de la tablet. Está comprobado: pasa de 35 operarios a 49.

```powershell
cd C:\FabricaBelgrano-planta

# 0. Backup primero. Es el punto de retorno.
powershell -ExecutionPolicy Bypass -File instalar\backup.ps1

# 1. Ver qué hay hoy.
node --env-file-if-exists=.env.local herramientas\ver-maestros.mjs

# 2. Simulación: no escribe nada, dice qué haría.
node --env-file-if-exists=.env.local migraciones\010-maestros-reales.js

# 3. Aplicar.
node --env-file-if-exists=.env.local migraciones\010-maestros-reales.js --confirmar

# 4. Comprobar.
node --env-file-if-exists=.env.local herramientas\ver-maestros.mjs
```

**No hace falta reiniciar el servicio.** La tarea programada corre `server\index.js` directo
—sin pasar por el seed— y `/api/catalogo` consulta la base en cada pedido, sin caché.
Alcanza con refrescar la tablet.

Un operario placeholder que ya hubiera registrado producción **no se borra**: queda de baja,
para que su registro siga mostrando quién lo hizo. Los que nunca firmaron nada se borran,
porque un "Operario 1" dado de baja igual aparece en `/app/maestros` y confunde.

### Lo que sigue faltando después de esto

| | |
|---|---|
| **Clientes** | Siguen siendo `Cliente 1`…`Cliente 5`. La lista real **nunca se cargó, ni en la nube**. La tablet de pedidos no sirve hasta que exista. |
| **Recepción** | El sector queda con placeholders: en Supabase también eran de prueba (`Prueba alexis`). Se cargan con `npm run operarios -- recepcion "Nombre" "Otro"`. |
| **La marca** | El código dice `Obenac`; en la nube figuraba `Obenak`. Es una marca que va impresa: lo define Alexis y se corrige desde `/app/maestros`. |
| **Tambos 11 y 12** | Se llaman los dos `CERR H`. Dos renglones iguales en la pantalla de recepción es elegir a ciegas. |
| **Días de maduración** | Quedan como "de referencia" **a propósito**. En la nube figuraban confirmados, pero con los números idénticos a los que trae el seed: nadie cambió ninguno, así que lo más probable es que se haya destildado la casilla sin que el maestro quesero dictara nada. |

---

## Lo que esta instalación NO resuelve

**1. Mirar la producción desde afuera de la fábrica.** Hoy Alexis puede abrir el sistema
desde el celular en cualquier lado. Con el servidor adentro, `/app` sólo funciona parado en
la planta. Se resuelve con una VPN o con una réplica a la nube, pero cuesta, y conviene
decidirlo **antes** de armar esto. → [docs/02, preguntas abiertas](02-preguntas-abiertas.md)

**2. La clave de acceso es todo o nada.** `ACCESO_CLAVE` queda sin definir, que es lo
correcto para las tablets: el operario con guantes no puede tipear una contraseña, y la
amenaza en planta no es un desconocido, es registrar a nombre de otro. Pero hoy el sistema
no distingue tablets de escritorio: **sin clave, `/app` también queda abierto para
cualquiera que esté en el WiFi de la fábrica.** Lo correcto sería tablets sin clave y
escritorio con clave; no está implementado.

**3. HTTPS.** Ver arriba. El sistema anda, pero sin service worker.

**4. Alta disponibilidad.** Si esa máquina muere, se para el registro de las ocho tablets.
La UPS cubre el corte de luz; no cubre un disco roto. El backup fuera del equipo es lo que
convierte eso en "se pierde media jornada" en vez de "se pierde todo".

---

## Volver atrás

```powershell
Unregister-ScheduledTask -TaskName FabricaBelgrano -Confirm:$false
Unregister-ScheduledTask -TaskName FabricaBelgrano-backup -Confirm:$false
Remove-NetFirewallRule -DisplayName 'Fabrica Belgrano (tablets)'
```

Las tablets vuelven a apuntar a la URL de Vercel y el hosting sigue como estaba. **La base
de planta no se borra**: queda ahí con lo que se haya cargado, y se trae con
`mudar-base.mjs` cuando haga falta.

---

## Archivos

| | |
|---|---|
| `instalar/planta.ps1` | El instalador. Sin `-Confirmar` sólo revisa. |
| `instalar/servidor.ps1` | Lo que corre la tarea de arranque: levanta Node y lo relevanta si se cae. |
| `instalar/backup.ps1` | `pg_dump` diario con retención y copia externa. |
| `instalar/entorno.ps1` | Lo **genera** el instalador: la ruta completa a `node.exe`. No se versiona. |

Los tres `.ps1` están guardados en **UTF-8 con BOM**. No es un detalle estético: PowerShell
5.1 lee como ANSI todo archivo sin BOM, y el instalador imprimiría `DiagnÃ³stico` en la
pantalla de un servidor ajeno.
