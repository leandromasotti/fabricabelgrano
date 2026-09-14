# Piloto de lechería — qué instalar, qué mirar, qué decidir

**Fecha:** 2026-09-11
**Decisión que lo motiva:** hay 12 pantallas construidas y **ningún operario tocó una sola**.
El plan original definía este hito como el único que importa, porque el riesgo del proyecto
nunca fue técnico.

---

## 1. La pregunta que este piloto contesta

> **Después de una semana, ¿el operario de lechería sigue usando la tablet, o volvió al cartón?**

Nada más. No es "¿anda el software?" — eso ya lo sabemos. Es si la gente lo usa cuando nadie
la está mirando.

**Por qué importa ahora:** cada pantalla nueva que se construye aumenta lo que habría que rehacer
si la respuesta es incómoda. Congelar el alcance una semana es más barato que descubrir en el mes
cuatro que el modelo de interacción no funciona en planta.

---

## 2. Alcance del piloto

**Entra una sola pantalla: lechería.** Una tablet, un sector.

| Entra | No entra |
|---|---|
| `/lecheria.html` en la tablet | Quesería, saladero, maduración, envasado, pedidos |
| `/consulta.html` para el encargado | Tablero LED, reportes, despacho |

Las demás pantallas existen y funcionan, pero **no se muestran todavía**. Si se abren seis
sectores a la vez y algo no gusta, no se va a saber cuál era el problema.

---

## 3. Lo que hay que hacer antes de instalar

### 3.1 Datos reales
```bash
npm run operarios                 # ver qué hay cargado
npm run operarios -- lecheria "Juan Pérez" "Carlos Gómez" "Nicolás Ruiz"
```
- [ ] **Lista real de operarios de lechería** ← lo único que bloquea
- [ ] Confirmar la marca **"Ovenac"** (pregunta A1)
- [ ] Confirmar si un pallet tiene cantidad fija de unidades o varía

### 3.2 Backups
```bash
npm run backup      # manual, cuando se quiera
```
El servidor hace uno **al arrancar** y otro **todos los días a las 16:30**, con la jornada cerrada
(la fábrica trabaja de 8 a 16). Conserva las últimas 30 copias en `data/backups/`.

⚠️ **No copiar `fabrica.db` a mano.** SQLite corre en modo WAL: lo recién escrito vive en
`fabrica.db-wal` hasta el checkpoint. En este mismo proyecto, el `.db` pesaba 28 KB mientras el
`-wal` pesaba 2 MB — copiar solo el `.db` se hubiera llevado casi nada, y el backup habría parecido
correcto hasta el día de usarlo. `npm run backup` usa `VACUUM INTO`, que escribe una base completa
y consistente sin bloquear a nadie.

- [ ] Verificar que `data/backups/` se está llenando después del primer día
- [ ] Copiar un backup **fuera del servidor** (pendrive, Drive, lo que sea). Un backup en el mismo
      disco que la base no es un backup.

### 3.3 Instalación física
- [ ] Amurar la tablet en lechería, **al alcance del operario que arma el pallet**
- [ ] Toma de corriente cerca (va enchufada, no a batería)
- [ ] Verificar WiFi **en ese punto exacto**, no en la oficina
- [ ] Abrir `/lecheria.html` en modo kiosco / pantalla completa
- [ ] Desactivar el bloqueo de pantalla de la tablet

### 3.4 Con la gente
- [ ] Mostrarle la pantalla al operario **antes** de colgarla, no después
- [ ] Decirle explícitamente que **el cartón sigue estando** y que puede usarlo si algo falla.
      Sacarle la red de seguridad el primer día es la forma más rápida de que odie el sistema.
- [ ] Avisarle que el botón DESHACER existe y que equivocarse no es un problema

---

## 4. Qué mirar durante la semana

Esto es lo que hay que anotar. **Ningún dato de acá sale del software** — sale de mirar.

### Los tres números que importan
| Qué | Cómo se mide | Qué significaría |
|---|---|---|
| **Pallets registrados por día** | `/consulta.html` | Si baja durante la semana, lo están abandonando |
| **Pallets en el cartón vs. en la tablet** | contar el cartón al final del día | La diferencia es lo que el sistema **no** capturó |
| **Cuántas veces se usó DESHACER** | consultar la base | Muchas = los botones están mal puestos o son chicos |

> El segundo es el más importante y el único honesto. Si el cartón sigue teniendo más marcas que
> la tablet, el sistema no está funcionando, por más que la pantalla ande perfecto.

### Lo que hay que observar en persona
Ir un rato a mirar, sin ayudar:
- [ ] ¿Toca los botones a la primera, o falla y tiene que repetir?
- [ ] ¿Con guantes? ¿Con las manos mojadas?
- [ ] ¿Se acerca a la tablet o le queda lejos de donde arma el pallet?
- [ ] ¿Mira la lista de "Hoy" o la ignora? (esa lista reemplaza al cartón como memoria del turno)
- [ ] ¿Se lo cuenta a otro operario, o lo usa por obligación?

### Lo que hay que preguntarle al final
- [ ] "¿Qué te resultó molesto?"
- [ ] "¿Qué le falta?"
- [ ] "Si mañana te saco la tablet y te devuelvo el cartón, ¿te molesta?" ← **la pregunta que vale**

---

## 5. Qué decidir al final de la semana

| Si pasó esto | Entonces |
|---|---|
| Usa la tablet y el cartón quedó vacío | Funciona. Seguir con quesería y saladero. |
| Usa las dos cosas | Falta algo que el cartón le da y la pantalla no. Averiguar qué **antes** de seguir. |
| Volvió al cartón | Parar. El problema no es de software y ninguna pantalla nueva lo arregla. |

---

## 6. Lo que queda pendiente y por qué puede esperar

Nada de esto bloquea el piloto, pero sí bloquea el uso real a mediano plazo:

| Falta | Por qué puede esperar una semana | Por qué no puede esperar tres meses |
|---|---|---|
| **ABM de datos maestros** | En una semana no cambia ningún operario | Hoy agregar a alguien necesita un desarrollador |
| **Merma y descarte** (B5) | Lechería registra pallets, no stock | En los sectores de queso el stock deriva todos los días |
| **Ajuste de inventario** | ídem | Sin reconciliación, el primer desvío se acumula sin límite |
| **Los otros 3 canales de venta** (C5) | El piloto no toca stock | "Listo para vender" va a crecer indefinidamente y nadie le va a creer |
| **Autenticación** | Corre en la red de la fábrica | El día que salga a internet, cualquiera factura pedidos |

Los tres del medio son la misma enfermedad: **el sistema sabe sumar pero no restar.** Un número
que solo crece deja de mirarse.
