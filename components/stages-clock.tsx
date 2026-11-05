'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { B_FIELD_MT, BUDGET_TOTAL, C2_HZ_PER_MT2, DUTY_M25, INSTABILITY_M25, MODES_M25, NU_CLOCK, T_BBR, TWO_PI, ZEEMAN_SPLIT_HZ_PER_MT } from '@/lib/physics/constants'
import { allan, bbrShift, ClockServo, qpnLimit, quadraticZeeman, redshift, velocityShift } from '@/lib/physics/clock'
import { axialModes, radialModes, TRAP_M25 } from '@/lib/physics/trap'
import { enterStage, viz } from '@/lib/viz'
import { CHART, Dock, Eq, M, Plot, Readouts, sci, Slider, useLoop, useReadoutRate, type PlotHandle } from './ui'

const FREP = 250e6 // illustrative comb repetition rate; the comb's actual rate isn't given in the clock papers

export function LockStage() {
  useReadoutRate(8)
  const [T, setT] = useState(1), [floorExp, setFloorExp] = useState(-16), [gain, setGain] = useState(0.25), [speed, setSpeed] = useState(40), [drift, setDrift] = useState(0), [B, setB] = useState(B_FIELD_MT)
  const seed = useRef(77)
  const make = () => new ClockServo({ T, duty: DUTY_M25, gain, laserFloor: 10 ** floorExp, driftPerS: drift * 1e-19, bMilliT: B, continuousCooling: true, segments: 48, seed: seed.current++ })
  const servo = useRef<ClockServo>(null!)
  if (!servo.current) servo.current = make()
  const aPlot = useRef<PlotHandle>(null), yPlot = useRef<PlotHandle>(null), lastDraw = useRef(0)
  useEffect(() => { enterStage('lock', 2600); viz.beams.clock = 0.7 }, [])
  useEffect(() => { servo.current = make() /* changing the probe restarts the record */ }, [T]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { servo.current.setOptions({ gain, laserFloor: 10 ** floorExp, driftPerS: drift * 1e-19, bMilliT: B }) }, [gain, floorExp, drift, B])
  const stats = useRef({ coef: 0, tMax: 0 })
  useLoop(() => {
    const s = servo.current
    const before = s.excitations
    for (let i = 0; i < speed; i++) s.cycle()
    viz.alGlow = 0.3 + 0.7 * Math.min(1, (s.excitations - before) / Math.max(1, speed))
    viz.beams.clock = 0.35 + 0.65 * Math.random() * 0.4
    viz.timeLens = `Clock time: ${s.t < 3600 ? `${s.t.toFixed(0)} s` : `${(s.t / 3600).toFixed(2)} h`}, ${speed * 75} × real time`
    const now = performance.now()
    if (now - lastDraw.current < 300 || s.y.length < 16) return
    lastDraw.current = now
    const tau0 = T / DUTY_M25
    const ad = allan(s.y, tau0)
    const qpn = qpnLimit(T, tau0)
    const taus = ad.map(a => a.tau)
    if (taus.length) {
      const tEnd = taus[taus.length - 1]
      aPlot.current?.draw({
        xLabel: 'Averaging time τ (s)', yLabel: 'Allan deviation', xLog: true, yLog: true, xRange: [1, Math.max(1e3, tEnd)], yRange: [1e-19, 1e-14],
        series: [
          { label: 'This clock, live', color: CHART.gold, points: ad.map(a => [a.tau, a.adev]) },
          { label: 'Quantum projection noise', color: CHART.violet, dash: [4, 4], points: [[1, qpn], [1e6, qpn / 1e3]] },
          { label: 'Measured 3.5×10⁻¹⁶/√τ', color: CHART.rose, dash: [2, 4], points: [[1, INSTABILITY_M25], [1e6, INSTABILITY_M25 / 1e3]] },
        ],
      })
      const tail = ad.filter(a => a.tau > 100 && a.tau < tEnd / 4)
      if (tail.length) stats.current.coef = Math.exp(tail.reduce((c, a) => c + Math.log(a.adev * Math.sqrt(a.tau)), 0) / tail.length)
    }
    // Last stretch of the clock's output, averaged so a screen pixel means something.
    const N = 300, y = s.y, stride = Math.max(1, Math.floor(y.length / N))
    const pts: [number, number][] = []
    for (let i = 0; i + stride <= y.length; i += stride) {
      let m = 0
      for (let j = 0; j < stride; j++) m += y[i + j]
      pts.push([(i + stride / 2) * tau0, m / stride])
    }
    yPlot.current?.draw({ xLabel: 'Clock time (s)', yLabel: 'Fractional frequency error', yFormat: v => v.toExponential(0), series: [{ label: 'Clock output', color: CHART.ice, points: pts }] })
  })
  const s = servo.current
  const qpn = useMemo(() => qpnLimit(T, T / DUTY_M25), [T])
  const zee = (ZEEMAN_SPLIT_HZ_PER_MT / 2) * B
  const irTooth = Math.round(NU_CLOCK / 4 / FREP)
  const ticks = BigInt(Math.round(s.t)) * 1121015393207859n
  return (
    <>
      <h2>Closing the loop</h2>
      <p>One atom gives one bit per second. The servo turns that into a frequency. It probes each line on both sides of its peak, at half maximum. If the two sides answer differently, the laser is off centre, and an integrator corrects it.</p>
      <Eq tex="\varepsilon = \frac{\bar P_+ - \bar P_-}{2\,|\partial_\delta P|},\qquad f_{\text{laser}}\;\leftarrow\;f_{\text{laser}} + G\,\varepsilon" />
      <p>Over short times the laser is its own reference, stable to about <M t="10^{-16}" />. Beyond the servo time of about 80 s, the atom takes over, and the Allan deviation falls as <M t="1/\sqrt\tau" />. That slope comes from quantum projection noise: each shot is a coin flip with a biased coin.</p>
      <p>The clock alternates between <M t="m_F=\pm5/2" />. The lines sit <M t="\pm" />{Math.abs(zee).toFixed(0)} Hz from centre at this field, so the mean of the two is immune to the magnetic field at first order. Drag the field below and watch the output ignore it, except for the known quadratic shift, which is then subtracted.</p>
      <Dock>
      <Slider label="Probe duration" value={T} min={0.1} max={2} step={0.05} onChange={setT} format={v => `${v.toFixed(2)} s`} hint="Changing this restarts the record." />
      <Slider label="Laser flicker floor" value={floorExp} min={-17} max={-14.5} step={0.1} onChange={setFloorExp} format={v => sci(10 ** v, 1)} hint="Marshall 2025 transfers stability from a cryogenic silicon cavity. The value isn't quoted there; 1 × 10⁻¹⁶ is assumed." />
      <Slider label="Servo gain" value={gain} min={0.02} max={1} step={0.01} onChange={setGain} format={v => v.toFixed(2)} />
      <Slider label="Laser drift" value={drift} min={0} max={200} step={1} onChange={setDrift} format={v => `${v} × 10⁻¹⁹ per s`} />
      <Slider label="Magnetic field" value={B} min={0.05} max={0.2} step={0.001} onChange={setB} format={v => `${v.toFixed(3)} mT`} />
      <Slider label="Cycles per frame" value={speed} min={1} max={300} step={1} onChange={setSpeed} format={v => String(v)} />
      <button type="button" onClick={() => { servo.current = make(); stats.current.coef = 0 }}>Restart the record</button>
      <Plot ref={aPlot} height={220} label="Allan deviation of the simulated clock against averaging time" />
      <Plot ref={yPlot} height={130} label="Fractional frequency error of the clock output over time" />
      <Readouts items={[
        ['Clock cycles', s.cycles.toLocaleString('en-US')],
        ['Measured here', stats.current.coef ? `${sci(stats.current.coef)}/√τ` : 'gathering data', ` real clock 3.5 × 10⁻¹⁶/√τ`],
        ['Projection noise limit', `${sci(qpn)}/√τ`],
        ['Mean excitation at half max', s.shots ? (s.excitations / s.shots).toFixed(3) : '—'],
      ]} />
      </Dock>
      <h3>Counting the cycles</h3>
      <p>Nothing electronic can count at a petahertz. An optical frequency comb is a ladder of laser lines spaced exactly by a microwave rate <M t="f_{\text{rep}}" />, offset by <M t="f_0" />. The clock laser, a Yb fiber laser at 1069.7 nm quadrupled to the UV, beats against one tooth.</p>
      <Eq tex={`\\frac{\\nu_{\\text{Al}}}{4} = n\\,f_{\\text{rep}} + f_0 + f_b,\\quad n\\approx ${irTooth.toLocaleString('en-US').replace(/,/g, '{,}')}`} />
      <p>Lock <M t="f_{\text{rep}}" /> to that beat and the comb divides the optical frequency down to radio. A counter then reads seconds. The number <M t="n" /> here assumes a 250 MHz comb for illustration. This simulated clock has now counted <strong>{ticks.toLocaleString('en-US')}</strong> cycles.</p>
    </>
  )
}

