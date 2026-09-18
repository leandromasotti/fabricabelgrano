import { useState } from 'react'
import { useAnularPallet, useLecheria } from '../api/cliente'
import { fechaCorta, hhmm, hoy, mesDe, num, semanaDe } from '../ui/formato'
import { Boton, Kpi, Paginador, Panel, Tabla, Tag, Vacio, type Columna } from '../ui/primitivos'
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
  const [pagina, setPagina] = useState(1)
  const { data, isPending, isError, isFetching } = useLecheria({ desde, hasta, pagina })
  const anular = useAnularPallet()

  // Cambiar el período vuelve a la primera página: quedarse en la 7 de un rango que
  // ahora tiene 2 mostraría una lista vacía que se lee como "no hay datos".
  const aplicar = ([d, h]: [string, string]) => {
    setDesde(d)
    setHasta(h)
    setPagina(1)
  }
  const esHoy = desde === hoy() && hasta === hoy()
  const esSemana = desde === semanaDe(hoy())[0] && hasta === semanaDe(hoy())[1]
  const esMes = desde === mesDe(hoy())[0] && hasta === mesDe(hoy())[1]

  // Con un rango de varios días, la hora sola no ubica nada: hay que ver de qué día es
  // cada fila. Con un día solo, la fecha es la misma en todas y sería ruido.
  const variosDias = desde !== hasta

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
          onChange={(e) => aplicar([e.target.value, hasta])}
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
          onChange={(e) => aplicar([desde, e.target.value])}
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
          {/* Los litros primero: es la unidad del negocio. El pallet es la unidad de
              trabajo —lo que el operario arma y cuenta— pero lo que se factura, se
              compara y se discute son litros. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              valor={num(data.litros)}
              titulo="Litros"
              // Un pallet en un formato sin equivalencia cargada no aporta litros, y
              // entonces este total dice MENOS de lo que realmente se produjo. Callarlo
              // sería peor que el número: se leería como una caída de producción.
              {...(data.sin_litros
                ? {
                    nota:
                      data.sin_litros === 1
                        ? '1 pallet sin litros definidos'
                        : `${num(data.sin_litros)} pallets sin litros definidos`,
                  }
                : {})}
            />
            <Kpi valor={num(data.total)} titulo="Pallets" />
            {data.por_producto.map((x) => (
              <Kpi key={x.producto} valor={num(x.n)} titulo={x.producto} />
            ))}
          </div>

          <Panel
            titulo="Registros"
            nota={
              data.filas
                ? `${num(data.filas)} en el período` +
                  (data.filas > data.total ? ` · ${num(data.filas - data.total)} anulados` : '')
                : 'Sin registros en este período'
            }
          >
            <Tabla
              columnas={columnas}
              filas={data.registros}
              claveDe={(r) => r.id}
              sinDatos="Sin registros en este período."
            />
            <Paginador
              pagina={data.pagina}
              paginas={data.paginas}
              filas={data.filas}
              porPagina={data.por_pagina}
              alCambiar={setPagina}
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
