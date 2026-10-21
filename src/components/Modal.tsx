import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
export default function Modal({ title, subtitle, children, onClose, wide = false, locked = false, className = '' }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; locked?: boolean; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const previous = document.activeElement as HTMLElement | null;
    element.showModal();
    return () => { element.close(); previous?.focus(); };
  }, []);
  return <dialog ref={dialog} className={`modal ${wide ? 'wide' : ''} ${className}`} aria-label={title} onCancel={e => { e.preventDefault(); if (!locked) onClose(); }} onClick={e => { if (e.target === dialog.current && !locked) { const r = dialog.current!.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose(); } }}>
    <div className="modal-header"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="Cerrar ventana" disabled={locked} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}
