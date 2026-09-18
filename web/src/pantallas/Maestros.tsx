import { useState, type ReactNode } from 'react'
import {
  useCrearMaestro,
  useEditarMaestro,
  useMaestros,
  useVisibilidadMaestro,
} from '../api/cliente'
import { num } from '../ui/formato'
import { useAviso } from '../ui/campos'
import { Boton, Panel, Vacio } from '../ui/primitivos'
import type {
  ClienteMaestro,
  MarcaMaestro,
  OperarioMaestro,
  TamboMaestro,
  TipoMaestro,
} from '../api/tipos'

/**
 * Alta y baja de los datos maestros.
 *
 * Hasta ahora agregar un operario o un cliente necesitaba un desarrollador con una
 * terminal abierta. Eso convierte en un pedido por chat lo que debería ser un minuto de
 * la persona que sabe cómo se llama su gente, y garantiza que el sistema arranque con
 * "Operario 1" en la pantalla de lechería.
 *
 * Nada se borra: se da de baja. Un operario que ya registró producción tiene que seguir
 * existiendo para que su nombre aparezca en el historial.
 */
export function Maestros() {
  const { data, isPending, isError } = useMaestros()

  if (isPending) return <Vacio>Cargando…</Vacio>
  if (isError) return <Vacio>No se pudieron cargar los datos maestros.</Vacio>

  return (
    <>
      <header className="mb-5">
        <h1 className="text-[23px] font-semibold">Datos maestros</h1>
        <p className="text-[14px] text-tinta-2">
          Quién trabaja en cada sector, a quién se le vende, qué tambos entregan y qué
          marcas se producen. Nada se borra: dar de baja lo saca de las pantallas, no del
          historial.
        </p>
      </header>

      <div className="flex flex-col gap-5">
        <Operarios operarios={data.operarios} sectores={data.sectores} />
        <Clientes clientes={data.clientes} />
        <Tambos tambos={data.tambos} />
        <Marcas marcas={data.marcas} />
      </div>
    </>
  )
}

// ---------------------------------------------------------------- piezas comunes

function Entrada({
  valor,
  alCambiar,
  etiqueta,
  ancho = 'flex-1',
  tipo = 'text',
  placeholder,
}: {
  valor: string
  alCambiar: (v: string) => void
  etiqueta: string
  ancho?: string
  tipo?: 'text' | 'number'
  placeholder?: string
}) {
  return (
    <input
      type={tipo}
      value={valor}
      aria-label={etiqueta}
      placeholder={placeholder ?? ''}
      onChange={(e) => alCambiar(e.target.value)}
      className={`${ancho} min-w-0 rounded-md border border-eje bg-superficie px-2.5 py-1.5 text-[14px] text-tinta ${
        tipo === 'number' ? 'text-right tabular-nums' : ''
      }`}
    />
  )
}

/** Lo que toda fila comparte: el interruptor, la cuenta de uso y el botón de guardar. */
function Fila({
  tipo,
  id,
  activo,
  usos,
  sustantivo,
  puedeGuardar,
  alGuardar,
  children,
}: {
  tipo: TipoMaestro
  id: number
  activo: boolean
  usos: number
  sustantivo: string
  puedeGuardar: boolean
  alGuardar: (editar: ReturnType<typeof useEditarMaestro>, avisar: (s: string) => void) => void
  children: ReactNode
}) {
  const editar = useEditarMaestro()
  const visibilidad = useVisibilidadMaestro()
  const [aviso, setAviso] = useAviso(2500)

  return (
    <li
      className={`flex flex-wrap items-center gap-2 border-b border-borde/60 py-2 last:border-0 ${
        activo ? '' : 'opacity-55'
      }`}
    >
      {children}

      <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap text-tinta-2">
        <input
          type="checkbox"
          checked={activo}
          disabled={visibilidad.isPending}
          onChange={(e) => visibilidad.mutate({ tipo, id, activo: e.target.checked })}
        />
        {activo ? 'en uso' : 'de baja'}
      </label>

      {/* La cuenta de uso no es decorativa: es lo que hay que mirar antes de renombrar.
          Cambiarle el nombre a alguien con 400 registros reescribe cómo se lee todo ese
          historial. Con 0, es un placeholder y no hay nada que perder. */}
      <span className="cifras w-24 text-right text-[12.5px] whitespace-nowrap text-tinta-suave">
        {usos ? `${num(usos)} ${sustantivo}` : 'sin uso'}
      </span>

      {/* Deshabilitado mientras no haya nada que guardar, en vez de un cartel de "sin
          cambios" repetido en cada fila: con veinte operarios en pantalla, eso es veinte
          veces la misma frase compitiendo con los datos. */}
      <Boton
        onClick={() => alGuardar(editar, setAviso)}
        deshabilitado={!puedeGuardar || editar.isPending}
      >
        {editar.isPending ? 'Guardando…' : 'Guardar'}
      </Boton>
      {aviso && <span className="text-[12px] text-bien">{aviso}</span>}
      {(editar.isError || visibilidad.isError) && (
        <span className="text-[12px] text-alerta">
          {(editar.error ?? visibilidad.error)?.message}
        </span>
      )}
    </li>
  )
}

