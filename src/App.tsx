import { useCallback, useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, ChevronRight, CircleHelp, Download, FlaskConical, Heart, History, LayoutDashboard, Leaf, LoaderCircle, LogOut, MapPin, Menu, Package, PawPrint, Plus, RefreshCw, Settings, ShieldCheck, Smartphone, Truck, UsersRound, Wifi, WifiOff, X } from 'lucide-react';
import { AppContext } from './lib/context';
import { command, loadData, receiptPDF, saveBlob } from './lib/api';
import { configured, supabase } from './lib/supabase';
import { demoData, DEMO_USER } from './lib/demo';
import { demoCommand } from './lib/demo-command';
import { formatDate, today } from './lib/dates';
import type { Data, View } from './lib/types';
import Auth from './components/Auth';
import Dashboard from './components/Dashboard';
import DriveSettings from './components/DriveSettings';
import { receiptFilename } from './lib/receipt-format';
import Admin from './components/Admin';
import DeliveryFlow, { type FlowState } from './components/DeliveryFlow';

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
const nav = [
  { id: 'dashboard', title: 'Mis entregas', icon: LayoutDashboard, admin: false },
  { id: 'history', title: 'Historial', icon: History, admin: false },
  { id: 'deliveries', title: 'Gestionar entregas', icon: Truck, admin: true },
  { id: 'destinations', title: 'Destinos', icon: MapPin, admin: true },
  { id: 'products', title: 'Productos', icon: Package, admin: true },
  { id: 'team', title: 'Equipo', icon: UsersRound, admin: true },
] as const;

