#Requires -Version 5.1
<#
  Instala el sistema en un servidor de la planta: la base PostgreSQL local, la app
  como tarea de arranque, el firewall abierto sólo a la red interna y un backup diario.

  SIN -Confirmar NO TOCA NADA.

  Revisa la máquina, dice qué encontró y qué haría. Es la misma regla que siguen las
  migraciones del proyecto y herramientas/mudar-base.mjs: primero mirar, después
  escribir. En una máquina que no conocemos esa primera pasada vale por sí sola.

      powershell -ExecutionPolicy Bypass -File instalar\planta.ps1
      powershell -ExecutionPolicy Bypass -File instalar\planta.ps1 -Confirmar

  El diagnóstico NO necesita Administrador. La instalación sí.

  Lo que NO hace, porque no se puede automatizar y hay que mirarlo igual:
    - la UPS
    - el reinicio automático de Windows Update
    - la IP fija
  Los tres salen en el diagnóstico con su estado real.
#>

param(
  # Sin esto no escribe nada. Igual que --confirmar en las migraciones.
  [switch]$Confirmar,

  [int]$Puerto = 3000,
  [string]$Base = 'fabrica_belgrano',
  [string]$Usuario = 'belgrano',

  # La del superusuario `postgres`, la que se eligió al instalar PostgreSQL. Si no se
  # pasa, se pide por pantalla y no queda en el historial de comandos.
  [string]$ClavePostgres,

  [string]$HostPg = 'localhost',
  [int]$PuertoPg = 5432,

  # Segundo destino del backup: un disco aparte, un pendrive, una carpeta de red. El
  # backup que vive en el mismo disco que la base no es un backup, es una copia.
  [string]$CopiaBackup,

  [switch]$SinBackup
)

$ErrorActionPreference = 'Stop'

$RAIZ = Split-Path -Parent $PSScriptRoot
$TAREA_SERVIDOR = 'FabricaBelgrano'
$TAREA_BACKUP = 'FabricaBelgrano-backup'
$REGLA_FIREWALL = 'Fabrica Belgrano (tablets)'

# ---------------------------------------------------------------- impresión

$script:Problemas = @()
$script:Avisos = @()

function Titulo($t) {
  Write-Host ''
  Write-Host "=== $t " -ForegroundColor Cyan -NoNewline
  Write-Host ('=' * [Math]::Max(0, 60 - $t.Length)) -ForegroundColor Cyan
}
function Ok($t) { Write-Host '  ok   ' -ForegroundColor Green -NoNewline; Write-Host $t }
function Mal($t) {
  Write-Host '  FALTA' -ForegroundColor Red -NoNewline; Write-Host "  $t"
  $script:Problemas += $t
}
function Ojo($t) {
  Write-Host '  ojo  ' -ForegroundColor Yellow -NoNewline; Write-Host $t
  $script:Avisos += $t
}
function Dato($t) { Write-Host '       ' -NoNewline; Write-Host $t -ForegroundColor DarkGray }
function Haria($t) { Write-Host '  ->   ' -ForegroundColor Magenta -NoNewline; Write-Host $t }

# Escribe UTF-8 SIN BOM a propósito.
#
# Node lee .env.local con --env-file-if-exists, y un BOM delante de la primera línea
# se pega al nombre de la variable: queda "\uFEFFDATABASE_URL", que no es DATABASE_URL.
# El sistema arrancaría en modo SQLite sin que nadie entienda por qué. Set-Content y
# Out-File en PowerShell 5.1 meten BOM, así que no se usan acá.
function EscribirSinBOM($ruta, $texto) {
  $sinBom = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($ruta, $texto, $sinBom)
}

function SoyAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  return (New-Object Security.Principal.WindowsPrincipal $id).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
}

Write-Host ''
Write-Host '  Lácteos Belgrano - servidor en planta' -ForegroundColor White
Write-Host "  $RAIZ" -ForegroundColor DarkGray
if (-not $Confirmar) {
  Write-Host '  MODO REVISIÓN: no se escribe nada.' -ForegroundColor Yellow
}

# ================================================================ DIAGNÓSTICO

Titulo 'la máquina'

$so = Get-CimInstance Win32_OperatingSystem
Dato "$($so.Caption) - $($so.Version)"

