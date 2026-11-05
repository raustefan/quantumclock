'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  BRIGHT_COUNTS, DARK_COUNTS, DETECT_US, HBAR, LIKELIHOOD_STOP, M_MG, MODES_M25, NU_CLOCK, PI_TIME_AL_US, PI_TIME_MG_US, READOUT_CYCLE_MS, TAU_3P0, TAU_3P1, TWO_PI,
} from '@/lib/physics/constants'
import { debyeWallerModes, LaserNoise, piOmega, probeExcitation, PROBE_COS, rabiHalfWidth, rabiLine, thermalCarrier } from '@/lib/physics/clock'
import { AL_P0, AL_P1, AL_S0, axialEtas, clebsch, meanN, OpticalPumping, QlsExperiment, SidebandCooler, thermal, type AxialId } from '@/lib/physics/quantum'
import { makeRng, TRAP_M25 } from '@/lib/physics/trap'
import { enterStage, viz } from '@/lib/viz'
import { fmtTime } from './stages-motion'
import { CHART, Choice, Dock, Eq, M, Plot, Readouts, sci, Slider, useLoop, useReadoutRate, type PlotHandle } from './ui'

const fracName = (m: number) => `${m < 0 ? '−' : '+'}${Math.abs(m * 2)}/2`

function ZeemanLadder({ pump, sign, purity }: { pump: OpticalPumping; sign: 1 | -1; purity: number }) {
  const W = 460, H = 214, gx = (i: number) => 95 + i * 54, ex = (j: number) => 41 + j * 54
  const gy = 160, ey = 62
  const lines: { x1: number; x2: number; o: number; c: string }[] = []
  for (let i = 0; i < 6; i++) for (const q of [-1, 1] as const) {
    const j = i - 2.5 + q + 3.5
    if (j < 0 || j > 7) continue
    const w = q === sign ? purity : 1 - purity
    if (w < 0.002) continue
    lines.push({ x1: gx(i), x2: ex(j), o: w * clebsch(2.5, i - 2.5, 1, q, 3.5, i - 2.5 + q) ** 2, c: CHART.ice })
  }
  return (
    <svg className="ladder" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Population of the six ground Zeeman states and eight excited states. The target stretched state holds ${(pump.stretched() * 100).toFixed(1)} percent.`}>
      {lines.map((l, i) => <line key={i} x1={l.x1} x2={l.x2} y1={gy} y2={ey} stroke={l.c} strokeOpacity={0.2 + 0.6 * l.o} strokeWidth={1 + 2 * l.o} />)}
      {Array.from(pump.excited).map((p, j) => (
        <g key={j}>
          <line x1={ex(j) - 20} x2={ex(j) + 20} y1={ey} y2={ey} stroke="#a89fce" strokeWidth={2} />
          <rect x={ex(j) - 18} y={ey - 2 - 30 * Math.min(1, p * 2)} width={36} height={30 * Math.min(1, p * 2)} fill={CHART.ice} rx={2} />
        </g>
      ))}
      {Array.from(pump.ground).map((p, i) => (
        <g key={i}>
          <line x1={gx(i) - 20} x2={gx(i) + 20} y1={gy} y2={gy} stroke="#a89fce" strokeWidth={2} />
          <rect x={gx(i) - 18} y={gy - 2 - 38 * p} width={36} height={38 * p} fill={CHART.gold} rx={2} />
          <text x={gx(i)} y={gy + 20} textAnchor="middle">{fracName(i - 2.5)}</text>
        </g>
      ))}
      <text x={2} y={18}>³P₁, F = 7/2, lifetime 300 µs</text>
      <text x={2} y={208}>¹S₀, F = 5/2, labelled by m_F</text>
    </svg>
  )
}

export function PrepStage() {
  useReadoutRate(15)
  const [sign, setSign] = useState<'plus' | 'minus'>('plus'), [purity, setPurity] = useState(0.998), [run, setRun] = useState(0)
  const pump = useRef<OpticalPumping>(null!)
  if (!pump.current) pump.current = new OpticalPumping(1)
  const plot = useRef<PlotHandle>(null), log = useRef<[number, number][]>([])
  const s: 1 | -1 = sign === 'plus' ? 1 : -1
  useEffect(() => { enterStage('prep', 20); viz.beams.al = 1 }, [])
  useEffect(() => { pump.current = new OpticalPumping(s); log.current = [] }, [s, run])
  useLoop(() => {
    const p = pump.current
    if (p.t > 0.03) { viz.beams.al = 0.1; return }
    viz.beams.al = 1
    for (let i = 0; i < 50; i++) p.advance(1e-6, purity, 5e4) // 50 us of ion time per frame
    log.current.push([p.t * 1e3, p.stretched()])
    let e = 0
    for (const x of p.excited) e += x
    viz.alGlow = 0.35 + 1.1 * e
    viz.timeLens = `Ion time: ${fmtTime(p.t)}`
    plot.current?.draw({ xLabel: 'Time (ms)', yLabel: 'In the target state', yRange: [0, 1], xRange: [0, 30], series: [{ label: 'Target state', color: CHART.gold, points: log.current }] })
  })
  const p = pump.current
  return (
    <>
      <h2>Preparing the clock ion</h2>
      <p>The clock transition needs one definite starting state. ¹S₀ has nuclear spin <M t="F=5/2" />, so six Zeeman states are all equally likely once the ion has been loaded. Circularly polarized 266.9 nm light on <M t="{}^1S_0\to{}^3P_1" /> fixes that: every absorption raises <M t="m_F" /> by one, while decay can return by <M t="0,\pm1" /> with odds set by the Clebsch-Gordan coefficients.</p>
      <Eq tex="\dot p_e = \sum_{g} R_0\, |\langle F_g m_g;\,1\,q\,|\,F_e m_e\rangle|^2 (p_g-p_e) \;-\; \frac{p_e}{\tau}" />
      <p>The ion random-walks upward until it reaches <M t="m_F=+5/2" />. There it can only reach <M t="m_F'=+7/2" />, and that state can only decay straight back. It is trapped in a closed cycle, the target. The next step uses this closed cycle too.</p>
      <p>Lower the polarization purity and watch the leak: the wrong-handed light keeps knocking the ion back down.</p>
      <Dock>
      <Choice label="Polarization" value={sign} onChange={setSign} options={[{ id: 'plus', label: 'σ⁺, target +5/2' }, { id: 'minus', label: 'σ⁻, target −5/2' }]} />
      <Slider label="Polarization purity" value={purity} min={0.7} max={1} step={0.001} onChange={setPurity} format={v => `${(v * 100).toFixed(1)} %`} />
      <button type="button" onClick={() => setRun(r => r + 1)}>Scramble the ion and pump again</button>
      <ZeemanLadder pump={p} sign={s} purity={purity} />
      <Plot ref={plot} height={150} label="Fraction of population in the stretched state over time" />
      <Readouts items={[
        ['In target state', `${(p.stretched() * 100).toFixed(2)} %`],
        ['Photons scattered', p.scattered.toFixed(1)],
      ]} />
      <p className="hint">The clock alternates between both targets, because the average of the <M t="\pm5/2" /> lines cancels the first-order magnetic shift. You&apos;ll see that at the lock.</p>
</Dock>
    </>
  )
}

type Cooling = 'doppler' | 'frozen' | 'ground'

export function ProbeStage() {
  useReadoutRate()
  const [T, setT] = useState(1), [det, setDet] = useState(0.3), [floorExp, setFloorExp] = useState(-16), [cool, setCool] = useState<Cooling>('doppler')
  const [result, setResult] = useState<null | { P: number; excited: boolean }>(null)
  const [running, setRunning] = useState(false)
  const plot = useRef<PlotHandle>(null)
  const trace = useRef<[number, number, number][]>([]), play = useRef(-1), shots = useRef<[number, number][]>([])
  const seed = useRef(10)
  useEffect(() => { enterStage('probe', 22); viz.bloom.visible = true; viz.bloom.x = 0; viz.bloom.y = 0; viz.bloom.z = -1; viz.bloom.trace = [] }, [])

  const modes = useMemo(() => {
    const nb = cool === 'ground' ? [0.015, 0.0035, 0.0099, 0.009, 0.0078, 0.0049] : MODES_M25.map(m => m.nbar)
    return debyeWallerModes(TRAP_M25, nb, PROBE_COS)
  }, [cool])
  const omega0 = useMemo(() => piOmega(T, modes), [T, modes])
  const width = useMemo(() => rabiHalfWidth(T), [T])
  const carrier = useMemo(() => modes.reduce((f, m) => f * thermalCarrier(m), 1), [modes])

  const noiseFor = (rng: () => number, segments: number) => {
    const l = new LaserNoise(10 ** floorExp, 0, Math.floor(rng() * 1e9)), h = T / segments, a = new Float64Array(segments)
    let mean = 0
    for (let i = 0; i < segments; i++) { a[i] = l.value() * NU_CLOCK; mean += a[i] / segments; l.advance(h) }
    // The servo has already steered out the laser's slow wander, so only the noise within this pulse remains.
    for (let i = 0; i < segments; i++) a[i] -= mean
    return a
  }

  // Monte Carlo scan with everything on, compared with the textbook formula.
  useEffect(() => {
    const rng = makeRng(seed.current++), span = 3 / T, sim: [number, number][] = [], ideal: [number, number][] = []
    for (let i = 0; i <= 44; i++) {
      const d = -span + (2 * span * i) / 44
      let P = 0
      for (let k = 0; k < 36; k++) {
        const noise = noiseFor(rng, 48), h = T / 48
        P += probeExcitation(rng, t => d + noise[Math.min(47, Math.floor(t / h))], { T, omega0, segments: 48, modes, continuousCooling: cool === 'doppler' })
      }
      sim.push([d, P / 36])
    }
    for (let i = 0; i <= 200; i++) { const d = -span + (2 * span * i) / 200; ideal.push([d, rabiLine(d, T)]) }
    scan.current = { sim, ideal }
    shots.current = []
    draw()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [T, floorExp, modes, omega0])
  const scan = useRef<{ sim: [number, number][]; ideal: [number, number][] }>({ sim: [], ideal: [] })
  const draw = () => plot.current?.draw({
    xLabel: 'Laser detuning (Hz)', yLabel: 'Excitation', yRange: [0, 1.02], marker: det,
    series: [
      { label: 'Ideal Rabi line', color: CHART.ink, dash: [4, 4], points: scan.current.ideal },
      { label: 'Simulated with motion, decay, laser noise', color: CHART.gold, points: scan.current.sim },
      { label: 'Your probes', color: CHART.rose, dots: true, points: shots.current },
    ],
  })
  useEffect(draw)

  const fire = () => {
    const rng = makeRng(seed.current++), noise = noiseFor(rng, 240), h = T / 240
    const tr: [number, number, number][] = []
    const P = probeExcitation(rng, t => det + noise[Math.min(239, Math.floor(t / h))], { T, omega0, segments: 240, modes, continuousCooling: cool === 'doppler' }, (_, x, y, z) => tr.push([x, y, z]))
    trace.current = tr; play.current = 0; viz.bloom.trace = []; setResult(null); setRunning(true)
    pending.current = { P, excited: rng() < P }
    viz.beams.clock = 1
  }
  const pending = useRef<{ P: number; excited: boolean } | null>(null)

  useLoop(() => {
    viz.timeLens = running ? `Playing the ${fmtTime(T)} pulse in 4 s` : ''
    if (play.current < 0) return
    const tr = trace.current, i = Math.min(tr.length - 1, Math.floor(play.current))
    const [x, y, z] = tr[i]
    viz.bloom.x = x; viz.bloom.y = y; viz.bloom.z = z
    viz.bloom.trace = tr.slice(0, i + 1)
    viz.alGlow = 0.3 + 0.5 * ((1 + z) / 2)
    play.current += tr.length / (60 * 4)
    if (play.current >= tr.length) {
      play.current = -1
      const r = pending.current!
      viz.bloom.x = 0; viz.bloom.y = 0; viz.bloom.z = r.excited ? 1 : -1; viz.beams.clock = 0
      shots.current.push([det, r.P])
      setResult(r); setRunning(false)
    }
  })
  return (
    <>
      <h2>Asking the atom</h2>
      <p>This is the clock. A single pulse of 267.4 nm light, one full second long, tries to turn ¹S₀ into ³P₀. With a laser exactly on resonance, it succeeds. If the laser is off by even a fraction of a hertz in over a quadrillion, it partly fails. That difference is the signal.</p>
      <Eq tex="P_e(\delta) = \frac{\Omega^2}{\Omega^2+\delta^2}\,\sin^2\!\Bigl(\tfrac{T}{2}\sqrt{\Omega^2+\delta^2}\Bigr)" />
      <p>On the Bloch sphere, the south pole is ¹S₀ and the north pole ³P₀. The arrow rotates about an axis tilted by the detuning. With <M t="\Omega T=\pi" />, that formula is the dashed curve on the chart. The gold curve is the exact numerical solution with what the formula ignores: the <M t="\tau=20.6" /> s spontaneous decay of ³P₀, frequency noise of the laser, and the Rabi rate changing with the ion&apos;s motion, <M t="\Omega_{\{n\}}=\Omega_0\prod_m\langle n_m|e^{i\eta_m(a_m+a_m^\dagger)}|n_m\rangle" />.</p>
      <p>The record clock keeps Doppler cooling on during the whole probe. Over a second, a sideband-cooled ion would heat past the Doppler limit anyway. Cooling continuously also averages the motional dephasing away. Switch to frozen motion to see what that would otherwise cost.</p>
      <Dock>
      <Slider label="Probe duration" value={T} min={0.05} max={2} step={0.01} onChange={v => { setT(v); setDet(Math.min(det, 2.5 / v)) }} format={v => `${v.toFixed(2)} s`} hint={`Line width ${(2 * width.hwhm).toFixed(2)} Hz. Quality factor ${sci(NU_CLOCK / (2 * width.hwhm), 1)}.`} />
      <Slider label="Laser detuning" value={det} min={-2.5 / T} max={2.5 / T} step={0.01 / T} onChange={setDet} format={v => `${v.toFixed(2)} Hz`} />
      <Slider label="Laser flicker floor" value={floorExp} min={-17} max={-14.5} step={0.1} onChange={setFloorExp} format={v => sci(10 ** v, 1)} hint={`That is ${(10 ** floorExp * NU_CLOCK).toFixed(2)} Hz at the clock frequency.`} />
      <Choice label="Ion motion during the probe" value={cool} onChange={setCool} options={[{ id: 'doppler', label: 'Doppler cooled (2025)' }, { id: 'frozen', label: 'Frozen thermal' }, { id: 'ground', label: 'Near ground state' }]} />
      <div className="actions">
        <button type="button" className="primary" disabled={running} onClick={fire}>{running ? 'Probing' : 'Fire one probe'}</button>
      </div>
      {result && (
        <p className="result" role="status">Probability of excitation {(result.P * 100).toFixed(1)} %. This shot measured <strong>{result.excited ? '³P₀' : '¹S₀'}</strong>, and the superposition is gone. One atom answers only yes or no, so a clock needs many shots to estimate a frequency. That sets its noise.</p>
      )}
      <Plot ref={plot} label="Excitation probability versus laser detuning" />
      <Readouts items={[
        ['Rabi frequency, atom at rest', `${(omega0 / TWO_PI).toFixed(3)} Hz`],
        ['Motional slowdown of carrier', `${carrier.toFixed(3)}`],
        ['Decay during pulse', `${((1 - Math.exp(-T / TAU_3P0)) * 100).toFixed(1)} %`],
      ]} />
</Dock>
    </>
  )
}

export function SidebandStage() {
  useReadoutRate(12)
  const [mode, setMode] = useState<AxialId>('z-com'), [started, setStarted] = useState(false), [pulse, setPulse] = useState(0)
  const cooler = useRef<SidebandCooler | null>(null)
  const dist = useRef<[number, number][]>([]), trend = useRef<[number, number][]>([])
  const nextAt = useRef(0)
  const hist = useRef<PlotHandle>(null), line = useRef<PlotHandle>(null)
  const nbar0 = mode === 'z-com' ? MODES_M25[0].nbar : MODES_M25[1].nbar
  const etas = useMemo(() => axialEtas(TRAP_M25, mode), [mode])
  const sigma0 = useMemo(() => Math.abs(etas.b[0]) * Math.sqrt(HBAR / (2 * M_MG * etas.omega)) * 1e6, [etas])
  const reset = () => {
    setStarted(false); setPulse(0); cooler.current = null; trend.current = [[0, nbar0]]
    paint(thermal(nbar0, 50))
    viz.wave = sigma0 * Math.sqrt(2 * nbar0 + 1) * 90
  }
  const paint = (p: ArrayLike<number>) => {
    dist.current = Array.from(p).slice(0, 36).map((v, n) => [n, Math.max(v, 1e-9)])
    hist.current?.draw({ xLabel: 'Motional quantum number n', yLabel: 'P(n)', yLog: true, yRange: [1e-4, 1], xRange: [-1, 36], series: [{ label: 'Occupation', color: CHART.gold, bars: true, points: dist.current }] })
    line.current?.draw({ xLabel: 'Cooling pulse', yLabel: 'Mean quanta', yLog: true, xRange: [0, 40], yRange: [0.03, 15], series: [{ label: 'Mean quanta', color: CHART.ice, points: trend.current }] })
  }
  useEffect(() => { enterStage('sideband', 16); viz.motionLens = 'Wave packet width magnified ×90' }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [mode])
  useLoop(() => {
    const now = performance.now()
    if (!started || pulse >= 40) {
      if (now > nextAt.current) { viz.beams.ramanA = viz.beams.ramanB = 0; viz.beams.repump = 0 }
      return
    }
    const sinceFire = nextAt.current - now
    viz.beams.repump = sinceFire < 60 && sinceFire > 0 ? 1 : 0
    if (now < nextAt.current) return
    if (!cooler.current) cooler.current = new SidebandCooler(TRAP_M25, mode, nbar0)
    const c = cooler.current, r = c.pulse(pulse < 15 ? 2 : 1)
    setPulse(pulse + 1)
    trend.current.push([pulse + 1, r.nbar])
    paint(r.p)
    viz.beams.ramanA = viz.beams.ramanB = 1
    viz.photons += 4
    viz.mgGlow = 0.8
    viz.wave = sigma0 * Math.sqrt(2 * r.nbar + 1) * 90
    viz.timeLens = `Ion time: ${fmtTime(c.elapsedUs * 1e-6)}`
    nextAt.current = now + 170
  })
  const c = cooler.current
  const nbar = c ? meanN(c.p) : nbar0, p0 = c ? c.p[0] : 1 / (1 + nbar0)
  return (
    <>
      <h2>Down to the ground state</h2>
      <p>The answer now sits in the Al⁺ electrons, and has to travel to Mg⁺ through the ions&apos; shared motion as exactly one phonon. That only works if the motion starts with zero phonons. Doppler cooling leaves about eight, so one more stage is needed.</p>
      <p>A pair of Raman beams 50 GHz from resonance drive Mg⁺ between its two hyperfine ground states while taking phonons out of the motion. <M t="\Delta n=-2" /> pulses work where the first-order coupling is weak, then <M t="\Delta n=-1" /> pulses finish the job. After every pulse a short optical repump resets the spin. It costs three photons&apos; worth of recoil but carries the entropy away.</p>
      <Eq tex="\begin{aligned}\Omega_{n,n'} &= \Omega\,\bigl|\langle n'|e^{i\eta(a+a^\dagger)}|n\rangle\bigr| \\ &= \Omega\, e^{-\eta^2/2}\,\eta^{|n-n'|}\sqrt{\tfrac{n_<!}{n_>!}}\;L_{n_<}^{|n-n'|}(\eta^2)\end{aligned}" />
      <p>This matrix element goes to zero at some high <M t="n" />, stranding population there, which is why the sequence starts at second order. The simulation uses the exact all-order element above and keeps the off-resonant carrier. That carrier shifts the sideband by tens of kHz, so the drive is first calibrated by scanning, just as in the lab.</p>
      <Dock>
      <Choice label="Axial mode" value={mode} onChange={setMode} options={[{ id: 'z-com', label: '2.16 MHz, together' }, { id: 'z-str', label: '3.75 MHz, opposed' }]} />
      <div className="actions">
        <button type="button" className="primary" disabled={started && pulse < 40} onClick={() => { if (pulse >= 40) reset(); else setStarted(true) }}>
          {pulse >= 40 ? 'Doppler cool again' : started ? 'Cooling' : 'Run 15 + 25 pulses'}
        </button>
      </div>
      <Plot ref={hist} height={170} label="Probability of each motional Fock state" />
      <Plot ref={line} height={130} label="Mean motional quanta after each pulse" />
      <Readouts items={[
        ['Pulse', pulse === 0 ? 'none yet' : `${pulse} of 40, ${pulse <= 15 ? 'second' : 'first'} order`],
        ['Mean quanta', nbar.toFixed(nbar < 1 ? 3 : 2)],
        ['Ground-state population', `${(p0 * 100).toFixed(1)} %`],
        ['Lamb-Dicke η, Raman', etas.raman.toFixed(3), ` from C17's 0.18 at 2.7 MHz`],
      ]} />
      <p className="hint">The cloud on each ion is the motional width of this mode, <M t="\sigma_0\sqrt{2\bar n+1}" />, magnified 90 times. The real <M t="\sigma_0" /> is about 7 nm, about a thousandth of the distance between the ions.</p>
