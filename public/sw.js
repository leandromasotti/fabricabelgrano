// Cachea el "app shell" para que las pantallas abran aunque no haya red.
// Las escrituras NO pasan por aca: las maneja la cola offline en comun.js.
//
// Estrategia: RED PRIMERO con caida al cache, no al reves.
//
// Con cache-primero, cualquier cambio en el HTML o el JS queda invisible hasta que
// alguien acuerde subir la version de este archivo — y nadie se acuerda. En una
// planta con seis tablets amuradas eso significa seis pantallas corriendo codigo
// viejo sin que nadie lo note. Red-primero paga unos milisegundos por carga a cambio
// de que lo que se ve sea siempre lo que esta publicado.
//
// El timeout es lo que hace que esto siga sirviendo offline: si la red no contesta
// en 2,5 s (planta con WiFi al limite, o camara frigorifica sin senal) se sirve el
// cache en vez de dejar la pantalla colgada esperando.

const CACHE = 'fb-v9'
const TIMEOUT = 2500

const SHELL = [
  '/', '/index.html', '/styles.css', '/comun.js', '/manifest.json',
  '/recepcion.html', '/recepcion.js',
  '/lecheria.html', '/lecheria.js',
  '/yogures.html', '/yogures.js',
  '/queseria.html', '/queseria.js',
  '/saladero.html', '/saladero.js',
  '/envasado.html', '/envasado.js',
  '/maduracion.html', '/maduracion.js',
  '/pedidos.html', '/pedidos.js',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Pide a la red con limite de tiempo. Si contesta, se guarda la copia fresca.
async function desdeLaRed(request) {
  const control = new AbortController()
  const reloj = setTimeout(() => control.abort(), TIMEOUT)
  try {
    const res = await fetch(request, { signal: control.signal })
    if (res.ok) {
      const copia = res.clone()
      caches.open(CACHE).then((c) => c.put(request, copia)).catch(() => {})
    }
    return res
  } finally {
    clearTimeout(reloj)
  }
}

self.addEventListener('fetch', (e) => {
  const { request } = e
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== location.origin) return

  // El escritorio en /app NO pasa por aca.
  //
  // Sus archivos llevan el hash del contenido en el nombre y se renuevan enteros en
  // cada despliegue. Guardarlos aca producia el peor de los dos mundos: con un
  // arranque en frio del servidor pasando los 2,5 s del timeout, se servia el index
  // VIEJO desde el cache, y ese index pedia archivos que el build nuevo ya borro.
  //
  // Ademas no lo necesita: el escritorio se usa en una computadora con internet. El
  // que tiene que andar sin red es la tablet de planta, y para eso esta este cache.
  if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return

  // La API nunca se cachea: datos viejos servidos como frescos serian peor que un
  // error visible. La app ya sabe manejar el 503 y encolar lo que haga falta.
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(request).catch(
        () => new Response('{}', { status: 503, headers: { 'content-type': 'application/json' } })
      )
    )
    return
  }

  e.respondWith(
    desdeLaRed(request).catch(async () => {
      const guardado = await caches.match(request)
      if (guardado) return guardado
      // Una navegacion a una pantalla que nunca se abrio online no tiene copia:
      // al menos servimos el lanzador en vez de un error del navegador.
      if (request.mode === 'navigate') return (await caches.match('/')) ?? Response.error()
      return Response.error()
    })
  )
})
