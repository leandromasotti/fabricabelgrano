// Clave de acceso para cuando el sistema está expuesto a internet.
//
// Se activa SOLO si existe la variable de entorno ACCESO_CLAVE. Sin ella no pide nada,
// que es lo correcto en dos casos: desarrollo local, y el día que esto corra dentro de
// la red de la fábrica, donde el operario con guantes no puede tipear una contraseña.
//
// Para el prototipo público protege todo por igual. En la instalación real la
// configuración correcta es otra —tablets sin clave, escritorio con clave— porque son
// dos amenazas distintas: en planta el riesgo es que alguien registre a nombre de otro;
// en internet, que un desconocido anule pedidos.
//
// Se usa HTTP Basic a propósito: el navegador la recuerda, no hace falta construir una
// pantalla de login, y para un prototipo detrás de HTTPS alcanza. No es un sistema de
// usuarios y no pretende serlo.

import { timingSafeEqual } from 'node:crypto'

const USUARIO = process.env.ACCESO_USUARIO ?? 'belgrano'
const CLAVE = process.env.ACCESO_CLAVE

// Comparación de tiempo constante: comparar con === filtra información por el tiempo
// que tarda en fallar. Es barato hacerlo bien.
function igual(a, b) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

export function acceso(req, res, next) {
  if (!CLAVE) return next()

  const cabecera = req.headers.authorization ?? ''
  if (cabecera.startsWith('Basic ')) {
    const [usuario, ...resto] = Buffer.from(cabecera.slice(6), 'base64').toString().split(':')
    const clave = resto.join(':')
    if (igual(usuario, USUARIO) && igual(clave, CLAVE)) return next()
  }

  res.set('WWW-Authenticate', 'Basic realm="Lácteos Belgrano", charset="UTF-8"')
  res.status(401).send('Acceso restringido')
}

export function avisarAcceso() {
  if (CLAVE) {
    console.log(`Acceso protegido con clave (usuario: ${USUARIO})`)
  } else {
    console.log('Acceso ABIERTO - definí ACCESO_CLAVE antes de exponerlo a internet')
  }
}
