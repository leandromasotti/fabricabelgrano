import { useState } from 'react'
import { useAnularPallet, useLecheria } from '../api/cliente'
import { hhmm, hoy, num } from '../ui/formato'
import { Boton, Kpi, Panel, Tabla, Tag, Vacio, type Columna } from '../ui/primitivos'
import type { RegistroPallet } from '../api/tipos'

/**
 * Lo que se registró en lechería un día, con la posibilidad de anular.
 *
 * Es la vía de corrección para lo que queda fuera de la ventana de 60 s que tiene la
 * tablet: el operario se da cuenta más tarde y avisa, y alguien lo corrige desde acá.
 */
export function Consulta() {
  const [fecha, setFecha] = useState(hoy)
  const { data, isPending, isError } = useLecheria(fecha)
  const anular = useAnularPallet()

  // El desglose por producto es lo primero que el encargado quiere ver del día.
  const vivos = (data?.registros ?? []).filter((r) => !r.anulado)
  const porProducto = vivos.reduce<Record<string, number>>((acc, r) => {
    acc[r.producto] = (acc[r.producto] ?? 0) + 1
    return acc
  }, {})

  const columnas: Columna<RegistroPallet>[] = [
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
          <span className={r.bultos !== r.bultos_formato ? 'font-semibold text-atencion' : 'text-tinta-2'}>
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

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Producción · Lechería</h1>
        <p className="text-[14px] text-tinta-2">
          Pallets registrados en el día. Desde acá se corrige lo que se pasó de la
          ventana de 60 segundos de la tablet.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2.5 rounded-xl border border-borde bg-superficie px-3.5 py-3">
        <label className="text-[13px] text-tinta-2" htmlFor="fecha">
          Fecha
        </label>
        <input
          id="fecha"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          className="rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta"
        />
        <Boton onClick={() => setFecha(hoy())} activo={fecha === hoy()}>
          Hoy
        </Boton>
        <div className="flex-1" />
        <Boton
          onClick={() => (window.location.href = `/api/registros.csv?fecha=${fecha}`)}
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

          <Panel titulo="Registros del día" nota={`${num(data.registros.length)} en total`}>
            <Tabla
              columnas={columnas}
              filas={data.registros}
              claveDe={(r) => r.id}
              sinDatos="Sin registros para esta fecha."
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
