// Quantum dynamics of ion motion and internal states.
// All sideband physics keeps the full Lamb-Dicke operator exp(i eta (a + a^dag)) to all orders,
// and all off-resonant terms in the interaction picture. Only the optical-frequency rotating-wave
// approximation is made, which is unavoidable: 1e15 Hz cannot be stepped alongside 1e6 Hz.
import {
  HBAR, HEATING_Z, K_3P1, K_MG, M_AL, M_MG, PI_TIME_AL_US, PI_TIME_MG_US, PROBE_COS_Z, RAMAN_DK, RAMAN_SCATTER_Z, TAU_3P1, TWO_PI,
} from './constants.ts'
import { axialModes, makeRng, type Trap } from './trap.ts'

// |<m| exp(i eta (a + a^dag)) |n>| times the phase i^|m-n|, returned as real magnitude with sign.
// Wineland et al. J. Res. NIST 103, 259 (1998), Eq. 31. Exact for all eta and n.
export function lambDicke(eta: number, N: number): Float64Array {
  const out = new Float64Array(N * N), x = eta * eta, pre = Math.exp(-x / 2)
  for (let lo = 0; lo < N; lo++) {
    let factor = pre
    for (let d = 0; lo + d < N; d++) {
      if (d > 0) factor *= eta / Math.sqrt(lo + d)
      // Generalised Laguerre L_lo^d(x) by upward recurrence.
      let l0 = 1, l1 = 1 + d - x
      if (lo === 0) l1 = 1
      else for (let k = 1; k < lo; k++) { const l2 = ((2 * k + 1 + d - x) * l1 - (k + d) * l0) / (k + 1); l0 = l1; l1 = l2 }
      const v = factor * l1
      out[(lo + d) * N + lo] = v; out[lo * N + (lo + d)] = v
    }
  }
  return out
}

// Multiply by i^|m-n| when using the elements above.
const IPOW_RE = [1, 0, -1, 0], IPOW_IM = [0, 1, 0, -1]

export const thermal = (nbar: number, N: number) => {
  const p = new Float64Array(N), r = nbar / (1 + nbar)
  let w = 1 / (1 + nbar), sum = 0
  for (let n = 0; n < N; n++) { p[n] = w; sum += w; w *= r }
  for (let n = 0; n < N; n++) p[n] /= sum
  return p
}
export const meanN = (p: ArrayLike<number>) => {
  let s = 0, w = 0
  for (let n = 0; n < p.length; n++) { s += n * p[n]; w += p[n] }
  return s / w
}

export type AxialId = 'z-com' | 'z-str'

// Lamb-Dicke parameters of the axial modes, from exact mode vectors.
export function axialEtas(trap: Trap, id: AxialId) {
  const m = axialModes(trap), mode = id === 'z-com' ? m.com : m.str
  const zMg = Math.abs(mode.b[0]) * Math.sqrt(HBAR / (2 * M_MG * mode.omega))
  const zAl = Math.abs(mode.b[1]) * Math.sqrt(HBAR / (2 * M_AL * mode.omega))
  return {
    omega: mode.omega,
    raman: RAMAN_DK * zMg, // effective two-photon wavevector on Mg+
    scatterMg: K_MG * zMg, // one 280 nm photon on Mg+
    al3p1: K_3P1 * PROBE_COS_Z * zAl, // one 267 nm photon on Al+
    b: mode.b,
  }
}

// Complex square matrix helpers on interleaved arrays.
type CMat = { re: Float64Array; im: Float64Array; n: number }
function cmul(a: CMat, b: CMat): CMat {
  const n = a.n, re = new Float64Array(n * n), im = new Float64Array(n * n)
  const ar = a.re, ai = a.im, br = b.re, bi = b.im
  for (let i = 0; i < n; i++) for (let k = 0; k < n; k++) {
    const x = ar[i * n + k], y = ai[i * n + k]
    if (x === 0 && y === 0) continue
    for (let j = 0; j < n; j++) {
      const p = br[k * n + j], q = bi[k * n + j]
      re[i * n + j] += x * p - y * q; im[i * n + j] += x * q + y * p
    }
  }
  return { re, im, n }
}

