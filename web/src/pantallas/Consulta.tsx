import { useState } from 'react'
import { useAnularPallet, useLecheria } from '../api/cliente'
import { fechaCorta, hhmm, hoy, mesDe, num, semanaDe } from '../ui/formato'
import { Boton, Kpi, Panel, Tabla, Tag, Vacio, type Columna } from '../ui/primitivos'
import type { RegistroPallet } from '../api/tipos'

/**
 * Lo que se registró en lechería, por período.
 *
 * Es además la vía de corrección para lo que queda fuera de la ventana de 60 s de la
 * tablet: el operario se da cuenta más tarde y avisa, y alguien lo corrige desde acá.
 */
export function Consulta() {
  const [desde, setDesde] = useState(hoy)
  const [hasta, setHasta] = useState(hoy)
  const { data, isPending, isError, isFetching } = useLecheria({ desde, hasta })
  const anular = useAnularPallet()

  const aplicar = ([d, h]: [string, string]) => {
    setDesde(d)
    setHasta(h)
  }
  const esHoy = desde === hoy() && hasta === hoy()
  const esSemana = desde === semanaDe(hoy())[0] && hasta === semanaDe(hoy())[1]
  const esMes = desde === mesDe(hoy())[0] && hasta === mesDe(hoy())[1]

  // Con un rango de varios días, la hora sola no ubica nada: hay que ver de qué día es
  // cada fila. Con un día solo, la fecha es la misma en todas y sería ruido.
  const variosDias = desde !== hasta

  // El desglose por producto es lo primero que el encargado quiere ver del período.
  const vivos = (data?.registros ?? []).filter((r) => !r.anulado)
  const porProducto = vivos.reduce<Record<string, number>>((acc, r) => {
    acc[r.producto] = (acc[r.producto] ?? 0) + 1
    return acc
  }, {})

  const columnas: Columna<RegistroPallet>[] = [
    ...(variosDias
      ? [
          {
            titulo: 'Fecha',
            celda: (r: RegistroPallet) => (
              <span className="cifras">{new Date(r.fecha_hora).toLocaleDateString('es-AR')}</span>
            ),
          },
        ]
      : []),
    { titulo: 'Hora', celda: (r) => <span className="cifras">{hhmm(r.fecha_hora)}</span> },
    { titulo: 'Marca', celda: (r) => r.marca },
    { titulo: 'Producto', celda: (r) => r.producto },
    { titulo: 'Envase', celda: (r) => r.envase ?? '—' },
    {
      titulo: 'Armado',
      // Sólo se marca cuando NO fue el formato completo. Ponerlo en todas las filas
      // convierte en ruido lo que justamente hay que poder distinguir de un vistazo.
      celda: (r) =>
        r.bultos && r.unidades_por_bulto ? (
          <span
            className={
              r.bultos !== r.bultos_formato ? 'font-semibold text-atencion' : 'text-tinta-2'
            }
          >
            {r.bultos} × {r.unidades_por_bulto}
            {r.bultos !== r.bultos_formato && ' · incompleto'}
          </span>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    { titulo: 'Litros', num: true, celda: (r) => (r.litros == null ? '—' : num(r.litros)) },
    { titulo: 'Operario', celda: (r) => r.operario },
    { titulo: '', celda: (r) => (r.origen === 'offline' ? <Tag>offline</Tag> : null) },
    {
      titulo: '',
      celda: (r) =>
        r.anulado ? (
          <span className="text-[12px] text-tinta-suave">anulado</span>
        ) : (
          <Boton
            onClick={() => {
              if (confirm(`¿Anular el pallet de las ${hhmm(r.fecha_hora)}?`)) anular.mutate(r.id)
            }}
          >
            Anular
          </Boton>
        ),
    },
  ]

  const query = new URLSearchParams({ desde, hasta }).toString()

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Producción · Lechería</h1>
        <p className="text-[14px] text-tinta-2">
          {desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} al ${fechaCorta(hasta)}`}
          {isFetching && data && <span className="ml-2 text-tinta-suave">actualizando…</span>}
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-xl border border-borde bg-superficie px-3.5 py-3">
        <label className="text-[13px] text-tinta-2" htmlFor="desde">
          Desde
        </label>
        <input
          id="desde"
          type="date"
          value={desde}
          max={hasta}
          onChange={(e) => setDesde(e.target.value)}
          className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
        />
        <label className="text-[13px] text-tinta-2" htmlFor="hasta">
          Hasta
        </label>
        <input
          id="hasta"
          type="date"
          value={hasta}
          min={desde}
          onChange={(e) => setHasta(e.target.value)}
          className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
        />

        {/* Los tres períodos con los que realmente se mira producción: el día que pasó,
            la semana en curso y el mes que se va a liquidar. */}
        <Boton onClick={() => aplicar([hoy(), hoy()])} activo={esHoy}>
          Hoy
        </Boton>
        <Boton onClick={() => aplicar(semanaDe(hoy()))} activo={esSemana}>
          Esta semana
        </Boton>
        <Boton onClick={() => aplicar(mesDe(hoy()))} activo={esMes}>
          Este mes
        </Boton>

        <div className="flex-1" />
        <Boton
          onClick={() => (window.location.href = `/api/registros.csv?${query}`)}
          variante="primario"
        >
          Descargar CSV
        </Boton>
      </div>

      {isPending && <Vacio>Cargando…</Vacio>}
      {isError && <Vacio>No se pudieron cargar los registros.</Vacio>}

      {data && (
        <div className="flex flex-col gap-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi valor={num(data.total)} titulo="Pallets" />
            <Kpi valor={num(data.litros)} titulo="Litros" />
            {Object.entries(porProducto).map(([producto, n]) => (
              <Kpi key={producto} valor={num(n)} titulo={producto} />
            ))}
          </div>

          <Panel
            titulo="Registros"
            nota={`${num(data.registros.length)} en total${
              data.registros.length > data.total ? ` · ${data.registros.length - data.total} anulados` : ''
            }`}
          >
            <Tabla
              columnas={columnas}
              filas={data.registros}
              claveDe={(r) => r.id}
              sinDatos="Sin registros en este período."
              altoMax={520}
            />
            {anular.isError && (
              <p className="mt-2 text-[13px] text-alerta">{anular.error.message}</p>
            )}
          </Panel>
        </div>
      )}
    </>
  )
}
