@echo off
rem ============================================================================
rem  PASO 2 - INSTALAR
rem
rem  Correr SOLO despues de que Leandro haya visto el REVISION.txt del paso 1.
rem
rem  Pide permiso de Administrador (sale un cartel de Windows: hay que decir SI)
rem  y despues pide la clave del PostgreSQL que se instalo antes.
rem ============================================================================

chcp 65001 > nul
cd /d "%~dp0"

rem Se vuelve a lanzar a si mismo con permisos de Administrador. Sin esto no se
rem pueden crear la tarea de arranque ni la regla del firewall, y el instalador
rem se planta antes de tocar nada.
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo.
  echo   Pidiendo permisos de Administrador...
  echo   Si Windows pregunta, hay que decir SI.
  echo.
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo.
echo ============================================================================
echo   INSTALANDO EL SISTEMA DE PRODUCCION
echo.
echo   Va a pedir la clave del usuario 'postgres': es la que se eligio al
echo   instalar PostgreSQL. Al escribirla NO se ve en pantalla, es normal.
echo ============================================================================
echo.

set FB_PS1=%~dp0instalar\planta.ps1
if not exist "%FB_PS1%" set FB_PS1=%~dp0planta.ps1

powershell -ExecutionPolicy Bypass -NoProfile -File "%FB_PS1%" -Confirmar

echo.
echo ============================================================================
echo   Si llego hasta aca y dice "Listo", el sistema esta andando y arranca
echo   solo cada vez que se prenda la computadora.
echo.
echo   Anota las direcciones que aparecen arriba: son las de cada tablet.
echo ============================================================================
echo.
pause
