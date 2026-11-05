'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DETUNING_DOPPLER, GAMMA_MG, HBAR, KB, M_AL, M_MG, MODES_M25, OMEGA_RF, SAT_DOPPLER, TWO_PI, VACUUM_PA } from '@/lib/physics/constants'
import { axialModes, IonCrystal, kx, ky, mathieuA, mathieuQ, mathieuStable, radialModes, spacing, TRAP_M25, type Trap } from '@/lib/physics/trap'
import { enterStage, viz, writeIons } from '@/lib/viz'
import { CHART, Dock, Eq, M, Plot, Readouts, sci, Slider, useLoop, useReadoutRate, type PlotHandle } from './ui'

const fmtTime = (s: number) => s >= 1 ? `${s.toPrecision(3)} s` : s >= 1e-3 ? `${(s * 1e3).toPrecision(3)} ms` : s >= 1e-6 ? `${(s * 1e6).toPrecision(3)} µs` : `${(s * 1e9).toPrecision(3)} ns`
export { fmtTime }

export function OverviewStage({ onNext }: { onNext: () => void }) {
  const start = useRef(0), tickEl = useRef<HTMLSpanElement>(null)
  useEffect(() => { enterStage('clock', 12500); viz.mgGlow = 0.7; viz.alGlow = 0.7; start.current = performance.now() }, [])
  useLoop(() => {
    // BigInt, because a double cannot hold this count to the last digit.
    const ms = BigInt(Math.round(performance.now() - start.current))
    if (tickEl.current) tickEl.current.textContent = ((ms * 1121015393207859n) / 1000n).toLocaleString('en-US')
  })
  return (
    <>
      <h1>A clock made from one atom</h1>
      <p className="lede">Every clock counts something that repeats. This one counts the light that a single aluminium ion absorbs, 1.121 quadrillion cycles every second.</p>
      <div className="ticks" aria-live="off">
        <span className="ticks-n" ref={tickEl}>0</span>
        <span className="ticks-l">cycles of the clock laser since you opened this page</span>
      </div>
      <p>The instrument simulated here is the <strong>²⁷Al⁺ quantum-logic clock</strong> at NIST. In 2025 it set the record for the lowest systematic uncertainty of any clock: <M t="5.5\times10^{-19}" /> in fractional frequency, or one second in about 58 billion years.</p>
      <p>Three parts make any such clock work:</p>
      <ul className="parts">
        <li><strong>A flywheel.</strong> An ultrastable laser at 267.4 nm that ticks on its own, and slowly wanders.</li>
        <li><strong>A reference.</strong> One ²⁷Al⁺ ion, whose <M t="{}^1S_0\leftrightarrow{}^3P_0" /> resonance is set by nature and barely reacts to its surroundings.</li>
        <li><strong>A counter.</strong> A frequency comb that divides the optical cycles down to something electronics can count.</li>
      </ul>
      <p>The trouble is that Al⁺ can&apos;t be laser cooled or read out directly: its strong transition lies at 167 nm, deep in the vacuum ultraviolet. So a second ion, ²⁵Mg⁺, sits beside it. The two share their motion, and quantum logic carries the answer from one to the other. That is what makes this a <em>quantum</em> clock.</p>
      <p>Each step that follows runs live, with real parameters taken from the published experiments. Drag to orbit the trap, scroll to zoom. The scene is true to scale, from the titanium endcaps 4 mm away to the ions 3.9 µm apart.</p>
      <button type="button" className="primary" onClick={onNext}>Start with the trap</button>
    </>
  )
}

