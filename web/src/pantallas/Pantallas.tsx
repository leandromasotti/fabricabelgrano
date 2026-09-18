import {
  useCambiarOpcionTablet,
  useCambiarSeccion,
  useOpcionesTablet,
  useSeccionesTablero,
} from '../api/cliente'
import { Panel, Vacio } from '../ui/primitivos'

/**
 * Qué muestran las pantallas de planta: el tablero LED y las ocho tablets.
 *
 * Las dos cosas viven acá y no en cada equipo porque son nueve pantallas amuradas en
 * sectores distintos. Cambiar algo yendo máquina por máquina garantiza que queden
 * desparejas y que nadie sepa cuál quedó sin tocar.
 */
export function Pantallas() {
  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Pantallas de planta</h1>
        <p className="text-[14px] text-tinta-2">
          Lo que se cambia acá llega solo a los equipos de planta, sin ir hasta ninguno.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <SeccionesLed />
        <OpcionesTablets />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- tablero LED

function SeccionesLed() {
  const { data, isPending, isError } = useSeccionesTablero()
  const cambiar = useCambiarSeccion()

  if (isPending) return <Panel titulo="Tablero LED"><Vacio>Cargando…</Vacio></Panel>
  if (isError) {
    return (
      <Panel titulo="Tablero LED">
        <Vacio>No se pudo cargar la configuración.</Vacio>
      </Panel>
    )
  }

  const visibles = data.filter((s) => s.visible).length

  return (
    <Panel
      titulo="Tablero LED"
      nota="En el mismo orden en que aparecen en la pared, de arriba hacia abajo. Se ve en menos de 10 segundos."
    >
      <ul className="flex flex-col">
        {data.map((s) => (
          <Interruptor
            key={s.clave}
            id={`led-${s.clave}`}
            nombre={s.nombre}
            descripcion={s.descripcion}
            activo={Boolean(s.visible)}
            trabajando={cambiar.isPending}
            estado={s.visible ? 'en pantalla' : 'oculta'}
            alCambiar={(v) => cambiar.mutate({ clave: s.clave, visible: v })}
          />
        ))}
      </ul>

      {visibles === 0 && (
        // No se impide: si el tablero se está reinstalando, dejarlo vacío a propósito es
        // legítimo. Pero tiene que ser una decisión, no una sorpresa.
        <p className="mt-4 text-[13.5px] font-semibold text-atencion">
          Con todas apagadas la pantalla de planta queda en negro, sólo con el reloj.
        </p>
      )}
      {cambiar.isError && <p className="mt-3 text-[13px] text-alerta">{cambiar.error.message}</p>}

      <p className="mt-4 text-[13px] text-tinta-suave">
        El orden no se puede cambiar: los bloques tienen formas muy distintas —una fila de
        cifras, cinco tarjetas iguales, una lista— y moverlos no es mover cajas.
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------- tablets

function OpcionesTablets() {
  const { data, isPending, isError } = useOpcionesTablet()
  const cambiar = useCambiarOpcionTablet()

  if (isPending) return <Panel titulo="Tablets de planta"><Vacio>Cargando…</Vacio></Panel>
  if (isError) {
    return (
      <Panel titulo="Tablets de planta">
        <Vacio>No se pudieron cargar las opciones.</Vacio>
      </Panel>
    )
  }

  return (
    <Panel
      titulo="Tablets de planta"
      nota="Aplica a los ocho sectores. La tablet lo toma al abrirse o al recargar la pantalla."
    >
      <ul className="flex flex-col">
        {data.map((o) => (
          <Interruptor
            key={o.clave}
            id={`tablet-${o.clave}`}
            nombre={o.nombre}
            descripcion={o.descripcion}
            activo={Boolean(o.activo)}
            trabajando={cambiar.isPending}
            estado={o.activo ? 'se muestra' : 'oculto'}
            alCambiar={(v) => cambiar.mutate({ clave: o.clave, activo: v })}
          />
        ))}
      </ul>
      {cambiar.isError && <p className="mt-3 text-[13px] text-alerta">{cambiar.error.message}</p>}

      <p className="mt-4 text-[13px] text-tinta-suave">
        El historial viene apagado a propósito: en una tablet amurada, la lista de lo que
        cargaron otros compite con el botón que hay que tocar. Para consultar está la
        pantalla de consulta, en una computadora y con filtros de verdad.
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------- común

function Interruptor({
  id,
  nombre,
  descripcion,
  activo,
  estado,
  trabajando,
  alCambiar,
}: {
  id: string
  nombre: string
  descripcion: string | null
  activo: boolean
  estado: string
  trabajando: boolean
  alCambiar: (v: boolean) => void
}) {
  return (
    <li className="flex items-start gap-3 border-b border-borde/60 py-3 last:border-0">
      <input
        id={id}
        type="checkbox"
        checked={activo}
        disabled={trabajando}
        onChange={(e) => alCambiar(e.target.checked)}
        className="mt-1"
      />
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className={`text-[14.5px] font-semibold ${activo ? '' : 'text-tinta-suave'}`}>
          {nombre}
        </span>
        {descripcion && <span className="block text-[13px] text-tinta-2">{descripcion}</span>}
      </label>
      <span className="text-[12.5px] whitespace-nowrap text-tinta-suave">{estado}</span>
    </li>
  )
}
