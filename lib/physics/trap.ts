// Classical dynamics of the two-ion crystal in the full, time-dependent Paul-trap field.
// There is no pseudopotential here: the RF term is integrated cycle by cycle.
import {
  C, COULOMB, DETUNING_DOPPLER, GAMMA_MG, HBAR, K_MG, KB, KHAT_DOPPLER, M_AL, M_MG, OMEGA_RF, SAT_DOPPLER, TWO_PI,
} from './constants.ts'

export const MASSES = [M_MG, M_AL] as const

// Force on an ion at (x, y, z) from the trap:
//   Fx = -(kx + R cos(Wt)) x,  Fy = -(ky - R cos(Wt)) y,  Fz = -K z,  kx + ky + K = 0 (Laplace).
export type Trap = { R: number; K: number; D: number; omega: number }

// Mathieu parameters for the Mg+ / Al+ ions follow from a Trap.
export const mathieuQ = (t: Trap, m: number) => (2 * t.R) / (m * t.omega * t.omega)
export const mathieuA = (k: number, t: Trap, m: number) => (4 * k) / (m * t.omega * t.omega)
export const kx = (t: Trap) => -t.K / 2 + t.D
export const ky = (t: Trap) => -t.K / 2 - t.D

// Trap fitted to the six measured mode frequencies of Marshall 2025 (see test/physics.test.ts).
// Fit residual: 2.5 kHz rms over the four radial modes, with two free parameters (R, D).
export const TRAP_M25: Trap = {
  R: 8.466825000723198e-10,
  K: M_MG * (TWO_PI * 2.205e6) ** 2,
  D: -8.948325764968845e-12,
  omega: OMEGA_RF,
}

export const spacing = (t: Trap) => Math.cbrt((2 * COULOMB) / t.K) // exact, independent of mass

// Axial normal modes (exact: the axial problem is static and linear about equilibrium).
export function axialModes(t: Trap) {
  const [m1, m2] = MASSES
  // Mass-weighted Hessian [[2K/m1, -K/sqrt(m1 m2)], [-K/sqrt(m1 m2), 2K/m2]]
  const a = (2 * t.K) / m1, b = (2 * t.K) / m2, c = -t.K / Math.sqrt(m1 * m2)
  const s = Math.sqrt(((a - b) / 2) ** 2 + c * c), mid = (a + b) / 2
  const mode = (w2: number) => {
    const v = [c, w2 - a], n = Math.hypot(v[0], v[1])
    const bv: [number, number] = [v[0] / n, v[1] / n]
    return { omega: Math.sqrt(w2), b: bv }
  }
  const com = mode(mid - s), str = mode(mid + s)
  if (com.b[0] < 0) com.b = [-com.b[0], -com.b[1]]
  if (str.b[0] < 0) str.b = [-str.b[0], -str.b[1]]
  return { com, str }
}

// Fundamental matrix of the linearised radial problem over one RF period (exact Floquet theory).
function radialMonodromy(t: Trap, axis: 'x' | 'y', n = 1024) {
  const k = axis === 'x' ? kx(t) : ky(t), sign = axis === 'x' ? 1 : -1
  const [m1, m2] = MASSES
  const c = t.K / 2 // Coulomb stiffness c/d^3 = K/2 exactly
  const T = TWO_PI / t.omega, dt = T / n
  const deriv = (s: number[], tau: number): number[] => {
    const f = k + sign * t.R * Math.cos(t.omega * tau)
    return [s[2], s[3], -((f - c) * s[0] + c * s[1]) / m1, -((f - c) * s[1] + c * s[0]) / m2]
  }
  const M: number[][] = [[], [], [], []]
  for (let col = 0; col < 4; col++) {
    let s = [0, 0, 0, 0]; s[col] = 1
    // The velocity columns are scaled by T to keep the matrix well conditioned.
    if (col >= 2) s[col] = 1 / T
    for (let i = 0; i < n; i++) s = rk4(s, i * dt, dt, deriv)
    for (let r = 0; r < 4; r++) M[r][col] = r >= 2 ? s[r] * T : s[r]
  }
  return M
}

