import { useEffect, useState } from 'react'
import {
  traer,
  useCatalogo,
  useClientes,
  useCrearPedido,
  usePedidos,
} from '../api/cliente'
import { num } from '../ui/formato'
import { Boton, Panel, Tag, Vacio } from '../ui/primitivos'
import type { LineaNueva, PedidoDetalle } from '../api/tipos'

/**
 * Carga administrativa de pedidos y hoja de armado imprimible.
 *
 * La orden baja en papel y los pesos suben por la tablet. Esa vuelta digital es donde
 * estaba la ganancia: el encargado factura sin esperar que suba ningún papel.
 */
export function NuevoPedido() {
  const { data: clientes } = useClientes()
  const { data: catalogo } = useCatalogo('pedidos')
  const { data } = usePedidos()
  const crear = useCrearPedido()

  const [clienteId, setClienteId] = useState('')
  const [quesoId, setQuesoId] = useState('')
  const [cantidad, setCantidad] = useState('1')
  const [nota, setNota] = useState('')
  const [lineas, setLineas] = useState<LineaNueva[]>([])
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set())
  const [unaPorHoja, setUnaPorHoja] = useState(false)

  const quesos = catalogo?.quesos ?? []
  const nombreDe = (id: number) => quesos.find((q) => q.id === id)?.nombre ?? ''

  // Sólo lo que todavía hay que armar: un pedido ya facturado no se imprime.
  const porArmar = (data?.pedidos ?? []).filter(
    (p) => p.estado === 'pendiente' || p.estado === 'armando',
  )

  // Las dependencias son los ids serializados y no los arrays: `porArmar` es un array
  // nuevo en cada render y usarlo directo dispararía el efecto para siempre.
  const idsVivos = porArmar.map((p) => p.id).join(',')

  // Si un pedido seleccionado ya se armó, deja de estar en la lista y su selección
  // tiene que irse con él; si no, el botón imprimiría una hoja fantasma.
  useEffect(() => {
    const vivos = new Set(idsVivos ? idsVivos.split(',').map(Number) : [])
    setSeleccion((prev) => {
      const quedan = [...prev].filter((id) => vivos.has(id))
      return quedan.length === prev.size ? prev : new Set(quedan)
    })
  }, [idsVivos])

  const agregar = () => {
    const id = Number(quesoId)
    const n = Number(cantidad)
    if (!id || !Number.isInteger(n) || n < 1) return
    // Si el queso ya está, se suma: el armador no tiene por qué buscar dos veces el
    // mismo queso en la cámara, y la base además exige un queso por pedido.
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.tipo_queso_id === id)
      if (i === -1) return [...prev, { tipo_queso_id: id, cantidad_pedida: n }]
      return prev.map((l, j) => (j === i ? { ...l, cantidad_pedida: l.cantidad_pedida + n } : l))
    })
    setCantidad('1')
  }

  const guardar = () => {
    const id = Number(clienteId || clientes?.[0]?.id)
    if (!id || !lineas.length) return
    crear.mutate(
      { cliente_id: id, lineas, ...(nota.trim() ? { nota: nota.trim() } : {}) },
      {
        onSuccess: (creado) => {
          setLineas([])
          setNota('')
          // El recién creado queda tildado: lo más probable es que se imprima ya.
          setSeleccion((prev) => new Set(prev).add(creado.id))
        },
      },
    )
  }

  const alternar = (id: number) =>
    setSeleccion((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })

  return (
    <>
      <div className="no-imprimir">
        <header className="mb-5">
          <h1 className="text-[23px] font-semibold">Nuevo pedido</h1>
          <p className="text-[14px] text-tinta-2">
            Se carga acá y se imprime para el que arma. Los pesos vuelven por la tablet.
          </p>
        </header>

        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_1fr]">
          <Panel titulo="Cargar un pedido">
            <div className="flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[13px] text-tinta-2">
                Cliente
                <select
                  value={clienteId}
                  onChange={(e) => setClienteId(e.target.value)}
                  className="rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
                >
                  {(clientes ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nombre}
                    </option>
                  ))}
                </select>
              </label>

              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px] text-tinta-2">
                  Queso
                  <select
                    value={quesoId}
                    onChange={(e) => setQuesoId(e.target.value)}
                    className="rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
                  >
                    <option value="">Elegir…</option>
                    {quesos.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.nombre}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex w-20 flex-col gap-1 text-[13px] text-tinta-2">
                  Piezas
                  <input
                    type="number"
                    min={1}
                    value={cantidad}
                    onChange={(e) => setCantidad(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && agregar()}
                    className="rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
                  />
                </label>
                <Boton onClick={agregar}>Agregar</Boton>
              </div>

              {lineas.length ? (
                <ul className="text-[14px]">
                  {lineas.map((l) => (
                    <li
                      key={l.tipo_queso_id}
                      className="flex items-center gap-2 border-b border-grilla py-1.5"
                    >
                      <span className="flex-1">{nombreDe(l.tipo_queso_id)}</span>
                      <span className="cifras text-tinta-2">{num(l.cantidad_pedida)} pz</span>
                      <Boton
                        onClick={() =>
                          setLineas((p) => p.filter((x) => x.tipo_queso_id !== l.tipo_queso_id))
                        }
                      >
                        Quitar
                      </Boton>
                    </li>
                  ))}
                </ul>
              ) : (
                <Vacio>Todavía no agregaste ningún queso.</Vacio>
              )}

              <label className="flex flex-col gap-1 text-[13px] text-tinta-2">
                Nota (opcional)
                <input
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                  placeholder="Sale en la hoja de armado"
                  className="rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
                />
              </label>

              <button
                type="button"
                onClick={guardar}
                disabled={!lineas.length || crear.isPending}
                className="cursor-pointer rounded-md border border-serie-1 bg-serie-1 px-3 py-2 text-[13.5px] font-semibold text-white disabled:opacity-40"
              >
                {crear.isPending ? 'Creando…' : 'Crear pedido'}
              </button>
              {crear.isError && <p className="text-[13px] text-alerta">{crear.error.message}</p>}
            </div>
          </Panel>

          <ParaImprimir
            pedidos={porArmar}
            seleccion={seleccion}
            alternar={alternar}
            seleccionarTodos={() => setSeleccion(new Set(porArmar.map((p) => p.id)))}
            limpiar={() => setSeleccion(new Set())}
            unaPorHoja={unaPorHoja}
            setUnaPorHoja={setUnaPorHoja}
          />
        </div>
      </div>

      <Hojas ids={[...seleccion]} orden={porArmar.map((p) => p.id)} unaPorHoja={unaPorHoja} />
    </>
  )
}

