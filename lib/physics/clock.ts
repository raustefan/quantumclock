// The clock transition itself, the laser, the servo, and the frequency budget.
import {
  BBR_ALPHA, C, C2_HZ_PER_MT2, DUTY_M25, H, HBAR, K_CLOCK, M_AL, MODES_M25, NU_CLOCK, PROBE_COS_Z, TAU_3P0, TWO_PI, ZEEMAN_SPLIT_HZ_PER_MT,
} from './constants.ts'
import { lambDicke } from './quantum.ts'
import { axialModes, gauss, makeRng, radialModes, TRAP_M25, type Trap } from './trap.ts'

// Rabi lineshape for a two-level atom, exact on resonance width: Omega, T in rad/s and s, delta in rad/s.
export function rabiLine(deltaHz: number, T: number) {
  const O = Math.PI / T, d = TWO_PI * deltaHz, g = Math.hypot(O, d)
  return ((O * O) / (g * g)) * Math.sin((g * T) / 2) ** 2
}

// Half-maximum detuning and slope of the pi-pulse Rabi line.
export function rabiHalfWidth(T: number) {
  let lo = 0, hi = 1 / T
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (rabiLine(mid, T) > 0.5) lo = mid; else hi = mid }
  const d = (lo + hi) / 2, e = 1e-5 / T
  return { hwhm: d, slope: Math.abs(rabiLine(d + e, T) - rabiLine(d - e, T)) / (2 * e) }
}

// Quantum projection noise limit for two-point locking at half maximum, from the slope itself.
export function qpnLimit(T: number, Tc: number) {
  const { slope } = rabiHalfWidth(T)
  return (0.5 / slope) * Math.sqrt(Tc) / NU_CLOCK
}

// Carrier Rabi rate factor <n|exp(i eta(a+a^dag))|n> for each mode, computed for the Al+ ion and a
// probe beam at the given direction cosines with the trap axes.
export type DWMode = { factors: Float64Array; nbar: number }
export function debyeWallerModes(trap: Trap, nbars: number[], cosines: { x: number; y: number; z: number }, N = 60): DWMode[] {
  const out: DWMode[] = []
  const az = axialModes(trap)
  const push = (eta: number, nbar: number) => {
    const D = lambDicke(Math.abs(eta), N), f = new Float64Array(N)
    for (let n = 0; n < N; n++) f[n] = D[n * N + n]
    out.push({ factors: f, nbar })
  }
  const zAl = (w: number, b: number) => b * Math.sqrt(HBAR / (2 * M_AL * w))
  push(K_CLOCK * cosines.z * zAl(az.com.omega, az.com.b[1]), nbars[0])
  push(K_CLOCK * cosines.z * zAl(az.str.omega, az.str.b[1]), nbars[1])
  let i = 2
  for (const axis of ['x', 'y'] as const) {
    const modes = radialModes(trap, axis)!, cos = axis === 'x' ? cosines.x : cosines.y
    for (const id of [`${axis}-com`, `${axis}-str`]) {
      const m = modes.find(q => q.id === id)!
      push(K_CLOCK * cos * Math.hypot(m.xr[1], m.xi[1]), nbars[i++])
    }
  }
  return out
}

// Thermal mean of the carrier factor: how much a Doppler-cooled ion slows the Rabi oscillation.
export function thermalCarrier(mode: DWMode) {
  const r = mode.nbar / (1 + mode.nbar)
  let w = 1 / (1 + mode.nbar), s = 0, norm = 0
  for (let n = 0; n < mode.factors.length; n++) { s += w * mode.factors[n]; norm += w; w *= r }
  return s / norm
}

export const PROBE_COS = { x: 0, y: 0, z: PROBE_COS_Z }

export const dopplerNbars = () => MODES_M25.map(m => m.nbar)

// One exact Rabi interrogation: Bloch vector through piecewise-constant frequency noise, with
// 3P0 spontaneous decay as a Lindblad term (Strang splitting), and motion-dependent carrier rate.
export type ProbeOptions = {
  T: number // pulse length, s
  omega0: number // Rabi frequency of an atom at rest, rad/s
  segments: number
  modes: DWMode[]
  continuousCooling: boolean // M25: Doppler cooling during the probe re-randomises n on a ~ms scale
}

function sampleN(m: DWMode, rng: () => number) {
  const u = rng(), r = m.nbar / (1 + m.nbar)
  if (r <= 0) return 0
  const n = Math.floor(Math.log(1 - u) / Math.log(r))
  return Math.min(n, m.factors.length - 1)
}