function rk4(s: number[], tau: number, dt: number, f: (s: number[], t: number) => number[]) {
  const k1 = f(s, tau), add = (a: number[], b: number[], h: number) => a.map((v, i) => v + h * b[i])
  const k2 = f(add(s, k1, dt / 2), tau + dt / 2), k3 = f(add(s, k2, dt / 2), tau + dt / 2), k4 = f(add(s, k3, dt), tau + dt)
  return s.map((v, i) => v + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
}

// Two reciprocal eigenvalue pairs of a real 4x4 symplectic matrix, from its traces.
function floquetPhases(M: number[][]) {
  let tr = 0, tr2 = 0
  for (let i = 0; i < 4; i++) { tr += M[i][i]; for (let j = 0; j < 4; j++) tr2 += M[i][j] * M[j][i] }
  const c2 = (tr * tr - tr2) / 2
  const disc = tr * tr - 4 * (c2 - 2)
  if (disc < 0) return null
  const s1 = (tr + Math.sqrt(disc)) / 2, s2 = (tr - Math.sqrt(disc)) / 2
  if (Math.abs(s1) >= 2 || Math.abs(s2) >= 2) return null
  return [Math.acos(s1 / 2), Math.acos(s2 / 2)]
}

// Complex null vector of (M - e^{i mu} I): Gaussian elimination with complete pivoting (rank 3).
function nullVector(M: number[][], mu: number) {
  const c = Math.cos(mu), s = Math.sin(mu)
  const re = M.map((r, i) => r.map((v, j) => v - (i === j ? c : 0)))
  const im = M.map((r, i) => r.map((_, j) => (i === j ? -s : 0)))
  const cols = [0, 1, 2, 3]
  for (let k = 0; k < 3; k++) {
    let best = -1, pr = k, pc = k
    for (let r = k; r < 4; r++) for (let q = k; q < 4; q++) {
      const a = re[r][cols[q]] ** 2 + im[r][cols[q]] ** 2
      if (a > best) { best = a; pr = r; pc = q }
    }
    ;[re[k], re[pr]] = [re[pr], re[k]]; [im[k], im[pr]] = [im[pr], im[k]]; [cols[k], cols[pc]] = [cols[pc], cols[k]]
    const col = cols[k], dr = re[k][col], di = im[k][col], d = dr * dr + di * di
    for (let j = 0; j < 4; j++) { const a = re[k][j], b = im[k][j]; re[k][j] = (a * dr + b * di) / d; im[k][j] = (b * dr - a * di) / d }
    for (let r = 0; r < 4; r++) if (r !== k) {
      const fr = re[r][col], fi = im[r][col]
      for (let j = 0; j < 4; j++) { const a = re[k][j], b = im[k][j]; re[r][j] -= fr * a - fi * b; im[r][j] -= fr * b + fi * a }
    }
  }
  const free = cols[3], vr = [0, 0, 0, 0], vi = [0, 0, 0, 0]
  vr[free] = 1
  for (let k = 0; k < 3; k++) { vr[cols[k]] = -re[k][free]; vi[cols[k]] = -im[k][free] }
  return { vr, vi }
}

export type RadialMode = {
  id: string; axis: 'x' | 'y'; kind: 'COM' | 'STR'; omega: number
  shiftPerQuantum: number // exact, including intrinsic micromotion
  // Floquet solution at RF phase 0: complex (Mg, Al) position and velocity for one unit of action.
  xr: [number, number]; xi: [number, number]; vr: [number, number]; vi: [number, number]
}

// Exact radial Floquet modes. COM has the higher frequency and the ions moving together.
export function radialModes(t: Trap, axis: 'x' | 'y'): RadialMode[] | null {
  const M = radialMonodromy(t, axis)
  const mus = floquetPhases(M)
  if (!mus) return null
  const T = TWO_PI / t.omega
  const modes = mus.map(mu => {
    const { vr, vi } = nullVector(M, mu)
    // Undo the T scaling of velocities, then quantise: sum_i m_i (u v* - v u*) = i hbar.
    let ur = [vr[0], vr[1]], ui = [vi[0], vi[1]], wr = [vr[2] / T, vr[3] / T], wi = [vi[2] / T, vi[3] / T]
    let wron = 0
    for (let i = 0; i < 2; i++) wron += MASSES[i] * 2 * (ui[i] * wr[i] - ur[i] * wi[i])
    if (wron < 0) { ui = ui.map(v => -v); wi = wi.map(v => -v); wron = -wron }
    const norm = Math.sqrt(HBAR / wron)
    ur = ur.map(v => v * norm); ui = ui.map(v => v * norm); wr = wr.map(v => v * norm); wi = wi.map(v => v * norm)
    // Average v_Al^2 over a full RF period by propagating the Floquet solution.
    const k = axis === 'x' ? kx(t) : ky(t), sign = axis === 'x' ? 1 : -1
    const c = t.K / 2
    const n = 256, dt = T / n
    const deriv = (s: number[], tau: number) => {
      const f = k + sign * t.R * Math.cos(t.omega * tau)
      return [s[2], s[3], -((f - c) * s[0] + c * s[1]) / MASSES[0], -((f - c) * s[1] + c * s[0]) / MASSES[1]]
    }
    let a = [ur[0], ur[1], wr[0], wr[1]], b = [ui[0], ui[1], wi[0], wi[1]]
    let v2 = 0
    for (let i = 0; i < n; i++) {
      v2 += a[3] * a[3] + b[3] * b[3]
      a = rk4(a, i * dt, dt, deriv); b = rk4(b, i * dt, dt, deriv)
    }
    v2 /= n
    return {
      omega: mu / T, shiftPerQuantum: -v2 / (C * C),
      xr: [ur[0], ur[1]] as [number, number], xi: [ui[0], ui[1]] as [number, number],
      vr: [wr[0], wr[1]] as [number, number], vi: [wi[0], wi[1]] as [number, number],
      together: ur[0] * ur[1] + ui[0] * ui[1] > 0,
    }
  })
  return modes.map(m => ({
    id: `${axis}-${m.together ? 'com' : 'str'}`, axis, kind: m.together ? 'COM' as const : 'STR' as const, omega: m.omega,
    shiftPerQuantum: m.shiftPerQuantum, xr: m.xr, xi: m.xi, vr: m.vr, vi: m.vi,
  }))
}

// Single-ion Mathieu stability from the exact monodromy trace: x'' + (a - 2q cos 2tau) x = 0.
export function mathieuStable(a: number, q: number, n = 96) {
  const h = Math.PI / n
  let x1 = 1, v1 = 0, x2 = 0, v2 = 1
  const acc = (x: number, tau: number) => -(a - 2 * q * Math.cos(2 * tau)) * x
  for (let i = 0; i < n; i++) {
    const tau = i * h
    for (const pair of [0, 1]) {
      const x = pair ? x2 : x1, v = pair ? v2 : v1
      const k1x = v, k1v = acc(x, tau)
      const k2x = v + (h / 2) * k1v, k2v = acc(x + (h / 2) * k1x, tau + h / 2)
      const k3x = v + (h / 2) * k2v, k3v = acc(x + (h / 2) * k2x, tau + h / 2)
      const k4x = v + h * k3v, k4v = acc(x + h * k3x, tau + h)
      const nx = x + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x), nv = v + (h / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
      if (pair) { x2 = nx; v2 = nv } else { x1 = nx; v1 = nv }
    }
  }
  return Math.abs(x1 + v2) < 2
}

// Deterministic generator so that the tests and the demos are reproducible.
export function makeRng(seed = 1) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Laser = { saturation: number; detuning: number; on: boolean }
const W1 = 1 / (2 - Math.cbrt(2)), W0 = 1 - 2 * W1

// Full three-dimensional molecular dynamics of the two ions. Positions and velocities are
// [xMg, yMg, zMg, xAl, yAl, zAl]. Integrated with a fourth-order symplectic (Yoshida) scheme at
// a fixed fraction of the RF period.
export class IonCrystal {
  trap: Trap
  pos = new Float64Array(6)
  vel = new Float64Array(6)
  t = 0
  dt: number
  laser: Laser = { saturation: SAT_DOPPLER, detuning: DETUNING_DOPPLER, on: false }
  photons = 0
  lost = false
  private rng: () => number
  // Running means since the last resetStats().
  sumV2Al = 0; sumV2Mg = 0; sumEcom = 0; sumEstr = 0; nStats = 0; maxRadius = 0
  private com; private str; private d = 0

  constructor(trap: Trap, stepsPerRF = 32, seed = 1) {
    this.trap = trap
    this.dt = (TWO_PI / trap.omega) / stepsPerRF
    this.rng = makeRng(seed)
    const m = axialModes(trap)
    this.com = m.com; this.str = m.str
    this.d = spacing(trap)
    this.reset()
  }

  setTrap(trap: Trap) {
    const { com, str } = axialModes(trap)
    this.trap = trap; this.com = com; this.str = str; this.d = spacing(trap)
  }

  reset() {
    const d = this.d
    this.pos.fill(0); this.vel.fill(0)
    this.pos[2] = -d / 2; this.pos[5] = d / 2
    this.lost = false; this.photons = 0; this.t = 0
    this.resetStats()
  }

  // Maxwell velocities at temperature T around the exact equilibrium.
  thermalise(T: number) {
    this.reset()
    for (let i = 0; i < 6; i++) {
      const m = MASSES[i < 3 ? 0 : 1]
      this.vel[i] = gauss(this.rng) * Math.sqrt((KB * T) / m)
    }
  }

  resetStats() {
    this.sumV2Al = 0; this.sumV2Mg = 0; this.sumEcom = 0; this.sumEstr = 0; this.nStats = 0
  }

  // Excite one Floquet (radial) or normal (axial) mode with n quanta, exactly on the eigen-solution.
  exciteMode(id: string, quanta: number) {
    this.reset()
    const axis = id[0], kind = id.slice(2)
    if (axis === 'z') {
      const m = kind === 'com' ? this.com : this.str
      const v = Math.sqrt((2 * quanta * HBAR * m.omega))
      this.vel[2] = (v * m.b[0]) / Math.sqrt(MASSES[0])
      this.vel[5] = (v * m.b[1]) / Math.sqrt(MASSES[1])
      return
    }
    const modes = radialModes(this.trap, axis as 'x' | 'y')
    const mode = modes?.find(x => x.id === id)
    if (!mode) return
    const off = axis === 'x' ? 0 : 1, amp = Math.sqrt(quanta) * 2
    for (const i of [0, 1]) {
      this.pos[i * 3 + off] = amp * mode.xr[i]
      this.vel[i * 3 + off] = amp * mode.vr[i]
    }
  }

  // Advance by n steps. Returns the number of Mg+ scattering events (each flashes in the scene).
  step(n: number): number {
    const p = this.pos, v = this.vel, tr = this.trap, om = tr.omega
    const kX = kx(tr), kY = ky(tr), R = tr.R, K = tr.K
    const im1 = 1 / MASSES[0], im2 = 1 / MASSES[1]
    const dt = this.dt
    const seq = [W1 * dt, W0 * dt, W1 * dt]
    let events = 0
    const L = this.laser
    const [kxH, kyH, kzH] = KHAT_DOPPLER
    const k = K_MG
    const recoil = (HBAR * k) / MASSES[0]
    for (let s = 0; s < n && !this.lost; s++) {
      for (let j = 0; j < 3; j++) {
        const h = seq[j]
        p[0] += 0.5 * h * v[0]; p[1] += 0.5 * h * v[1]; p[2] += 0.5 * h * v[2]
        p[3] += 0.5 * h * v[3]; p[4] += 0.5 * h * v[4]; p[5] += 0.5 * h * v[5]
        const c = Math.cos(om * (this.t + 0.5 * h))
        const dx = p[0] - p[3], dy = p[1] - p[4], dz = p[2] - p[5]
        const r2 = dx * dx + dy * dy + dz * dz, ir = Math.sqrt(1 / r2), f = COULOMB * ir * ir * ir
        const fx = f * dx, fy = f * dy, fz = f * dz
        v[0] += h * im1 * (-(kX + R * c) * p[0] + fx)
        v[1] += h * im1 * (-(kY - R * c) * p[1] + fy)
        v[2] += h * im1 * (-K * p[2] + fz)
        v[3] += h * im2 * (-(kX + R * c) * p[3] - fx)
        v[4] += h * im2 * (-(kY - R * c) * p[4] - fy)
        v[5] += h * im2 * (-K * p[5] - fz)
        p[0] += 0.5 * h * v[0]; p[1] += 0.5 * h * v[1]; p[2] += 0.5 * h * v[2]
        p[3] += 0.5 * h * v[3]; p[4] += 0.5 * h * v[4]; p[5] += 0.5 * h * v[5]
        this.t += h
      }
      if (L.on) {
        const kv = k * (kxH * v[0] + kyH * v[1] + kzH * v[2])
        const delta = L.detuning - kv, s0 = L.saturation
        const rate = 0.5 * GAMMA_MG * (s0 / (1 + s0 + (4 * delta * delta) / (GAMMA_MG * GAMMA_MG)))
        if (this.rng() < rate * dt) {
          events++; this.photons++
          // Absorption along the beam; emission with the sigma-transition dipole pattern about it.
          v[0] += recoil * kxH; v[1] += recoil * kyH; v[2] += recoil * kzH
          const [ex, ey, ez] = dipoleDirection(this.rng, kxH, kyH, kzH)
          v[0] += recoil * ex; v[1] += recoil * ey; v[2] += recoil * ez
        }
      }
      // Time-averaged statistics.
      const v2Al = v[3] * v[3] + v[4] * v[4] + v[5] * v[5], v2Mg = v[0] * v[0] + v[1] * v[1] + v[2] * v[2]
      this.sumV2Al += v2Al; this.sumV2Mg += v2Mg
      const d = this.d
      const zm = p[2] + d / 2, za = p[5] - d / 2, s1 = Math.sqrt(MASSES[0]), s2 = Math.sqrt(MASSES[1])
      const com = this.com, str = this.str
      const qc = com.b[0] * s1 * zm + com.b[1] * s2 * za, qs = str.b[0] * s1 * zm + str.b[1] * s2 * za
      const pc = com.b[0] * s1 * v[2] + com.b[1] * s2 * v[5], ps = str.b[0] * s1 * v[2] + str.b[1] * s2 * v[5]
      this.sumEcom += 0.5 * (pc * pc + com.omega * com.omega * qc * qc)
      this.sumEstr += 0.5 * (ps * ps + str.omega * str.omega * qs * qs)
      this.nStats++
      const rad = Math.max(p[0] * p[0] + p[1] * p[1], p[3] * p[3] + p[4] * p[4])
      if (rad > 2.5e-4 * 2.5e-4) this.lost = true
    }
    return events
  }

  // Time dilation of the Al+ clock ion, time averaged. Higher orders in v/c are below 1e-30 here.
  timeDilation() {
    return this.nStats ? -(this.sumV2Al / this.nStats) / (2 * C * C) : 0
  }

  // Kinetic temperature of one ion, per degree of freedom.
  temperature(ion: 0 | 1) {
    if (!this.nStats) return 0
    const sum = ion ? this.sumV2Al : this.sumV2Mg
    return (MASSES[ion] * (sum / this.nStats)) / (3 * KB)
  }

  axialQuanta() {
    if (!this.nStats) return { com: 0, str: 0 }
    return {
      com: this.sumEcom / this.nStats / (HBAR * this.com.omega),
      str: this.sumEstr / this.nStats / (HBAR * this.str.omega),
    }
  }
}

export function gauss(rng: () => number) {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(TWO_PI * rng())
}

// Sample an emission direction with the sigma-polarised dipole pattern (1 + cos^2 theta) about the axis.
export function dipoleDirection(rng: () => number, ax: number, ay: number, az: number): [number, number, number] {
  let u: number
  do { u = 2 * rng() - 1 } while (rng() * 2 > 1 + u * u)
  const phi = TWO_PI * rng(), st = Math.sqrt(1 - u * u)
  // Orthonormal basis around the axis.
  const px = Math.abs(ax) < 0.9 ? 1 : 0, py = px ? 0 : 1
  let bx = py * az, by = -px * az, bz = px * ay - py * ax
  const n = Math.hypot(bx, by, bz); bx /= n; by /= n; bz /= n
  const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx
  const a = st * Math.cos(phi), b = st * Math.sin(phi)
  return [u * ax + a * bx + b * cx, u * ay + a * by + b * cy, u * az + a * bz + b * cz]
}

// Scattering-limited Doppler occupation for a mode, as in M25: n = (Gamma / 4 omega) kappa.
export const dopplerLimitQuanta = (omega: number, kappa: number) => (GAMMA_MG / (4 * omega)) * kappa