</Dock>
    </>
  )
}

const JOINT: { al: number; mg: number; n: number; name: string }[] = [
  { al: AL_S0, mg: 0, n: 0, name: '¹S₀, ↓, n = 0' },
  { al: AL_P1, mg: 0, n: 1, name: '³P₁, ↓, n = 1' },
  { al: AL_P1, mg: 1, n: 0, name: '³P₁, ↑, n = 0' },
  { al: AL_S0, mg: 1, n: 0, name: '¹S₀, ↑, n = 0' },
  { al: AL_P0, mg: 0, n: 0, name: '³P₀, ↓, n = 0' },
]

export function TransferStage() {
  useReadoutRate(15)
  const [state, setState] = useState<'S0' | 'P0'>('S0'), [running, setRunning] = useState(false), [modeId, setModeId] = useState<AxialId>('z-com')
  const exp = useRef<QlsExperiment | null>(null), plot = useRef<PlotHandle>(null), log = useRef<{ a: [number, number][]; n: [number, number][]; m: [number, number][] }>({ a: [], n: [], m: [] })
  const seed = useRef(3), offsetUs = useRef(0), lastPhase = useRef('al')
  useEffect(() => { enterStage('transfer', 15); viz.motionLens = 'Wave packet width magnified ×90' }, [])
  const start = () => {
    const e = new QlsExperiment(TRAP_M25, modeId, seed.current++)
    e.start(state === 'S0' ? AL_S0 : AL_P0, thermal(0.015, e.N))
    exp.current = e; log.current = { a: [], n: [], m: [] }; offsetUs.current = 0; lastPhase.current = 'al'; setRunning(true)
  }
  const sigma0 = useMemo(() => { const e = axialEtas(TRAP_M25, modeId); return Math.abs(e.b[0]) * Math.sqrt(HBAR / (2 * M_MG * e.omega)) * 1e6 }, [modeId])
  useLoop(() => {
    const e = exp.current
    viz.beams.al = running && e?.phase === 'al' ? 1 : 0
    viz.beams.ramanA = viz.beams.ramanB = running && e?.phase === 'mg' ? 1 : 0
    if (!e || !running) return
    const more = e.advance(6)
    if (e.phase !== lastPhase.current) { offsetUs.current += PI_TIME_AL_US; lastPhase.current = e.phase }
    const t = (e.phase === 'done' ? PI_TIME_AL_US + PI_TIME_MG_US : offsetUs.current + e.t * 1e6)
    const pops = e.alPops(), up = e.probUp()
    let nAvg = 0
    for (let al = 0; al < 3; al++) for (let mg = 0; mg < 2; mg++) for (let n = 0; n < e.N; n++) nAvg += n * e.population(al, mg, n)
    log.current.a.push([t, pops[AL_P1]]); log.current.n.push([t, nAvg]); log.current.m.push([t, up])
    viz.alGlow = 0.3 + 0.9 * pops[AL_P1]; viz.mgGlow = 0.25 + 0.75 * (1 - up)
    viz.wave = sigma0 * Math.sqrt(2 * nAvg + 1) * 90
    viz.timeLens = `Ion time: ${t.toFixed(1)} µs`
    plot.current?.draw({
      xLabel: 'Time (µs)', yLabel: 'Population', yRange: [0, 1.05], xRange: [0, PI_TIME_AL_US + PI_TIME_MG_US],
      series: [
        { label: 'Al⁺ in ³P₁', color: CHART.ice, points: log.current.a },
        { label: 'One phonon', color: CHART.gold, points: log.current.n },
        { label: 'Mg⁺ flipped to ↑', color: CHART.rose, points: log.current.m },
      ],
    })
    if (!more) setRunning(false)
  })
  const e = exp.current
  return (
    <>
      <h2>Quantum logic: one phonon as the wire</h2>
      <p>Mg⁺ needs to learn one thing: is Al⁺ in ¹S₀ or in ³P₀? Two pulses tell it, proposed by Wineland and first shown by Schmidt and colleagues in 2005.</p>
      <ol className="seq">
        <li><strong>Pulse on Al⁺, {PI_TIME_AL_US} µs.</strong> A blue-sideband π pulse on ¹S₀ → ³P₁. If Al⁺ is in ¹S₀, it is excited and adds a phonon. If it is in ³P₀, the light has nothing to couple to, and nothing happens.</li>
        <li><strong>Pulse on Mg⁺, {PI_TIME_MG_US} µs.</strong> A red-sideband π pulse. If there is a phonon, Mg⁺ absorbs it and flips to ↑. If there is none, there is no ground state to go to and it stays ↓.</li>
      </ol>
      <Eq tex="|{}^1S_0\rangle|{\downarrow}\rangle|0\rangle \to |{}^3P_1\rangle|{\downarrow}\rangle|1\rangle \to |{}^3P_1\rangle|{\uparrow}\rangle|0\rangle" />
      <Eq tex="|{}^3P_0\rangle|{\downarrow}\rangle|0\rangle \to |{}^3P_0\rangle|{\downarrow}\rangle|0\rangle \to |{}^3P_0\rangle|{\downarrow}\rangle|0\rangle" />
      <p>The simulation solves the Schrödinger equation for the joint state of Al⁺ (3 levels), Mg⁺ (2 levels) and the motion (9 Fock states). Every off-resonant carrier and sideband is included to all orders. ³P₁ decays with its 300 µs lifetime as Monte Carlo quantum jumps with real photon recoil, so each run really is one experiment and some of them go wrong.</p>
      <p>A phonon state has no mean displacement: <M t="\langle n|x|n\rangle=0" />. So the ions don&apos;t visibly oscillate. The wave packet instead swells by <M t="\sqrt3" /> when <M t="n=1" />, and that&apos;s what you see.</p>
      <Dock>
      <Choice label="Al⁺ starts in" value={state} onChange={setState} options={[{ id: 'S0', label: '¹S₀, not excited' }, { id: 'P0', label: '³P₀, excited by the probe' }]} />
      <Choice label="Shared mode" value={modeId} onChange={setModeId} options={[{ id: 'z-com', label: 'Together' }, { id: 'z-str', label: 'Opposed' }]} />
      <div className="actions">
        <button type="button" className="primary" disabled={running} onClick={start}>{running ? 'Transferring' : 'Run the transfer'}</button>
      </div>
      <Plot ref={plot} label="Populations during the transfer: Al excited, phonon, and Mg flipped" />
      {e && (
        <div className="bars" role="group" aria-label="Population of the main joint states">
          {JOINT.map(j => {
            const p = e.population(j.al, j.mg, j.n)
            return <div key={j.name} className="bar"><span>{j.name}</span><i><b style={{ width: `${p * 100}%` }} /></i><em>{(p * 100).toFixed(1)} %</em></div>
          })}
        </div>
      )}
      {e?.phase === 'done' && <p className="result" role="status">Mg⁺ ends {(e.probUp() * 100).toFixed(1)} % in ↑, which is dark when probed. {e.decays > 0 ? 'A ³P₁ decay happened during this run.' : ''}</p>}
      <p className="hint">Pulse times follow the published Al⁺ and Be⁺ experiments (Rosenband 2007); the Mg⁺ time isn&apos;t published and is set consistent with Brewer 2019&apos;s sequence.</p>
</Dock>
    </>
  )
}

