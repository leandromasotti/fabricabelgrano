// Formato de números y fechas, en un solo lugar.
//
// Todo lo que se muestra en pantalla pasa por acá. Cuando el mismo número aparece en
// un KPI y en una tabla con dos formatos distintos, el que lee asume que son dos
// números distintos.

export const num = (n: number | null | undefined): string => (n ?? 0).toLocaleString('es-AR')

export const kilos = (gramos: number): string => (gramos / 1000).toFixed(3).replace('.', ',')

/** Un decimal, con coma: en es-AR "3.1 h" se lee como tres mil cien. */
export const decimal = (n: number, decimales = 1): string =>
  n.toLocaleString('es-AR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales })

/**
 * Una fecha `YYYY-MM-DD` es un día del calendario, no un instante.
 * `new Date('2026-08-15')` la interpreta como medianoche UTC y al formatearla en local
 * cae al día anterior. Ese bug ya se comió un día entero en los reportes; el sufijo
 * `T00:00` es lo que lo evita.
 */
export const dia = (iso: string): Date => new Date(`${iso}T00:00`)

export const fechaCorta = (iso: string): string => dia(iso).toLocaleDateString('es-AR')

export const fechaLarga = (iso: string): string =>
  dia(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short' })

export const hhmm = (instante: string): string =>
  new Date(instante).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

/** Hoy en local, en formato `YYYY-MM-DD`. El truco de 'sv-SE' es que ya sale ISO. */
export const hoy = (): string => new Date().toLocaleDateString('sv-SE')

export const diasAtras = (n: number): string =>
  new Date(Date.now() - n * 864e5).toLocaleDateString('sv-SE')

// ---------------------------------------------------------------- períodos

/**
 * Aritmética de calendario sobre strings `YYYY-MM-DD`.
 *
 * Se ancla al mediodía UTC a propósito: partir de la medianoche y sumar o restar horas
 * cae en el día de al lado según el huso y el horario de verano. Desde el mediodía,
 * ningún corrimiento de zona alcanza a mover la fecha.
 */
const alMediodia = (iso: string) => new Date(`${iso}T12:00:00Z`)
const aIso = (d: Date) => d.toISOString().slice(0, 10)

/** La semana del lunes al domingo que contiene esa fecha. */
export function semanaDe(iso: string): [string, string] {
  const d = alMediodia(iso)
  // getUTCDay da 0 para domingo; acá la semana arranca el lunes, como en la fábrica.
  const desplazamiento = (d.getUTCDay() + 6) % 7
  const lunes = new Date(d)
  lunes.setUTCDate(d.getUTCDate() - desplazamiento)
  const domingo = new Date(lunes)
  domingo.setUTCDate(lunes.getUTCDate() + 6)
  return [aIso(lunes), aIso(domingo)]
}

/** Del 1 al último día del mes que contiene esa fecha. */
export function mesDe(iso: string): [string, string] {
  const d = alMediodia(iso)
  const primero = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 12))
  // Día 0 del mes siguiente = último del actual, sin tablas de 28/30/31 ni bisiestos.
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12))
  return [aIso(primero), aIso(ultimo)]
}
