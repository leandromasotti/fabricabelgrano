<#
  Backup diario de la base. Lo corre la tarea 'FabricaBelgrano-backup' a las 22:00.

  POR QUÉ NO `npm run backup`

  server/backup.js hace el backup con VACUUM INTO, que es de SQLite, y con PostgreSQL se
  planta a propósito en vez de fingir que hizo algo. Con Postgres el backup se hace desde
  afuera del proceso, con pg_dump, y eso es esto.

  Formato `custom` (-Fc) y no SQL plano: sale comprimido y se restaura con pg_restore
  eligiendo qué traer. Restaurar una tabla sola el día que alguien borró algo es la
  diferencia entre diez minutos y una tarde.

      powershell -ExecutionPolicy Bypass -File instalar\backup.ps1
      powershell -ExecutionPolicy Bypass -File instalar\backup.ps1 -Copia D:\backups

  PARA RESTAURAR:
      pg_restore --clean --if-exists -d "<DATABASE_URL>" <archivo.dump>
#>

param(
  # Segundo destino: otro disco, un pendrive, una carpeta de red. El backup que vive en
  # el mismo disco que la base protege contra "borré algo", no contra que el disco muera.
  [string]$Copia,
  [int]$Dias = 30
)

$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot

$logs = Join-Path $RAIZ 'data\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'backup.log'

function Apuntar($texto) {
  $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $texto"
  Add-Content -Path $log -Value $linea -Encoding UTF8
  Write-Host $linea
}

function Morir($texto) {
  Apuntar "ERROR: $texto"
  exit 1
}

# ---------------------------------------------------------------- la URL

$envLocal = Join-Path $RAIZ '.env.local'
if (-not (Test-Path $envLocal)) { Morir "no encontré $envLocal" }

# Gana el ÚLTIMO DATABASE_URL sin comentar, que es la misma regla que aplica Node al
# leer el archivo. Si acá eligiéramos el primero, el backup podría estar copiando una
# base distinta de la que el sistema está usando, y nadie se enteraría hasta el día malo.
$url = $null
foreach ($linea in (Get-Content $envLocal)) {
  if ($linea -match '^\s*DATABASE_URL\s*=\s*(.+?)\s*$') { $url = $Matches[1].Trim('"', "'") }
}
if (-not $url) { Morir "no hay un DATABASE_URL activo en .env.local" }

try { $u = [uri]$url } catch { Morir "DATABASE_URL no parece una URL" }

$partes = $u.UserInfo -split ':', 2
$pgUsuario = [uri]::UnescapeDataString($partes[0])
$pgClave = ''
if ($partes.Count -gt 1) { $pgClave = [uri]::UnescapeDataString($partes[1]) }
$pgBase = $u.AbsolutePath.TrimStart('/')
$pgHost = $u.Host
$pgPuerto = $u.Port
if ($pgPuerto -le 0) { $pgPuerto = 5432 }

if ($pgHost -ne 'localhost' -and $pgHost -ne '127.0.0.1') {
  Apuntar "ojo: la base no es local ($pgHost). Copio esa igual, que es la que usa el sistema."
}

# ---------------------------------------------------------------- pg_dump

$pgDump = $null
$c = Get-Command pg_dump.exe -EA SilentlyContinue
if ($c) { $pgDump = $c.Source }
else {
  foreach ($d in (Get-ChildItem 'C:\Program Files\PostgreSQL' -Directory -EA SilentlyContinue |
                  Sort-Object Name -Descending)) {
    $tal = Join-Path $d.FullName 'bin\pg_dump.exe'
    if (Test-Path $tal) { $pgDump = $tal; break }
  }
}
if (-not $pgDump) { Morir 'no encontré pg_dump.exe' }

$destino = Join-Path $RAIZ 'data\backups'
New-Item -ItemType Directory -Force -Path $destino | Out-Null

$sello = Get-Date -Format 'yyyy-MM-dd-HHmm'
$archivo = Join-Path $destino "fabrica-$sello.dump"

# La clave por variable de entorno y no en la línea de comandos: los argumentos de un
# proceso los ve cualquiera con el Administrador de tareas.
$env:PGPASSWORD = $pgClave
try {
  $salida = & $pgDump --host=$pgHost --port=$pgPuerto --username=$pgUsuario `
    --dbname=$pgBase --format=custom --file=$archivo 2>&1
  $codigo = $LASTEXITCODE
} finally {
  $env:PGPASSWORD = $null
}

if ($codigo -ne 0) { Morir "pg_dump falló: $($salida -join ' ')" }
if (-not (Test-Path $archivo)) { Morir 'pg_dump dijo que anduvo pero no dejó archivo' }

$tam = [Math]::Round((Get-Item $archivo).Length / 1KB, 1)
if ($tam -lt 1) { Morir "el backup pesa $tam KB - eso no es una base, es un archivo vacío" }
Apuntar "ok  $archivo  ($tam KB)"

# ---------------------------------------------------------------- la copia de afuera

if ($Copia) {
  try {
    New-Item -ItemType Directory -Force -Path $Copia | Out-Null
    Copy-Item $archivo -Destination $Copia -Force
    Apuntar "copiado a $Copia"
  } catch {
    # Que falle la copia externa no invalida el backup local: se avisa y se sigue.
    Apuntar "ojo: no pude copiar a $Copia - $($_.Exception.Message)"
  }
}

# ---------------------------------------------------------------- retención

$viejos = @(Get-ChildItem $destino -Filter 'fabrica-*.dump' -EA SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Dias) })

foreach ($v in $viejos) { Remove-Item $v.FullName -Force }
if ($viejos.Count) { Apuntar "borrados $($viejos.Count) backups de más de $Dias días" }

$quedan = @(Get-ChildItem $destino -Filter 'fabrica-*.dump' -EA SilentlyContinue).Count
Apuntar "quedan $quedan copias en $destino"