export function ShiftsStage() {
  useReadoutRate(10)
  const [B, setB] = useState(B_FIELD_MT), [Tenv, setTenv] = useState(T_BBR), [h, setH] = useState(0.33), [v, setV] = useState(0)
  useEffect(() => { enterStage('shifts', 6000) }, [])
  const rows = [
    { effect: 'Quadratic Zeeman', value: quadraticZeeman(B), live: true, formula: 'C₂ B²' },
    { effect: 'Secular time dilation', value: -114.6e-19, formula: 'Σ shift × (n̄ + ½)' },
    { effect: 'Cooling laser Stark', value: -37.2e-19, formula: 'measured' },
    { effect: 'Blackbody radiation', value: bbrShift(Tenv), live: true, formula: 'T⁴ law' },
    { effect: 'Excess micromotion', value: -1.6e-19, formula: 'measured' },
    { effect: 'Quadratic Zeeman, RF field', value: -0.54e-19, formula: 'measured' },
    { effect: 'Background gas', value: -0.3e-19, formula: 'measured' },
  ]
  const total = rows.reduce((a, r) => a + r.value, 0)
  const lab = [
    { effect: 'Height above the other clock', value: redshift(h), detail: `gh/c²` },
    { effect: 'Speed relative to the other clock', value: velocityShift(v), detail: `√(1−v²/c²) − 1` },
  ]
  const grav = lab[0].value + lab[1].value
  const sigma = INSTABILITY_M25 * Math.SQRT2
  const timeToSee = Math.abs(grav) > 0 ? (sigma / Math.abs(grav)) ** 2 : Infinity
  const barW = (x: number) => Math.max(1.5, (Math.log10(Math.max(Math.abs(x), 1e-20)) + 20) / 6 * 100)
  const fmtDur = (s: number) => !Number.isFinite(s) ? 'no difference' : s < 60 ? `${s.toFixed(0)} s` : s < 3600 * 2 ? `${(s / 60).toFixed(0)} min` : s < 86400 * 2 ? `${(s / 3600).toFixed(1)} h` : s < 3.156e7 ? `${(s / 86400).toFixed(0)} days` : `${(s / 3.156e7).toFixed(1)} years`
  return (
    <>
      <h2>What still moves the atom</h2>
      <p>An atomic frequency is not an atom&apos;s frequency in isolation. The ion sits in a magnetic field, in the room&apos;s thermal glow, in laser light, and in motion. Each of these shifts it. Accuracy comes from knowing each shift, and subtracting it.</p>
      <p>Bars are on a log scale from <M t="10^{-20}" /> to <M t="10^{-14}" />. Values in gold follow your sliders. The rest come from the measured budget in Marshall et al. 2025.</p>
      <h3>Relativity on a tabletop</h3>
      <p>A clock higher in Earth&apos;s gravity runs faster, and a moving clock runs slower. This isn&apos;t a shift to correct, but a real difference in the passage of time. In 2010, NIST watched an Al⁺ clock change its rate when raised by 33 cm.</p>
      <Eq tex="\frac{\Delta\nu}{\nu}=\frac{gh}{c^2}\qquad\frac{\Delta\nu}{\nu}=\sqrt{1-\frac{v^2}{c^2}}-1" />
      <Dock>
      <div className="budget" role="table" aria-label="Fractional frequency shifts">
        {rows.map(r => (
          <div key={r.effect} role="row" className="budget-row">
            <span role="cell">{r.effect}<small>{r.formula}</small></span>
            <span role="cell" className="budget-bar"><b style={{ width: `${barW(r.value)}%`, background: r.live ? CHART.gold : '#6f64a8' }} /></span>
            <span role="cell" className="budget-val">{sci(r.value, 1)}</span>
          </div>
        ))}
        <div role="row" className="budget-row total">
          <span role="cell">Total correction</span><span role="cell" />
          <span role="cell" className="budget-val">{sci(total, 2)}</span>
        </div>
      </div>
      <Slider label="Magnetic field" value={B} min={0.02} max={0.2} step={0.001} onChange={setB} format={x => `${x.toFixed(3)} mT`} />
      <Slider label="Temperature of the surroundings" value={Tenv} min={4} max={330} step={1} onChange={setTenv} format={x => `${x.toFixed(0)} K`} hint={<>Al⁺ has one of the smallest blackbody shifts of any clock species, <M t="\Delta\alpha=6.86\times10^{-42}" /> J m²/V².</>} />
      <Slider label="Raise the clock" value={h} min={0} max={3} step={0.01} onChange={setH} format={x => `${(x * 100).toFixed(0)} cm`} />
      <Slider label="Move the clock" value={v} min={0} max={40} step={0.1} onChange={setV} format={x => `${x.toFixed(1)} m/s`} />
      <Readouts items={[
        ['Height', sci(lab[0].value, 2), ' fractional'],
        ['Speed', sci(lab[1].value, 2), ' fractional'],
        ['Difference at the clock', `${(grav * NU_CLOCK * 1e3).toFixed(1)} mHz`],
        ['Time to see it, two such clocks', fmtDur(timeToSee), ' at 3.5 × 10⁻¹⁶/√τ'],
      ]} />
      <p className="hint">Total budget in Marshall et al. 2025: {sci(BUDGET_TOTAL.shift * 1e-19, 2)}, uncertainty {sci(BUDGET_TOTAL.unc * 1e-19, 1)}. The clock is corrected by this total. It&apos;s the uncertainty that counts.</p>
</Dock>
    </>
  )
}