// One-period propagator of a sideband drive, H = (Omega/2)(sigma+ D(t) e^{i order w t} + h.c.) + shift |up><up|,
// on basis index = spin * N + n with spin 0 = lower, 1 = upper. Exactly periodic in 2 pi / w.
// order > 0: red sideband (n -> n - order). order < 0: blue sideband (n -> n + |order|).
function sidebandPeriod(eta: number, Omega: number, order: number, N: number, w: number, shift = 0, steps = 48): CMat {
  const D = lambDicke(eta, N)
  const list: { u: number; v: number; re: number; im: number; h: number }[] = []
  for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
    const v = D[m * N + n]
    if (Math.abs(v) < 1e-5) continue
    const d = Math.abs(m - n) % 4
    list.push({ u: m + N, v: n, re: (v * IPOW_RE[d] * Omega) / 2, im: (v * IPOW_IM[d] * Omega) / 2, h: m - n + order })
  }
  const dim = 2 * N, T = TWO_PI / w, dt = T / steps, ne = list.length
  const outRe = new Float64Array(dim * dim), outIm = new Float64Array(dim * dim)
  const y = new Float64Array(2 * dim), k = new Float64Array(2 * dim), tmp = new Float64Array(2 * dim), acc = new Float64Array(2 * dim)
  const rhs = (t: number, s: Float64Array, d: Float64Array) => {
    d.fill(0)
    for (let i = 0; i < ne; i++) {
      const e = list[i], ph = e.h * w * t, c = Math.cos(ph), sn = Math.sin(ph)
      const gr = e.re * c - e.im * sn, gi = e.re * sn + e.im * c
      const u = e.u, v = e.v, ur = s[2 * u], ui = s[2 * u + 1], vr = s[2 * v], vi = s[2 * v + 1]
      // i dc_up/dt = g c_down ; i dc_down/dt = g* c_up
      d[2 * u] += gr * vi + gi * vr; d[2 * u + 1] -= gr * vr - gi * vi
      d[2 * v] += gr * ui - gi * ur; d[2 * v + 1] -= gr * ur + gi * ui
    }
    if (shift) for (let u = N; u < dim; u++) { d[2 * u] += shift * s[2 * u + 1]; d[2 * u + 1] -= shift * s[2 * u] }
  }
  for (let col = 0; col < dim; col++) {
    y.fill(0); y[2 * col] = 1
    for (let st = 0; st < steps; st++) {
      const t = st * dt
      acc.set(y)
      rhs(t, y, k); for (let i = 0; i < y.length; i++) { acc[i] += (dt / 6) * k[i]; tmp[i] = y[i] + (dt / 2) * k[i] }
      rhs(t + dt / 2, tmp, k); for (let i = 0; i < y.length; i++) { acc[i] += (dt / 3) * k[i]; tmp[i] = y[i] + (dt / 2) * k[i] }
      rhs(t + dt / 2, tmp, k); for (let i = 0; i < y.length; i++) { acc[i] += (dt / 3) * k[i]; tmp[i] = y[i] + dt * k[i] }
      rhs(t + dt, tmp, k); for (let i = 0; i < y.length; i++) y[i] = acc[i] + (dt / 6) * k[i]
    }
    for (let r = 0; r < dim; r++) { outRe[r * dim + col] = y[2 * r]; outIm[r * dim + col] = y[2 * r + 1] }
  }
  return { re: outRe, im: outIm, n: dim }
}

function matPower(U: CMat, m: number) {
  let out: CMat | null = null, base = U
  for (let e = m; e > 0; e >>= 1) {
    if (e & 1) out = out ? cmul(out, base) : base
    if (e > 1) base = cmul(base, base)
  }
  return out!
}

// The non-resonant carrier light-shifts the sideband. A real experiment finds the sideband by scanning
// the drive frequency; this does the same, maximising the n = |order| -> 0 (or 0 -> 1) transfer.
export function calibrateSideband(eta: number, Omega: number, order: number, w: number) {
  const N = Math.abs(order) + 8, D = lambDicke(eta, N)
  const from = order > 0 ? order : 0, to = order > 0 ? 0 : -order
  const tPi = Math.PI / (Omega * Math.abs(D[to * N + from]))
  const m = Math.max(1, Math.round((tPi * w) / TWO_PI))
  const guess = (Omega * Omega) / (2 * Math.abs(order) * w)
  const transfer = (shift: number) => {
    const U = matPower(sidebandPeriod(eta, Omega, order, N, w, shift, 32), m)
    const r = (N + to) * 2 * N + from
    return U.re[r] ** 2 + U.im[r] ** 2
  }
  let best = 0, bestP = -1
  for (let i = -12; i <= 12; i++) {
    const x = (i / 8) * guess, p = transfer(x)
    if (p > bestP) { bestP = p; best = x }
  }
  // Parabolic refinement around the best grid point.
  const h = guess / 8, pm = transfer(best - h), pp = transfer(best + h), den = pm - 2 * bestP + pp
  if (den < 0) best += (0.5 * h * (pm - pp)) / den
  return best
}

