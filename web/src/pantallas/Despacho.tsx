import { useState } from 'react'
import {
  useAccionPedido,
  useCatalogo,
  useClientes,
  useCrearPedido,
  usePedido,
  usePedidos,
} from '../api/cliente'
import { hhmm, kilos, num } from '../ui/formato'
import { Modal } from '../ui/Modal'
import { Boton, Vacio } from '../ui/primitivos'
import type { EstadoPedido, LineaNueva, Pedido } from '../api/tipos'

/**
 * Pantalla del encargado. Resuelve el cuello de botella del audio 6: hoy Andrés no
 * puede facturar NADA hasta que suban todos los pedidos juntos. Acá los ve llegar de a
 * uno, en el momento, y factura el que está listo sin esperar al resto.
 */
const COLUMNAS: { estado: EstadoPedido; titulo: string; vacio: string }[] = [
  { estado: 'pendiente', titulo: 'Pendientes de armar', vacio: 'Nada pendiente.' },
  { estado: 'armando', titulo: 'En armado', vacio: 'Nadie está armando ahora.' },
  { estado: 'listo', titulo: 'Listos para facturar', vacio: 'Nada para facturar.' },
]

export function Despacho() {
  const { data, isError, isFetching } = usePedidos()
  const [alta, setAlta] = useState(false)

  const pedidos = data?.pedidos ?? []
  const listos = pedidos.filter((p) => p.estado === 'listo')
  const gramosListos = listos.reduce((n, p) => n + p.gramos, 0)

  return (
    <>
      <header className="mb-4 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[23px] font-semibold">Pedidos · Despacho</h1>
        <span className="ml-auto flex items-center gap-2 text-[13px] text-tinta-suave">
          {/* El pulso dice si la pantalla está viva. Colgada en una pared, una vista
              congelada y una sin pedidos se ven exactamente igual. */}
          <span
            aria-hidden
            className={`size-2 rounded-full ${
              isError ? 'bg-alerta' : isFetching ? 'animate-pulse bg-bien' : 'bg-bien'
            }`}
          />
          {isError ? 'sin conexión con el servidor' : 'actualizando cada 5 s'}
        </span>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Boton onClick={() => setAlta(true)} variante="primario">
          + Nuevo pedido
        </Boton>
        {listos.length > 0 && (
          <span className="text-[14px] text-tinta-2">
            {listos.length} pedido{listos.length === 1 ? '' : 's'} listo
            {listos.length === 1 ? '' : 's'} · {kilos(gramosListos)} kg para facturar
          </span>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {COLUMNAS.map((c) => {
          const suyos = pedidos.filter((p) => p.estado === c.estado)
          return (
            <section key={c.estado}>
              <h2 className="mb-2.5 text-[12px] font-bold tracking-wide text-tinta-suave uppercase">
                {c.titulo}
                {suyos.length > 0 && <span className="ml-1.5 font-normal">({suyos.length})</span>}
              </h2>
              {suyos.length ? (
                suyos.map((p) => <Tarjeta key={p.id} pedido={p} />)
              ) : (
                <Vacio>{c.vacio}</Vacio>
              )}
            </section>
          )
        })}
      </div>

      <AltaPedido abierto={alta} alCerrar={() => setAlta(false)} />
    </>
  )
}

// ---------------------------------------------------------------- tarjeta

function Tarjeta({ pedido: p }: { pedido: Pedido }) {
  // El estado de "desplegado" vive en la tarjeta. Antes se guardaba en un Set global
  // porque el refresco redibujaba todo y cerraba los detalles cada 5 segundos, justo
  // mientras alguien controlaba un pedido. Acá React conserva el componente y no
  // hace falta.
  const [abierto, setAbierto] = useState(false)
  const accion = useAccionPedido()
  const listo = p.estado === 'listo'

  const confirmarAnular = () => {
    if (confirm(`¿Anular el pedido de ${p.cliente}?`)) accion.mutate({ id: p.id, accion: 'anular' })
  }

  return (
    <article
      className={`mb-3 rounded-xl bg-superficie px-4 py-3.5 ${
        listo ? 'border-2 border-bien' : 'border border-borde'
      }`}
    >
      <div className="flex items-baseline gap-2.5">
        <span className="flex-1 text-[18px] font-bold">{p.cliente}</span>
        <span className="cifras text-[12.5px] text-tinta-suave">
          {hhmm(p.armado_en ?? p.creado_en)}
        </span>
      </div>

      <div className="mt-2 mb-1 flex items-baseline gap-4">
        <span className="cifras text-[27px] leading-none font-extrabold">
          {kilos(p.gramos)}
          <small className="ml-1 text-[13px] font-semibold text-tinta-2">kg</small>
        </span>
        <span className="cifras text-[14px] text-tinta-2">
          {p.piezas} de {p.piezas_pedidas} piezas
        </span>
      </div>

      {p.armador && <div className="text-[12.5px] text-tinta-suave">Armando: {p.armador}</div>}

      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="mt-2 cursor-pointer text-[13px] text-serie-1 hover:underline"
      >
        {abierto ? 'Ocultar detalle' : `Ver detalle (${p.lineas} línea${p.lineas === 1 ? '' : 's'})`}
      </button>

      {abierto && <Detalle id={p.id} />}

      <div className="mt-3 flex flex-wrap gap-2">
        {listo ? (
          <>
            <button
              type="button"
              onClick={() => accion.mutate({ id: p.id, accion: 'facturar' })}
              disabled={accion.isPending}
              className="cursor-pointer rounded-lg border border-bien bg-bien px-3.5 py-2 text-[13.5px] font-semibold text-white disabled:opacity-50"
            >
              Marcar facturado
            </button>
            <Boton onClick={() => (window.location.href = `/api/pedidos/${p.id}/remito.csv`)}>
              Descargar CSV
            </Boton>
            <Boton onClick={() => accion.mutate({ id: p.id, accion: 'reabrir' })}>Reabrir</Boton>
          </>
        ) : (
          <Boton onClick={confirmarAnular}>Anular</Boton>
        )}
      </div>

      {accion.isError && (
        <p className="mt-2 text-[12.5px] text-alerta">{accion.error.message}</p>
      )}
    </article>
  )
}

function Detalle({ id }: { id: number }) {
  const { data, isPending, isError } = usePedido(id, true)

  if (isPending) return <p className="mt-2 text-[13px] text-tinta-suave">Cargando detalle…</p>
  if (isError) return <p className="mt-2 text-[13px] text-alerta">No se pudo traer el detalle.</p>

  return (
    <table className="mt-2 w-full border-collapse text-[13.5px]">
      <thead>
        <tr>
          {['Queso', 'Pedidas', 'Entregadas', 'Kilos'].map((h, i) => (
            <th
              key={h}
              className={`border-b border-grilla px-1.5 py-1.5 text-[11px] font-medium tracking-wide text-tinta-suave uppercase ${
                i === 0 ? 'text-left' : 'text-right'
              }`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.lineas.map((l) => (
          <tr key={l.id}>
            <td className="border-b border-grilla px-1.5 py-1.5">{l.queso}</td>
            <td className="cifras border-b border-grilla px-1.5 py-1.5 text-right">
              {l.cantidad_pedida}
            </td>
            {/* Lo entregado en rojo cuando no coincide con lo pedido: es lo único que
                hay que mirar antes de facturar. */}
            <td
              className={`cifras border-b border-grilla px-1.5 py-1.5 text-right ${
                l.piezas !== l.cantidad_pedida ? 'font-bold text-alerta' : ''
              }`}
            >
              {l.piezas}
            </td>
            <td className="cifras border-b border-grilla px-1.5 py-1.5 text-right">
              {kilos(l.gramos)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

// ---------------------------------------------------------------- alta

function AltaPedido({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const { data: clientes } = useClientes()
  const { data: catalogo } = useCatalogo('pedidos')
  const crear = useCrearPedido()

  const [clienteId, setClienteId] = useState('')
  const [quesoId, setQuesoId] = useState('')
  const [cantidad, setCantidad] = useState('')
  const [lineas, setLineas] = useState<LineaNueva[]>([])

  const quesos = catalogo?.quesos ?? []
  const nombreDe = (id: number) => quesos.find((q) => q.id === id)?.nombre ?? ''

  const cerrarYLimpiar = () => {
    setLineas([])
    setQuesoId('')
    setCantidad('')
    crear.reset()
    alCerrar()
  }

  const agregar = () => {
    const id = Number(quesoId)
    const n = Number(cantidad)
    if (!id || !Number.isInteger(n) || n < 1) return
    // Si el queso ya está, se SUMA en vez de agregar una segunda línea: la base exige
    // un queso por pedido, y cargarlo dos veces fue justo lo que rompió una migración.
    setLineas((prev) => {
      const i = prev.findIndex((l) => l.tipo_queso_id === id)
      if (i === -1) return [...prev, { tipo_queso_id: id, cantidad_pedida: n }]
      return prev.map((l, j) =>
        j === i ? { ...l, cantidad_pedida: l.cantidad_pedida + n } : l,
      )
    })
    setCantidad('')
  }

  const guardar = () => {
    const id = Number(clienteId || clientes?.[0]?.id)
    if (!id || !lineas.length) return
    crear.mutate({ cliente_id: id, lineas }, { onSuccess: cerrarYLimpiar })
  }

  return (
    <Modal
      abierto={abierto}
      alCerrar={cerrarYLimpiar}
      titulo="Nuevo pedido"
      pie={
        <>
          <Boton onClick={cerrarYLimpiar}>Cancelar</Boton>
          <button
            type="button"
            onClick={guardar}
            disabled={!lineas.length || crear.isPending}
            className="cursor-pointer rounded-md border border-serie-1 bg-serie-1 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {crear.isPending ? 'Creando…' : 'Crear pedido'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2.5 text-[13px] text-tinta-2">
          Cliente
          <select
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            className="flex-1 rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
          >
            {(clientes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-wrap items-center gap-2.5 text-[13px] text-tinta-2">
          Queso
          <select
            value={quesoId}
            onChange={(e) => setQuesoId(e.target.value)}
            className="flex-1 rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
          >
            <option value="">Elegir…</option>
            {quesos.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nombre}
              </option>
            ))}
          </select>
          <input
            type="number"
            min={1}
            value={cantidad}
            placeholder="piezas"
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
            className="w-24 rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
          />
          <Boton onClick={agregar}>Agregar</Boton>
        </div>

        {lineas.length > 0 && (
          <ul className="text-[14px]">
            {lineas.map((l) => (
              <li
                key={l.tipo_queso_id}
                className="flex items-center gap-2.5 border-b border-grilla py-1.5"
              >
                <span className="flex-1">
                  {nombreDe(l.tipo_queso_id)} · {num(l.cantidad_pedida)} piezas
                </span>
                <Boton
                  onClick={() =>
                    setLineas((prev) => prev.filter((x) => x.tipo_queso_id !== l.tipo_queso_id))
                  }
                >
                  Quitar
                </Boton>
              </li>
            ))}
          </ul>
        )}

        {crear.isError && <p className="text-[13px] text-alerta">{crear.error.message}</p>}
      </div>
    </Modal>
  )
}