$admin = SoyAdmin
if ($admin) { Ok 'corriendo como Administrador' }
elseif ($Confirmar) { Mal 'la instalación necesita Administrador (botón derecho -> Ejecutar como administrador)' }
else { Dato 'sin Administrador - alcanza para revisar, no para instalar' }

$libre = [Math]::Round((Get-PSDrive -Name ($RAIZ.Substring(0,1))).Free / 1GB, 1)
if ($libre -lt 5) { Mal "quedan $libre GB libres en el disco; la base y los backups necesitan más" }
else { Ok "$libre GB libres en el disco" }

# Un servidor que se suspende deja ocho tablets sin sistema y nadie entiende por qué.
# Es la falla más tonta y la más probable en una PC de escritorio reutilizada.
$dormir = $null
try {
  $q = (powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE) -join "`n"
  # Los índices salen como 0x00000000, primero el de red (AC) y después el de batería.
  # Se busca el patrón y no el texto, porque el texto está traducido y cambia.
  $idx = [regex]::Matches($q, '0x[0-9a-fA-F]{8}')
  if ($idx.Count -ge 2) { $dormir = [Convert]::ToInt32($idx[$idx.Count - 2].Value, 16) }
} catch { }

if ($dormir -eq $null) { Ojo 'no pude leer la configuración de energía; revisala a mano' }
elseif ($dormir -eq 0) { Ok 'enchufado no se suspende' }
else { Ojo "enchufado se SUSPENDE a los $([Math]::Round($dormir/60)) min - lo apago en la instalación" }

# El horario es dato de proceso: horaServidor() corrige el reloj de cada tablet contra
# el de este servidor. Si este se desfasa, se desfasan las ocho.
try {
  $w32 = (w32tm /query /status 2>&1) -join "`n"
  if ($LASTEXITCODE -eq 0) { Ok 'el servicio de hora está andando' }
  else { Ojo 'el servicio de hora (w32time) no responde - el reloj de este server manda sobre el de todas las tablets' }
} catch { Ojo 'no pude consultar w32time' }

Titulo 'red'

# Sólo las placas FÍSICAS que estén levantadas.
#
# Sin este filtro, la primera dirección de la lista puede ser la de WSL, la de Hyper-V o
# la de una VPN: en esta misma máquina de desarrollo, `172.19.240.1` (WSL) salía antes
# que la de la red real. Amurar esa IP en ocho tablets es un día perdido buscando por
# qué no llegan a un servidor que está perfectamente prendido.
$fisicas = @(Get-NetAdapter -EA SilentlyContinue |
  Where-Object { -not $_.Virtual -and $_.Status -eq 'Up' })

