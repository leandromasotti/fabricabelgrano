@echo off
rem ============================================================================
rem  PASO 1 - REVISAR LA MAQUINA
rem
rem  No instala nada. No cambia nada. Mira que tiene esta computadora y deja el
rem  resultado en REVISION.txt, al lado de este archivo.
rem
rem  Sin acentos y sin BOM a proposito: cmd.exe muestra basura con cualquiera de
rem  las dos cosas, y este archivo lo abre alguien que no es programador.
rem ============================================================================

chcp 65001 > nul
cd /d "%~dp0"

echo.
echo   Revisando la maquina. Son unos segundos...
echo.

rem En el paquete que se manda a la fabrica estos .cmd estan en la raiz y el
rem instalador cuelga de instalar\. En el repo estan los dos juntos. Anda igual
rem en los dos lados: lo que no puede pasar es que no arranque por eso.
set FB_PS1=%~dp0instalar\planta.ps1
if not exist "%FB_PS1%" set FB_PS1=%~dp0planta.ps1

powershell -ExecutionPolicy Bypass -NoProfile -File "%FB_PS1%" > "%~dp0REVISION.txt" 2>&1

type "%~dp0REVISION.txt"

echo.
echo ============================================================================
echo   Esto quedo guardado en:
echo   %~dp0REVISION.txt
echo.
echo   Mandale ESE archivo a Leandro antes de instalar nada.
echo ============================================================================
echo.
pause
