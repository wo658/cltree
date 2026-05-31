import { AppShell } from './components/layout/AppShell';

/**
 * App root. Renders only AppShell.
 * The frontend has no local state — all data is fetched from the server via WebSocket/HTTP.
 */
export default function App() {
  return <AppShell />;
}
