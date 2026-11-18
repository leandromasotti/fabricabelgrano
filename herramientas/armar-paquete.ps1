<#
  Arma la carpeta que se le manda a la fábrica para instalar el sistema.

      powershell -ExecutionPolicy Bypass -File herramientas\armar-paquete.ps1

  POR QUÉ UN SCRIPT Y NO UN ZIP A MANO

  Porque en el repo hay cosas que NO pueden salir de esta máquina:

    .env.local      la contraseña del PostgreSQL del hosting y la de Supabase
    cuenta_4x       la clave SSH privada de la cuenta de GitHub
    data/           la base y los backups
    supabase-backup/ un volcado de producción

  Un zip hecho arrastrando la carpeta se lleva las cuatro. Y el día que eso pasa no hay
  forma de saberlo: el paquete anda igual.

  La base del paquete es `git archive`, o sea SÓLO lo que está versionado. Todo lo de
  arriba está en .gitignore, así que no puede entrar ni por error. Después se agregan a
  mano las dos cosas que el sistema necesita y que justamente NO se versionan
  (node_modules y public/app), y al final se revisa el resultado y se aborta si apareció
  algo que no corresponde.
#>

param(
  [string]$Destino = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'FabricaBelgrano-planta'),
  [switch]$SinZip
)

$ErrorActionPreference = 'Stop'
$RAIZ = Split-Path -Parent $PSScriptRoot

