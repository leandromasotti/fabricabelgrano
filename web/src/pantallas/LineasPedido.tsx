import { useState } from 'react'
import { useCatalogo } from '../api/cliente'
import { num } from '../ui/formato'
import { Boton } from '../ui/primitivos'
import type { Envase, LineaNueva, Marca, Producto, TipoQueso } from '../api/tipos'

/**
 * El armador de líneas de pedido, compartido por "Nuevo pedido" y por el alta rápida de
 * Despacho.
 *
 * Vive acá y no duplicado en las dos pantallas porque son tres formularios con reglas
 * distintas —el queso no lleva marca, la leche lleva formato, el yogur no— y mantenerlas
 * sincronizadas a mano es exactamente el tipo de cosa que se desincroniza.
 */

/**
 * Identidad de una línea del borrador.
 *
 * No alcanza con el producto: el mismo "Entera de Lácteos Belgrano" en cajón x 18 y en
 * cajón x 20 son DOS líneas, que es el caso que motivó todo el cambio de formatos. La
 * clave tiene que incluir el envase o una pisa a la otra.
 */
export const claveLinea = (l: LineaNueva) =>
  l.tipo_queso_id
    ? `q${l.tipo_queso_id}`
    : `p${l.producto_id}-${l.marca_id}-${l.envase_id ?? 0}`

export interface CatalogosPedido {
  quesos: TipoQueso[]
  leche: { productos: Producto[]; marcas: Marca[]; envases: Envase[] }
  yogur: { productos: Producto[]; marcas: Marca[] }
}

/**
 * Los tres catálogos que hace falta cruzar.
 *
 * Son tres llamadas y no una porque el endpoint ya filtra por sector, y ese filtro es el
 * que sabe que Obenac no hace yogur. Reimplementar el filtro acá sería duplicar una regla
 * de negocio en el navegador.
 */
export function useCatalogosPedido(): CatalogosPedido {
  const { data: ped } = useCatalogo('pedidos')
  const { data: lec } = useCatalogo('lecheria')
  const { data: yog } = useCatalogo('yogures')
  return {
    quesos: ped?.quesos ?? [],
    leche: {
      productos: lec?.productos ?? [],
      marcas: lec?.marcas ?? [],
      envases: lec?.envases ?? [],
    },
    yogur: { productos: yog?.productos ?? [], marcas: yog?.marcas ?? [] },
  }
}

const nombrePor = (xs: { id: number; nombre: string }[], id?: number) =>
  xs.find((x) => x.id === id)?.nombre ?? ''

