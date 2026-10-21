import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';

class ErrorBoundary extends React.Component<React.PropsWithChildren, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <main className="error-page"><img src="/icon.svg" width="64" alt="Minue" /><h1>Hagamos una pausa</h1><p>La aplicación no pudo abrir esta pantalla. Recarga para volver a intentarlo.</p><button className="button primary" onClick={() => location.reload()}>Volver a cargar</button></main> : this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>);
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => { /* Installation can be retried next visit. */ }); });
}