function Paso($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Ok($t)   { Write-Host '  ok   ' -ForegroundColor Green -NoNewline; Write-Host $t }
function Ojo($t)  { Write-Host '  ojo  ' -ForegroundColor Yellow -NoNewline; Write-Host $t }
function Morir($t) { Write-Host "`n  ABORTADO: $t`n" -ForegroundColor Red; exit 1 }

Push-Location $RAIZ
try {
  # ---------------------------------------------------------------- 1. qué versión
  Paso 'qué se empaqueta'

  $sucio = @(git status --porcelain | Where-Object { $_ -notmatch '^\?\?' })
  if ($sucio) {
    Ojo "hay $($sucio.Count) archivo(s) modificados SIN COMMITEAR - no entran al paquete:"
    foreach ($s in $sucio) { Write-Host "         $s" -ForegroundColor DarkGray }
    Ojo 'commiteá primero si querés que vayan'
  }
  $commit = (git log -1 --format='%h %s')
  Ok "desde el commit: $commit"

  # ---------------------------------------------------------------- 2. lo versionado
  Paso 'copiando lo versionado'

  if (Test-Path $Destino) { Remove-Item $Destino -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $Destino | Out-Null

  # git archive respeta .gitignore por definición: lo que no está versionado no sale.
  $tar = Join-Path $env:TEMP "fb-paquete-$PID.tar"
  git archive --format=tar -o $tar HEAD
  if ($LASTEXITCODE -ne 0) { Morir 'git archive falló' }
  & tar.exe -xf $tar -C $Destino
  if ($LASTEXITCODE -ne 0) { Morir 'no pude extraer el tar (¿falta tar.exe?)' }
  Remove-Item $tar -Force
  Ok "$(@(Get-ChildItem $Destino -Recurse -File).Count) archivos versionados"

  # Material de trabajo, no de instalación: transcripciones y análisis de los audios del
  # cliente. Son 2,3 MB que no hacen falta para que el sistema arranque.
  #
  # `supabase-backup` e `instalacion en servidor` entraron al repo despues de que esto
  # se escribio, y las dos TIENEN que salir del paquete. El backup porque es un volcado
  # de produccion y el verificador de mas abajo aborta el empaquetado si lo encuentra
  # —correctamente: no sale de esta maquina—. La carpeta de instalacion porque son
  # copias de archivos que el paquete ya trae, y una copia vieja al lado de la buena es
  # una trampa para el que la abra en la fabrica.
  foreach ($sobra in @('requerimientos', 'web', '.github', 'vercel-sin-estaticos',
                       'supabase-backup', 'instalacion en servidor')) {
    $r = Join-Path $Destino $sobra
    if (Test-Path $r) { Remove-Item $r -Recurse -Force; Ok "sacado: $sobra/" }
  }

  # Lo que Alexis tiene que ver al abrir la carpeta va ARRIBA DE TODO, no adentro de
  # instalar\. Alguien que no programa abre el zip y hace doble clic en lo primero que
  # entiende; si los tres archivos están dos carpetas adentro, no los encuentra.
  foreach ($suyo in @('LEEME.txt', '1-REVISAR.cmd', '2-INSTALAR.cmd')) {
    Move-Item (Join-Path $Destino "instalar\$suyo") (Join-Path $Destino $suyo) -Force
  }
  Ok 'LEEME.txt, 1-REVISAR.cmd y 2-INSTALAR.cmd quedaron en la raíz'

  # ---------------------------------------------------------------- 3. lo que no se versiona
  Paso 'agregando lo que el sistema necesita y no está en git'

  # El escritorio /app es el build de web/. Está en .gitignore porque versionarlo garantiza
  # conflictos en cada merge, pero SIN ESTO /app devuelve 404 en la fábrica.
  $appOrigen = Join-Path $RAIZ 'public\app'
  if (-not (Test-Path (Join-Path $appOrigen 'index.html'))) {
    Morir "falta public\app\index.html - compilá el escritorio con ``npm run web:build`` antes de empaquetar"
  }
  Copy-Item $appOrigen (Join-Path $Destino 'public\app') -Recurse -Force
  Ok 'public\app\ (el escritorio compilado)'

  # node_modules va adentro para no depender de que el servidor de la fábrica tenga
  # internet.
  #
  # better-sqlite3 NO viaja, y se excluye AL COPIAR en vez de borrarla después: es la
  # carpeta más pesada de todas (13 de los 18 MB), así que copiarla para borrarla era
  # la mayor parte del tiempo de empaquetado. Es un binario compilado para la versión
  # de Node de ESTA máquina y el servidor va a tener otra; es opcional de verdad,
  # server/db.js sólo la importa si no hay DATABASE_URL y en la fábrica siempre va a
  # haber.
  #
  # robocopy y no Copy-Item porque son miles de archivos chicos y la diferencia se
  # mide en minutos. Devuelve 0-7 cuando anduvo (1 = copió archivos); de 8 para
  # arriba es un error de verdad.
  $nmOrigen = Join-Path $RAIZ 'node_modules'
  if (-not (Test-Path (Join-Path $nmOrigen 'pg'))) { Morir 'no hay node_modules\pg - corré npm install' }

  & robocopy.exe $nmOrigen (Join-Path $Destino 'node_modules') /E /XD 'better-sqlite3' `
    /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
  if ($LASTEXITCODE -ge 8) { Morir "robocopy falló (código $LASTEXITCODE)" }
  $global:LASTEXITCODE = 0

  if (-not (Test-Path (Join-Path $Destino 'node_modules\pg'))) { Morir 'node_modules quedó incompleto' }
  Ok 'node_modules\ (sin better-sqlite3, que es de esta máquina)'

  # ---------------------------------------------------------------- 4. la revisión
  Paso 'revisando que no se haya colado nada'

  # EL PAQUETE SE RECORRE UNA SOLA VEZ.
  #
  # Antes había un Get-ChildItem -Recurse por cada patrón prohibido —nueve— más el del
  # conteo, el del escaneo de texto y el del tamaño: doce recorridos completos sobre los
  # mismos archivos. Con un antivirus mirando cada lectura eso son minutos. Se enumera
  # una vez y se filtra en memoria.
  $todos = @(Get-ChildItem $Destino -Recurse -File -Force -EA SilentlyContinue)
  Ok "$($todos.Count) archivos en total"

  $prohibidos = @('.env', '.env.*', 'cuenta_4x', 'cuenta_4x.*', '*.pem', 'id_ed25519*', 'id_rsa*', '*.db', '*.db-wal')
  $colados = @($todos | Where-Object {
    $nombre = $_.Name
    @($prohibidos | Where-Object { $nombre -like $_ }).Count -gt 0
  })
  foreach ($carpeta in @('data', 'supabase-backup', '.vercel')) {
    if (Test-Path (Join-Path $Destino $carpeta)) { $colados += (Get-Item (Join-Path $Destino $carpeta)) }
  }

  if ($colados) {
    foreach ($c in $colados) { Write-Host "         $($c.FullName)" -ForegroundColor Red }
    Morir "se colaron $($colados.Count) archivos que no pueden salir de esta máquina"
  }
  Ok 'sin archivos de credenciales ni datos de producción'

  # Una contraseña real adentro de un archivo de texto no la agarra el filtro de nombres.
  # Esto no decide por su cuenta: marca lo que parezca una URL con usuario y contraseña
  # para que lo mire una persona antes de subir nada.
  #
  # node_modules queda AFUERA del escaneo. Son miles de archivos de terceros: revisarlos
  # tardaba mas que todo el resto del empaquetado junto y no puede encontrar nada nuestro.
  # Lo que se revisa es lo que escribimos nosotros.
  $aRevisar = @($todos |
    Where-Object {
      $_.FullName -notlike "*\node_modules\*" -and
      $_.FullName -notlike "*\public\app\*" -and
      $_.Extension -in '.md', '.json', '.js', '.mjs', '.ps1', '.cmd', '.txt', '.sql', '.yml', '.html'
    })

  $sospechosas = @($aRevisar |
    Select-String -Pattern 'postgres(ql)?://[^:/\s]+:[^@\s]+@' -EA SilentlyContinue |
    Where-Object { $_.Line -notmatch 'USUARIO|CLAVE|usuario:clave|<|\.\.\.' })
  Ok "revisados $($aRevisar.Count) archivos de texto nuestros"

  if ($sospechosas) {
    Ojo 'esto parece una URL con contraseña - miralo antes de subir:'
    foreach ($s in $sospechosas) {
      Write-Host "         $($s.Filename):$($s.LineNumber)  $($s.Line.Trim())" -ForegroundColor Yellow
    }
  } else {
    Ok 'ninguna URL con contraseña en el texto'
  }

  # ---------------------------------------------------------------- 5. el zip
  # Se reusa $todos: entre la revisión y acá no se tocó nada del paquete.
  $tam = [Math]::Round(($todos | Measure-Object Length -Sum).Sum / 1MB, 1)
  Paso 'listo'
  Ok "$Destino  ($tam MB)"

  if (-not $SinZip) {
    $zip = "$Destino.zip"
    if (Test-Path $zip) { Remove-Item $zip -Force }
    # tar.exe y no Compress-Archive: el segundo, sobre los miles de archivos chicos de
    # node_modules, tarda muchisimo. tar viene con Windows 10 y 11 y hace el mismo .zip.
    Push-Location (Split-Path $Destino -Parent)
    & tar.exe -a -c -f $zip (Split-Path $Destino -Leaf)
    $codigoTar = $LASTEXITCODE
    Pop-Location
    if ($codigoTar -ne 0) {
      Ojo 'tar falló; pruebo con Compress-Archive (va a tardar bastante más)'
      Compress-Archive -Path "$Destino\*" -DestinationPath $zip -CompressionLevel Optimal
    }
    $tamZip = [Math]::Round((Get-Item $zip).Length / 1MB, 1)
    Ok "$zip  ($tamZip MB)  <- esto es lo que va al Drive"
  }

  Write-Host ''
  Write-Host '  Alexis abre la carpeta y hace doble clic en 1-REVISAR.cmd.' -ForegroundColor White
  Write-Host '  Le va a dejar un REVISION.txt para mandarte. Nada se instala con eso.' -ForegroundColor DarkGray
  Write-Host ''
} finally {
  Pop-Location
}