function StabilityChart({ trap }: { trap: Trap }) {
  const canvas = useRef<HTMLCanvasElement>(null), grid = useRef<HTMLCanvasElement | null>(null)
  const Q = 1.15, A = 0.5
  useEffect(() => {
    const c = document.createElement('canvas'); c.width = 230; c.height = 130
    const g = c.getContext('2d')!, img = g.createImageData(c.width, c.height)
    for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) {
      const q = ((i + 0.5) / c.width) * Q, a = A - ((j + 0.5) / c.height) * 2 * A, k = (j * c.width + i) * 4
      const ok = mathieuStable(a, q, 32)
      img.data[k] = ok ? 96 : 0; img.data[k + 1] = ok ? 78 : 0; img.data[k + 2] = ok ? 170 : 0; img.data[k + 3] = ok ? 255 : 0
    }
    g.putImageData(img, 0, 0)
    grid.current = c
  }, [])
  useEffect(() => {
    let id = 0
    const draw = () => {
      const c = canvas.current
      if (!c || !grid.current) { id = requestAnimationFrame(draw); return }
      const W = c.clientWidth, H = c.clientHeight, dpr = Math.min(devicePixelRatio, 2)
      c.width = W * dpr; c.height = H * dpr
      const g = c.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      const fam = getComputedStyle(document.body).getPropertyValue('--font-ui')
      const L = 38, B = 32, X = (q: number) => L + (q / Q) * (W - L - 6), Y = (a: number) => (H - B) / 2 - (a / A) * ((H - B) / 2 - 4)
      g.imageSmoothingEnabled = true
      g.drawImage(grid.current, L, Y(A), W - L - 6, Y(-A) - Y(A))
      g.strokeStyle = 'rgba(190,180,240,.3)'; g.fillStyle = '#a89fce'; g.font = `12px ${fam}, system-ui`; g.lineWidth = 1
      g.textAlign = 'center'
      for (const q of [0, 0.25, 0.5, 0.75, 1]) { g.beginPath(); g.moveTo(X(q), Y(A)); g.lineTo(X(q), Y(-A)); g.stroke(); g.fillText(String(q), X(q), H - B + 14) }
      g.fillText('Mathieu q', L + (W - L) / 2, H - 3)
      g.textAlign = 'right'; g.textBaseline = 'middle'
      for (const a of [-0.5, 0, 0.5]) g.fillText(String(a), L - 5, Y(a))
      g.textBaseline = 'alphabetic'
      for (const [m, color] of [[M_MG, CHART.rose], [M_AL, CHART.ice]] as const) {
        const q = mathieuQ(trap, m)
        for (const k of [kx(trap), ky(trap)]) {
          const a = mathieuA(k, trap, m)
          g.fillStyle = color; g.strokeStyle = '#1c1636'; g.lineWidth = 2
          g.beginPath(); g.arc(X(q), Y(Math.max(-A, Math.min(A, a))), 5, 0, 7); g.fill(); g.stroke()
        }
      }
    }
    draw()
    const ro = new ResizeObserver(draw); if (canvas.current) ro.observe(canvas.current)
    return () => { cancelAnimationFrame(id); ro.disconnect() }
  }, [trap])
  return (
    <figure className="plot">
      <canvas ref={canvas} role="img" aria-label="Mathieu stability diagram with the ions' working points" style={{ width: '100%', height: 190, display: 'block' }} />
      <figcaption className="legend"><span><i style={{ background: '#604eaa' }} />stable motion</span><span><i style={{ background: CHART.rose }} />Mg⁺ (x and y)</span><span><i style={{ background: CHART.ice }} />Al⁺ (x and y)</span></figcaption>
    </figure>
  )
}