const logPoisson = (k: number, mu: number) => {
  let f = 0
  for (let i = 2; i <= k; i++) f += Math.log(i)
  return k * Math.log(mu) - mu - f
}
const poisson = (rng: () => number, mu: number) => {
  const L = Math.exp(-mu); let k = 0, p = 1
  do { k++; p *= rng() } while (p > L)
  return k - 1
}

export function DetectStage() {
  useReadoutRate(12)
  const [truth, setTruth] = useState<'S0' | 'P0' | 'super'>('super'), [tech, setTech] = useState(0.13)
  const cal = useRef({ s: 0, p: 0, n: 0 }), expS = useRef<QlsExperiment | null>(null)
  const [runs, setRuns] = useState({ n: 0, right: 0, cycles: 0, undecided: 0 })
  const [playing, setPlaying] = useState<null | { cycles: number; logLR: number; kBright: boolean; verdict: string | null; truth: number; photons: number }>(null)
  const hist = useRef({ bright: new Float64Array(26), dark: new Float64Array(26) })
  const traj = useRef<[number, number][]>([[0, 0]])
  const pPlot = useRef<PlotHandle>(null), lPlot = useRef<PlotHandle>(null)
  const rng = useRef(makeRng(41)), nextAt = useRef(0)
  useEffect(() => { enterStage('detect', 26) }, [])
  const CAL_N = 40
  const pDark = (al: number) => {
    const c = cal.current
    const ideal = c.n ? (al === AL_S0 ? c.s : c.p) / (c.n / 2) : al === AL_S0 ? 1 : 0
    return al === AL_S0 ? ideal * (1 - tech) : ideal + (1 - ideal) * tech * 0.2
  }

  const cycle = (al: number) => {
    const dark = rng.current() < pDark(al)
    const k = poisson(rng.current, dark ? DARK_COUNTS : BRIGHT_COUNTS)
    const ll = (s: number) => {
      const pd = pDark(s)
      return Math.log(pd * Math.exp(logPoisson(k, DARK_COUNTS)) + (1 - pd) * Math.exp(logPoisson(k, BRIGHT_COUNTS)))
    }
    return { k, dark, dLR: ll(AL_S0) - ll(AL_P0) }
  }
  // One measurement of the Al+ state, with a 3P0 decay chance each cycle.
  const measure = (startState: number) => {
    let al = startState, L = 0, cycles = 0
    const stop = Math.log(LIKELIHOOD_STOP)
    while (Math.abs(L) < stop && cycles < 60) {
      const c = cycle(al); L += c.dLR; cycles++
      if (al === AL_P0 && rng.current() < READOUT_CYCLE_MS * 1e-3 / TAU_3P0) al = AL_S0
    }
    return { verdict: L > 0 ? AL_S0 : AL_P0, cycles }
  }
  const pick = () => truth === 'S0' ? AL_S0 : truth === 'P0' ? AL_P0 : rng.current() < 0.5 ? AL_S0 : AL_P0

  useLoop(() => {
    // Calibrate each cycle's dark probability by running the real two-pulse sequence.
    const c = cal.current
    if (c.n < CAL_N) {
      if (!expS.current) expS.current = new QlsExperiment(TRAP_M25, 'z-com', 91)
      const e = expS.current, al = c.n % 2 ? AL_P0 : AL_S0
      e.start(al, thermal(0.015, e.N)); while (e.advance(256));
      if (al === AL_S0) c.s += e.probUp(); else c.p += e.probUp()
      c.n++
    }
    const P = playing, now = performance.now()
    viz.mgGlow = Math.max(0.2, viz.mgGlow * 0.92)
    if (P && !P.verdict && now > nextAt.current) {
      nextAt.current = now + 480
      const res = cycle(P.truth)
      const cycles = P.cycles + 1, logLR = P.logLR + res.dLR
      traj.current.push([cycles, logLR / Math.LN10])
      viz.photons += res.k * 2
      viz.mgGlow = res.k >= 3 ? 1.1 : 0.25
      const done = Math.abs(logLR) >= Math.log(LIKELIHOOD_STOP) || cycles >= 40
      const verdict = done ? (logLR > 0 ? '¹S₀' : '³P₀') : null
      setPlaying({ cycles, logLR, kBright: !res.dark, verdict, truth: P.truth, photons: res.k })
      if (done) setRuns(r => ({ n: r.n + 1, right: r.right + ((logLR > 0 ? AL_S0 : AL_P0) === P.truth ? 1 : 0), cycles: r.cycles + cycles, undecided: r.undecided }))
    }
    lPlot.current?.draw({
      xLabel: 'Detection cycle', yLabel: 'log₁₀ odds, ¹S₀ over ³P₀', xRange: [0, Math.max(12, traj.current.length)], yRange: [-4.5, 4.5],
      series: [
        { label: 'This measurement', color: CHART.gold, points: traj.current },
        { label: 'Stop at 1000 to 1', color: CHART.ink, dash: [4, 4], points: [[0, 3], [60, 3], [NaN, NaN], [0, -3], [60, -3]] },
      ],
    })
  })
  useEffect(() => {
    const h = hist.current
    for (let i = 0; i < 26; i++) { h.dark[i] = Math.exp(logPoisson(i, DARK_COUNTS)); h.bright[i] = Math.exp(logPoisson(i, BRIGHT_COUNTS)) }
    pPlot.current?.draw({
      xLabel: `Photons in ${DETECT_US} µs`, yLabel: 'Probability', xRange: [-1, 22], yRange: [0, 0.45],
      series: [
        { label: 'Mg⁺ dark, ↑', color: CHART.violet, bars: true, points: Array.from(h.dark).map((v, i) => [i, v] as [number, number]) },
        { label: 'Mg⁺ bright, ↓', color: CHART.rose, bars: true, points: Array.from(h.bright).map((v, i) => [i, v] as [number, number]) },
      ],
    })
  }, [])
  const measureOne = () => { traj.current = [[0, 0]]; nextAt.current = 0; setPlaying({ cycles: 0, logLR: 0, kBright: false, verdict: null, truth: pick(), photons: 0 }) }
  const measureMany = () => {
    const out = { ...runs }
    for (let i = 0; i < 5000; i++) { const t = pick(), m = measure(t); out.n++; out.cycles += m.cycles; if (m.verdict === t) out.right++ }
    setRuns(out)
  }
  useEffect(() => { setRuns({ n: 0, right: 0, cycles: 0, undecided: 0 }) }, [tech, truth])
  const c = cal.current
  return (
    <>
      <h2>Asking the question until sure</h2>
      <p>On the cycling transition, a ↓ Mg⁺ scatters photons, and a lens collects a few. A ↑ Mg⁺ is 1.79 GHz off resonance and stays dark. In 250 µs, about eight photons are counted from bright, and about 0.9 from dark.</p>
      <p>One round isn&apos;t reliable: at NIST a single cycle errs about 15 % of the time, more than the ideal physics alone. But the ³P₀ / ¹S₀ question is a <strong>quantum non-demolition</strong> measurement. ³P₁ decays back to ¹S₀ in 300 µs, while ³P₀ lives 20.6 s, so the state survives the questioning, and it can be asked again.</p>
      <Eq tex="\log L_{k+1} = \log L_k + \log\frac{P(c_k\,|\,{}^1S_0)}{P(c_k\,|\,{}^3P_0)}" />
      <p>Each round is scored by Bayes&apos; rule, and the sequence stops once the odds pass 1000 to 1. Here <M t="c_k" /> is the photon count of round <M t="k" />. Hume and colleagues reported 99.94 % fidelity in about 6.5 rounds of about 2 ms each, using Be⁺ as the logic ion. Run 5000 measurements to compare: this simulation lands on the same fidelity in somewhat fewer rounds.</p>
      <Dock>
      <Choice label="Al⁺ was left in" value={truth} onChange={setTruth} options={[{ id: 'super', label: 'Equal superposition' }, { id: 'S0', label: '¹S₀' }, { id: 'P0', label: '³P₀' }]} />
      <Slider label="Technical error per cycle" value={tech} min={0} max={0.35} step={0.01} onChange={setTech} format={v => `${(v * 100).toFixed(0)} %`} hint={`The simulated pulses alone err ${c.n ? (100 * (1 - c.s / (c.n / 2))).toFixed(1) : '…'} % on ¹S₀. Pointing and intensity noise aren't modelled, so this slider adds them. The default gives the published 15 %.`} />
      <div className="actions">
        <button type="button" className="primary" onClick={measureOne} disabled={!!playing && !playing.verdict || c.n < CAL_N}>{c.n < CAL_N ? 'Calibrating' : 'Measure once, slowly'}</button>
        <button type="button" onClick={measureMany} disabled={c.n < CAL_N}>Measure 5000 times</button>
      </div>
      {playing && (
        <p className="result" role="status">
          Round {playing.cycles}: {playing.photons} photons. {playing.verdict
            ? <>Verdict <strong>{playing.verdict}</strong>, which is {playing.verdict === (playing.truth === AL_S0 ? '¹S₀' : '³P₀') ? 'correct' : 'wrong'}. {truth === 'super' ? 'The superposition collapsed on the first round.' : ''}</>
            : `Odds ${Math.exp(Math.abs(playing.logLR)).toFixed(0)} to 1 so far.`}
        </p>
      )}
      <Plot ref={lPlot} height={170} label="Log likelihood ratio versus detection cycle" />
      <Plot ref={pPlot} height={140} label="Photon count distributions for bright and dark Mg ion" />
      <Readouts items={[
        ['Measurements', runs.n.toLocaleString('en-US')],
        ['Correct', runs.n ? `${((100 * runs.right) / runs.n).toFixed(2)} %` : 'none yet', ' Hume 2007: 99.94 %'],
        ['Mean rounds', runs.n ? (runs.cycles / runs.n).toFixed(2) : 'none yet', ' Hume 2007: 6.54'],
      ]} />
      <p className="hint">Photon counts: Chen 2017. The Al⁺ lifetime of 3P1 (τ = {TAU_3P1 * 1e6} µs) sets the shortest useful round.</p>
</Dock>
    </>
  )
}