$ips = @()
foreach ($placa in $fisicas) {
  $ips += @(Get-NetIPAddress -AddressFamily IPv4 -InterfaceIndex $placa.InterfaceIndex -EA SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    ForEach-Object {
      $_ | Add-Member -NotePropertyName PorCable `
        -NotePropertyValue ($placa.PhysicalMediaType -notmatch '802\.11|Wireless') -PassThru
    })
}

# Un servidor por WiFi en una fábrica es el enlace más frágil de toda la instalación, y
# encima es el único que nadie mira cuando algo falla. Si hay cable, va por cable.
$ips = @($ips | Sort-Object -Property @{ Expression = 'PorCable'; Descending = $true })

if (-not $ips) {
  Mal 'ninguna placa de red física con IPv4 - sin red las tablets no llegan'
} else {
  foreach ($ip in $ips) {
    $comoLlego = if ($ip.PrefixOrigin -eq 'Manual') { 'IP fija' } else { "por DHCP" }
    $medio = if ($ip.PorCable) { 'cable' } else { 'WiFi' }
    $texto = "$($ip.IPAddress)  $($ip.InterfaceAlias)  - $medio, $comoLlego"
    if ($ip.PrefixOrigin -eq 'Manual' -and $ip.PorCable) { Ok $texto } else { Ojo $texto }
  }
  if ($ips | Where-Object { $_.PrefixOrigin -ne 'Manual' }) {
    Dato 'Las tablets llevan la URL amurada igual que el soporte: si la IP cambia,'
    Dato 'dejan de encontrar el servidor. Reserva en el router o IP fija.'
  }
  if (-not ($ips | Where-Object { $_.PorCable })) {
    Dato 'Este servidor está sólo por WiFi. En una fábrica con cámaras y lavados, el'
    Dato 'cable no es un lujo: es el único tramo que no se cae solo.'
  }
}

$virtuales = @(Get-NetAdapter -EA SilentlyContinue | Where-Object { $_.Virtual -and $_.Status -eq 'Up' })
if ($virtuales) {
  Dato "ignoré $($virtuales.Count) placa(s) virtual(es): $(($virtuales.Name) -join ', ')"
}

$enUso = @(Get-NetTCPConnection -LocalPort $Puerto -State Listen -EA SilentlyContinue)
if ($enUso) {
  $quien = (Get-Process -Id $enUso[0].OwningProcess -EA SilentlyContinue).ProcessName
  Ojo "el puerto $Puerto ya está ocupado por '$quien' - elegí otro con -Puerto"
} else { Ok "el puerto $Puerto está libre" }

$regla = Get-NetFirewallRule -DisplayName $REGLA_FIREWALL -EA SilentlyContinue
if ($regla) { Ok "la regla de firewall '$REGLA_FIREWALL' ya existe" }
else { Dato "falta la regla de firewall - la creo en la instalación" }

Titulo 'Node'

$nodeExe = $null
$cmdNode = Get-Command node.exe -EA SilentlyContinue
if ($cmdNode) { $nodeExe = $cmdNode.Source }
elseif (Test-Path 'C:\Program Files\nodejs\node.exe') { $nodeExe = 'C:\Program Files\nodejs\node.exe' }

if (-not $nodeExe) {
  Mal 'no hay Node instalado  (winget install -e --id OpenJS.NodeJS.LTS)'
} else {
  $ver = (& $nodeExe -v).Trim()
  $mayor = [int]($ver -replace '^v(\d+)\..*$', '$1')
  if ($mayor -lt 20) { Mal "Node $ver es muy viejo; hace falta 20 o más (ideal 22 LTS)" }
  elseif ($mayor -ne 22) { Ojo "Node $ver - el proyecto fija 22.x para el deploy; acá anda, pero conviene igualar" }
  else { Ok "Node $ver" }
  Dato $nodeExe

  # La tarea de arranque corre como SYSTEM, que tiene otro PATH y otro perfil. Un Node
  # instalado con nvm dentro del perfil del usuario existe para vos y no para SYSTEM.
  # Por eso la ruta completa se guarda en instalar\entorno.ps1 y no se resuelve por PATH.
  if ($nodeExe -like "$env:USERPROFILE*") {
    Ojo 'Node está dentro de tu perfil de usuario - guardo la ruta completa para que SYSTEM lo encuentre'
  }
}

if (Test-Path (Join-Path $RAIZ 'node_modules\pg')) { Ok 'las dependencias están instaladas' }
else { Dato 'faltan las dependencias - corro npm install en la instalación' }

Titulo 'PostgreSQL'

function BuscarBinariosPg {
  $candidatos = New-Object System.Collections.Generic.List[string]
  $c = Get-Command psql.exe -EA SilentlyContinue
  if ($c) { $candidatos.Add((Split-Path $c.Source)) }
  foreach ($d in (Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -EA SilentlyContinue |
                  Sort-Object Name -Descending)) {
    $candidatos.Add((Join-Path $d.FullName 'bin'))
  }
  foreach ($k in (Get-ChildItem 'HKLM:\SOFTWARE\PostgreSQL\Installations' -EA SilentlyContinue)) {
    $bd = (Get-ItemProperty $k.PSPath -EA SilentlyContinue)."Base Directory"
    if ($bd) { $candidatos.Add((Join-Path $bd 'bin')) }
  }
  foreach ($ruta in $candidatos) {
    if ((Test-Path (Join-Path $ruta 'psql.exe')) -and (Test-Path (Join-Path $ruta 'pg_dump.exe'))) {
      return $ruta
    }
  }
  return $null
}

$binPg = BuscarBinariosPg
$servicioPg = @(Get-Service -Name 'postgresql*' -EA SilentlyContinue)

if (-not $binPg) {
  Mal 'no encontré PostgreSQL  (winget install -e --id PostgreSQL.PostgreSQL.17)'
  Dato 'Piso duro: PostgreSQL 12 - el esquema usa columnas GENERATED ... STORED.'
  Dato 'Recomendado: 17 o 18, que es lo que corre el hosting (medido 18.4).'
} else {
  $vPsql = (& (Join-Path $binPg 'psql.exe') --version) -replace '[^0-9\.]', ''
  $mayorPg = [int]($vPsql -split '\.')[0]
  if ($mayorPg -lt 12) { Mal "PostgreSQL $vPsql es anterior a la 12 - el esquema no entra" }
  else { Ok "PostgreSQL $vPsql" }
  Dato $binPg
}

if (-not $servicioPg) {
  if ($binPg) { Ojo 'hay binarios de PostgreSQL pero ningún servicio - ¿está sólo el cliente?' }
} else {
  foreach ($s in $servicioPg) {
    if ($s.Status -eq 'Running') { Ok "servicio $($s.Name): andando" }
    else { Mal "servicio $($s.Name): $($s.Status) - tiene que estar andando" }
  }
}

Titulo 'el proyecto'

foreach ($req in @('migraciones\001-esquema.sql', 'server\index.js', 'herramientas\mudar-base.mjs', 'package.json')) {
  if (Test-Path (Join-Path $RAIZ $req)) { Ok $req }
  else { Mal "falta $req - ¿el repo está completo?" }
}

$envLocal = Join-Path $RAIZ '.env.local'
if (Test-Path $envLocal) {
  Ojo '.env.local ya existe - NO lo piso; si querés uno nuevo, renombralo antes'
} else {
  Dato '.env.local se crea en la instalación'
}

# ================================================================ VEREDICTO

Titulo 'veredicto'

if ($script:Problemas.Count -eq 0) {
  Write-Host '  SE PUEDE INSTALAR' -ForegroundColor Green
} else {
  $cuantas = if ($script:Problemas.Count -eq 1) { 'falta 1 cosa' } else { "faltan $($script:Problemas.Count) cosas" }
  Write-Host "  NO se puede instalar todavía - $cuantas`:" -ForegroundColor Red
  foreach ($p in $script:Problemas) { Write-Host "    - $p" -ForegroundColor Red }
}
if ($script:Avisos.Count) {
  Write-Host ''
  Write-Host '  Para mirar (no frenan la instalación):' -ForegroundColor Yellow
  foreach ($a in $script:Avisos) { Write-Host "    - $a" -ForegroundColor Yellow }
}

Write-Host ''
Write-Host '  Esto el script no lo puede ver, y hay que confirmarlo a ojo:' -ForegroundColor White
Write-Host '    - ¿Esta máquina tiene UPS? Sin UPS, un corte de luz corta el registro' -ForegroundColor DarkGray
Write-Host '      de producción de toda la planta.' -ForegroundColor DarkGray
Write-Host '    - ¿Windows Update la reinicia sola de madrugada? Configurá las horas' -ForegroundColor DarkGray
Write-Host '      activas para que no caiga en turno.' -ForegroundColor DarkGray
Write-Host '    - ¿Qué más corre acá? Si es el servidor del ERP, la carga es despreciable' -ForegroundColor DarkGray
Write-Host '      pero quedás atado a sus ventanas de mantenimiento.' -ForegroundColor DarkGray

if (-not $Confirmar) {
  Titulo 'lo que haría con -Confirmar'
  Haria "apagar la suspensión del equipo (enchufado)"
  Haria "crear el rol '$Usuario' y la base '$Base' en PostgreSQL"
  Haria "escribir .env.local con DATABASE_URL y PORT=$Puerto"
  Haria "armar el esquema (001-esquema.sql + migraciones 002..00N) y cargar el catálogo"
  Haria "abrir el puerto $Puerto en el firewall, SÓLO para la red local"
  Haria "registrar la tarea '$TAREA_SERVIDOR' que levanta el servidor al arrancar Windows"
  if (-not $SinBackup) { Haria "registrar la tarea '$TAREA_BACKUP': pg_dump todos los días a las 22:00" }
  Write-Host ''
  Write-Host '  Nada de esto pasó todavía.' -ForegroundColor Yellow
  Write-Host ''
  exit 0
}

if ($script:Problemas.Count) {
  Write-Host ''
  Write-Host '  Me planto acá: resolvé lo de arriba y volvé a correrlo.' -ForegroundColor Red
  Write-Host ''
  exit 1
}

# ================================================================ INSTALACIÓN

Titulo 'INSTALANDO'

# ---- energía
if ($dormir -ne 0) {
  powercfg /change standby-timeout-ac 0
  powercfg /change hibernate-timeout-ac 0
  powercfg /change disk-timeout-ac 0
  Ok 'suspensión e hibernación apagadas (enchufado)'
}

# ---- la base
$psql = Join-Path $binPg 'psql.exe'

if (-not $ClavePostgres) {
  Write-Host ''
  Write-Host "  Clave del superusuario 'postgres' (la que elegiste al instalar PostgreSQL):" -ForegroundColor White
  $segura = Read-Host -AsSecureString '  clave'
  $ClavePostgres = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura))
}