export function TrapStage() {
  useReadoutRate()
  const q0 = mathieuQ(TRAP_M25, M_MG)
  const [q, setQ] = useState(q0), [axial, setAxial] = useState(1)
  const [speed, setSpeed] = useState(Math.log10(1.5)), [mag, setMag] = useState(20)
  const trap = useMemo<Trap>(() => ({ ...TRAP_M25, R: TRAP_M25.R * (q / q0), K: TRAP_M25.K * axial }), [q, q0, axial])
  const crystal = useRef<IonCrystal>(null!)
  if (!crystal.current) { crystal.current = new IonCrystal(TRAP_M25, 48, 4); crystal.current.thermalise(0.02) }
  const acc = useRef(0)
  useEffect(() => { enterStage('trap', 2100); viz.rfVisible = 1; viz.saddle = 1; viz.trail = true }, [])
  useEffect(() => { crystal.current.setTrap(trap) }, [trap])
  const rate = 10 ** speed // RF cycles per second on screen
  useLoop(dt => {
    const c = crystal.current
    acc.current += rate * 48 * dt
    const n = Math.min(Math.floor(acc.current), 4000); acc.current -= Math.floor(acc.current)
    c.step(n)
    writeIons(c, mag)
    viz.rfPhase = OMEGA_RF * c.t
    viz.rfVisible = rate < 6 ? 1 : 0.25; viz.saddle = rate < 6 ? 1 : 0
    viz.timeLens = `1 s on screen = ${fmtTime((rate * TWO_PI) / OMEGA_RF)} in the trap`
    viz.motionLens = `Motion magnified ×${mag}`
  })
  const retrap = () => { crystal.current.setTrap(trap); crystal.current.thermalise(0.02); viz.trailClear = true }
  const c = crystal.current
  const radial = radialModes(trap, 'x'), lost = c.lost, unstable = !radial
  const qAl = mathieuQ(trap, M_AL), com = axialModes(trap).com.omega
  return (
    <>
      <h2>Holding an ion in nothing</h2>
      <p>Earnshaw&apos;s theorem forbids a static electric field from trapping a charge: a saddle always leaks in one direction. So the trap never holds still. Four gold-coated blades on a diamond wafer are driven at <M t="\Omega/2\pi=70.86" /> MHz, flipping the saddle faster than the ion can roll off. Two titanium endcaps, biased with a static voltage, close the ends.</p>
      <Eq tex="\ddot{x}_i + \frac{\Omega^2}{4}\bigl(a_i - 2q_i\cos\Omega t\bigr)x_i = \frac{F^{\text{Coulomb}}_{i,x}}{m_i}" />
      <p>That is the Mathieu equation with the Coulomb push of the other ion. This page integrates it directly in three dimensions, 48 steps per RF cycle. There is no averaged pseudopotential anywhere in this code, so the fast jitter you see at slow speed is real <strong>micromotion</strong>.</p>
      <p>Slow time down to watch the blades swap polarity and the ions shiver. Then raise the RF until the working point leaves the stable region. Mg⁺ is lighter, so it goes first.</p>
      <Dock>
      <Slider label="RF drive (Mathieu q of Mg⁺)" value={q} min={0.05} max={1.05} step={0.005} onChange={setQ} format={v => v.toFixed(3)} hint={<>The papers don&apos;t publish the RF voltage for this trap, so it&apos;s set by <M t="q" />. <M t="q=0.206" /> reproduces the measured modes.</>} />
      <Slider label="Axial confinement" value={axial} min={0.3} max={2} step={0.01} onChange={setAxial} format={v => `${v.toFixed(2)} × endcap field`} />
      <Slider label="Playback speed" value={speed} min={-0.5} max={3.3} step={0.05} onChange={setSpeed} format={() => `${rate < 10 ? rate.toFixed(1) : rate.toFixed(0)} RF cycles per second`} />
      <Slider label="Motion magnification" value={mag} min={1} max={80} step={1} onChange={setMag} format={v => `×${v}`} />
      {(lost || unstable) && (
        <div className="notice" role="status">
          <p>{lost ? 'An ion has struck an electrode: its orbit grew past the 250 µm aperture.' : 'The working point has left the stable region. The ions will be ejected.'}</p>
          {lost && <button type="button" onClick={() => { setQ(q0); setAxial(1); retrap() }}>Reset the drive and reload</button>}
        </div>
      )}
      <StabilityChart trap={trap} />
      <Readouts items={[
        ['q of Mg⁺, Al⁺', `${q.toFixed(3)}, ${qAl.toFixed(3)}`],
        ['Ion spacing', `${(spacing(trap) * 1e6).toFixed(2)} µm`],
        ['Axial in-phase mode', `${(com / TWO_PI / 1e6).toFixed(2)} MHz`],
        ['Radial x modes', radial ? radial.map(m => (m.omega / TWO_PI / 1e6).toFixed(2)).join(', ') + ' MHz' : 'none: unstable'],
        ['Vacuum', `${VACUUM_PA.toExponential(1)} Pa`, ' about 60 molecules per mm³'],
      ]} />
</Dock>
    </>
  )
}

