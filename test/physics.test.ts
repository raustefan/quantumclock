// The physics engine, checked against analytic results and against published measurements.
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BUDGET_M25, C, C2_HZ_PER_MT2, B_FIELD_MT, LIKELIHOOD_STOP, M_MG, MODES_M25, NU_CLOCK, OMEGA_RF, SAT_DOPPLER, TWO_PI,
} from '../lib/physics/constants.ts'
import {
  allan, bbrShift, ClockServo, debyeWallerModes, LaserNoise, PROBE_COS, piOmega, probeExcitation, qpnLimit, quadraticZeeman, rabiHalfWidth, rabiLine, redshift, secularFromModes, thermalCarrier,
} from '../lib/physics/clock.ts'
import { clebsch, lambDicke, meanN, OpticalPumping, QlsExperiment, SidebandCooler, thermal, AL_P0, AL_S0, axialEtas } from '../lib/physics/quantum.ts'
import { axialModes, IonCrystal, makeRng, mathieuQ, mathieuStable, radialModes, spacing, TRAP_M25, type Trap } from '../lib/physics/trap.ts'

const close = (a: number, b: number, tol: number, what = '') => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b} (tol ${tol})`)
const sci = (x: number) => x.toExponential(3)

test('Mathieu stability edge at a=0 is q=0.908', () => {
  assert.ok(mathieuStable(0, 0.90))
  assert.ok(!mathieuStable(0, 0.92))
  assert.ok(mathieuStable(-0.002, 0.2))
})

test('modes match all six measured frequencies of Marshall 2025', () => {
  const a = axialModes(TRAP_M25)
  close(a.com.omega / TWO_PI / 1e6, 2.16, 0.01, 'z-com')
  close(a.str.omega / TWO_PI / 1e6, 3.75, 0.01, 'z-str')
  for (const axis of ['x', 'y'] as const) for (const m of radialModes(TRAP_M25, axis)!) {
    const r = MODES_M25.find(q => q.id === m.id)!
    close(m.omega / TWO_PI / 1e6, r.fMHz, 0.01, m.id)
  }
})

test('shift per quantum, not fitted, reproduces Marshall Table S2 to 5 %', () => {
  const radial = [...radialModes(TRAP_M25, 'x')!, ...radialModes(TRAP_M25, 'y')!]
  for (const m of radial) {
    const r = MODES_M25.find(q => q.id === m.id)!
    close(m.shiftPerQuantum / r.shiftPerQuantum, 1, 0.05, m.id)
  }
})

test('budget secular row equals sum of shift per quantum times (nbar + 1/2)', () => {
  close(secularFromModes() * 1e19, -114.6, 0.1, 'secular')
})

test('blackbody and quadratic Zeeman formulas give the Marshall budget', () => {
  close(bbrShift(297.15) * 1e19, BUDGET_M25.find(b => b.effect.startsWith('Black'))!.shift, 1.7, 'BBR')
  close(quadraticZeeman(B_FIELD_MT) * 1e19, -6317.9, 15, 'Zeeman')
  close(C2_HZ_PER_MT2 * 0.01 / NU_CLOCK * 1e19, -6417.9, 20, 'C2 at 0.1 mT')
  close(redshift(0.33), 3.6e-17, 0.1e-17, 'redshift 33 cm')
})

test('integrator conserves the exact RF motion: free single-axis secular frequency from MD', () => {
  // COM mode of a pure axial excitation should oscillate at the eigenfrequency.
  const c = new IonCrystal(TRAP_M25, 32, 3)
  c.exciteMode('z-com', 100)
  const T = TWO_PI / axialModes(TRAP_M25).com.omega, steps = Math.round((10 * T) / c.dt)
  const z0 = c.pos[2]
  let crossings = 0, last = c.vel[2]
  for (let i = 0; i < steps; i++) { c.step(1); if (last * c.vel[2] < 0) crossings++; last = c.vel[2] }
  close(crossings, 20, 1, 'zero crossings in 10 periods')
  assert.ok(Number.isFinite(z0))
})

test('Lamb-Dicke matrix: unitary columns and known elements', () => {
  const N = 80, eta = 0.2, D = lambDicke(eta, N)
  close(D[0], Math.exp(-eta * eta / 2), 1e-12, '<0|D|0>')
  close(D[N], eta * Math.exp(-eta * eta / 2), 1e-12, '<1|D|0>')
  close(D[N + 1], (1 - eta * eta) * Math.exp(-eta * eta / 2), 1e-12, '<1|D|1>')
  for (const n of [0, 3, 20]) { let s = 0; for (let m = 0; m < N; m++) s += D[m * N + n] ** 2; close(s, 1, 1e-9, 'column norm') }
})

test('Clebsch-Gordan: stretched is unity, weak branch matches', () => {
  close(clebsch(2.5, 2.5, 1, 1, 3.5, 3.5), 1, 1e-12, 'stretched')
  // Sum rule on the excited-state decay.
  let s = 0
  for (const q of [-1, 0, 1]) s += clebsch(2.5, 1.5 - q, 1, q, 3.5, 1.5) ** 2
  close(s, 1, 1e-12, 'sum rule')
})

test('optical pumping reaches the stretched state, degrades with impure polarisation', () => {
  const run = (purity: number) => {
    const o = new OpticalPumping(1)
    for (let i = 0; i < 400000; i++) o.advance(1e-7, purity, 5e4)
    return o.stretched()
  }
  assert.ok(run(1) > 0.999, `pure ${run(1)}`)
  assert.ok(run(0.9) < run(0.99))
})

test('Raman sideband cooling reaches over 97 % ground state with the C17 sequence', () => {
  const c = new SidebandCooler(TRAP_M25, 'z-com', MODES_M25[0].nbar)
  const start = performance.now()
  let last = 0
  for (let i = 0; i < 15; i++) last = c.pulse(2).nbar
  const mid = last
  for (let i = 0; i < 25; i++) last = c.pulse(1).nbar
  console.log(`  z-COM: ${MODES_M25[0].nbar} -> ${mid.toFixed(3)} (2nd order) -> ${last.toFixed(4)} (C17 sim: 0.015), P0=${c.p[0].toFixed(4)}, ${c.elapsedUs.toFixed(0)} us, took ${(performance.now() - start).toFixed(0)} ms`)
  assert.ok(c.p[0] > 0.97, `ground-state population ${c.p[0]}`)
})

test('quantum-logic transfer: Al S0 goes to Mg dark, Al 3P0 stays bright', () => {
  const q = new QlsExperiment(TRAP_M25, 'z-com', 11)
  const p0 = thermal(0.015, q.N)
  let darkFromS0 = 0, darkFromP0 = 0, n = 60
  const start = performance.now()
  for (let i = 0; i < n; i++) { q.start(AL_S0, p0); while (q.advance(64)); darkFromS0 += q.probUp() }
  for (let i = 0; i < n; i++) { q.start(AL_P0, p0); while (q.advance(64)); darkFromP0 += q.probUp() }
  darkFromS0 /= n; darkFromP0 /= n
  console.log(`  P(dark|S0)=${darkFromS0.toFixed(3)}, P(dark|3P0)=${darkFromP0.toFixed(4)}, ${((performance.now() - start) / (2 * n)).toFixed(1)} ms/cycle; etas Al ${axialEtas(TRAP_M25, 'z-com').al3p1.toFixed(3)} Mg ${axialEtas(TRAP_M25, 'z-com').raman.toFixed(3)}`)
  assert.ok(darkFromS0 > 0.7, `S0 transfer ${darkFromS0}`)
  assert.ok(darkFromP0 < 0.1, `P0 leak ${darkFromP0}`)
})

test('Rabi lineshape: unit peak, half-width, QPN close to measured instability', () => {
  close(rabiLine(0, 1), 1, 1e-12, 'peak')
  const { hwhm, slope } = rabiHalfWidth(1)
  close(rabiLine(hwhm, 1), 0.5, 1e-9, 'half max')
  const q = qpnLimit(1, 1 / 0.8)
  console.log(`  Rabi T=1 s: FWHM=${(2 * hwhm).toFixed(3)} Hz, slope=${slope.toFixed(3)}/Hz, QPN=${sci(q)} /sqrt(tau) vs measured 3.5e-16`)
  close(q / 3.5e-16, 1, 0.3, 'QPN vs measured')
})

test('Debye-Waller slowdown of the clock Rabi rate matches C17 (11 % Doppler vs ground)', () => {
  // C17 trap modes: 2.7, 4.8, 6.2, 5.4, 7.2, 6.5 MHz.
  const a = axialModes(TRAP_M25).com.omega / (TWO_PI * 2.7e6)
  const K = TRAP_M25.K / (a * a)
  const trap: Trap = { R: TRAP_M25.R, K, D: TRAP_M25.D, omega: TWO_PI * 76e6 } // radial modes unused: n = 0 and cos = 0
  const nb = [41.3 / (4 * 2.7) * 1.7, 41.3 / (4 * 4.8) * 1.7, 0, 0, 0, 0]
  const modes = debyeWallerModes(trap, nb, PROBE_COS)
  let f = 1
  for (const m of modes) f *= thermalCarrier(m)
  const cold = debyeWallerModes(trap, [0, 0, 0, 0, 0, 0], PROBE_COS)
  let g = 1
  for (const m of cold) g *= thermalCarrier(m)
  console.log(`  Doppler/ground Rabi ratio ${(f / g).toFixed(3)} (measured 1.126/1.258 = ${(1.126 / 1.258).toFixed(3)})`)
  close(f / g, 1.126 / 1.258, 0.02, 'Debye-Waller')
})

test('probe: on resonance gives high excitation, decay reduces it by the 3P0 lifetime', () => {
  const modes = debyeWallerModes(TRAP_M25, [0, 0, 0, 0, 0, 0], PROBE_COS)
  const rng = makeRng(5)
  const w = piOmega(1, modes)
  const p = probeExcitation(rng, () => 0, { T: 1, omega0: w, segments: 256, modes, continuousCooling: false })
  close(p, 1, 0.05, 'pi pulse')
  const off = probeExcitation(rng, () => 3, { T: 1, omega0: w, segments: 256, modes, continuousCooling: false })
  assert.ok(off < 0.1, 'off resonance')
})

test('flicker calibration: laser ADEV near the set floor', () => {
  const l = new LaserNoise(1e-16, 0, 7), y: number[] = [], tau0 = 1
  for (let i = 0; i < 200000; i++) { l.advance(tau0); y.push(l.value()) }
  const a = allan(y, tau0).filter(q => q.tau >= 2 && q.tau <= 200)
  const mean = Math.exp(a.reduce((s, q) => s + Math.log(q.adev), 0) / a.length)
  console.log(`  flicker floor set 1e-16, measured ${sci(mean)}: ${a.map(q => `${q.tau}:${q.adev.toExponential(1)}`).join(' ')}`)
  close(mean / 1e-16, 1, 0.25, 'flicker floor')
})

test('closed-loop clock: Allan deviation reaches the Marshall 2025 instability', () => {
  const s = new ClockServo({ T: 1, duty: 0.8, gain: 0.25, laserFloor: 1e-16, driftPerS: 0, bMilliT: B_FIELD_MT, continuousCooling: true, segments: 64, seed: 21 })
  const start = performance.now()
  for (let i = 0; i < 60000; i++) s.cycle()
  const ms = performance.now() - start
  const a = allan(s.y, 1.25)
  const long = a.filter(q => q.tau > 100 && q.tau < 5000)
  const coef = Math.exp(long.reduce((c, q) => c + Math.log(q.adev * Math.sqrt(q.tau)), 0) / long.length)
  console.log(`  ${ms.toFixed(0)} ms for 60000 cycles; sigma=${sci(coef)}/sqrt(tau) (M25 3.5e-16); contrast ~${(s.excitations / s.shots).toFixed(3)} at half max; ${a.filter((_, i) => i % 3 === 0).map(q => `${q.tau.toFixed(0)}:${q.adev.toExponential(1)}`).join(' ')}`)
  close(coef / 3.5e-16, 1, 0.45, 'instability')
})

test('Doppler cooling MD reaches Marshall mode occupations and secular time dilation', { timeout: 300000 }, () => {
  const c = new IonCrystal(TRAP_M25, 32, 9)
  c.thermalise(0.05)
  c.laser.on = true
  c.laser.saturation = SAT_DOPPLER
  c.step(1_000_000) // ~0.44 ms settling
  const settled = c.temperature(0)
  c.resetStats()
  const start = performance.now()
  c.step(40_000_000) // ~17.6 ms of averaging
  const q = c.axialQuanta(), dil = c.timeDilation()
  console.log(`  settling T=${(settled * 1e3).toFixed(2)} mK; TMg=${(c.temperature(0) * 1e3).toFixed(2)} mK, TAl=${(c.temperature(1) * 1e3).toFixed(2)} mK; n(z-com)=${q.com.toFixed(2)} [8.22], n(z-str)=${q.str.toFixed(2)} [4.50]; shift=${(dil * 1e19).toFixed(1)}e-19 [-114.6]; ${c.photons} photons; ${(performance.now() - start).toFixed(0)} ms; q=${mathieuQ(TRAP_M25, M_MG).toFixed(3)}; d=${(spacing(TRAP_M25) * 1e6).toFixed(2)} um; lost=${c.lost}`)
  assert.ok(!c.lost)
  close(q.com / 8.22, 1, 0.3, 'z-com occupation')
  close(q.str / 4.5, 1, 0.3, 'z-str occupation')
  close(dil * 1e19 / -114.6, 1, 0.3, 'time dilation')
  assert.ok(OMEGA_RF > 0 && C > 0 && LIKELIHOOD_STOP > 0 && meanN([1]) === 0)
})