// Emission-direction weight along the mode axis for a sigma dipole whose axis is at 45 deg:
// W(u) = (1 + (1/2) P2(cos th0) P2(u)) / 2, integrated with 8-point Gauss-Legendre.
const GL_X = [-0.9602898565, -0.7966664774, -0.5255324099, -0.1834346425, 0.1834346425, 0.5255324099, 0.7966664774, 0.9602898565]
const GL_W = [0.1012285363, 0.2223810345, 0.3137066459, 0.3626837834, 0.3626837834, 0.3137066459, 0.2223810345, 0.1012285363]
const P2 = (x: number) => (3 * x * x - 1) / 2
// One absorbed-and-reemitted photon: P(n' | n). The repump beam projection onto the axis (cos^2 = 0.17)
// is set so three photons give the measured 0.027 quanta per repump (C17 Table 2, z-COM).
export function scatterMatrix(etaPhoton: number, N: number, photons = 3, cosAbs = Math.sqrt(0.17)) {
  const one = new Float64Array(N * N)
  for (let q = 0; q < 8; q++) {
    const u = GL_X[q], w = GL_W[q] * 0.5 * (1 + 0.5 * 0.25 * P2(u))
    const D = lambDicke(etaPhoton * Math.abs(cosAbs + u), N)
    for (let i = 0; i < N * N; i++) one[i] += w * D[i] * D[i]
  }
  // Photons are independent.
  let out = one
  for (let p = 1; p < photons; p++) {
    const next = new Float64Array(N * N)
    for (let i = 0; i < N; i++) for (let k = 0; k < N; k++) for (let j = 0; j < N; j++) next[i * N + j] += out[i * N + k] * one[k * N + j]
    out = next
  }
  return out
}

export type CoolingPulse = { order: 1 | 2; periods: number; nbar: number; tUs: number; p: Float64Array }

// Raman sideband cooling of one axial mode, following C17: 2nd-order pulses, then 1st-order,
// each followed by the optical repump. Each pulse uses the exact one-period propagator raised
// to a power (pulse lengths are whole motional periods). The pulse length at each step is chosen
// to maximise the fall in mean occupation, the figure of merit used by C17.
export class SidebandCooler {
  N: number; id: AxialId; eta; p: Float64Array; omega: number
  private U = new Map<number, CMat[]>(); private S: Float64Array; private DS = new Map<number, Float64Array>()
  OmegaCarrier: number; elapsedUs = 0

  constructor(trap: Trap, id: AxialId, nbar0: number, N = 50) {
    this.N = N; this.id = id
    const e = axialEtas(trap, id)
    this.eta = e; this.omega = e.omega
    this.p = thermal(nbar0, N)
    // Carrier Rabi rate set so that the n=1 first-order sideband pi time is PI_TIME_MG_US.
    const D = lambDicke(e.raman, N)
    this.OmegaCarrier = Math.PI / (PI_TIME_MG_US * 1e-6 * Math.abs(D[1]))
    this.S = scatterMatrix(e.scatterMg, N)
    this.DS.set(0, D)
  }

  // Lazily built powers U, U^2, U^4 ... The first call for each sideband order takes a moment.
  private powers(order: 1 | 2) {
    let list = this.U.get(order)
    if (!list) {
      const shift = calibrateSideband(this.eta.raman, this.OmegaCarrier, order, this.omega)
      list = [sidebandPeriod(this.eta.raman, this.OmegaCarrier, order, this.N, this.omega, shift)]
      for (let i = 1; i < 8; i++) list.push(cmul(list[i - 1], list[i - 1]))
      this.U.set(order, list)
    }
    return list
  }

