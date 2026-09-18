import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Ancho real del contenedor, para que el gráfico se dibuje a la medida en vez de
 * escalarse.
 *
 * La alternativa fácil —un `viewBox` fijo con `width: 100%`— escala también las
 * etiquetas: en un panel ancho los nombres de los quesos salen gigantes y en uno
 * angosto, ilegibles. Midiendo el contenedor, el texto queda siempre a 13 px y lo
 * único que se estira son las barras, que es lo que uno quiere que se estire.
 */
export function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [ancho, setAncho] = useState(0)

  useLayoutEffect(() => {
    const nodo = ref.current
    if (!nodo) return
    const observador = new ResizeObserver((entradas) => {
      const r = entradas[0]?.contentRect
      if (r) setAncho(r.width)
    })
    observador.observe(nodo)
    return () => observador.disconnect()
  }, [])

  return [ref, ancho] as const
}