# La contraseña de la app se genera acá y es alfanumérica a propósito.
#
# Va adentro de una URL (postgres://usuario:CLAVE@host/base) y ahí los caracteres @ : /
# ? # % parten la URL en el lugar equivocado. El error que sale habla de un host que no
# existe y no de la contraseña: ya nos pasó con el hosting. Alfanumérica de 32 no tiene
# menos entropía que la alternativa y no hay nada que escapar nunca.
$abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$bytes = New-Object byte[] 32
$rng.GetBytes($bytes)
$ClaveApp = -join ($bytes | ForEach-Object { $abc[$_ % $abc.Length] })

$env:PGPASSWORD = $ClavePostgres

function Psql($sql, $base) {
  if (-not $base) { $base = 'postgres' }
  $salida = & $psql -U postgres -h $HostPg -p $PuertoPg -d $base -v ON_ERROR_STOP=1 -tAc $sql 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host "  psql falló:" -ForegroundColor Red
    Write-Host ($salida -join "`n") -ForegroundColor Red
    $env:PGPASSWORD = $null
    exit 1
  }
  return ($salida -join "`n").Trim()
}

$verPg = Psql 'SHOW server_version_num'
if ([int]$verPg -lt 120000) {
  Mal "el servidor corre PostgreSQL $verPg; el esquema necesita 12 o más"
  $env:PGPASSWORD = $null
  exit 1
}
Ok "conectado al servidor (server_version_num $verPg)"