/** Cómo se lee una línea del borrador, con la misma forma que después manda el servidor. */
export function etiquetaLinea(l: LineaNueva, c: CatalogosPedido): string {
  if (l.tipo_queso_id) return nombrePor(c.quesos, l.tipo_queso_id)
  const esLeche = Boolean(l.envase_id)
  const productos = esLeche ? c.leche.productos : c.yogur.productos
  const marcas = esLeche ? c.leche.marcas : c.yogur.marcas
  return [
    nombrePor(productos, l.producto_id),
    nombrePor(marcas, l.marca_id),
    esLeche ? nombrePor(c.leche.envases, l.envase_id) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export const unidadDe = (l: LineaNueva) =>
  l.tipo_queso_id ? 'piezas' : l.envase_id ? 'cajones' : 'unidades'

// ---------------------------------------------------------------- el selector

const campo =
  'rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta'

type Solapa = 'queso' | 'leche' | 'yogur'

/**
 * Elige qué agregar. Tres solapas y no un combo largo con todo mezclado: lo que hay que
 * completar cambia según la clase, y un formulario que muestra campos que no aplican
 * invita a llenarlos.
 */
export function ElegirLinea({
  catalogos,
  onAgregar,
}: {
  catalogos: CatalogosPedido
  onAgregar: (l: LineaNueva) => void
}) {
  const [solapa, setSolapa] = useState<Solapa>('queso')
  const [quesoId, setQuesoId] = useState('')
  const [productoId, setProductoId] = useState('')
  const [marcaId, setMarcaId] = useState('')
  const [envaseId, setEnvaseId] = useState('')
  const [cantidad, setCantidad] = useState('1')

  const n = Number(cantidad)
  const cantidadValida = Number.isInteger(n) && n > 0

  const productos = solapa === 'leche' ? catalogos.leche.productos : catalogos.yogur.productos
  const marcas = solapa === 'leche' ? catalogos.leche.marcas : catalogos.yogur.marcas

  const listo =
    cantidadValida &&
    (solapa === 'queso'
      ? Boolean(quesoId)
      : Boolean(productoId && marcaId) && (solapa !== 'leche' || Boolean(envaseId)))

  const agregar = () => {
    if (!listo) return
    if (solapa === 'queso') {
      onAgregar({ tipo_queso_id: Number(quesoId), cantidad_pedida: n })
    } else {
      onAgregar({
        producto_id: Number(productoId),
        marca_id: Number(marcaId),
        // El yogur va sin envase a propósito: el servidor rechaza el que lo mande.
        ...(solapa === 'leche' ? { envase_id: Number(envaseId) } : {}),
        cantidad_pedida: n,
      })
    }
    setCantidad('1')
  }

  // Al cambiar de solapa se limpia lo de la anterior: si no, queda un envase elegido de
  // cuando era leche y se manda en una línea de yogur.
  const cambiar = (s: Solapa) => {
    setSolapa(s)
    setQuesoId('')
    setProductoId('')
    setMarcaId('')
    setEnvaseId('')
  }

  const envase = catalogos.leche.envases.find((e) => e.id === Number(envaseId))
  const litros =
    envase && envase.unidades_por_bulto && envase.litros_por_unidad
      ? Math.round(n * envase.unidades_por_bulto * Number(envase.litros_por_unidad))
      : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        {(
          [
            ['queso', 'Queso'],
            ['leche', 'Leche'],
            ['yogur', 'Yogur'],
          ] as [Solapa, string][]
        ).map(([k, t]) => (
          <Boton key={k} activo={solapa === k} onClick={() => cambiar(k)}>
            {t}
          </Boton>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        {solapa === 'queso' ? (
          <label className="flex flex-1 flex-col gap-1 text-[13px] text-tinta-2">
            Queso
            <select value={quesoId} onChange={(e) => setQuesoId(e.target.value)} className={campo}>
              <option value="">Elegir…</option>
              {catalogos.quesos.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.nombre}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label className="flex flex-1 flex-col gap-1 text-[13px] text-tinta-2">
              Producto
              <select
                value={productoId}
                onChange={(e) => setProductoId(e.target.value)}
                className={campo}
              >
                <option value="">Elegir…</option>
                {productos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-1 flex-col gap-1 text-[13px] text-tinta-2">
              Marca
              <select value={marcaId} onChange={(e) => setMarcaId(e.target.value)} className={campo}>
                <option value="">Elegir…</option>
                {marcas.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </select>
            </label>
            {solapa === 'leche' && (
              <label className="flex flex-1 flex-col gap-1 text-[13px] text-tinta-2">
                Formato
                <select
                  value={envaseId}
                  onChange={(e) => setEnvaseId(e.target.value)}
                  className={campo}
                >
                  <option value="">Elegir…</option>
                  {catalogos.leche.envases.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nombre}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}

        <label className="flex flex-col gap-1 text-[13px] text-tinta-2">
          {solapa === 'queso' ? 'Piezas' : solapa === 'leche' ? 'Cajones' : 'Unidades'}
          <input
            type="number"
            min={1}
            value={cantidad}
            onChange={(e) => setCantidad(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && agregar()}
            className={`w-28 ${campo}`}
          />
        </label>

        <Boton onClick={agregar} deshabilitado={!listo}>
          Agregar
        </Boton>
      </div>

      {/* Los litros mientras se teclea, no después de guardar: es donde todavía se puede
          notar que 400 cajones eran 40. */}
      {litros !== null && cantidadValida && (
        <p className="text-[13px] text-tinta-2">
          {num(n)} × {envase?.nombre} = <span className="cifras">{num(litros)}</span> litros
          {envase?.provisorio ? ' · formato a confirmar' : ''}
        </p>
      )}
    </div>
  )
}

/** La lista del borrador, con el botón de quitar. Igual en las dos pantallas. */
export function LineasBorrador({
  lineas,
  catalogos,
  onQuitar,
}: {
  lineas: LineaNueva[]
  catalogos: CatalogosPedido
  onQuitar: (clave: string) => void
}) {
  return (
    <ul className="text-[14px]">
      {lineas.map((l) => (
        <li
          key={claveLinea(l)}
          className="flex items-center gap-2 border-b border-grilla py-1.5"
        >
          <span className="flex-1">{etiquetaLinea(l, catalogos)}</span>
          <span className="cifras text-tinta-2">
            {num(l.cantidad_pedida)} {unidadDe(l)}
          </span>
          <Boton onClick={() => onQuitar(claveLinea(l))}>Quitar</Boton>
        </li>
      ))}
    </ul>
  )
}