const MODE_LABEL: Record<string, string> = {
  'z-com': 'Axial, together', 'z-str': 'Axial, opposed', 'x-com': 'Radial x, together', 'x-str': 'Radial x, opposed', 'y-com': 'Radial y, together', 'y-str': 'Radial y, opposed',
}

export function ModesStage() {
  const [id, setId] = useState('z-str')
  const mag = id[0] === 'z' ? 12 : 16
  const crystal = useRef<IonCrystal>(null!)
  if (!crystal.current) crystal.current = new IonCrystal(TRAP_M25, 64, 6)
  const plot = useRef<PlotHandle>(null)
  const trace = useRef<[number, number, number][]>([])
  const acc = useRef(0)
  const modes = useMemo(() => {
    const ax = axialModes(TRAP_M25), rad = [...radialModes(TRAP_M25, 'x')!, ...radialModes(TRAP_M25, 'y')!]
    return MODES_M25.map(m => {
      const r = rad.find(q => q.id === m.id)
      const omega = r ? r.omega : m.id === 'z-com' ? ax.com.omega : ax.str.omega
      const mode = m.id === 'z-com' ? ax.com : ax.str
      const shift = r ? r.shiftPerQuantum : -(HBAR * omega * mode.b[1] ** 2) / (2 * M_AL * 299792458 ** 2)
      return { ...m, omega, shift }
    })
  }, [])
  useEffect(() => { enterStage('modes', 30); viz.trail = true }, [])
  useEffect(() => { crystal.current.exciteMode(id, 60); trace.current = []; viz.trailClear = true }, [id])
  const omega = modes.find(m => m.id === id)!.omega
  const axisIndex = id[0] === 'z' ? 2 : id[0] === 'x' ? 0 : 1
  useLoop(dt => {
    const c = crystal.current
    // One secular oscillation every two seconds on screen.
    acc.current += ((TWO_PI / omega / 2) / c.dt) * dt
    const n = Math.min(Math.floor(acc.current), 2000); acc.current -= n
    const d = spacing(TRAP_M25)
    for (let i = 0; i < n; i += 2) {
      c.step(2)
      const a = c.pos[axisIndex] + (axisIndex === 2 ? d / 2 : 0), b = c.pos[3 + axisIndex] - (axisIndex === 2 ? d / 2 : 0)
      trace.current.push([c.t * 1e6, a * 1e9, b * 1e9])
    }
    const tEnd = c.t * 1e6, span = 3 * (1e6 * TWO_PI) / omega
    while (trace.current.length > 1 && trace.current[0][0] < tEnd - span) trace.current.shift()
    writeIons(c, mag)
    viz.timeLens = `1 s on screen = ${fmtTime((TWO_PI / omega) / 2)} in the trap`
    viz.motionLens = `Motion magnified ×${mag}, 60 quanta`
    plot.current?.draw({
      xLabel: 'Time (µs)', yLabel: 'Displacement (nm)',
      series: [
        { label: 'Mg⁺', color: CHART.rose, points: trace.current.map(q => [q[0], q[1]]) },
        { label: 'Al⁺', color: CHART.ice, points: trace.current.map(q => [q[0], q[2]]) },
      ],
    })
  })
  return (
    <>
      <h2>Two ions, one motion</h2>
      <p>Coulomb repulsion locks the ions 3.9 µm apart. They no longer move independently: the pair has six collective modes, two along each axis, with the ions moving together (COM) or opposed (STR). This shared motion is the wire that will connect them.</p>
      <p>Because the two masses differ, the radial modes partly localize: in the opposed radial modes about 80 % of the mass-weighted motion is on the heavier Al⁺. Those are the modes that shift the clock most.</p>
      <Eq tex="\frac{\Delta\nu}{\nu}\Big|_{\text{per quantum}} = -\frac{\overline{|\dot u_{\text{Al}}|^2}}{c^2}" />
      <p>Here <M t="u_{\text{Al}}" /> is the exact Floquet mode function, from the propagator of the linearized equations over one RF period. Three trap parameters were fitted to the six measured frequencies. The shift-per-quantum column is then a <strong>prediction</strong>, including intrinsic micromotion.</p>
      <Dock>
      <table className="modes">
        <thead><tr><th scope="col">Mode</th><th scope="col">f sim (MHz)</th><th scope="col">f meas.</th><th scope="col">Shift sim (10⁻¹⁹)</th><th scope="col">meas.</th></tr></thead>
        <tbody>
          {modes.map(m => (
            <tr key={m.id} aria-selected={id === m.id}>
              <td><button type="button" aria-pressed={id === m.id} onClick={() => setId(m.id)}>{MODE_LABEL[m.id]}</button></td>
              <td>{(m.omega / TWO_PI / 1e6).toFixed(3)}</td><td>{m.fMHz.toFixed(2)}</td>
              <td>{(m.shift * 1e19).toFixed(2)}</td><td>{(m.shiftPerQuantum * 1e19).toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Measured values: Marshall et al. 2025, Table S2. Pick a mode to excite exactly that solution of the full equations.</p>
      <Plot ref={plot} label="Displacement of each ion from equilibrium versus time" />
</Dock>
    </>
  )
}

export function DopplerStage() {
  useReadoutRate()
  const [det, setDet] = useState(DETUNING_DOPPLER / GAMMA_MG), [sat, setSat] = useState(SAT_DOPPLER)
  const crystal = useRef<IonCrystal>(null!)
  if (!crystal.current) { crystal.current = new IonCrystal(TRAP_M25, 32, 8); crystal.current.thermalise(1); crystal.current.laser.on = true }
  const plot = useRef<PlotHandle>(null)
  const log = useRef<{ mg: [number, number][]; al: [number, number][] }>({ mg: [], al: [] })
  const batch = useRef(12000), win = useRef(0), epochT = useRef(0)
  const stat = useRef({ tMg: 1, tAl: 1, nCom: 0, nStr: 0, dil: 0 })
  useEffect(() => { enterStage('doppler', 34); viz.beams.cool = 1; viz.trail = true }, [])
  const reheat = () => {
    const c = crystal.current; c.thermalise(1); c.laser.on = true
    log.current = { mg: [], al: [] }; win.current = 0; epochT.current = 0; viz.trailClear = true
  }
  useLoop(() => {
    const c = crystal.current
    c.laser.detuning = det * GAMMA_MG; c.laser.saturation = sat
    const t0 = performance.now()
    const events = c.step(batch.current)
    const ms = performance.now() - t0
    batch.current = Math.max(2000, Math.min(60000, batch.current * (ms > 7 ? 0.9 : 1.05)))
    win.current += batch.current
    // Each statistics window is ~130 us of trap time.
    if (win.current > 300000) {
      win.current = 0
      const s = stat.current, q = c.axialQuanta(), k = 0.2
      s.tMg = c.temperature(0); s.tAl = c.temperature(1)
      s.nCom += k * (q.com - s.nCom); s.nStr += k * (q.str - s.nStr); s.dil += k * (c.timeDilation() - s.dil)
      log.current.mg.push([c.t * 1e3, s.tMg * 1e3]); log.current.al.push([c.t * 1e3, s.tAl * 1e3])
      c.resetStats()
      plot.current?.draw({
        xLabel: 'Trap time (ms)', yLabel: 'Temperature (mK)', yLog: true, yRange: [0.5, 3000],
        series: [
          { label: 'Mg⁺', color: CHART.rose, points: log.current.mg },
          { label: 'Al⁺, cooled only through Mg⁺', color: CHART.ice, points: log.current.al },
          { label: 'ħΓ/2k_B', color: CHART.gold, dash: [5, 5], points: [[0, (HBAR * GAMMA_MG) / (2 * KB) * 1e3], [c.t * 1e3, (HBAR * GAMMA_MG) / (2 * KB) * 1e3]] },
        ],
      })
    }
    const rms = Math.sqrt((KB * stat.current.tMg) / (M_MG * (2 * Math.PI * 3e6) ** 2))
    const mag = Math.min(40, 1.2e-6 / Math.max(rms, 1e-9))
    writeIons(c, mag)
    viz.photons += Math.min(events, 6)
    viz.mgGlow = 0.35 + Math.min(0.65, events / 25); viz.alGlow = 0.45
    viz.timeLens = `Trap time: ${fmtTime(c.t)}`
    viz.motionLens = `Motion magnified ×${mag.toFixed(0)}`
  })
  const c = crystal.current, s = stat.current
  const rate = (0.5 * GAMMA_MG * sat) / (1 + sat + 4 * det * det)
  return (
    <>
      <h2>Stopping an ion with light</h2>
      <p>Mg⁺ has a fast cycling transition at 279.6 nm, with <M t="\Gamma/2\pi=41.3" /> MHz. Tune a laser just below it and the Doppler shift does the rest: an ion moving into the beam sees the light closer to resonance, scatters more photons, and each photon carries momentum <M t="\hbar k" /> against its motion. Re-emission goes in random directions, which is what sets the limit.</p>
      <p>Al⁺ is never touched by this light. It cools only by exchanging momentum with Mg⁺ through their Coulomb coupling.</p>
      <Eq tex="R(\mathbf v) = \frac{\Gamma}{2}\,\frac{s}{1+s+4(\delta-\mathbf k\cdot\mathbf v)^2/\Gamma^2}" />
      <p>Every photon is simulated: the full RF trajectory runs with absorption and emission as random kicks at this rate, emission following the <M t="\sigma" />-dipole pattern <M t="1+\cos^2\theta" />. The final temperature is an outcome of the simulation, not an input.</p>
      <p>Try detuning above resonance. The same physics now pumps energy in, and the ions leave.</p>
      <Dock>
      <Slider label="Detuning" value={det} min={-3} max={0.5} step={0.01} onChange={setDet} format={v => `${v.toFixed(2)} Γ`} hint="The clock runs at −Γ/2, the theoretical optimum." />
      <Slider label="Saturation s" value={sat} min={0.02} max={2} step={0.002} onChange={setSat} format={v => v.toFixed(3)} hint="The clock campaign averaged 0.148." />
      <button type="button" onClick={reheat}>Heat the ions to 1 K and start again</button>
      {c.lost && <div className="notice" role="status"><p>The ions were driven out of the trap. Blue-detuned light heats instead of cools.</p><button type="button" onClick={() => { setDet(-0.5); reheat() }}>Reload at −Γ/2</button></div>}
      <Plot ref={plot} label="Ion temperature falling toward the Doppler limit as a function of trap time" />
      <Readouts items={[
        ['Mg⁺ temperature', `${(s.tMg * 1e3).toFixed(2)} mK`],
        ['Al⁺ temperature', `${(s.tAl * 1e3).toFixed(2)} mK`],
        ['Quanta, axial COM', s.nCom.toFixed(1), ' measured 8.22(48)'],
        ['Quanta, axial STR', s.nStr.toFixed(1), ' measured 4.50(19)'],
        ['Al⁺ time dilation', sci(s.dil), ' budget −1.146 × 10⁻¹⁷'],
        ['Scattering rate at rest', `${(rate / 1e6).toFixed(1)} M photons/s`],
        ['Photons so far', c.photons.toLocaleString('en-US')],
      ]} />
      <p className="hint">Time dilation is <M t="-\overline{v^2}/2c^2" /> of the Al⁺ ion in this very simulation: a single-ion atomic clock runs slow because the atom moves. A short window fluctuates; settle a while to compare. Kinetic temperatures run above <M t="\hbar\Gamma/2k_B" /> because the beam angle and micromotion add to the radial energy.</p>
</Dock>
    </>
  )
}