# CREATE ROLE no es idempotente y CREATE DATABASE no corre dentro de un bloque DO, así
# que cada uno se consulta antes. Correr el instalador dos veces no tiene que romper nada.
$existeRol = Psql "SELECT 1 FROM pg_roles WHERE rolname = '$Usuario'"
if ($existeRol -eq '1') {
  Ojo "el rol '$Usuario' ya existía - le pongo una contraseña nueva"
  Psql "ALTER ROLE ""$Usuario"" WITH LOGIN PASSWORD '$ClaveApp'" | Out-Null
} else {
  Psql "CREATE ROLE ""$Usuario"" WITH LOGIN PASSWORD '$ClaveApp'" | Out-Null
  Ok "rol '$Usuario' creado"
}

$existeBase = Psql "SELECT 1 FROM pg_database WHERE datname = '$Base'"
if ($existeBase -eq '1') {
  Ojo "la base '$Base' ya existía - no la toco"
} else {
  Psql "CREATE DATABASE ""$Base"" OWNER ""$Usuario"" ENCODING 'UTF8'" | Out-Null
  Ok "base '$Base' creada"
}

# El rol de la app es dueño de su esquema y de nada más. No es superusuario: no hace
# falta para nada de lo que hace el sistema, y un servidor de planta es justo donde no
# conviene que el proceso que mira internet entre como postgres.
Psql "ALTER SCHEMA public OWNER TO ""$Usuario""" $Base | Out-Null
Psql "GRANT ALL ON SCHEMA public TO ""$Usuario""" $Base | Out-Null
Ok "el esquema public quedó a nombre de '$Usuario'"

$env:PGPASSWORD = $null

$DATABASE_URL = "postgres://$Usuario`:$ClaveApp@$HostPg`:$PuertoPg/$Base"