export function probeExcitation(rng: () => number, detuningHz: (t: number) => number, o: ProbeOptions, trace?: (t: number, x: number, y: number, z: number) => void) {
  // Density matrix in Bloch form; start in |S0>: ree=0, ug=1.
  let u = 0, v = 0, w = -1
  const h = o.T / o.segments
  const ns = o.modes.map(m => sampleN(m, rng))
  const decay = Math.exp(-h / (2 * TAU_3P0)), cdec = Math.exp(-h / (4 * TAU_3P0))
  for (let s = 0; s < o.segments; s++) {
    if (o.continuousCooling) for (let i = 0; i < ns.length; i++) ns[i] = sampleN(o.modes[i], rng)
    let om = o.omega0
    for (let i = 0; i < ns.length; i++) om *= o.modes[i].factors[ns[i]]
    const t = (s + 0.5) * h, d = TWO_PI * detuningHz(t)
    // Half a step of decay: population returns to the ground state, trace stays 1.
    u *= cdec; v *= cdec; w = (1 + w) * decay - 1
    // exact rotation about (om, 0, d)
    const g = Math.hypot(om, d) || 1e-30, ax = om / g, az = d / g, a = g * h
    const c = Math.cos(a), si = Math.sin(a), dot = ax * u + az * w
    const cx = -az * v, cy = az * u - ax * w, cz = ax * v
    const nu = u * c + cx * si + ax * dot * (1 - c)
    const nv = v * c + cy * si
    const nw = w * c + cz * si + az * dot * (1 - c)
    u = nu; v = nv; w = nw
    u *= cdec; v *= cdec; w = (1 + w) * decay - 1
    trace?.((s + 1) * h, u, v, w)
  }
  return (1 + w) / 2
}

// Omega_0 such that the thermally averaged carrier gives a pi pulse in T.
export function piOmega(T: number, modes: DWMode[]) {
  let f = 1
  for (const m of modes) f *= thermalCarrier(m)
  return Math.PI / (T * f)
}

// Laser frequency noise: flicker built from a bank of log-spaced Ornstein-Uhlenbeck processes
// (a standard exact discretisation of 1/f noise over the band that matters) plus linear drift.
const FLICKER_CAL = 0.92 // see test/physics.test.ts
export class LaserNoise {
  private taus: number[] = []
  private state: number[] = []
  private rng: () => number
  floor: number // Allan deviation flicker floor (fractional)
  driftPerS: number
  t = 0

  constructor(floor: number, driftPerS: number, seed: number) {
    this.floor = floor; this.driftPerS = driftPerS
    this.rng = makeRng(seed)
    for (let k = -4; k <= 14; k += 1) { this.taus.push(2 ** k); this.state.push(gauss(this.rng)) }
  }

  // Current fractional frequency.
  value() {
    let s = 0
    for (const x of this.state) s += x
    return s * FLICKER_CAL * this.floor * Math.SQRT1_2 + this.driftPerS * this.t
  }

  advance(dt: number) {
    for (let i = 0; i < this.taus.length; i++) {
      const a = Math.exp(-dt / this.taus[i])
      this.state[i] = a * this.state[i] + Math.sqrt(1 - a * a) * gauss(this.rng)
    }
    this.t += dt
  }
}

export type ServoOptions = { T: number; duty: number; gain: number; laserFloor: number; driftPerS: number; bMilliT: number; continuousCooling: boolean; segments: number; seed: number }

// The whole closed loop: two mF lines, two sides each, QPN from Bernoulli shots, integrating servo.
export class ClockServo {
  o: ServoOptions; rng: () => number; laser: LaserNoise
  t = 0; cycles = 0
  // Laser offsets from the true unperturbed frequency, one per line, Hz: fed back by the servo.
  offset = [0, 0]
  private diff = [0, 0]; private side = 0; private line = 0
  y: number[] = []
  excitations = 0; shots = 0
  private modes: DWMode[]; private omega0: number; private width
  lastError = 0

  constructor(o: ServoOptions) {
    this.o = o
    this.rng = makeRng(o.seed)
    this.laser = new LaserNoise(o.laserFloor, o.driftPerS, o.seed + 13)
    this.modes = debyeWallerModes(TRAP_M25, dopplerNbars(), PROBE_COS)
    this.omega0 = piOmega(o.T, this.modes)
    this.width = rabiHalfWidth(o.T)
    this.offset = [this.lineCenter(0), this.lineCenter(1)]
  }