  private bestPeriods(order: 1 | 2) {
    const D = this.DS.get(0)!, N = this.N, T = TWO_PI / this.omega
    let best = 1, bestDrop = -Infinity
    for (let m = 1; m < 255; m += m < 32 ? 1 : 4) {
      const t = m * T; let drop = 0
      for (let n = order; n < N; n++) {
        const g = this.OmegaCarrier * Math.abs(D[(n - order) * N + n])
        drop += this.p[n] * Math.sin(g * t / 2) ** 2 * order
      }
      if (drop > bestDrop + 1e-9) { bestDrop = drop; best = m }
    }
    return best
  }

  // Apply one pulse + repump. Uses the true propagator, and returns the new distribution.
  pulse(order: 1 | 2): CoolingPulse {
    const list = this.powers(order), N = this.N, dim = 2 * N
    const m = this.bestPeriods(order)
    let U: CMat | null = null
    for (let b = 0; b < 8; b++) if (m & (1 << b)) U = U ? cmul(U, list[b]) : list[b]
    const dn = new Float64Array(N), up = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      const w = this.p[n]
      if (w < 1e-14) continue
      for (let r = 0; r < dim; r++) {
        const re = U!.re[r * dim + n], im = U!.im[r * dim + n], a = (re * re + im * im) * w
        if (r < N) dn[r] += a; else up[r - N] += a
      }
    }
    // Optical repump: only the |up> part scatters photons.
    const out = new Float64Array(N)
    for (let i = 0; i < N; i++) {
      out[i] += dn[i]
      for (let j = 0; j < N; j++) out[i] += this.S[i * N + j] * up[j]
    }
    // Anomalous heating and off-resonant Raman scattering, as a thermal-reservoir process (C17, Eq. 3).
    const tUs = (m * TWO_PI / this.omega) * 1e6
    const dtUs = tUs + 25 // B19: 12 ms / 342 pulses, about 35 us per pulse including repump
    const rate = HEATING_Z[this.id] * 1e-6 * dtUs + RAMAN_SCATTER_Z[this.id] * tUs
    const heated = new Float64Array(N)
    for (let n = 0; n < N; n++) {
      heated[n] = out[n] * (1 - rate * (2 * n + 1))
      if (n > 0) heated[n] += out[n - 1] * rate * n
      if (n < N - 1) heated[n] += out[n + 1] * rate * (n + 1)
    }
    let sum = 0
    for (let n = 0; n < N; n++) sum += heated[n]
    for (let n = 0; n < N; n++) heated[n] /= sum
    this.p = heated
    this.elapsedUs += dtUs
    return { order, periods: m, nbar: meanN(heated), tUs, p: heated }
  }
}

// Joint-state simulation of the quantum-logic readout. Basis: Al {S0, 3P1, 3P0} x Mg {down, up} x n.
export const AL_S0 = 0, AL_P1 = 1, AL_P0 = 2
const DIM_AL = 3, DIM_MG = 2

export class QlsExperiment {
  N: number; dim: number; re: Float64Array; im: Float64Array; t = 0
  phase: 'al' | 'mg' | 'done' = 'al'
  decays = 0
  omegaM: number; etaAl: number; etaMg: number
  private DAl: Float64Array; private DMg: Float64Array; private dRe: Float64Array; private dIm: Float64Array
  private tmpRe: Float64Array; private tmpIm: Float64Array; private accRe: Float64Array; private accIm: Float64Array
  private kRe: Float64Array; private kIm: Float64Array
  OmegaAl: number; OmegaMg: number; tAl: number; tMg: number; dt: number; shiftAl: number; shiftMg: number
  rng: () => number
  private DSc: Float64Array[] = []