# ---- .env.local
if (Test-Path $envLocal) {
  Ojo '.env.local ya existía - NO lo toqué. Revisá que DATABASE_URL apunte a la base local.'
} else {
  $contenido = @"
# Configuración del servidor de planta. La escribió instalar\planta.ps1.
#
# NO se sube al repo: .gitignore tiene .env*, y acá adentro hay una contraseña.
#
# Si alguna vez hay más de un DATABASE_URL sin comentar, GANA EL ÚLTIMO. Es la forma
# más fácil de creer que estás mirando una base y estar escribiendo en otra.

DATABASE_URL=$DATABASE_URL
PORT=$Puerto

# ACCESO_CLAVE queda SIN definir a propósito.
#
# Adentro de la red de la fábrica el operario con guantes no puede tipear una
# contraseña, y la amenaza no es un desconocido: es registrar a nombre de otro.
# Pero ojo, hoy es todo o nada: sin clave, el escritorio /app también queda abierto
# para cualquiera que esté en el WiFi de la fábrica.
#
# ACCESO_CLAVE=
"@
  EscribirSinBOM $envLocal $contenido
  Ok '.env.local escrito (UTF-8 sin BOM)'
}

# ---- dependencias
Push-Location $RAIZ
try {
  if (-not (Test-Path (Join-Path $RAIZ 'node_modules\pg'))) {
    Write-Host '  instalando dependencias (puede tardar)...' -ForegroundColor DarkGray
    & cmd.exe /c 'npm install --omit=dev 2>&1' | Out-Null
    if (-not (Test-Path (Join-Path $RAIZ 'node_modules\pg'))) {
      Mal 'npm install no dejó node_modules\pg - mirá el error a mano'
      exit 1
    }
    Ok 'dependencias instaladas'
  }

  # ---- esquema
  # Se reusa la herramienta que ya movió la base de Supabase al hosting. Con
  # --solo-esquema y sin ORIGEN arma 001-esquema.sql + las migraciones 002..00N sobre
  # una base vacía, y si la base YA tiene tablas no toca nada. Una sola ruta de código
  # para armar el esquema, que es la que ya está probada.
  $env:DESTINO = $DATABASE_URL
  & $nodeExe (Join-Path $RAIZ 'herramientas\mudar-base.mjs') '--solo-esquema' '--confirmar'
  $codigo = $LASTEXITCODE
  $env:DESTINO = $null
  if ($codigo -ne 0) { Mal 'falló el armado del esquema'; exit 1 }
  Ok 'esquema armado'

  # ---- catálogo
  # El seed es idempotente: sobre una base que ya tiene datos no agrega nada.
  & $nodeExe '--env-file-if-exists=.env.local' (Join-Path $RAIZ 'server\seed.js')
  if ($LASTEXITCODE -ne 0) { Mal 'falló el seed'; exit 1 }
  Ok 'catálogo cargado'
} finally {
  Pop-Location
}

# ---- entorno para la tarea (ver el comentario de arriba sobre SYSTEM y el PATH)
$entorno = @"
# Lo generó instalar\planta.ps1. No se edita a mano: volvé a correr el instalador.
#
# La tarea programada corre como SYSTEM, que tiene otro PATH que el tuyo. Por eso acá
# va la ruta COMPLETA a node.exe y no un 'node' pelado.
`$NODE = '$nodeExe'
`$RAIZ = '$RAIZ'
"@
EscribirSinBOM (Join-Path $PSScriptRoot 'entorno.ps1') $entorno
Ok 'instalar\entorno.ps1 escrito'

# ---- firewall
# Sólo la red local. El sistema no tiene por qué ser alcanzable desde fuera de la
# fábrica, y hoy además arranca sin ACCESO_CLAVE.
if ($regla) { Remove-NetFirewallRule -DisplayName $REGLA_FIREWALL -EA SilentlyContinue }
New-NetFirewallRule -DisplayName $REGLA_FIREWALL -Direction Inbound -Protocol TCP `
  -LocalPort $Puerto -RemoteAddress LocalSubnet -Action Allow -Profile Any | Out-Null
Ok "puerto $Puerto abierto para la red local"

# ---- tarea del servidor
$envoltorio = Join-Path $PSScriptRoot 'servidor.ps1'
$accion = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$envoltorio`"" `
  -WorkingDirectory $RAIZ

# Arranca con Windows, sin que nadie inicie sesión: la planta entra a las 5 y nadie
# va a ir a loguearse al servidor.
$disparador = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

# ExecutionTimeLimit en cero es LO IMPORTANTE de esta línea: por defecto el Programador
# de tareas mata lo que lleve más de 3 días corriendo. Un servidor que se apaga solo
# cada 72 horas es el bug más difícil de encontrar de todos los que podríamos dejar.
$ajustes = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask -TaskName $TAREA_SERVIDOR -Action $accion -Trigger $disparador `
  -Principal $principal -Settings $ajustes -Description 'Servidor de produccion - Lacteos Belgrano' -Force | Out-Null