  private lineCenter(line: number) {
    const s = line === 0 ? 1 : -1
    return s * (ZEEMAN_SPLIT_HZ_PER_MT / 2) * this.o.bMilliT + C2_HZ_PER_MT2 * this.o.bMilliT ** 2
  }

  setOptions(p: Partial<ServoOptions>) {
    const changedT = p.T !== undefined && p.T !== this.o.T
    Object.assign(this.o, p)
    this.laser.floor = this.o.laserFloor; this.laser.driftPerS = this.o.driftPerS
    if (changedT) { this.omega0 = piOmega(this.o.T, this.modes); this.width = rabiHalfWidth(this.o.T) }
  }

  // Run one clock cycle: probe one side of one line, count one Bernoulli shot, maybe update the servo.
  cycle() {
    const { T, duty, segments, continuousCooling } = this.o
    const line = this.line, side = this.side ? 1 : -1
    const noise = () => this.laser.value() * NU_CLOCK
    const nu0 = this.lineCenter(line)
    const h = T / segments, dets = new Float64Array(segments)
    for (let s = 0; s < segments; s++) {
      dets[s] = noise() + this.offset[line] + side * this.width.hwhm - nu0
      this.laser.advance(h)
    }
    const P = probeExcitation(this.rng, t => dets[Math.min(segments - 1, Math.floor(t / h))], {
      T, omega0: this.omega0, segments, modes: this.modes, continuousCooling,
    })
    const click = this.rng() < P ? 1 : 0
    this.excitations += click; this.shots++
    // Dead time: cooling, state preparation, and readout.
    this.laser.advance(T * (1 / duty - 1))
    this.t += T / duty
    this.cycles++
    this.diff[line] += side * click
    if (this.side) {
      // After both sides: error = (P+ - P-) / (2 slope), P+ measured at +hwhm: positive means the line is high.
      const err = this.diff[line] / (2 * this.width.slope)
      this.offset[line] += this.o.gain * err
      this.lastError = err
      this.diff[line] = 0
      this.line = 1 - line
    }
    this.side = 1 - this.side
    // Clock output: the laser steered by the mean of both line offsets. Linear Zeeman cancels.
    const center = C2_HZ_PER_MT2 * this.o.bMilliT ** 2
    const out = noise() + (this.offset[0] + this.offset[1]) / 2 - center
    this.y.push(out / NU_CLOCK)
  }
}

// Overlapping Allan deviation on octave-spaced averaging times.
export function allan(y: ArrayLike<number>, tau0: number) {
  const n = y.length, out: { tau: number; adev: number; n: number }[] = []
  if (n < 8) return out
  const pre = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) pre[i + 1] = pre[i] + y[i]
  for (let m = 1; 2 * m < n; m = Math.ceil(m * 1.5)) {
    let sum = 0, c = 0
    for (let i = 0; i + 2 * m <= n; i++) {
      const d = (pre[i + 2 * m] - 2 * pre[i + m] + pre[i]) / m
      sum += d * d; c++
    }
    if (c < 4) break
    out.push({ tau: m * tau0, adev: Math.sqrt(sum / (2 * c)), n: c })
  }
  return out
}

// Frequency-shift formulas. All fractional, all exact at this order.
export const quadraticZeeman = (bmT: number) => (C2_HZ_PER_MT2 * bmT * bmT) / NU_CLOCK
// E_rms^2 = (831.9 V/m)^2 (T/300 K)^4; shift = -(Delta alpha) <E^2> / (2 h nu)
export const bbrShift = (T: number) => (-BBR_ALPHA * 831.9 ** 2 * (T / 300) ** 4) / (2 * H * NU_CLOCK)
// Exact gravitational and special-relativistic rate factors, Earth surface potential gradient only.
export const G_EARTH = 9.80665
export const redshift = (h: number) => (G_EARTH * h) / (C * C)
// expm1/log1p because 1 - v^2/c^2 is too close to 1 for double precision at everyday speeds.
export const velocityShift = (v: number) => Math.expm1(0.5 * Math.log1p(-(v * v) / (C * C)))
export const secularFromModes = () => MODES_M25.reduce((s, m) => s + m.shiftPerQuantum * (m.nbar + 0.5), 0)
export { DUTY_M25 }
