'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { viz } from '@/lib/viz'
import { InstrumentScene } from './Scene'
import { LedgerStage, LockStage, ShiftsStage } from './stages-clock'
import { DopplerStage, ModesStage, OverviewStage, TrapStage } from './stages-motion'
import { DetectStage, PrepStage, ProbeStage, SidebandStage, TransferStage } from './stages-quantum'

const STAGES = [
  { id: 'clock', label: 'The clock', time: '' },
  { id: 'trap', label: 'Trap', time: 'always on' },
  { id: 'modes', label: 'Shared motion', time: '2 to 5 MHz' },
  { id: 'doppler', label: 'Doppler cooling', time: '2 ms' },
  { id: 'prep', label: 'Prepare Al⁺', time: 'ms' },
  { id: 'probe', label: 'Clock probe', time: '1 s' },
  { id: 'sideband', label: 'Ground state', time: 'about 2 ms' },
  { id: 'transfer', label: 'Quantum logic', time: '40 µs' },
  { id: 'detect', label: 'Read out', time: '10 ms' },
  { id: 'lock', label: 'Lock & count', time: 'each 1.25 s' },
  { id: 'shifts', label: 'Shifts', time: '' },
  { id: 'ledger', label: 'Exact or not', time: '' },
] as const

export default function App() {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [glError, setGlError] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null), overlay = useRef<HTMLDivElement>(null), panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setPaused(true); viz.paused = true }
    const hash = STAGES.findIndex(s => s.id === window.location.hash.slice(1))
    if (hash >= 0) setIndex(hash)
    let scene: InstrumentScene | null = null
    try { scene = new InstrumentScene(canvas.current!, overlay.current!) } catch { setGlError(true) }
    return () => scene?.dispose()
  }, [])

  const go = useCallback((i: number) => {
    const next = Math.max(0, Math.min(STAGES.length - 1, i))
    setIndex(next)
    history.replaceState(null, '', `#${STAGES[next].id}`)
    panel.current?.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      if (e.key === 'ArrowRight') go(index + 1)
      if (e.key === 'ArrowLeft') go(index - 1)
      if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); setPaused(p => { viz.paused = !p; return !p }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, go])

  const stage = STAGES[index].id
  return (
    <div className="app">
      <main className="reading" ref={panel}>
        <div className="reading-inner" key={stage}>
          {stage === 'clock' && <OverviewStage onNext={() => go(1)} />}
          {stage === 'trap' && <TrapStage />}
          {stage === 'modes' && <ModesStage />}
          {stage === 'doppler' && <DopplerStage />}
          {stage === 'prep' && <PrepStage />}
          {stage === 'probe' && <ProbeStage />}
          {stage === 'sideband' && <SidebandStage />}
          {stage === 'transfer' && <TransferStage />}
          {stage === 'detect' && <DetectStage />}
          {stage === 'lock' && <LockStage />}
          {stage === 'shifts' && <ShiftsStage />}
          {stage === 'ledger' && <LedgerStage />}
          <div id="dock-inline" />
          <nav className="pager" aria-label="Step">
            <button type="button" disabled={index === 0} onClick={() => go(index - 1)}>Previous</button>
            <button type="button" disabled={index === STAGES.length - 1} onClick={() => go(index + 1)}>Next: {STAGES[index + 1]?.label ?? 'end'}</button>
          </nav>
        </div>
      </main>

      <section className="instrument" ref={overlay} aria-label="3D view of the ion trap. Drag to orbit, scroll to zoom.">
        <canvas ref={canvas} className="gl" />
        {glError && <p className="notice gl-error">This browser could not start WebGL, so the 3D view is off. The simulations and charts still run.</p>}
        <span className="ion-label" data-label-mg>²⁵Mg⁺ logic ion</span>
        <span className="ion-label" data-label-al>²⁷Al⁺ clock ion</span>
        <span className="ion-label" data-label-north>³P₀</span>
        <span className="ion-label" data-label-south>¹S₀</span>
        <div className="lens">
          <div className="scale"><i data-scale-bar /><span data-scale-label /></div>
          <div data-time /><div data-motion />
          <div className="uv-note">UV light is invisible. Beam colors are assigned.</div>
        </div>
        <button type="button" className="pause" aria-pressed={paused} onClick={() => setPaused(p => { viz.paused = !p; return !p })}>{paused ? 'Resume the physics' : 'Pause the physics'}</button>
      </section>

      <aside id="dock" className="dock" aria-label="Controls and live measurements" />

      <nav className="rail" aria-label="Steps of one clock cycle">
        <ol>
          {STAGES.map((s, i) => (
            <li key={s.id}>
              <button type="button" aria-current={i === index ? 'step' : undefined} onClick={() => go(i)}>
                <span className="rail-n">{i}</span>
                <span className="rail-l">{s.label}</span>
                {s.time && <span className="rail-t">{s.time}</span>}
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </div>
  )
}
