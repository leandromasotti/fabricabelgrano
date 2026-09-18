import { useCambiarSeccion, useSeccionesTablero } from '../api/cliente'
import { Panel, Vacio } from '../ui/primitivos'

/**
 * Qué muestra la pantalla de planta.
 *
 * El sistema se implementa por sectores y no todos arrancan juntos: mientras lechería ya
 * carga y quesería todavía no, una sección en cero no dice "no se produjo hoy", dice
 * "esto no anda". Un tablero con tres números reales vale más que uno con seis donde la
 * mitad son ceros que nadie sabe interpretar.
 */
export function TableroLed() {
  const { data, isPending, isError } = useSeccionesTablero()
  const cambiar = useCambiarSeccion()

  if (isPending) return <Vacio>Cargando…</Vacio>
  if (isError) return <Vacio>No se pudo cargar la configuración del tablero.</Vacio>

  const visibles = data.filter((s) => s.visible).length

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Tablero LED</h1>
        <p className="text-[14px] text-tinta-2">
          Lo que se apaga acá desaparece de la pantalla de planta en menos de 10 segundos,
          sin tocar la máquina que la maneja.
        </p>
      </header>

      <Panel
        titulo="Secciones"
        nota="En el mismo orden en que aparecen en la pared, de arriba hacia abajo"
      >
        <ul className="flex flex-col">
          {data.map((s) => (
            <li
              key={s.clave}
              className="flex items-start gap-3 border-b border-borde/60 py-3 last:border-0"
            >
              <input
                id={`sec-${s.clave}`}
                type="checkbox"
                checked={Boolean(s.visible)}
                disabled={cambiar.isPending}
                onChange={(e) => cambiar.mutate({ clave: s.clave, visible: e.target.checked })}
                className="mt-1"
              />
              <label htmlFor={`sec-${s.clave}`} className="min-w-0 flex-1 cursor-pointer">
                <span className={`text-[14.5px] font-semibold ${s.visible ? '' : 'text-tinta-suave'}`}>
                  {s.nombre}
                </span>
                {s.descripcion && (
                  <span className="block text-[13px] text-tinta-2">{s.descripcion}</span>
                )}
              </label>
              <span className="text-[12.5px] whitespace-nowrap text-tinta-suave">
                {s.visible ? 'en pantalla' : 'oculta'}
              </span>
            </li>
          ))}
        </ul>

        {visibles === 0 && (
          // No se impide: si el tablero se está reinstalando, dejarlo vacío a propósito
          // es legítimo. Pero tiene que ser una decisión, no una sorpresa.
          <p className="mt-4 text-[13.5px] font-semibold text-atencion">
            Con todas apagadas la pantalla de planta queda en negro, sólo con el reloj.
          </p>
        )}

        {cambiar.isError && (
          <p className="mt-3 text-[13px] text-alerta">{cambiar.error.message}</p>
        )}
      </Panel>

      <p className="mt-4 text-[13px] text-tinta-suave">
        El orden no se puede cambiar: los bloques tienen formas muy distintas —una fila de
        cifras, cinco tarjetas iguales, una lista— y moverlos no es mover cajas.
      </p>
    </>
  )
}