  constructor(trap: Trap, id: AxialId, seed = 1, N = 9) {
    const e = axialEtas(trap, id)
    this.N = N; this.dim = DIM_AL * DIM_MG * N
    this.omegaM = e.omega; this.etaAl = e.al3p1; this.etaMg = e.raman
    this.DAl = lambDicke(e.al3p1, N); this.DMg = lambDicke(e.raman, N)
    // Carrier Rabi rates set by the sideband pi times of R07: t_pi = pi / (Omega |<1|D|0>|).
    this.tAl = PI_TIME_AL_US * 1e-6; this.tMg = PI_TIME_MG_US * 1e-6
    this.OmegaAl = Math.PI / (this.tAl * Math.abs(this.DAl[N]))
    this.OmegaMg = Math.PI / (this.tMg * Math.abs(this.DMg[N]))
    this.shiftAl = calibrateSideband(e.al3p1, this.OmegaAl, -1, e.omega)
    this.shiftMg = calibrateSideband(e.raman, this.OmegaMg, 1, e.omega)
    this.dt = (TWO_PI / this.omegaM) / 24
    const d = this.dim
    this.re = new Float64Array(d); this.im = new Float64Array(d); this.dRe = new Float64Array(d); this.dIm = new Float64Array(d)
    this.tmpRe = new Float64Array(d); this.tmpIm = new Float64Array(d); this.accRe = new Float64Array(d); this.accIm = new Float64Array(d)
    this.kRe = new Float64Array(d); this.kIm = new Float64Array(d)
    this.rng = makeRng(seed)
    for (let q = 0; q < 8; q++) this.DSc.push(lambDicke(this.etaAl * Math.abs(GL_X[q]), N))
  }

  private ix(al: number, mg: number, n: number) { return (al * DIM_MG + mg) * this.N + n }

  // Start one cycle: Al in S0 or 3P0, Mg in down, motion sampled from P(n).
  start(alState: number, pn: ArrayLike<number>) {
    let u = this.rng(), n0 = 0
    for (let n = 0; n < this.N; n++) { u -= pn[n] ?? 0; if (u <= 0) { n0 = n; break } }
    this.re.fill(0); this.im.fill(0); this.re[this.ix(alState, 0, n0)] = 1
    this.t = 0; this.phase = 'al'; this.decays = 0
  }

