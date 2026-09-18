import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Layout } from './ui/Layout'
import { Consulta } from './pantallas/Consulta'
import { Despacho } from './pantallas/Despacho'
import { DiasMaduracion } from './pantallas/DiasMaduracion'
import { Envases } from './pantallas/Envases'
import { LecheCruda } from './pantallas/LecheCruda'
import { Maestros } from './pantallas/Maestros'
import { NuevoPedido } from './pantallas/NuevoPedido'
import { Reportes } from './pantallas/Reportes'
import { TableroLed } from './pantallas/TableroLed'

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      // La fábrica trabaja de 8 a 16 y estos datos cambian por minuto, no por segundo.
      staleTime: 30_000,
      // Un 400 o un 404 no mejora reintentando: solo se reintenta lo que puede ser
      // un problema de red.
      retry: (intentos, e) =>
        e instanceof Error && 'estado' in e && typeof e.estado === 'number' && e.estado < 500
          ? false
          : intentos < 2,
      refetchOnWindowFocus: false,
    },
  },
})

export function App() {
  return (
    <QueryClientProvider client={cliente}>
      {/* basename /app: el SPA vive ahí y las pantallas viejas siguen en la raíz. */}
      <BrowserRouter basename="/app">
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/despacho" replace />} />
            <Route path="despacho" element={<Despacho />} />
            <Route path="nuevo-pedido" element={<NuevoPedido />} />
            <Route path="reportes" element={<Reportes />} />
            <Route path="leche-cruda" element={<LecheCruda />} />
            <Route path="envases" element={<Envases />} />
            <Route path="maduracion-dias" element={<DiasMaduracion />} />
            <Route path="consulta" element={<Consulta />} />
            <Route path="tablero-led" element={<TableroLed />} />
            <Route path="maestros" element={<Maestros />} />
            <Route path="*" element={<Navigate to="/despacho" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