// ---------------------------------------------------------------- selección

function ParaImprimir({
  pedidos,
  seleccion,
  alternar,
  seleccionarTodos,
  limpiar,
  unaPorHoja,
  setUnaPorHoja,
}: {
  pedidos: { id: number; cliente: string; creado_en: string; lineas: number; piezas_pedidas: number; estado: string }[]
  seleccion: Set<number>
  alternar: (id: number) => void
  seleccionarTodos: () => void
  limpiar: () => void
  unaPorHoja: boolean
  setUnaPorHoja: (v: boolean) => void
}) {
  const n = seleccion.size

  return (
    <Panel
      titulo="Pendientes de armar"
      nota="Se refresca sola: alguien puede tomar un pedido mientras mirás"
      acciones={
        <div className="flex gap-2">
          <Boton onClick={seleccionarTodos}>Todos</Boton>
          <Boton onClick={limpiar}>Ninguno</Boton>
        </div>
      }
    >
      {pedidos.length ? (
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-borde">
              <th className="w-8 py-2" />
              <th className="py-2 text-left font-medium text-tinta-suave">Cliente</th>
              <th className="py-2 text-left font-medium text-tinta-suave">Creado</th>
              <th className="py-2 text-right font-medium text-tinta-suave">Líneas</th>
              <th className="py-2 text-right font-medium text-tinta-suave">Piezas</th>
              <th className="py-2 pl-3 text-left font-medium text-tinta-suave">Estado</th>
            </tr>
          </thead>
          <tbody>
            {pedidos.map((p) => (
              <tr key={p.id} className="border-b border-borde/60 last:border-0">
                <td className="py-2">
                  <input
                    type="checkbox"
                    checked={seleccion.has(p.id)}
                    onChange={() => alternar(p.id)}
                    aria-label={`Seleccionar el pedido de ${p.cliente}`}
                  />
                </td>
                <td className="py-2">{p.cliente}</td>
                <td className="cifras py-2 text-tinta-2">
                  {new Date(p.creado_en).toLocaleString('es-AR', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })}
                </td>
                <td className="cifras py-2 text-right">{p.lineas}</td>
                <td className="cifras py-2 text-right">{num(p.piezas_pedidas)}</td>
                <td className="py-2 pl-3">
                  <Tag>{p.estado === 'armando' ? 'En armado' : 'Pendiente'}</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Vacio>No hay pedidos pendientes de armar.</Vacio>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <BotonImprimir habilitado={n > 0} />
        <label className="flex items-center gap-1.5 text-[13px] text-tinta-2">
          <input
            type="checkbox"
            checked={unaPorHoja}
            onChange={(e) => setUnaPorHoja(e.target.checked)}
          />
          Una hoja por pedido
        </label>
        {n > 0 && (
          <span className="text-[13px] text-tinta-suave">
            {n} pedido{n === 1 ? '' : 's'} seleccionado{n === 1 ? '' : 's'}
          </span>
        )}
      </div>
    </Panel>
  )
}

function BotonImprimir({ habilitado }: { habilitado: boolean }) {
  return (
    <button
      type="button"
      disabled={!habilitado}
      onClick={() => window.print()}
      className="cursor-pointer rounded-md border border-serie-1 bg-serie-1 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
    >
      Imprimir hojas de armado
    </button>
  )
}

// ---------------------------------------------------------------- las hojas

/**
 * Las hojas viven siempre en el DOM, ocultas en pantalla y visibles sólo al imprimir.
 *
 * La versión anterior las armaba dentro del handler del botón y llamaba a
 * `window.print()` en la línea siguiente. Con React eso no funciona: el estado se
 * aplica de forma asíncrona y se imprimiría el DOM anterior. Manteniéndolas montadas,
 * el botón sólo llama a `print()` y lo que sale es siempre lo que está seleccionado —
 * incluido el Ctrl+P del navegador, que antes imprimía una hoja vacía.
 */
function Hojas({
  ids,
  orden,
  unaPorHoja,
}: {
  ids: number[]
  orden: number[]
  unaPorHoja: boolean
}) {
  const [completos, setCompletos] = useState<PedidoDetalle[]>([])
  const clave = ids.join(',')
  const ordenClave = orden.join(',')

  useEffect(() => {
    if (!ids.length) {
      setCompletos([])
      return
    }
    let vigente = true
    void Promise.all(ids.map((id) => traer<PedidoDetalle>(`/api/pedidos/${id}`)))
      .then((r) => {
        // En el orden de la tabla, no en el que se fueron tildando.
        if (vigente) setCompletos(r.sort((a, b) => orden.indexOf(a.id) - orden.indexOf(b.id)))
      })
      .catch(() => vigente && setCompletos([]))
    return () => {
      vigente = false
    }
  }, [clave, ordenClave])

  return (
    <div className={`hojas${unaPorHoja ? ' separadas' : ''}`}>
      {completos.map((p) => (
        <div key={p.id} className="hoja">
          <h3>{p.cliente}</h3>
          <div className="meta">
            Pedido #{p.id} · creado {new Date(p.creado_en).toLocaleString('es-AR')}
            {p.nota ? ` · ${p.nota}` : ''}
          </div>
          <table>
            <thead>
              <tr>
                <th>Queso</th>
                <th className="n">Piezas</th>
                <th>Piezas armadas</th>
                <th>Kilos</th>
              </tr>
            </thead>
            <tbody>
              {p.lineas.map((l) => (
                <tr key={l.id}>
                  <td>{l.queso}</td>
                  <td className="n">{l.cantidad_pedida}</td>
                  {/* En blanco a propósito: se completan a mano en la cámara y después
                      se vuelcan en la tablet. */}
                  <td className="anotar" />
                  <td className="anotar" />
                </tr>
              ))}
              <tr>
                <td>TOTAL</td>
                <td className="n">{p.piezas_pedidas}</td>
                <td className="anotar" />
                <td className="anotar" />
              </tr>
            </tbody>
          </table>
          <div className="pie">
            <div className="firma">Armó</div>
            <div className="firma">Hora</div>
          </div>
        </div>
      ))}
    </div>
  )
}
