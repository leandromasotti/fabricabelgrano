import { useEffect, useState } from 'react'

/** Campo numérico de tabla de configuración. Angosto, alineado a la derecha. */
export function CampoNumero({
  valor,
  alCambiar,
  deshabilitado,
  paso = '1',
  etiqueta,
}: {
  valor: string
  alCambiar: (v: string) => void
  deshabilitado?: boolean
  paso?: string
  etiqueta: string
}) {
  return (
    <input
      type="number"
      min={paso === '1' ? 1 : 0.001}
      step={paso}
      value={valor}
      aria-label={etiqueta}
      disabled={deshabilitado}
      onChange={(e) => alCambiar(e.target.value)}
      className="w-24 rounded-md border border-eje bg-superficie px-2 py-1.5 text-right text-[14px] text-tinta tabular-nums disabled:opacity-40"
    />
  )
}

export function Estado({ confirmado }: { confirmado: boolean }) {
  return (
    <span
      className={`rounded px-1.5 py-px text-[11.5px] ${
        confirmado
          ? 'border border-bien/40 text-bien'
          : 'border border-atencion/40 text-atencion'
      }`}
    >
      {confirmado ? 'confirmado' : 'a confirmar'}
    </span>
  )
}

/**
 * Mensaje de "guardado" que se borra solo.
 *
 * Devuelve el texto a mostrar y la función para dispararlo. El temporizador se limpia
 * al desmontar: sin eso, guardar y navegar deja un setTimeout apuntando a un
 * componente que ya no existe.
 */
export function useAviso(milisegundos = 4000) {
  const [aviso, setAviso] = useState<string | null>(null)

  useEffect(() => {
    if (aviso === null) return
    const t = setTimeout(() => setAviso(null), milisegundos)
    return () => clearTimeout(t)
  }, [aviso, milisegundos])

  return [aviso, setAviso] as const
}