  private rhs(t: number, sr: Float64Array, si: Float64Array) {
    const N = this.N, dr = this.dRe, di = this.dIm, w = this.omegaM
    dr.fill(0); di.fill(0)
    if (this.phase === 'al') {
      // Blue sideband of S0 -> 3P1: laser detuned by +w_m. Off-resonant carrier and all others retained.
      const g = this.OmegaAl / 2
      for (let mg = 0; mg < DIM_MG; mg++) for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
        const v = this.DAl[m * N + n]
        if (Math.abs(v) < 1e-6) continue
        const q = Math.abs(m - n) % 4, ph = (m - n - 1) * w * t, c = Math.cos(ph), s = Math.sin(ph)
        const ar = g * v * (IPOW_RE[q] * c - IPOW_IM[q] * s), ai = g * v * (IPOW_RE[q] * s + IPOW_IM[q] * c)
        const up = this.ix(AL_P1, mg, m), dn = this.ix(AL_S0, mg, n)
        di[up] -= ar * sr[dn] - ai * si[dn]; dr[up] += ar * si[dn] + ai * sr[dn]
        di[dn] -= ar * sr[up] + ai * si[up]; dr[dn] += ar * si[up] - ai * sr[up]
      }
      for (let mg = 0; mg < DIM_MG; mg++) for (let n = 0; n < N; n++) {
        const i = this.ix(AL_P1, mg, n); dr[i] += this.shiftAl * si[i]; di[i] -= this.shiftAl * sr[i]
      }
    } else if (this.phase === 'mg') {
      // Raman red sideband of Mg: |down, n> -> |up, n-1>.
      const g = this.OmegaMg / 2
      for (let al = 0; al < DIM_AL; al++) for (let m = 0; m < N; m++) for (let n = 0; n < N; n++) {
        const v = this.DMg[m * N + n]
        if (Math.abs(v) < 1e-6) continue
        const q = Math.abs(m - n) % 4, ph = (m - n + 1) * w * t, c = Math.cos(ph), s = Math.sin(ph)
        const ar = g * v * (IPOW_RE[q] * c - IPOW_IM[q] * s), ai = g * v * (IPOW_RE[q] * s + IPOW_IM[q] * c)
        const up = this.ix(al, 1, m), dn = this.ix(al, 0, n)
        di[up] -= ar * sr[dn] - ai * si[dn]; dr[up] += ar * si[dn] + ai * sr[dn]
        di[dn] -= ar * sr[up] + ai * si[up]; dr[dn] += ar * si[up] - ai * sr[up]
      }
      for (let al = 0; al < DIM_AL; al++) for (let n = 0; n < N; n++) {
        const i = this.ix(al, 1, n); dr[i] += this.shiftMg * si[i]; di[i] -= this.shiftMg * sr[i]
      }
    }
    // 3P1 spontaneous decay: the no-jump part of the Monte Carlo wave function method.
    const hG = 1 / (2 * TAU_3P1)
    for (let mg = 0; mg < DIM_MG; mg++) for (let n = 0; n < N; n++) {
      const i = this.ix(AL_P1, mg, n); dr[i] -= hG * sr[i]; di[i] -= hG * si[i]
    }
  }

  // Advance the wave function by RK4 steps; returns false when the sequence has finished.
  advance(steps: number) {
    const d = this.dim, dt = this.dt
    for (let st = 0; st < steps; st++) {
      if (this.phase === 'done') return false
      const end = this.phase === 'al' ? this.tAl : this.tMg
      const y = this.re, z = this.im, ar = this.accRe, ai = this.accIm, tr = this.tmpRe, ti = this.tmpIm
      ar.set(y); ai.set(z)
      const t = this.t
      this.rhs(t, y, z)
      for (let i = 0; i < d; i++) { ar[i] += (dt / 6) * this.dRe[i]; ai[i] += (dt / 6) * this.dIm[i]; tr[i] = y[i] + (dt / 2) * this.dRe[i]; ti[i] = z[i] + (dt / 2) * this.dIm[i] }
      this.rhs(t + dt / 2, tr, ti)
      for (let i = 0; i < d; i++) { ar[i] += (dt / 3) * this.dRe[i]; ai[i] += (dt / 3) * this.dIm[i]; tr[i] = y[i] + (dt / 2) * this.dRe[i]; ti[i] = z[i] + (dt / 2) * this.dIm[i] }
      this.rhs(t + dt / 2, tr, ti)
      for (let i = 0; i < d; i++) { ar[i] += (dt / 3) * this.dRe[i]; ai[i] += (dt / 3) * this.dIm[i]; tr[i] = y[i] + dt * this.dRe[i]; ti[i] = z[i] + dt * this.dIm[i] }
      this.rhs(t + dt, tr, ti)
      for (let i = 0; i < d; i++) { y[i] = ar[i] + (dt / 6) * this.dRe[i]; z[i] = ai[i] + (dt / 6) * this.dIm[i] }
      this.t += dt
      // Quantum jump test: 3P1 -> S0 with one recoil kick along the mode, dipole pattern.
      let pP1 = 0, norm = 0
      for (let i = 0; i < d; i++) norm += y[i] * y[i] + z[i] * z[i]
      for (let mg = 0; mg < DIM_MG; mg++) for (let n = 0; n < this.N; n++) { const i = this.ix(AL_P1, mg, n); pP1 += y[i] * y[i] + z[i] * z[i] }
      if (this.rng() < (pP1 / norm) * (dt / TAU_3P1)) this.jump()
      else { const s = 1 / Math.sqrt(norm); for (let i = 0; i < d; i++) { y[i] *= s; z[i] *= s } }
      if (this.t >= end) {
        this.t = 0
        this.phase = this.phase === 'al' ? 'mg' : 'done'
      }
    }
    return this.phase !== 'done'
  }

  private jump() {
    const N = this.N, y = this.re, z = this.im
    let u = this.rng(), q = 0
    for (; q < 7; q++) { u -= GL_W[q] / 2; if (u <= 0) break }
    const D = this.DSc[q]
    const nr = new Float64Array(this.dim), ni = new Float64Array(this.dim)
    for (let mg = 0; mg < DIM_MG; mg++) for (let m = 0; m < N; m++) {
      const src = this.ix(AL_P1, mg, m)
      for (let n = 0; n < N; n++) {
        const v = D[n * N + m], k = Math.abs(n - m) % 4, dst = this.ix(AL_S0, mg, n)
        nr[dst] += v * (IPOW_RE[k] * y[src] - IPOW_IM[k] * z[src]); ni[dst] += v * (IPOW_RE[k] * z[src] + IPOW_IM[k] * y[src])
      }
    }
    let s = 0
    for (let i = 0; i < this.dim; i++) s += nr[i] * nr[i] + ni[i] * ni[i]
    s = 1 / Math.sqrt(s)
    for (let i = 0; i < this.dim; i++) { y[i] = nr[i] * s; z[i] = ni[i] * s }
    this.decays++
  }

  population(al: number, mg: number, n: number) {
    const i = this.ix(al, mg, n)
    return this.re[i] ** 2 + this.im[i] ** 2
  }
  probUp() {
    let p = 0
    for (let al = 0; al < DIM_AL; al++) for (let n = 0; n < this.N; n++) p += this.population(al, 1, n)
    return p
  }
  alPops() {
    const out = [0, 0, 0]
    for (let al = 0; al < DIM_AL; al++) for (let mg = 0; mg < DIM_MG; mg++) for (let n = 0; n < this.N; n++) out[al] += this.population(al, mg, n)
    return out
  }
}

