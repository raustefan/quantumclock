'use client'
import katex from 'katex'
import { createPortal } from 'react-dom'
import { useEffect, useId, useImperativeHandle, useMemo, useReducer, useRef, useState, type ReactNode, type Ref } from 'react'
import { viz } from '@/lib/viz'

// Controls and live charts sit beside the 3D view on wide screens, and under the text on narrow ones.
export function Dock({ children }: { children: ReactNode }) {
  const [narrow, setNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 1180px)').matches)
  useEffect(() => {
    const m = window.matchMedia('(max-width: 1180px)'), on = () => setNarrow(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  const target = typeof document !== 'undefined' ? document.getElementById(narrow ? 'dock-inline' : 'dock') : null
  return target ? createPortal(children, target) : null
}

export function Eq({ tex, block = true }: { tex: string; block?: boolean }) {
  const html = useMemo(() => katex.renderToString(tex, { displayMode: block, throwOnError: false, output: 'htmlAndMathml' }), [tex, block])
  return <span className={block ? 'eq' : undefined} dangerouslySetInnerHTML={{ __html: html }} />
}
export const M = ({ t }: { t: string }) => <Eq tex={t} block={false} />

// Runs fn every animation frame unless the instrument is paused; the time step is in seconds.
export function useLoop(fn: (dt: number) => void) {
  const saved = useRef(fn)
  saved.current = fn
  useEffect(() => {
    let id = 0, last = performance.now()
    const tick = (now: number) => {
      id = requestAnimationFrame(tick)
      const dt = Math.min((now - last) / 1000, 0.1); last = now
      if (!viz.paused) saved.current(dt)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [])
}

// Re-render at a human reading rate so numbers can be read while the physics runs at full speed.
export function useReadoutRate(hz = 8) {
  const [, bump] = useReducer((x: number) => x + 1, 0)
  useEffect(() => { const id = setInterval(bump, 1000 / hz); return () => clearInterval(id) }, [hz])
}

export function Slider({ label, value, min, max, step, onChange, format, hint }: {
  label: ReactNode; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format: (v: number) => string; hint?: ReactNode
}) {
  const id = useId()
  return (
    <div className="slider">
      <label htmlFor={id}><span>{label}</span><output htmlFor={id}>{format(value)}</output></label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} />
      {hint && <p className="hint">{hint}</p>}
    </div>
  )
}

export function Readouts({ items }: { items: [ReactNode, ReactNode, ReactNode?][] }) {
  return (
    <dl className="readouts">
      {items.map(([k, v, ref], i) => (
        <div key={i}><dt>{k}</dt><dd>{v}{ref && <small>{ref}</small>}</dd></div>
      ))}
    </dl>
  )
}

export function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { id: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="choice" role="group" aria-label={label}>
      <span>{label}</span>
      <div>
        {options.map(o => <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>{o.label}</button>)}
      </div>
    </div>
  )
}

export type Series = { label: string; color: string; points: [number, number][]; dash?: number[]; dots?: boolean; bars?: boolean }
export type PlotData = { series: Series[]; xLabel: string; yLabel: string; xLog?: boolean; yLog?: boolean; xRange?: [number, number]; yRange?: [number, number]; marker?: number; xFormat?: (x: number) => string; yFormat?: (y: number) => string }
export type PlotHandle = { draw: (d: PlotData) => void }

const INK = '#efeaff', MUTED = '#a89fce', GRID = 'rgba(190,180,240,.14)'

const fmtDefault = (v: number) => {
  if (v === 0) return '0'
  const a = Math.abs(v)
  return a >= 1e4 || a < 0.01 ? v.toExponential(1).replace('e+', 'e') : String(Number(v.toPrecision(3)))
}

function ticks(lo: number, hi: number, log: boolean) {
  const out: number[] = []
  if (log) {
    const a = Math.ceil(Math.log10(lo) - 1e-9), b = Math.floor(Math.log10(hi) + 1e-9), s = Math.max(1, Math.ceil((b - a) / 6))
    for (let e = a; e <= b; e += s) out.push(10 ** e)
    return out
  }
  const span = hi - lo, p = 10 ** Math.floor(Math.log10(span / 5)), m = span / 5 / p, step = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v)
  return out
}

// A small canvas chart with a crosshair, tooltip and legend. Drawn imperatively because it updates live.
export function Plot({ ref, height = 190, label }: { ref: Ref<PlotHandle>; height?: number; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const data = useRef<PlotData | null>(null)
  const hover = useRef<number | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [legend, setLegend] = useState<string>('')
  const legendData = useRef<Series[]>([])
  const pad = { l: 58, r: 12, t: 8, b: 38 }

  const paint = () => {
    const c = canvas.current, d = data.current
    if (!c || !d) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2), W = c.clientWidth, H = c.clientHeight
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr) }
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, W, H)
    let [x0, x1] = d.xRange ?? [Infinity, -Infinity], [y0, y1] = d.yRange ?? [Infinity, -Infinity]
    if (!d.xRange || !d.yRange) for (const s of d.series) for (const [x, y] of s.points) {
      if (!Number.isFinite(x) || !Number.isFinite(y) || (d.xLog && x <= 0) || (d.yLog && y <= 0)) continue
      if (!d.xRange) { x0 = Math.min(x0, x); x1 = Math.max(x1, x) }
      if (!d.yRange) { y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    }
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return
    if (x0 === x1) x1 = x0 + 1
    if (y0 === y1) y1 = y0 + 1
    if (!d.yRange && !d.yLog) { const m = (y1 - y0) * 0.08; y0 -= m; y1 += m }
    const fx = d.xLog ? (x: number) => (Math.log10(x) - Math.log10(x0)) / (Math.log10(x1) - Math.log10(x0)) : (x: number) => (x - x0) / (x1 - x0)
    const fy = d.yLog ? (y: number) => (Math.log10(y) - Math.log10(y0)) / (Math.log10(y1) - Math.log10(y0)) : (y: number) => (y - y0) / (y1 - y0)
    const X = (x: number) => pad.l + fx(x) * (W - pad.l - pad.r), Y = (y: number) => H - pad.b - fy(y) * (H - pad.t - pad.b)
    g.font = `12px ${getComputedStyle(document.body).getPropertyValue('--font-ui')}, system-ui, sans-serif`
    g.lineWidth = 1
    g.fillStyle = MUTED; g.strokeStyle = GRID
    const xf = d.xFormat ?? fmtDefault, yf = d.yFormat ?? fmtDefault
    g.textAlign = 'center'; g.textBaseline = 'top'
    for (const v of ticks(x0, x1, !!d.xLog)) { const p = X(v); g.beginPath(); g.moveTo(p, pad.t); g.lineTo(p, H - pad.b); g.stroke(); g.fillText(xf(v), p, H - pad.b + 4) }
    g.textAlign = 'right'; g.textBaseline = 'middle'
    for (const v of ticks(y0, y1, !!d.yLog)) { const p = Y(v); g.beginPath(); g.moveTo(pad.l, p); g.lineTo(W - pad.r, p); g.stroke(); g.fillText(yf(v), pad.l - 6, p) }
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'
    g.fillText(d.xLabel, pad.l + (W - pad.l - pad.r) / 2, H - 4)
    g.save(); g.translate(12, pad.t + (H - pad.t - pad.b) / 2); g.rotate(-Math.PI / 2); g.fillText(d.yLabel, 0, 0); g.restore()
    g.save(); g.beginPath(); g.rect(pad.l, pad.t, W - pad.l - pad.r, H - pad.t - pad.b); g.clip()
    for (const s of d.series) {
      g.strokeStyle = s.color; g.fillStyle = s.color; g.lineWidth = 2; g.setLineDash(s.dash ?? [])
      if (s.bars) {
        const bw = Math.max(2, (W - pad.l - pad.r) / Math.max(1, s.points.length) - 2)
        for (const [x, y] of s.points) { const px = X(x), py = Y(y), base = Y(d.yLog ? y0 : Math.max(y0, 0)); g.fillRect(px - bw / 2, py, bw, Math.max(base - py, 0.5)) }
      } else if (s.dots) {
        for (const [x, y] of s.points) { if (!Number.isFinite(y) || (d.yLog && y <= 0)) continue; g.beginPath(); g.arc(X(x), Y(y), 3.5, 0, 7); g.fill() }
      } else {
        g.beginPath(); let on = false
        for (const [x, y] of s.points) {
          if (!Number.isFinite(y) || (d.yLog && y <= 0) || (d.xLog && x <= 0)) { on = false; continue }
          if (on) g.lineTo(X(x), Y(y)); else { g.moveTo(X(x), Y(y)); on = true }
        }
        g.stroke()
      }
    }
    g.setLineDash([])
    if (d.marker !== undefined) { g.strokeStyle = INK; g.lineWidth = 1; const p = X(d.marker); g.beginPath(); g.moveTo(p, pad.t); g.lineTo(p, H - pad.b); g.stroke() }
    if (hover.current !== null) { g.strokeStyle = 'rgba(239,234,255,.45)'; g.lineWidth = 1; g.beginPath(); g.moveTo(hover.current, pad.t); g.lineTo(hover.current, H - pad.b); g.stroke() }
    g.restore()
    ;(c as HTMLCanvasElement & { _x?: (px: number) => number })._x = px => {
      const f = (px - pad.l) / (W - pad.l - pad.r)
      return d.xLog ? 10 ** (Math.log10(x0) + f * (Math.log10(x1) - Math.log10(x0))) : x0 + f * (x1 - x0)
    }
  }

  useImperativeHandle(ref, () => ({
    draw(d) {
      data.current = d
      const key = d.series.map(s => s.label).join('|')
      if (key !== legend) { legendData.current = d.series; setLegend(key) }
      paint()
    },
  }))

  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ro = new ResizeObserver(() => paint())
    ro.observe(c)
    return () => ro.disconnect()
  })

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget as HTMLCanvasElement & { _x?: (px: number) => number }, d = data.current
    if (!d || !c._x) return
    const rect = c.getBoundingClientRect(), px = e.clientX - rect.left, x = c._x(px)
    hover.current = px
    const yf = d.yFormat ?? fmtDefault, xf = d.xFormat ?? fmtDefault
    const rows: string[] = []
    for (const s of d.series) {
      let best: [number, number] | null = null, bd = Infinity
      for (const q of s.points) { const dd = Math.abs(d.xLog ? Math.log(q[0] / x) : q[0] - x); if (dd < bd) { bd = dd; best = q } }
      if (best) rows.push(`${s.label}: ${yf(best[1])}`)
    }
    setTip({ x: Math.min(px + 10, rect.width - 150), y: 8, text: `${d.xLabel.split(' (')[0]} ${xf(x)}\n${rows.join('\n')}` })
    paint()
  }

  return (
    <figure className="plot">
      <div style={{ position: 'relative', height }}>
        <canvas ref={canvas} role="img" aria-label={label} style={{ width: '100%', height: '100%' }} onPointerMove={onMove} onPointerLeave={() => { hover.current = null; setTip(null); paint() }} />
        {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>}
      </div>
      {legendData.current.length > 1 && (
        <figcaption className="legend">
          {legendData.current.map(s => <span key={s.label}><i style={{ background: s.color, opacity: s.dash ? 0.65 : 1 }} />{s.label}</span>)}
        </figcaption>
      )}
    </figure>
  )
}

export const CHART = { ice: '#1fa3ca', rose: '#e4589f', gold: '#b88820', violet: '#8f7cf2', ink: '#efeaff' }

// Scientific notation for readouts: 3.5 × 10⁻¹⁶.
const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' }
export function sci(v: number, digits = 2) {
  if (!Number.isFinite(v)) return '—'
  if (v === 0) return '0'
  const [m, e] = v.toExponential(digits).split('e')
  const exp = String(Number(e)).split('').map(c => SUP[c]).join('')
  return `${m.replace('-', '−')} × 10${exp}`
}
