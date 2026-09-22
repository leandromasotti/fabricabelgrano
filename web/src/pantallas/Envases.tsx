import { useState } from 'react'
import {
  useCrearEnvase,
  useEnvases,
  useGuardarEnvase,
  useGuardarFormatoYogur,
  useVisibilidadEnvase,
} from '../api/cliente'
import { Modal } from '../ui/Modal'
import { num } from '../ui/formato'
import { CampoNumero, Estado, useAviso } from '../ui/campos'
import { Boton, Panel, Vacio } from '../ui/primitivos'
import type { Envase, FormatoYogur } from '../api/tipos'

/**
 * Configuración de los formatos de pallet y de bin.
 *
 * El total se recalcula mientras se tipea, antes de guardar: así quien carga el dato ve
 * enseguida si le dio 840 u 8.400 y se da cuenta del cero de más antes de que quede
 * grabado en cientos de registros.
 */
export function Envases() {
  const { data, isPending, isError } = useEnvases()

  if (isPending) return <Vacio>Cargando formatos…</Vacio>
  if (isError) return <Vacio>No se pudieron cargar los formatos.</Vacio>

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Envases y formatos</h1>
        <p className="text-[14px] text-tinta-2">
          De acá salen los litros de cada pallet y los kilos de cada bin. Completar un
          formato también completa los registros viejos que lo usan.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <Panel
          titulo="Pallets y cajones"
          nota="bultos por pallet × unidades por bulto × litros por unidad"
          acciones={<AltaFormato />}
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-borde">
                  {['Formato', 'Bultos', 'Unidades', 'Litros c/u', 'Total', 'Pallets cargados', 'Orden', 'En la tablet', '', ''].map(
                    (h, i) => (
                      <th
                        key={h || i}
                        className={`px-2 py-2 font-medium text-tinta-suave first:pl-0 ${
                          (i >= 1 && i <= 5) || i === 6 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.pallets.map((e) => (
                  <FilaPallet key={e.id} envase={e} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          titulo="Bins de yogur"
          nota="Los bins son de 500 L; la cantidad de sachets que entra varía, y 500 es el valor acordado hasta tener precisión"
        >
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13.5px]">
              <thead>
                <tr className="border-b border-borde">
                  {['Producto', 'Sachets por bin', 'Kilos c/u', 'Total', 'Bins cargados', '', ''].map(
                    (h, i) => (
                      <th
                        key={h || i}
                        className={`px-2 py-2 font-medium text-tinta-suave first:pl-0 ${
                          i >= 1 && i <= 4 ? 'text-right' : 'text-left'
                        }`}
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {data.yogur.map((y) => (
                  <FilaYogur key={y.id} formato={y} />
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  )
}

/**
 * Alta de un formato.
 *
 * Hasta ahora agregar un cajón necesitaba un desarrollador, y la lista se mueve: el
 * 2026-09-22 salieron "Sancor" y "La Serenísima" —eran el mismo cajón con el nombre del
 * cliente— y entró la distinción que sí importa, x 18 contra x 20. Además todos están en
 * camino de desaparecer conforme pasan de cajones a cajas. Que los cargue y los dé de
 * baja el encargado es lo que permite acompañar ese cambio en vez de ir atrás.
 */
function AltaFormato() {
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [bultos, setBultos] = useState('')
  const [unidades, setUnidades] = useState('')
  const [litros, setLitros] = useState('1')
  const crear = useCrearEnvase()

  const b = Number(bultos)
  const u = Number(unidades)
  const l = Number(litros)
  const total = b > 0 && u > 0 && l > 0 ? Math.round(b * u * l) : null

  const cerrar = () => {
    setNombre('')
    setBultos('')
    setUnidades('')
    setLitros('1')
    crear.reset()
    setAbierto(false)
  }

  const campo = (
    etiqueta: string,
    valor: string,
    set: (v: string) => void,
    paso = '1',
  ) => (
    <label className="flex flex-col gap-1 text-[13px] text-tinta-2">
      {etiqueta}
      <input
        type="number"
        min={paso === '1' ? 1 : 0.001}
        step={paso}
        value={valor}
        onChange={(e) => set(e.target.value)}
        className="rounded-md border border-eje bg-superficie px-2.5 py-2 text-right text-[14px] text-tinta tabular-nums"
      />
    </label>
  )

  return (
    <>
      <Boton onClick={() => setAbierto(true)} variante="primario">
        + Agregar formato
      </Boton>
      <Modal
        abierto={abierto}
        alCerrar={cerrar}
        titulo="Nuevo formato de pallet"
        pie={
          <>
            <Boton onClick={cerrar}>Cancelar</Boton>
            <button
              type="button"
              disabled={!nombre.trim() || crear.isPending}
              onClick={() =>
                crear.mutate(
                  {
                    nombre: nombre.trim(),
                    bultos_por_pallet: bultos,
                    unidades_por_bulto: unidades,
                    litros_por_unidad: litros,
                  },
                  { onSuccess: cerrar },
                )
              }
              className="cursor-pointer rounded-md border border-serie-1 bg-serie-1 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
            >
              {crear.isPending ? 'Creando…' : 'Crear formato'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-[13px] text-tinta-2">
            Nombre
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Cajón lácteo"
              className="rounded-md border border-eje bg-superficie px-2.5 py-2 text-[14px] text-tinta"
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            {campo('Bultos por pallet', bultos, setBultos)}
            {campo('Unidades por bulto', unidades, setUnidades)}
            {campo('Litros por unidad', litros, setLitros, '0.001')}
          </div>

          <p className="text-[13.5px]">
            {total !== null ? (
              <>
                Cada pallet va a valer <b className="tabular-nums">{num(total)} L</b>
              </>
            ) : (
              // Se puede crear incompleto a propósito: es preferible tener el formato
              // listado y marcado "a confirmar" a que el operario no encuentre dónde
              // registrar el pallet que ya armó.
              <span className="text-tinta-suave">
                Sin los tres números queda “a confirmar”: se puede usar igual y los litros
                se completan después.
              </span>
            )}
          </p>

          {crear.isError && <p className="text-[13px] text-alerta">{crear.error.message}</p>}
        </div>
      </Modal>
    </>
  )
}

const texto = (v: number | null) => (v === null ? '' : String(v))

function FilaPallet({ envase: e }: { envase: Envase }) {
  const [bultos, setBultos] = useState(texto(e.bultos_por_pallet))
  const [unidades, setUnidades] = useState(texto(e.unidades_por_bulto))
  const [litros, setLitros] = useState(texto(e.litros_por_unidad))
  const [tocado, setTocado] = useState(false)
  const [aviso, setAviso] = useAviso()
  const guardar = useGuardarEnvase()
  const visibilidad = useVisibilidadEnvase()

  const b = Number(bultos)
  const u = Number(unidades)
  const l = Number(litros)
  const completo = b > 0 && u > 0 && l > 0
  const total = completo ? Math.round(b * u * l) : null

  const campo = (valor: string, set: (v: string) => void, etiqueta: string, paso?: string) => (
    <CampoNumero
      valor={valor}
      etiqueta={`${etiqueta} de ${e.nombre}`}
      {...(paso ? { paso } : {})}
      alCambiar={(v) => {
        set(v)
        setTocado(true)
      }}
    />
  )

  return (
    <tr className={`border-b border-borde/60 last:border-0 ${e.activo ? '' : 'opacity-55'}`}>
      <td className="py-2">{e.nombre}</td>
      <td className="px-2 py-2 text-right">{campo(bultos, setBultos, 'Bultos por pallet')}</td>
      <td className="px-2 py-2 text-right">{campo(unidades, setUnidades, 'Unidades por bulto')}</td>
      <td className="px-2 py-2 text-right">
        {campo(litros, setLitros, 'Litros por unidad', '0.001')}
      </td>
      <td className="cifras px-2 py-2 text-right font-semibold">
        {total !== null ? (
          `${num(total)} L`
        ) : (
          <span className="font-normal text-tinta-suave">sin datos</span>
        )}
      </td>
      <td className="cifras px-2 py-2 text-right text-tinta-2">{e.pallets ? num(e.pallets) : '—'}</td>
      <td className="px-2 py-2 text-right">
        <input
          type="number"
          min={0}
          max={999}
          defaultValue={e.orden}
          aria-label={`Orden de ${e.nombre}`}
          // onBlur y no onChange: tecleando "12" pasaría por "1" y reordenaría la lista
          // a mitad de camino, moviendo la fila justo mientras se escribe en ella.
          onBlur={(ev) => {
            const n = Number(ev.target.value)
            if (Number.isInteger(n) && n !== e.orden) visibilidad.mutate({ id: e.id, orden: n })
          }}
          className="w-16 rounded-md border border-eje bg-superficie px-2 py-1.5 text-right text-[14px] text-tinta tabular-nums"
        />
      </td>
      <td className="px-2 py-2">
        <label className="flex items-center gap-1.5 text-[12.5px] text-tinta-2">
          <input
            type="checkbox"
            checked={Boolean(e.activo)}
            onChange={(ev) => visibilidad.mutate({ id: e.id, activo: ev.target.checked })}
          />
          {e.activo ? 'visible' : 'oculto'}
        </label>
      </td>
      <td className="px-2 py-2">
        <Estado confirmado={!e.provisorio} />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <Boton
            onClick={() =>
              guardar.mutate(
                {
                  id: e.id,
                  bultos_por_pallet: bultos,
                  unidades_por_bulto: unidades,
                  litros_por_unidad: litros,
                },
                {
                  onSuccess: (r) => {
                    setTocado(false)
                    setAviso(
                      r.pallets_rellenados
                        ? `guardado · ${r.pallets_rellenados} pallets completados`
                        : 'guardado',
                    )
                  },
                },
              )
            }
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Boton>
          {tocado && !aviso && <span className="text-[12px] text-atencion">sin guardar</span>}
          {aviso && <span className="text-[12px] text-bien">{aviso}</span>}
          {guardar.isError && <span className="text-[12px] text-alerta">{guardar.error.message}</span>}
        </div>
      </td>
    </tr>
  )
}

function FilaYogur({ formato: y }: { formato: FormatoYogur }) {
  const [unidades, setUnidades] = useState(texto(y.unidades_por_bin))
  const [kilos, setKilos] = useState(texto(y.kilos_por_unidad))
  const [tocado, setTocado] = useState(false)
  const [aviso, setAviso] = useAviso()
  const guardar = useGuardarFormatoYogur()

  const u = Number(unidades)
  const k = Number(kilos)
  const total = u > 0 && k > 0 ? Math.round(u * k * 100) / 100 : null

  return (
    <tr className="border-b border-borde/60 last:border-0">
      <td className="py-2">{y.nombre}</td>
      <td className="px-2 py-2 text-right">
        <CampoNumero
          valor={unidades}
          etiqueta={`Sachets por bin de ${y.nombre}`}
          alCambiar={(v) => {
            setUnidades(v)
            setTocado(true)
          }}
        />
      </td>
      <td className="px-2 py-2 text-right">
        <CampoNumero
          valor={kilos}
          paso="0.001"
          etiqueta={`Kilos por sachet de ${y.nombre}`}
          alCambiar={(v) => {
            setKilos(v)
            setTocado(true)
          }}
        />
      </td>
      <td className="cifras px-2 py-2 text-right font-semibold">
        {total !== null ? (
          // El "≈" no es decoración: la cantidad de sachets por bin es un acuerdo, no
          // una medición, y el kilaje que sale de acá hereda esa imprecisión.
          `≈ ${num(total)} kg`
        ) : (
          <span className="font-normal text-tinta-suave">sin datos</span>
        )}
      </td>
      <td className="cifras px-2 py-2 text-right text-tinta-2">
        {y.bins ? num(y.bins) : '—'}
        {y.bins_sin_kilos > 0 && (
          <span className="text-tinta-suave"> ({y.bins_sin_kilos} sin kilos)</span>
        )}
      </td>
      <td className="px-2 py-2">
        <Estado confirmado={!y.datos_provisorios} />
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2">
          <Boton
            onClick={() =>
              guardar.mutate(
                { id: y.id, unidades_por_bin: unidades, kilos_por_unidad: kilos },
                {
                  onSuccess: (r) => {
                    setTocado(false)
                    setAviso(
                      r.bins_rellenados ? `guardado · ${r.bins_rellenados} bins completados` : 'guardado',
                    )
                  },
                },
              )
            }
          >
            {guardar.isPending ? 'Guardando…' : 'Guardar'}
          </Boton>
          {tocado && !aviso && <span className="text-[12px] text-atencion">sin guardar</span>}
          {aviso && <span className="text-[12px] text-bien">{aviso}</span>}
          {guardar.isError && <span className="text-[12px] text-alerta">{guardar.error.message}</span>}
        </div>
      </td>
    </tr>
  )
}
