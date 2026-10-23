import { useEffect, useRef, useState } from 'react';
import { Eraser, PenLine } from 'lucide-react';
type Point = { x: number; y: number };
export default function Signature({ onChange, disabled }: { onChange: (value: string) => void; disabled: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const paths = useRef<Point[][]>([]);
  const active = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const callback = useRef(onChange); callback.current = onChange;
  function redraw() {
    const c = canvas.current;if(!c)return;
    const ctx=c.getContext('2d');if(!ctx)return;
    const r = c.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    c.width = Math.round(r.width * ratio); c.height = Math.round(r.height * ratio);
    ctx.scale(ratio, ratio); ctx.lineWidth = 2.4; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#244c3d';
    for (const path of paths.current) {
      ctx.beginPath();
      path.forEach((p, i) => { if (i === 0) ctx.moveTo(p.x * r.width, p.y * r.height); else ctx.lineTo(p.x * r.width, p.y * r.height); });
      ctx.stroke();
    }
  }
  useEffect(() => {
    const observer = new ResizeObserver(() => { if(!canvas.current)return;redraw(); if (paths.current.some(p => p.length > 2)) callback.current(canvas.current.toDataURL('image/png')); });
    observer.observe(canvas.current!); return () => observer.disconnect();
  }, []);
  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function finish() {
    if (!active.current) return; active.current = false;
    const valid = paths.current.reduce((n, p) => n + p.length, 0) >= 6;
    setHasInk(valid); onChange(valid ? canvas.current!.toDataURL('image/png') : '');
  }
  return <div className="signature-field"><div className="field-heading"><span>Firma de quien recibe <span className="required">*</span></span><button type="button" className="text-button" disabled={disabled || !hasInk} onClick={() => { paths.current = []; redraw(); setHasInk(false); onChange(''); }}><Eraser size={14} /> Borrar</button></div>
    <div className="signature-pad"><canvas ref={canvas} aria-label="Dibuja la firma de quien recibe" onPointerDown={e => { if (disabled) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); active.current = true; paths.current.push([point(e)]); }} onPointerMove={e => { if (!active.current || disabled) return; paths.current.at(-1)!.push(point(e)); redraw(); }} onPointerUp={finish} onPointerCancel={finish} />{!hasInk && <span className="signature-hint"><PenLine size={23} /> Firma aquí con el dedo o el lápiz</span>}<div className="signature-line" /></div>
    <p className="field-note">Pide a quien recibe que firme dentro del recuadro.</p>
  </div>;
}
