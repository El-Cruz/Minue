import { useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LoaderCircle, PawPrint, ShieldCheck, Truck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import Illustration from './Illustration';

export default function Auth({ onDemo, setupPassword = false }: { onDemo: () => void; setupPassword?: boolean }) {
  const [mode, setMode] = useState<'login' | 'reset' | 'password'>(setupPassword ? 'password' : 'login');
  const [show, setShow] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => new URLSearchParams(location.hash.slice(1)).has('error') || new URLSearchParams(location.search).has('error') ? 'El enlace no es válido o ya venció. Solicita un nuevo enlace para recuperar tu acceso.' : ''), [message, setMessage] = useState('');
  useEffect(() => { if (setupPassword) setMode('password'); }, [setupPassword]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError(''); setMessage('');
    const values = new FormData(e.currentTarget);
    try {
      if (!supabase) throw new Error('Falta conectar Supabase. Puedes explorar la demostración.');
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email: String(values.get('email')).trim(), password: String(values.get('password')) });
        if (error) throw new Error('No pudimos ingresar. Revisa tu correo y contraseña.');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(String(values.get('email')).trim(), { redirectTo: `${location.origin}/auth/reset` });
        if (error) throw new Error('No pudimos enviar el enlace. Inténtalo más tarde.');
        setMessage('Si el correo tiene una cuenta, recibirás un enlace para cambiar la contraseña.');
      } else {
        if (values.get('password') !== values.get('confirm')) throw new Error('Las contraseñas no coinciden.');
        const { error } = await supabase.auth.updateUser({ password: String(values.get('password')) });
        if (error) throw new Error('El enlace puede haber vencido o la contraseña no es válida. Solicita uno nuevo.');
        history.replaceState(null, '', '/');
        location.replace('/');
      }
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div className="auth-layout"><section className="auth-story"><a className="brand" href="/"><span className="brand-mark"><PawPrint /></span><span>minue<span className="brand-tag">NUTRICIÓN QUE CUIDA</span></span></a><div className="auth-story-copy"><span className="eyebrow">BIENESTAR EN CADA PARADA</span><h1>El cuidado también<br />viaja contigo.</h1><p>Cada entrega lleva algo más que alimento.<br />Lleva salud, confianza y muchas colitas felices.</p><Illustration /><div className="story-footer"><ShieldCheck size={18} /> Preparado con ciencia. Entregado con cariño.</div></div></section>
    <main className="auth-form-area"><div className="auth-form"><div className="section-icon"><Truck size={23} /></div><span className="eyebrow">MINUE · ENTREGAS</span><h2>{mode === 'login' ? 'Qué bueno verte de nuevo' : mode === 'reset' ? 'Recupera tu acceso' : 'Tu cuenta, lista para salir'}</h2><p>{mode === 'login' ? 'Ingresa para organizar tu día y llevar bienestar a cada destino.' : mode === 'reset' ? 'Te enviaremos un enlace para crear una nueva contraseña.' : 'Elige una contraseña de al menos 12 caracteres.'}</p>
    <form onSubmit={submit}>{mode !== 'password' && <label>Correo electrónico<input name="email" type="email" placeholder="tu@correo.com" autoComplete="email" required maxLength={254} /></label>}{mode !== 'reset' && <label>Contraseña<div className="password-input"><input name="password" type={show ? 'text' : 'password'} autoComplete={mode === 'password' ? 'new-password' : 'current-password'} minLength={mode === 'password' ? 12 : 1} maxLength={128} required placeholder={mode === 'password' ? 'Crea una contraseña segura' : 'Tu contraseña'} /><button type="button" className="icon-button" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}{mode === 'password' && <label>Confirma la contraseña<input name="confirm" type="password" autoComplete="new-password" minLength={12} maxLength={128} required /></label>}
      {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="form-success" role="status">{message}</p>}
      <button className="button primary full" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : null}{mode === 'login' ? 'Ingresar a Minue' : mode === 'reset' ? 'Enviar enlace' : 'Guardar contraseña'}<ArrowRight size={17} /></button>
    </form><button className="text-button center" onClick={() => { setMode(mode === 'login' ? 'reset' : 'login'); setMessage(''); setError(''); }}>{mode === 'login' ? '¿Olvidaste tu contraseña?' : 'Volver al inicio de sesión'}</button><div className="auth-divider" /><p className="auth-invite">El acceso es por invitación. Si aún no tienes una cuenta, contacta con la persona que administra Minue.</p><button className="button subtle full" onClick={onDemo}>Explorar la demostración <ArrowRight size={16} /></button></div><span className="auth-bottom">Minue · Nutrición consciente para perros y gatos</span></main>
  </div>;
}