export default function App() {
  const [demo, setDemo] = useState(!configured || new URLSearchParams(location.search).get('demo') === '1');
  const [data, setData] = useState<Data | null>(() => !configured || new URLSearchParams(location.search).get('demo') === '1' ? demoData() : null);
  const [session, setSession] = useState<Session | null>(null), [authLoading, setAuthLoading] = useState(configured);
  const [setupPassword, setSetupPassword] = useState(location.pathname.startsWith('/auth/'));
  const [loadError, setLoadError] = useState(''), [busy, setBusy] = useState(false), [online, setOnline] = useState(navigator.onLine);
  const [view, setView] = useState<View>('dashboard'), [flow, setFlow] = useState<FlowState | null>(null);
  const [mobileMenu, setMobileMenu] = useState(false), [createRequested, setCreateRequested] = useState(false);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null), [installed, setInstalled] = useState(matchMedia('(display-mode: standalone)').matches);
  const [day, setDay] = useState(today());
  const lock = useRef(false), currentData = useRef(data); currentData.current = data;
  const userId = demo ? DEMO_USER : session?.user.id;
  const user = data?.profiles.find(p => p.id === userId && p.active);
  const notify = useCallback((message: string, error = false) => setToast({ message, error }), []);

  useEffect(() => { if (!demo && user?.is_admin && new URLSearchParams(location.search).has('drive')) setView('settings'); }, [demo, user?.id, user?.is_admin]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 10000 : 5000); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const onOnline = () => setOnline(true), onOffline = () => setOnline(false);
    const onPrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const onInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('online', onOnline); window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onPrompt); window.addEventListener('appinstalled', onInstalled);
    const timer = setInterval(() => setDay(today()), 30_000);
    return () => { clearInterval(timer); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); window.removeEventListener('beforeinstallprompt', onPrompt); window.removeEventListener('appinstalled', onInstalled); };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    let mounted = true;
    supabase.auth.getSession().then(({ data, error }) => { if (mounted) { setSession(data.session); setAuthLoading(false); if (error) notify('No pudimos restaurar tu sesión. Vuelve a ingresar.', true); } }).catch(() => { if (mounted) setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession); setAuthLoading(false);
      if (event === 'PASSWORD_RECOVERY') setSetupPassword(true);
      if (event === 'SIGNED_OUT') { setData(null); setFlow(null); }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [notify]);
  const refresh = useCallback(async () => {
    if (demo || !session) return;
    try { const next = await loadData(); setData(next); setLoadError(''); }
    catch (e) { setLoadError((e as Error).message); }
  }, [demo, session?.user.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (demo || !session) return;
    const onFocus = () => { if (!lock.current && navigator.onLine) void refresh(); };
    window.addEventListener('focus', onFocus); window.addEventListener('online', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('online', onFocus); };
  }, [refresh, demo, session?.user.id]);

  async function run(action: string, payload: Record<string, unknown>) {
    if (lock.current) throw new Error('Espera a que termine la operación actual.');
    if (!online) throw new Error('Necesitas conexión para guardar los cambios.');
    lock.current = true; setBusy(true);
    try {
      if (demo) {
        const next = demoCommand(currentData.current!, userId!, action, payload); currentData.current = next; setData(next);
      } else {
        const result = await command({ action, payload });
        if (result.pdf_pending) notify('Entrega confirmada. Podrás generar el PDF desde el historial.');
        try {
          const next = await loadData(); currentData.current = next; setData(next); setLoadError('');
        } catch {
          if (action === 'confirm_delivery' && result.data?.snapshot) {
            const next = structuredClone(currentData.current!);
            const delivery = next.deliveries.find(d => d.id === payload.delivery_id);
            if (delivery) delivery.status = 'delivered';
            if (!next.receipts.some(r => r.id === result.data.id)) next.receipts.push(result.data);
            currentData.current = next; setData(next);
          }
          setLoadError('Los cambios se guardaron, pero no pudimos actualizar la lista. Vuelve a cargar los datos.');
        }
      }
    } finally { lock.current = false; setBusy(false); }
  }
  async function getPDF(deliveryId: string, original = false) {
    if (!online) throw new Error('Conéctate a internet para descargar el comprobante.');
    let blob: Blob;
    const receipt = currentData.current?.receipts.find(r => r.delivery_id === deliveryId);
    if (demo) {
      if (!receipt?.signature_data) throw new Error('No se encontró el comprobante.');
      const { buildReceiptPDF } = await import('./lib/pdf');
      const bytes = Uint8Array.from(atob(receipt.signature_data.split(',')[1]), c => c.charCodeAt(0));
      const pdf = await buildReceiptPDF(receipt, bytes, { demonstration: true });
      blob = new Blob([pdf as BlobPart], { type: 'application/pdf' });
    } else blob = await receiptPDF(deliveryId, original);
    return blob;
  }
  async function download(deliveryId: string, original = false) {
    const blob = await getPDF(deliveryId, original);
    const receipt = currentData.current?.receipts.find(r => r.delivery_id === deliveryId);
    saveBlob(blob, receipt ? receiptFilename(receipt, original) : 'Minue-comprobante.pdf');
    notify('Comprobante descargado.');
  }
  function go(next: View) { setView(next); setMobileMenu(false); setCreateRequested(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function logout() {
    if (busy) return;
    if (demo) { if (!configured) { setData(demoData()); notify('Demostración reiniciada.'); } else { setDemo(false); setData(null); } }
    else {
      const { error } = await supabase!.auth.signOut({ scope: 'local' });
      if (error) { notify('No pudimos cerrar la sesión. Inténtalo de nuevo.', true); return; }
      setData(null); setSession(null);
    }
    setFlow(null); go('dashboard');
  }
  async function install() {
    if (installed) { notify('Minue ya se está usando como aplicación.'); return; }
    if (!installPrompt) { go('settings'); return; }
    try { await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === 'accepted') notify('La instalación está en marcha.'); setInstallPrompt(null); }
    catch { notify('Abre el menú de Chrome y selecciona «Instalar aplicación».', true); }
  }
  function enterDemo() { setDemo(true); setData(demoData()); setLoadError(''); go('dashboard'); }
  if (!demo && authLoading) return <div className="loading-page"><img src="/icon.svg" alt="Minue" /><LoaderCircle className="spin" /><p>Preparando tu día…</p></div>;
  if (!demo && (!session || setupPassword)) return <Auth onDemo={enterDemo} setupPassword={setupPassword && Boolean(session)} />;
  if (!data || (!demo && loadError && !user)) return <div className="error-page"><img src="/icon.svg" width="64" alt="Minue" /><h1>{loadError ? 'No pudimos cargar tu ruta' : 'Preparando tu ruta…'}</h1><p>{loadError || 'Solo tomará un momento.'}</p><button className="button primary" onClick={refresh}><RefreshCw size={16} /> Volver a intentar</button><button className="text-button center" onClick={logout}>Cerrar sesión</button></div>;
  if (!user) return <div className="error-page"><ShieldCheck size={42} /><h1>Tu acceso aún no está habilitado</h1><p>Tu cuenta debe estar activa y autorizada por administración para ingresar a Minue.</p><button className="button primary" onClick={refresh}>Comprobar acceso</button><button className="text-button center" onClick={logout}>Cerrar sesión</button></div>;
  const title = view === 'settings' ? 'Mi aplicación' : nav.find(n => n.id === view)?.title || 'Mis entregas';
  const visibleNav = nav.filter(n => !n.admin || user.is_admin);
  return <AppContext.Provider value={{ data, user, demo, busy, online, run, notify, download, getPDF }}><div className="app-layout">
    {mobileMenu && <button className="sidebar-backdrop" aria-label="Cerrar menú" onClick={() => setMobileMenu(false)} />}
    <aside className={`sidebar ${mobileMenu ? 'open' : ''}`}><button className="brand" onClick={() => go('dashboard')} aria-label="Minue, inicio"><span className="brand-mark"><PawPrint size={27} /></span><span>minue<span className="brand-tag">NUTRICIÓN QUE CUIDA</span></span></button><div className="workspace-label"><span className="workspace-icon"><Leaf size={16} /></span><span>Centro de entregas<small>Cuidamos cada paso</small></span></div><span className="nav-label">MI ESPACIO</span><nav aria-label="Navegación principal">{visibleNav.map((item, n) => <div key={item.id}>{item.admin && !visibleNav[n - 1]?.admin && <span className="nav-label admin-label">ADMINISTRACIÓN</span>}<button className={`nav-link ${view === item.id ? 'active' : ''}`} onClick={() => go(item.id)}><item.icon size={18} /><span>{item.title}</span>{item.id === 'dashboard' && <span className="nav-count">{data.deliveries.filter(d => d.assigned_to === user.id && d.scheduled_date === day && d.status === 'pending').length}</span>}{view === item.id && item.id !== 'dashboard' && <ChevronRight size={14} />}</button></div>)}</nav><div className="sidebar-bottom"><div className="install-card"><span className="install-icon"><Smartphone size={22} /></span><h3>Tu ruta va contigo</h3><p>Minue, a un toque de distancia.<br />Instala la app en tu celular.</p><button onClick={install}>{installed ? 'Aplicación instalada' : 'Instalar aplicación'}<ArrowRight size={14} /></button></div><button className={`nav-link ${view === 'settings' ? 'active' : ''}`} onClick={() => go('settings')}><Settings size={18} /><span>Mi aplicación</span></button><div className="sidebar-signature"><PawPrint size={13} /> Bienestar que llega más lejos</div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="topbar-start"><button className="icon-button menu-toggle" aria-label="Abrir menú" onClick={() => setMobileMenu(true)}><Menu size={22} /></button><span className="breadcrumb">Mi espacio <ChevronRight size={13} /> <strong>{title}</strong></span><span className="mobile-brand">minue<span>ENTREGAS</span></span></div><div className="topbar-right"><span className={`connection ${!online ? 'offline' : ''}`}>{online ? <Wifi size={14} /> : <WifiOff size={14} />}<span>{online ? 'En línea' : 'Sin conexión'}</span></span><span className="header-divider" /><button className="profile-button" onClick={() => go('settings')} aria-label="Ver mi perfil"><span className="avatar">{user.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.is_courier ? 'Repartidor' : 'Administración'}</small></span></button></div></header>
      {demo && <div className="demo-banner"><FlaskConical size={15} /><span><strong>Vista de demostración</strong><span className="desktop-only"> · Datos de ejemplo. Los cambios se reinician al recargar.</span></span><button onClick={() => go('settings')}>Conectar Minue <ArrowUpRightMini /></button></div>}
      {!online && <div className="offline-banner" role="alert"><WifiOff size={16} /> Sin conexión. Conéctate para actualizar tu ruta o confirmar una entrega.</div>}
      {loadError && <div className="offline-banner" role="alert">{loadError}<button className="text-button" onClick={refresh}>Reintentar</button></div>}
      <main className="main-content"><div className="page-heading"><div><span className="eyebrow">{formatDate(day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</span><h1>{view === 'dashboard' ? <>Hola, {user.name.split(' ')[0]} <span className="greeting-dot">✺</span></> : title}</h1><p>{view === 'dashboard' ? 'Un nuevo día para llevar bienestar.' : view === 'history' ? 'Las entregas que ya hicieron la diferencia.' : view === 'settings' ? 'Tu perfil, tu acceso y Minue en tu celular.' : 'Un espacio para que todo llegue a buen destino.'}</p></div>{view === 'dashboard' && <div className="heading-actions">{user.is_admin && <button className="button primary" onClick={() => { go('deliveries'); setCreateRequested(true); }}><Plus size={16} /><span>Nueva entrega</span></button>}<div className="today-chip"><CalendarDays size={17} /><span>Hoy, {formatDate(day, { day: 'numeric', month: 'short' })}</span></div></div>}</div>
      {(view === 'dashboard' || view === 'history') && <Dashboard key={`${view}-${day}`} history={view === 'history'} onFlow={setFlow} />}
      {['deliveries', 'destinations', 'products', 'team'].includes(view) && user.is_admin && <Admin key={view} view={view} onFlow={setFlow} createRequested={createRequested} onCreated={() => setCreateRequested(false)} />}
      {view === 'settings' && <div className="settings-grid">{user.is_admin && <DriveSettings />}<section className="panel settings-panel"><div className="section-icon"><UsersRound size={22} /></div><h2>Tu perfil</h2><dl><dt>Nombre</dt><dd>{user.name}</dd><dt>Correo</dt><dd>{user.email}</dd><dt>Permisos</dt><dd>{[user.is_admin && 'Administración', user.is_courier && 'Reparto'].filter(Boolean).join(' y ')}</dd><dt>Zona horaria</dt><dd>Quito, Ecuador · UTC−5</dd></dl><button className="button subtle full" disabled={busy} onClick={logout}><LogOut size={16} />{demo ? configured ? 'Salir de la demostración' : 'Reiniciar demostración' : 'Cerrar sesión'}</button></section><section className="panel settings-panel"><div className="section-icon"><Smartphone size={22} /></div><h2>Minue en tu Android</h2><p>Ten tu ruta a mano, sin buscar entre pestañas.</p><ol className="install-steps"><li>Abre la dirección de Minue en <strong>Google Chrome</strong>.</li><li>Toca el menú <strong>⋮</strong> y elige <strong>Instalar aplicación</strong> o <strong>Agregar a pantalla de inicio</strong>.</li><li>Confirma. Encontrarás Minue junto a tus otras aplicaciones.</li></ol><button className="button primary full" onClick={install} disabled={installed || !installPrompt}><Download size={17} />{installed ? 'Ya está instalada' : installPrompt ? 'Instalar Minue' : 'Instala desde el menú de Chrome'}</button><p className="field-note"><Wifi size={15} /> Se necesita internet para consultar y confirmar entregas.</p></section>{demo && <section className="panel settings-panel setup-panel"><div className="section-icon"><ShieldCheck size={22} /></div><h2>De la idea a tu ruta real</h2><p>Esta vista usa datos de ejemplo y no guarda entregas reales. Para operar, conecta el proyecto de Supabase de la organización <strong>Minue</strong> y publica la aplicación.</p><p>La configuración de base de datos, el acceso privado y las instrucciones de despliegue se incluyen con el proyecto. La primera cuenta administradora se habilita durante esa configuración.</p><span className="setup-note"><CheckCircle2 size={17} /> El comprobante usa un formato provisional adaptable.</span></section>}</div>}
      <footer className="main-footer"><span><PawPrint size={13} /> minue <i>·</i> Nutrición que cuida</span><span>Hecho para llegar bien. <Heart size={12} /></span></footer></main>
    </div><nav className="mobile-bottom-nav" aria-label="Navegación móvil"><button className={view === 'dashboard' ? 'active' : ''} onClick={() => go('dashboard')}><LayoutDashboard size={21} /><span>Entregas</span></button><button className={view === 'history' ? 'active' : ''} onClick={() => go('history')}><History size={21} /><span>Historial</span></button>{user.is_admin && <button className={view === 'deliveries' ? 'active' : ''} onClick={() => go('deliveries')}><Truck size={21} /><span>Gestionar</span></button>}<button className={view === 'settings' ? 'active' : ''} onClick={() => go('settings')}><Settings size={21} /><span>Mi app</span></button></nav>
    {flow && <DeliveryFlow key={`${flow.id}-${flow.type}`} flow={flow} setFlow={setFlow} onClose={() => setFlow(null)} />}{toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={19} /> : <CheckCircle2 size={19} />}<span>{toast.message}</span><button className="icon-button" aria-label="Cerrar aviso" onClick={() => setToast(null)}><X size={17} /></button></div>}
  </div></AppContext.Provider>;
}
function ArrowUpRightMini() { return <span aria-hidden="true">↗</span>; }