// Exact Clebsch-Gordan coefficient <j1 m1; j2 m2 | J M> by the Racah formula.
const logFact = (() => { const a = [0]; for (let i = 1; i < 64; i++) a[i] = a[i - 1] + Math.log(i); return a })()
export function clebsch(j1: number, m1: number, j2: number, m2: number, J: number, M: number) {
  if (Math.abs(m1 + m2 - M) > 1e-9 || J < Math.abs(j1 - j2) || J > j1 + j2 || Math.abs(M) > J) return 0
  const f = (x: number) => logFact[Math.round(x)]
  const pre = 0.5 * (Math.log(2 * J + 1) + f(J + j1 - j2) + f(J - j1 + j2) + f(j1 + j2 - J) - f(j1 + j2 + J + 1)
    + f(J + M) + f(J - M) + f(j1 - m1) + f(j1 + m1) + f(j2 - m2) + f(j2 + m2))
  let sum = 0
  for (let k = 0; k < 40; k++) {
    const a = [k, j1 + j2 - J - k, j1 - m1 - k, j2 + m2 - k, J - j2 + m1 + k, J - j1 - m2 + k]
    if (a.some(x => x < -1e-9)) continue
    sum += (k % 2 ? -1 : 1) * Math.exp(-a.reduce((s, x) => s + f(x), 0))
  }
  return Math.exp(pre) * sum
}

// Optical pumping of Al+ on 1S0 F=5/2 <-> 3P1 F=7/2 as an exact rate equation with Clebsch-Gordan branching.
// purity is the fraction of the light power in the requested circular polarisation; the rest is in the other.
export class OpticalPumping {
  ground = new Float64Array(6).fill(1 / 6) // mF = -5/2 ... 5/2
  excited = new Float64Array(8) // mF' = -7/2 ... 7/2
  sign: 1 | -1
  scattered = 0
  t = 0

  constructor(sign: 1 | -1 = 1) { this.sign = sign }

  reset() { this.ground.fill(1 / 6); this.excited.fill(0); this.scattered = 0; this.t = 0 }

  // rate0: stimulated rate for a unit CG^2, in units of 1/s.
  advance(dt: number, purity: number, rate0: number) {
    const G = 1 / TAU_3P1, g = this.ground, e = this.excited
    const dg = new Float64Array(6), de = new Float64Array(8)
    for (let i = 0; i < 6; i++) {
      const mg = i - 2.5
      for (const q of [-1, 0, 1]) {
        const me = mg + q, j = Math.round(me + 3.5)
        if (j < 0 || j > 7) continue
        const cg2 = clebsch(2.5, mg, 1, q, 3.5, me) ** 2
        // Spontaneous decay.
        dg[i] += G * cg2 * e[j]
        const weight = q === this.sign ? purity : q === -this.sign ? 1 - purity : 0
        const flow = rate0 * weight * cg2 * (g[i] - e[j])
        dg[i] -= flow; de[j] += flow
      }
    }
    for (let j = 0; j < 8; j++) de[j] -= G * e[j]
    let sc = 0
    for (let j = 0; j < 8; j++) sc += G * e[j]
    this.scattered += sc * dt
    for (let i = 0; i < 6; i++) g[i] += dt * dg[i]
    for (let j = 0; j < 8; j++) e[j] += dt * de[j]
    this.t += dt
  }

  stretched() { return this.sign > 0 ? this.ground[5] + this.excited[7] : this.ground[0] + this.excited[0] }
}
