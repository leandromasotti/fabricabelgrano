import { useEffect, useRef, type ReactNode } from 'react'

/**
 * Envuelve el `<dialog>` nativo en vez de recrearlo con divs.
 *
 * Lo nativo ya trae, gratis y bien hecho, lo que siempre se implementa mal a mano: el
 * foco atrapado adentro, Escape para cerrar, el resto de la página inerte para el
 * lector de pantalla, y el backdrop en su propia capa sin pelear con z-index.
 */
export function Modal({
  abierto,
  alCerrar,
  titulo,
  children,
  pie,
}: {
  abierto: boolean
  alCerrar: () => void
  titulo: string
  children: ReactNode
  pie?: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (abierto && !d.open) d.showModal()
    if (!abierto && d.open) d.close()
  }, [abierto])

  return (
    <dialog
      ref={ref}
      // El `close` nativo también lo dispara Escape y el botón de cerrar del sistema;
      // sin esto el estado de React quedaría en "abierto" con el diálogo ya cerrado y
      // no se podría volver a abrir.
      onClose={alCerrar}
      onClick={(e) => {
        // Clic en el backdrop: el target es el propio <dialog>, no su contenido.
        if (e.target === ref.current) alCerrar()
      }}
      className="w-[92vw] max-w-lg rounded-xl border border-borde bg-superficie p-0 text-tinta backdrop:bg-black/45"
    >
      <div className="p-6">
        <h3 className="mb-4 text-[18px] font-semibold">{titulo}</h3>
        {children}
        {pie && <div className="mt-5 flex flex-wrap justify-end gap-2">{pie}</div>}
      </div>
    </dialog>
  )
}