Ok "tarea '$TAREA_SERVIDOR' registrada (arranca con Windows)"

# ---- tarea del backup
if (-not $SinBackup) {
  $scriptBackup = Join-Path $PSScriptRoot 'backup.ps1'
  $argsBackup = "-ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File `"$scriptBackup`""
  if ($CopiaBackup) { $argsBackup += " -Copia `"$CopiaBackup`"" }

  $accionB = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argsBackup -WorkingDirectory $RAIZ
  $dispB = New-ScheduledTaskTrigger -Daily -At '22:00'
  $ajustesB = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $TAREA_BACKUP -Action $accionB -Trigger $dispB `
    -Principal $principal -Settings $ajustesB -Description 'pg_dump diario - Lacteos Belgrano' -Force | Out-Null
  Ok "tarea '$TAREA_BACKUP' registrada (todos los días 22:00)"
  if (-not $CopiaBackup) {
    Ojo 'el backup queda en el mismo disco que la base - pasá -CopiaBackup <ruta> para sacarlo de ahí'
  }
}

# ---- arrancar y comprobar
Start-ScheduledTask -TaskName $TAREA_SERVIDOR
Write-Host '  esperando a que levante...' -ForegroundColor DarkGray

$arranco = $false
foreach ($i in 1..20) {
  Start-Sleep -Seconds 1
  try {
    $r = Invoke-WebRequest -Uri "http://localhost:$Puerto/api/catalogo?sector=lecheria" `
      -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $arranco = $true; break }
  } catch { }
}

if ($arranco) { Ok 'el servidor contesta' }
else {
  Mal 'el servidor no contestó en 20 s'
  Dato "mirá el log: $RAIZ\data\logs\servidor.log"
}

# ================================================================ LISTO

Titulo 'las tablets'

$ipPrincipal = ($ips | Select-Object -First 1).IPAddress
Write-Host ''
Write-Host "  Cada tablet se abre en una de estas direcciones:" -ForegroundColor White
Write-Host ''
foreach ($t in @(
  @('Recepción',          '/recepcion.html'),
  @('Lechería',           '/lecheria.html'),
  @('Yogures + Lechería', '/planta.html?sectores=yogures,lecheria'),
  @('Quesería + Saladero','/planta.html'),
  @('Envasado',           '/envasado.html'),
  @('Maduración',         '/maduracion.html'),
  @('Armado de pedidos',  '/pedidos.html'),
  @('Escritorio',         '/app')
)) {
  Write-Host ("    {0,-20} " -f $t[0]) -NoNewline
  Write-Host "http://$ipPrincipal`:$Puerto$($t[1])" -ForegroundColor Cyan
}

Write-Host ''
Write-Host '  OJO con el modo kiosco:' -ForegroundColor Yellow
Write-Host '  Sobre http:// (sin certificado) Chrome NO instala la PWA ni registra el' -ForegroundColor DarkGray
Write-Host '  service worker. La cola offline sigue andando -es localStorage, no depende' -ForegroundColor DarkGray
Write-Host '  del SW- pero se pierden la pantalla completa y el caché de pantallas.' -ForegroundColor DarkGray
Write-Host '  La salida recomendada es un navegador kiosco (Fully Kiosk Browser), que' -ForegroundColor DarkGray
Write-Host '  además arranca solo después de un corte de luz. Está explicado en' -ForegroundColor DarkGray
Write-Host '  docs\14-servidor-en-planta.md' -ForegroundColor DarkGray
Write-Host ''
Write-Host '  Listo.' -ForegroundColor Green
Write-Host ''
