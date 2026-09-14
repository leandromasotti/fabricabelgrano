// Copia de seguridad de la base.
//
// POR QUÉ NO SE COPIA EL ARCHIVO A MANO
// SQLite corre en modo WAL: lo recién escrito vive en `fabrica.db-wal` hasta que se
// hace checkpoint, no en `fabrica.db`. Ahora mismo, en este proyecto, el .db pesa
// 28 KB y el -wal pesa 2 MB: copiar solo el .db se llevaría casi nada, y el backup
// parecería correcto hasta el día que hiciera falta usarlo.
//
// `VACUUM INTO` resuelve las dos cosas: escribe una base completa y consistente
// —incluyendo lo que está en el WAL— y lo hace sin bloquear a quien esté escribiendo.
// El archivo que sale es una base SQLite normal: se abre con cualquier herramienta y
// se restaura copiándola encima. No hace falta ningún procedimiento especial, que es
// justo lo que uno quiere el día que se rompió algo.

import { db } from './db.js'
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const DESTINO = process.env.BACKUP_DIR ?? join(root, 'data', 'backups')
const RETENCION = Number(process.env.BACKUP_RETENCION ?? 30)

const sello = () =>
  new Date().toLocaleString('sv-SE').replace(/[: ]/g, '-').slice(0, 16)

export function backup() {
  mkdirSync(DESTINO, { recursive: true })
  const archivo = join(DESTINO, `fabrica-${sello()}.db`)

  // VACUUM INTO falla si el destino ya existe, lo cual es bueno: nunca pisa un backup.
  db.exec(`VACUUM INTO '${archivo.replace(/'/g, "''")}'`)

  const tamaño = statSync(archivo).size
  const borrados = limpiarViejos()
  return { archivo, tamaño, borrados }
}

// Se conservan los últimos N. Sin esto, en un año hay 365 copias llenando el disco
// del servidor y el backup termina fallando justo por haber funcionado demasiado bien.
function limpiarViejos() {
  const copias = readdirSync(DESTINO)
    .filter((f) => f.startsWith('fabrica-') && f.endsWith('.db'))
    .sort()
    .reverse()

  const sobran = copias.slice(RETENCION)
  for (const f of sobran) unlinkSync(join(DESTINO, f))
  return sobran.length
}

// La fábrica trabaja de 8 a 16. El backup automático corre a las 16:30, con la jornada
// cerrada: la copia queda completa y no compite con nadie escribiendo.
const HORA_BACKUP = Number(process.env.BACKUP_HORA ?? 16)
const MINUTO_BACKUP = Number(process.env.BACKUP_MINUTO ?? 30)

function faltaParaElBackup() {
  const ahora = new Date()
  const objetivo = new Date(ahora)
  objetivo.setHours(HORA_BACKUP, MINUTO_BACKUP, 0, 0)
  if (objetivo <= ahora) objetivo.setDate(objetivo.getDate() + 1)
  return objetivo - ahora
}

export function programarBackups() {
  // Uno al arrancar: si el servidor se reinició, algo pasó, y ese es justo el momento
  // en que uno quiere tener una copia.
  try {
    const r = backup()
    console.log(`Backup al arrancar: ${r.archivo} (${Math.round(r.tamaño / 1024)} KB)`)
  } catch (e) {
    console.error('Backup al arrancar FALLÓ:', e.message)
  }

  const programar = () => {
    setTimeout(() => {
      try {
        const r = backup()
        console.log(`Backup diario: ${r.archivo} (${Math.round(r.tamaño / 1024)} KB)` +
                    (r.borrados ? `, ${r.borrados} copias viejas borradas` : ''))
      } catch (e) {
        // Un backup que falla no puede tirar abajo el servidor de producción.
        console.error('Backup diario FALLÓ:', e.message)
      }
      programar()
    }, faltaParaElBackup())
  }
  programar()

  const h = String(HORA_BACKUP).padStart(2, '0')
  const m = String(MINUTO_BACKUP).padStart(2, '0')
  console.log(`Backups automáticos a las ${h}:${m}, conservando ${RETENCION} copias en ${DESTINO}`)
}

// Ejecutado directamente: npm run backup
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  const r = backup()
  console.log(`Backup listo: ${r.archivo}`)
  console.log(`  ${Math.round(r.tamaño / 1024)} KB` + (r.borrados ? ` · ${r.borrados} copias viejas borradas` : ''))
}
