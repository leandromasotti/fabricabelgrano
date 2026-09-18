import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

interface Estado {
  contenido: ReactNode
  x: number
  y: number
}

interface Api {
  /** Se cuelga de un elemento del SVG: devuelve los handlers de puntero. */
  enlazar: (contenido: ReactNode) => {
    onPointerEnter: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerLeave: () => void
  }
}

const Ctx = createContext<Api | null>(null)

export function useTooltip(): Api {
  const api = useContext(Ctx)
  if (!api) throw new Error('useTooltip fuera de <ProveedorTooltip>')
  return api
}

/**
 * Un solo tooltip para todos los gráficos de la pantalla.
 *
 * Se posiciona contra el viewport y se repliega solo cuando no entra: sin eso, el
 * tooltip de la última barra de la derecha se corta contra el borde, que es justo
 * donde están los días recientes, los que más se miran.
 */
export function ProveedorTooltip({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado | null>(null)
  const caja = useRef<HTMLDivElement>(null)

  const ubicar = useCallback((e: ReactPointerEvent, contenido: ReactNode) => {
    const margen = 14
    const r = caja.current?.getBoundingClientRect()
    const ancho = r?.width ?? 180
    const alto = r?.height ?? 60
    let x = e.clientX + margen
    let y = e.clientY + margen
    if (x + ancho > window.innerWidth - 8) x = e.clientX - ancho - margen
    if (y + alto > window.innerHeight - 8) y = e.clientY - alto - margen
    setEstado({ contenido, x, y })
  }, [])

  const api = useMemo<Api>(
    () => ({
      enlazar: (contenido) => ({
        onPointerEnter: (e) => ubicar(e, contenido),
        onPointerMove: (e) => ubicar(e, contenido),
        onPointerLeave: () => setEstado(null),
      }),
    }),
    [ubicar],
  )

  return (
    <Ctx.Provider value={api}>
      {children}
      <div
        ref={caja}
        role="tooltip"
        aria-hidden={!estado}
        className="pointer-events-none fixed z-50 max-w-60 rounded-lg border border-borde bg-superficie px-2.5 py-2 text-[12.5px] leading-snug shadow-lg transition-opacity"
        style={{
          left: estado?.x ?? 0,
          top: estado?.y ?? 0,
          opacity: estado ? 1 : 0,
        }}
      >
        {estado?.contenido}
      </div>
    </Ctx.Provider>
  )
}
