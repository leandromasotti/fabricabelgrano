<#
  Lo que corre la tarea programada 'FabricaBelgrano' al arrancar Windows.

  POR QUÉ UN BUCLE Y NO `node server\index.js` A SECAS

  El Programador de tareas reintenta cuando la tarea FALLA. Si Node termina con código 0
  -una excepción manejada, un apagado limpio, cualquier cosa que no sea un crash- la
  tarea terminó bien y no se reintenta nada: el servidor queda apagado y las ocho tablets
  sin sistema, sin un solo error en ningún lado. El bucle lo levanta igual, pase lo que
  pase.

  La espera de 30 s cuando murió enseguida es para no dejar un bucle caliente: si la base
  no está, Node arrancaría y moriría miles de veces por minuto y llenaría el disco de log
  en una noche.
#>

$ErrorActionPreference = 'Continue'

# instalar\entorno.ps1 lo genera el instalador y trae la ruta COMPLETA a node.exe.
# Esta tarea corre como SYSTEM, que tiene otro PATH: un `node` pelado puede no existir.
$entorno = Join-Path $PSScriptRoot 'entorno.ps1'
if (Test-Path $entorno) {
  . $entorno
} else {
  $RAIZ = Split-Path -Parent $PSScriptRoot
  $NODE = 'node'
}

Set-Location $RAIZ

$logs = Join-Path $RAIZ 'data\logs'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$log = Join-Path $logs 'servidor.log'

# Rotación simple: una copia anterior y nada más. Un servidor de planta corriendo dos
# años no puede terminar con un log de 40 GB, y guardar diez generaciones de log de un
# sistema que ya guarda todo en la base no le sirve a nadie.
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 20MB)) {
  Move-Item $log "$log.1" -Force
}

function Apuntar($texto) {
  $linea = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  [envoltorio] $texto"
  Add-Content -Path $log -Value $linea -Encoding UTF8
}

Apuntar "arrancando - node: $NODE"

while ($true) {
  $desde = Get-Date

  # Se invoca a través de cmd a propósito: en PowerShell 5.1, redirigir la salida de
  # error de un .exe nativo con 2>&1 envuelve cada línea en un ErrorRecord y deja
  # $LASTEXITCODE mintiendo. cmd redirige y no interpreta nada.
  & cmd.exe /c "`"$NODE`" --env-file-if-exists=.env.local server\index.js >> `"$log`" 2>&1"
  $codigo = $LASTEXITCODE

  $vivio = ((Get-Date) - $desde).TotalSeconds
  if ($vivio -lt 10) {
    Apuntar "terminó con código $codigo a los $([Math]::Round($vivio)) s. Espero 30 s (puede ser la base)."
    Start-Sleep -Seconds 30
  } else {
    Apuntar "terminó con código $codigo. Lo levanto de nuevo."
    Start-Sleep -Seconds 5
  }
}