export function LedgerStage() {
  useEffect(() => { enterStage('ledger', 13000) }, [])
  const rad = useMemo(() => [...radialModes(TRAP_M25, 'x')!, ...radialModes(TRAP_M25, 'y')!], [])
  const ax = useMemo(() => axialModes(TRAP_M25), [])
  const f = (id: string) => {
    const r = rad.find(m => m.id === id)
    return (r ? r.omega : id === 'z-com' ? ax.com.omega : ax.str.omega) / TWO_PI / 1e6
  }
  const worstF = Math.max(...MODES_M25.map(m => Math.abs(f(m.id) - m.fMHz)))
  const shifts = rad.map(m => m.shiftPerQuantum / MODES_M25.find(q => q.id === m.id)!.shiftPerQuantum)
  const worstS = Math.max(...shifts.map(x => Math.abs(x - 1))) * 100
  return (
    <>
      <h2>What is exact, and what isn&apos;t</h2>
      <p>No simulation of this instrument can be fully exact, so here is what this one actually does. The numbers below come from the engine in this page, checked by a test suite against the published measurements.</p>
      <h3>Compared with experiment</h3>
      <table className="ledger">
        <thead><tr><th scope="col">Quantity</th><th scope="col">Simulated</th><th scope="col">Published</th></tr></thead>
        <tbody>
          <tr><td>All six mode frequencies, 3 parameters fitted</td><td>within {(worstF * 1e3).toFixed(1)} kHz</td><td>Table S2, M25</td></tr>
          <tr><td>Radial shift per quantum, not fitted</td><td>within {worstS.toFixed(1)} %</td><td>Table S2, M25</td></tr>
          <tr><td>Doppler-cooled quanta, z-COM, 106 ms of MD</td><td>8.55</td><td>8.22 ± 0.48</td></tr>
          <tr><td>Doppler-cooled quanta, z-STR</td><td>5.16</td><td>4.50 ± 0.19</td></tr>
          <tr><td>Secular time dilation of Al⁺, directly from the trajectory</td><td>−123.9 × 10⁻¹⁹</td><td>−114.6 ± 3.8 × 10⁻¹⁹</td></tr>
          <tr><td>Blackbody shift at 24 °C</td><td>{(bbrShift(T_BBR) * 1e19).toFixed(1)} × 10⁻¹⁹</td><td>−30.7 ± 1.7 × 10⁻¹⁹</td></tr>
          <tr><td>Quadratic Zeeman</td><td>{(C2_HZ_PER_MT2 * B_FIELD_MT ** 2 / NU_CLOCK * 1e19).toFixed(1)} × 10⁻¹⁹</td><td>−6317.9 × 10⁻¹⁹, sets the field</td></tr>
          <tr><td>Closed-loop instability, 60 000 cycles</td><td>4.4 × 10⁻¹⁶/√τ</td><td>3.5 × 10⁻¹⁶/√τ</td></tr>
          <tr><td>Sideband cooling, z-COM ground state</td><td>97.9 %, n̄ = 0.12</td><td>simulated n̄ = 0.015 in C17</td></tr>
        </tbody>
      </table>
      <p>The disagreements are real. The MD runs about 8 % hot in time dilation, and the z-STR occupation sits outside the measured error; a 106 ms run also has its own statistical scatter of several percent. Closed-loop instability is about 25 % worse than measured. Sideband cooling leaves more population stranded at high n than C17&apos;s optimized sequence, whose exact pulse timings aren&apos;t published.</p>
      <h3>Approximations the simulation can&apos;t avoid</h3>
      <ul className="ledger-list">
        <li><strong>Optical rotating-wave approximation.</strong> The 1.1 PHz optical carrier isn&apos;t stepped; the interaction picture removes it. Its counter-rotating correction is the Bloch-Siegert shift, on the order of <M t="\Omega^2/4\nu" />, far below anything here.</li>
        <li><strong>Finite Hilbert spaces.</strong> 50 Fock states for cooling, 9 for readout, and 60 for the carrier factors. C17 used 150 for cooling. Population beyond the cutoff is lost to renormalization.</li>
        <li><strong>Numerical time steps.</strong> 32 to 64 steps per RF cycle with a fourth-order symplectic integrator, 24 to 48 per motional cycle with RK4. The tests check the results against exact solutions.</li>
        <li><strong>Sampled statistics.</strong> Everything stochastic is Monte Carlo, including photon kicks, jumps and shots. Short runs fluctuate, as they do in the laboratory.</li>
      </ul>
      <h3>Modelling choices you should know about</h3>
      <ul className="ledger-list">
        <li><strong>Ideal trap fields.</strong> A perfect quadrupole with no anharmonicity, no patch potentials and no excess micromotion. Excess micromotion is taken from the measured budget.</li>
        <li><strong>Photon scattering is semiclassical in the MD.</strong> Valid because <M t="\Gamma\gg\omega_m" /> and <M t="\bar n\gg1" /> there. Excited-state time (3.9 ns) is treated as instantaneous.</li>
        <li><strong>One mode at a time.</strong> Sideband cooling and the logic pulses treat one axial mode. Spectator modes aren&apos;t in those Hilbert spaces, and only appear through the clock probe&apos;s carrier factors.</li>
        <li><strong>Sideband cooling is population-level between pulses.</strong> Each pulse is an exact propagator, but coherences between pulses are dropped, as in C17&apos;s own model. Pulses last whole motional periods.</li>
        <li><strong>Motion during the clock probe.</strong> With Doppler cooling on, each mode&apos;s quantum number is redrawn from a thermal distribution in every time slice of the probe. That assumes mixing much faster than the slice, which the MD supports (about a millisecond against tens of milliseconds), but the papers don&apos;t measure it.</li>
        <li><strong>Clock line contrast is probably too high.</strong> The simulated line peaks near 95 %. Brewer 2019 reports about 70 % with a 150 ms probe, and Marshall 2025 doesn&apos;t quote a value. Whatever limits the real contrast isn&apos;t in this model.</li>
        <li><strong>Technical noise in readout is a parameter.</strong> The simulated logic pulses are better than the lab&apos;s, so the 15 % single-cycle error is added by hand.</li>
        <li><strong>Shifts not derived.</strong> Cooling Stark, excess micromotion and collision shifts are quoted from the measured budget, not simulated.</li>
        <li><strong>Not simulated:</strong> the two-direction servo cancelling first-order Doppler, ion-order stabilization, and the field and micromotion servos.</li>
      </ul>
      <h3>Inferred, because the papers don&apos;t state them</h3>
      <ul className="ledger-list">
        <li><strong>RF voltage:</strong> parametrized as Mathieu <M t="q" />, fitted from mode frequencies.</li>
        <li><strong>Cooling beam direction:</strong> 45° to the axis, from the κ factors in Table S2.</li>
        <li><strong>Probe beam angle:</strong> axial cosine 0.81, set from C17&apos;s 11 % Rabi slowdown.</li>
        <li><strong>Laser flicker floor:</strong> 1 × 10⁻¹⁶ is an assumption.</li>
        <li><strong>Optical pumping light intensity:</strong> set to saturate ³P₁. Only the lifetime and Clebsch-Gordan factors are taken from the physics.</li>
        <li><strong>Sideband π times:</strong> 30 µs on Al⁺ from Rosenband 2007. 10 µs on Mg⁺ is chosen to fit Brewer 2019&apos;s pulse rate.</li>
        <li><strong>Wafer outline:</strong> its 500 µm thickness, 250 µm spacing, and 4 mm endcap distance are published. The blade shape is stylized. Ions and beams are drawn larger or narrower than life so that you can see them.</li>
      </ul>
      <h3>Sources</h3>
      <ol className="sources">
        <li>M25: Marshall et al., High-stability single-ion clock with 5.5×10⁻¹⁹ systematic uncertainty, <a href="https://arxiv.org/abs/2504.13071">PRL 135, 033201 (2025)</a></li>
        <li>B19: Brewer et al., An ²⁷Al⁺ quantum-logic clock with systematic uncertainty below 10⁻¹⁸, <a href="https://arxiv.org/abs/1902.07694">PRL 123, 033201 (2019)</a></li>
        <li>C17: Chen et al., Sympathetic ground state cooling and time-dilation shifts in an ²⁷Al⁺ optical clock, <a href="https://arxiv.org/abs/1608.05047">PRL 118, 053002 (2017)</a></li>
        <li>Rosenband et al., Observation of the ¹S₀→³P₀ clock transition in ²⁷Al⁺, <a href="https://arxiv.org/abs/physics/0703067">PRL 98, 220801 (2007)</a></li>
        <li>Schmidt et al., Spectroscopy using quantum logic, <a href="https://doi.org/10.1126/science.1114375">Science 309, 749 (2005)</a></li>
        <li>Chou et al., Optical clocks and relativity, <a href="https://doi.org/10.1126/science.1192720">Science 329, 1630 (2010)</a></li>
        <li>Hume et al., High-fidelity adaptive qubit detection through repetitive quantum nondemolition measurements, <a href="https://arxiv.org/abs/0705.1870">PRL 99, 120502 (2007)</a></li>
        <li>Brewer et al., Measurements of ²⁷Al⁺ and ²⁵Mg⁺ magnetic constants, <a href="https://arxiv.org/abs/1903.04661">PRA 100, 013409 (2019)</a></li>
        <li>Clos et al., Decoherence-assisted spectroscopy of a single Mg⁺ ion, <a href="https://arxiv.org/abs/1402.1678">PRL 112, 113003 (2014)</a></li>
        <li>Batteiger et al., Precision spectroscopy of the 3s-3p fine-structure doublet in Mg⁺, <a href="https://arxiv.org/abs/0907.0368">PRA 80, 022503 (2009)</a></li>
        <li>BIPM, <a href="https://www.bipm.org/documents/20126/69375069/27Al+_1121THz_2021.pdf/af023aa2-90d2-74eb-14bf-842141bf288e">Recommended value of the ²⁷Al⁺ frequency (2021)</a></li>
      </ol>
      <p className="hint">Run <code>npm test</code> to reproduce these comparisons: 17 checks in <code>test/physics.test.ts</code>. Readout fidelity is checked live on the read-out step.</p>
    </>
  )
}