/** Formulario de alta, plegado hasta que alguien lo abre. */
function Alta({
  titulo,
  children,
  alCrear,
  puedeCrear,
  crear,
}: {
  titulo: string
  children: ReactNode
  alCrear: () => void
  puedeCrear: boolean
  crear: ReturnType<typeof useCrearMaestro>
}) {
  const [abierto, setAbierto] = useState(false)

  if (!abierto) {
    return (
      <div className="pt-2">
        <Boton onClick={() => setAbierto(true)} variante="primario">
          + {titulo}
        </Boton>
      </div>
    )
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-borde bg-plano px-3 py-2.5">
      {children}
      <button
        type="button"
        disabled={!puedeCrear || crear.isPending}
        onClick={alCrear}
        className="cursor-pointer rounded-md border border-serie-1 bg-serie-1 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40"
      >
        {crear.isPending ? 'Agregando…' : 'Agregar'}
      </button>
      <Boton onClick={() => setAbierto(false)}>Cancelar</Boton>
      {crear.isError && <span className="text-[12.5px] text-alerta">{crear.error.message}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- operarios

function Operarios({
  operarios,
  sectores,
}: {
  operarios: OperarioMaestro[]
  sectores: { clave: string; nombre: string }[]
}) {
  return (
    <Panel
      titulo="Operarios"
      nota="Son los nombres que el operario toca en la tablet de su sector. Cada sector tiene los suyos."
    >
      <div className="flex flex-col gap-5">
        {sectores.map((s) => (
          <SectorOperarios
            key={s.clave}
            sector={s}
            // El mismo nombre en dos sectores son dos personas distintas, y el sistema
            // lo permite a propósito: puede haber un Juan en lechería y otro en quesería.
            operarios={operarios.filter((o) => o.sector === s.clave)}
          />
        ))}
      </div>
    </Panel>
  )
}

function SectorOperarios({
  sector,
  operarios,
}: {
  sector: { clave: string; nombre: string }
  operarios: OperarioMaestro[]
}) {
  const crear = useCrearMaestro()
  const [nuevo, setNuevo] = useState('')

  return (
    <section>
      <h3 className="mb-1 text-[12px] font-bold tracking-wide text-tinta-suave uppercase">
        {sector.nombre}
        <span className="ml-1.5 font-normal">
          ({operarios.filter((o) => o.activo).length})
        </span>
      </h3>

      {operarios.length ? (
        <ul className="flex flex-col">
          {operarios.map((o) => (
            <FilaOperario key={o.id} operario={o} />
          ))}
        </ul>
      ) : (
        <p className="py-2 text-[13px] text-tinta-suave">Nadie cargado todavía.</p>
      )}

      <Alta
        titulo={`Agregar a ${sector.nombre}`}
        crear={crear}
        puedeCrear={nuevo.trim().length > 0}
        alCrear={() =>
          crear.mutate(
            { tipo: 'operarios', datos: { nombre: nuevo.trim(), sector: sector.clave } },
            { onSuccess: () => setNuevo('') },
          )
        }
      >
        <Entrada
          valor={nuevo}
          alCambiar={setNuevo}
          etiqueta={`Nombre del operario de ${sector.nombre}`}
          placeholder="Nombre y apellido"
          ancho="w-64"
        />
      </Alta>
    </section>
  )
}

function FilaOperario({ operario: o }: { operario: OperarioMaestro }) {
  const [nombre, setNombre] = useState(o.nombre)
  const cambio = nombre.trim() !== o.nombre && nombre.trim().length > 0

  return (
    <Fila
      tipo="operarios"
      id={o.id}
      activo={Boolean(o.activo)}
      usos={o.usos}
      sustantivo="registros"
      puedeGuardar={cambio}
      alGuardar={(editar, avisar) =>
        cambio &&
        editar.mutate(
          { tipo: 'operarios', id: o.id, datos: { nombre: nombre.trim() } },
          { onSuccess: () => avisar('guardado') },
        )
      }
    >
      <Entrada valor={nombre} alCambiar={setNombre} etiqueta={`Nombre de ${o.nombre}`} ancho="w-64" />
    </Fila>
  )
}

// ---------------------------------------------------------------- clientes

function Clientes({ clientes }: { clientes: ClienteMaestro[] }) {
  const crear = useCrearMaestro()
  const [nuevo, setNuevo] = useState('')

  return (
    <Panel titulo="Clientes" nota="A quién se le arman pedidos">
      <ul className="flex flex-col">
        {clientes.map((c) => (
          <FilaCliente key={c.id} cliente={c} />
        ))}
      </ul>
      <Alta
        titulo="Agregar cliente"
        crear={crear}
        puedeCrear={nuevo.trim().length > 0}
        alCrear={() =>
          crear.mutate(
            { tipo: 'clientes', datos: { nombre: nuevo.trim() } },
            { onSuccess: () => setNuevo('') },
          )
        }
      >
        <Entrada valor={nuevo} alCambiar={setNuevo} etiqueta="Nombre del cliente" placeholder="Nombre" ancho="w-72" />
      </Alta>
    </Panel>
  )
}

function FilaCliente({ cliente: c }: { cliente: ClienteMaestro }) {
  const [nombre, setNombre] = useState(c.nombre)
  const cambio = nombre.trim() !== c.nombre && nombre.trim().length > 0

  return (
    <Fila
      tipo="clientes"
      id={c.id}
      activo={Boolean(c.activo)}
      usos={c.usos}
      sustantivo="pedidos"
      puedeGuardar={cambio}
      alGuardar={(editar, avisar) =>
        cambio &&
        editar.mutate(
          { tipo: 'clientes', id: c.id, datos: { nombre: nombre.trim() } },
          { onSuccess: () => avisar('guardado') },
        )
      }
    >
      <Entrada valor={nombre} alCambiar={setNombre} etiqueta={`Nombre de ${c.nombre}`} ancho="w-72" />
    </Fila>
  )
}

// ---------------------------------------------------------------- tambos

function Tambos({ tambos }: { tambos: TamboMaestro[] }) {
  const crear = useCrearMaestro()
  const [numero, setNumero] = useState('')
  const [nombre, setNombre] = useState('')

  return (
    <Panel
      titulo="Tambos"
      nota="El número es la clave con la que llegan: el remito del caudalímetro dice “tambo 14”, no un nombre"
    >
      <ul className="flex flex-col">
        {tambos.map((t) => (
          <FilaTambo key={t.id} tambo={t} />
        ))}
      </ul>
      <Alta
        titulo="Agregar tambo"
        crear={crear}
        puedeCrear={Number(numero) >= 1}
        alCrear={() =>
          crear.mutate(
            { tipo: 'tambos', datos: { numero: Number(numero), nombre: nombre.trim() } },
            {
              onSuccess: () => {
                setNumero('')
                setNombre('')
              },
            },
          )
        }
      >
        <Entrada valor={numero} alCambiar={setNumero} etiqueta="Número de tambo" tipo="number" ancho="w-24" placeholder="14" />
        <Entrada valor={nombre} alCambiar={setNombre} etiqueta="Nombre del tambo" ancho="w-64" placeholder="Nombre (opcional)" />
      </Alta>
    </Panel>
  )
}

function FilaTambo({ tambo: t }: { tambo: TamboMaestro }) {
  const [numero, setNumero] = useState(String(t.numero))
  const [nombre, setNombre] = useState(t.nombre ?? '')
  const cambio =
    (Number(numero) !== t.numero || nombre.trim() !== (t.nombre ?? '')) && Number(numero) >= 1

  return (
    <Fila
      tipo="tambos"
      id={t.id}
      activo={Boolean(t.activo)}
      usos={t.usos}
      sustantivo="entregas"
      puedeGuardar={cambio}
      alGuardar={(editar, avisar) =>
        cambio &&
        editar.mutate(
          { tipo: 'tambos', id: t.id, datos: { numero: Number(numero), nombre: nombre.trim() } },
          { onSuccess: () => avisar('guardado') },
        )
      }
    >
      <Entrada valor={numero} alCambiar={setNumero} etiqueta={`Número del tambo ${t.numero}`} tipo="number" ancho="w-24" />
      <Entrada
        valor={nombre}
        alCambiar={setNombre}
        etiqueta={`Nombre del tambo ${t.numero}`}
        ancho="w-64"
        placeholder="Sin nombre"
      />
    </Fila>
  )
}

// ---------------------------------------------------------------- marcas

const FAMILIAS = [
  { clave: 'leche', nombre: 'Leche' },
  { clave: 'yogur', nombre: 'Yogur' },
]

function Marcas({ marcas }: { marcas: MarcaMaestro[] }) {
  const crear = useCrearMaestro()
  const [nombre, setNombre] = useState('')
  const [familias, setFamilias] = useState<string[]>(['leche'])
  const [propia, setPropia] = useState(false)

  return (
    <Panel
      titulo="Marcas"
      nota="Las familias deciden dónde aparece cada marca: el yogur se produce en dos marcas, no en las tres"
    >
      <ul className="flex flex-col">
        {marcas.map((m) => (
          <FilaMarca key={m.id} marca={m} />
        ))}
      </ul>
      <Alta
        titulo="Agregar marca"
        crear={crear}
        puedeCrear={nombre.trim().length > 0 && familias.length > 0}
        alCrear={() =>
          crear.mutate(
            { tipo: 'marcas', datos: { nombre: nombre.trim(), es_propia: propia, familias } },
            {
              onSuccess: () => {
                setNombre('')
                setFamilias(['leche'])
                setPropia(false)
              },
            },
          )
        }
      >
        <Entrada valor={nombre} alCambiar={setNombre} etiqueta="Nombre de la marca" ancho="w-56" placeholder="Nombre" />
        <Familias valor={familias} alCambiar={setFamilias} nombre="nueva" />
        <label className="flex items-center gap-1.5 text-[12.5px] text-tinta-2">
          <input type="checkbox" checked={propia} onChange={(e) => setPropia(e.target.checked)} />
          propia
        </label>
      </Alta>
    </Panel>
  )
}

function Familias({
  valor,
  alCambiar,
  nombre,
}: {
  valor: string[]
  alCambiar: (v: string[]) => void
  nombre: string
}) {
  return (
    <span className="flex items-center gap-3">
      {FAMILIAS.map((f) => (
        <label key={f.clave} className="flex items-center gap-1.5 text-[12.5px] text-tinta-2">
          <input
            type="checkbox"
            checked={valor.includes(f.clave)}
            aria-label={`${f.nombre} en ${nombre}`}
            onChange={(e) =>
              alCambiar(
                e.target.checked
                  ? [...valor, f.clave]
                  : valor.filter((x) => x !== f.clave),
              )
            }
          />
          {f.nombre}
        </label>
      ))}
    </span>
  )
}

function FilaMarca({ marca: m }: { marca: MarcaMaestro }) {
  const [nombre, setNombre] = useState(m.nombre)
  const [familias, setFamilias] = useState<string[]>(m.familias)
  const [propia, setPropia] = useState(Boolean(m.es_propia))

  const igualFamilias =
    familias.length === m.familias.length && familias.every((f) => m.familias.includes(f))
  const cambio =
    (nombre.trim() !== m.nombre || !igualFamilias || propia !== Boolean(m.es_propia)) &&
    nombre.trim().length > 0 &&
    familias.length > 0

  return (
    <Fila
      tipo="marcas"
      id={m.id}
      activo={Boolean(m.activo)}
      usos={m.usos}
      sustantivo="registros"
      puedeGuardar={cambio}
      alGuardar={(editar, avisar) =>
        cambio &&
        editar.mutate(
          {
            tipo: 'marcas',
            id: m.id,
            datos: { nombre: nombre.trim(), es_propia: propia, familias },
          },
          { onSuccess: () => avisar('guardado') },
        )
      }
    >
      <Entrada valor={nombre} alCambiar={setNombre} etiqueta={`Nombre de ${m.nombre}`} ancho="w-56" />
      <Familias valor={familias} alCambiar={setFamilias} nombre={m.nombre} />
      <label className="flex items-center gap-1.5 text-[12.5px] text-tinta-2">
        <input type="checkbox" checked={propia} onChange={(e) => setPropia(e.target.checked)} />
        propia
      </label>
    </Fila>
  )
}
