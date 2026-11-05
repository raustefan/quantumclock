// Every physical input to the simulation, with where it came from.
// Refs: M25 = Marshall et al., PRL 135, 033201 (2025), arXiv:2504.13071
//       B19 = Brewer et al., PRL 123, 033201 (2019), arXiv:1902.07694
//       C17 = Chen et al., PRL 118, 053002 (2017), arXiv:1608.05047
//       R07 = Rosenband et al., PRL 98, 220801 (2007), arXiv:physics/0703067
//       H07 = Hume et al., PRL 99, 120502 (2007), arXiv:0705.1870

// SI defining constants (exact) and CODATA 2018.
export const C = 299792458
export const H = 6.62607015e-34
export const HBAR = H / (2 * Math.PI)
export const E_CHARGE = 1.602176634e-19
export const KB = 1.380649e-23
export const EPS0 = 8.8541878128e-12
export const AMU = 1.6605390666e-27
export const M_E_AMU = 5.48579909065e-4
export const COULOMB = (E_CHARGE * E_CHARGE) / (4 * Math.PI * EPS0)
export const TWO_PI = 2 * Math.PI

// Ion masses: AME2020 atomic mass minus one electron.
export const M_MG = (24.98583696 - M_E_AMU) * AMU
export const M_AL = (26.98153853 - M_E_AMU) * AMU

// 27Al+ 1S0 <-> 3P0. CIPM 2021 recommended value (BIPM), relative uncertainty 1.9e-16.
export const NU_CLOCK = 1121015393207859.16
export const LAMBDA_CLOCK = C / NU_CLOCK
export const K_CLOCK = TWO_PI / LAMBDA_CLOCK
export const TAU_3P0 = 20.6 // s, R07
export const LAMBDA_3P1 = 266.9e-9 // m, R07
export const K_3P1 = TWO_PI / LAMBDA_3P1
export const TAU_3P1 = 300e-6 // s, R07 and H07
export const G_S0 = -0.00079248 // Bohr magnetons, R07
export const G_P0 = -0.00197686 // Bohr magnetons, R07
export const ZEEMAN_SPLIT_HZ_PER_MT = -82884 // nu(+5/2) - nu(-5/2), R07
export const C2_HZ_PER_MT2 = -71.944 // Brewer et al., PRA 100, 013409 (2019)
export const B_FIELD_MT = 0.0992 // reproduces the M25 mean quadratic Zeeman shift; M25 quotes 0.10 mT

// 25Mg+ 3s 2S1/2 F=3 <-> 3p 2P3/2 F=4 cycling transition.
export const NU_MG = 1072085225e6 // Hz, Batteiger et al., PRA 80, 022503 (2009)
export const LAMBDA_MG = C / NU_MG
export const K_MG = TWO_PI / LAMBDA_MG
export const GAMMA_MG = TWO_PI * 41.3e6 // Clos et al., PRL 112, 113003 (2014); M25's Doppler limit implies the same value
export const HYPERFINE_MG = 1788762753.74 // Hz, M25

// Trap and cooling, as operated in M25.
export const OMEGA_RF = TWO_PI * 70.86e6 // M25
export const SAT_DOPPLER = 0.148 // on-resonance saturation parameter, M25 campaign average
export const DETUNING_DOPPLER = -GAMMA_MG / 2 // M25
export const ION_ELECTRODE_M = 250e-6 // C17
export const WAFER_THICKNESS_M = 500e-6 // M25
export const ENDCAP_DISTANCE_M = 4e-3 // C17
export const VACUUM_PA = 2.5e-10 // M25
export const BBR_ALPHA = 6.86e-42 // differential polarizability, J m^2 / V^2, as used in M25
export const T_BBR = 297.15 // K (24.0 C), M25

// Cooling-beam direction in trap axes (x, y, z). The papers do not state it, but the
// axial and radial kappa factors in M25 Table S2 fix it: kappa = 1 + alpha / cos^2(theta)
// with kappa_z = 1.7 and kappa_r = 2.3 require a beam near 45 deg to the axis, between x and y.
export const KHAT_DOPPLER: [number, number, number] = [0.5, 0.5, Math.SQRT1_2]

// Clock and 3P1 probe direction cosines in trap axes. The papers do not state the angle; this axial
// projection yields C17's measured 11 % Debye-Waller slowdown for a Doppler-cooled pair (see tests).
export const PROBE_COS_Z = 0.81

// M25 Table S2.
export const MODES_M25 = [
  { id: 'z-com', axis: 'z', kind: 'COM', fMHz: 2.16, shiftPerQuantum: -0.95e-19, nbar: 8.22, nbarErr: 0.48, kappa: 1.7, nbarDoppler: 8.1 },
  { id: 'z-str', axis: 'z', kind: 'STR', fMHz: 3.75, shiftPerQuantum: -1.42e-19, nbar: 4.5, nbarErr: 0.19, kappa: 1.7, nbarDoppler: 4.6 },
  { id: 'x-com', axis: 'x', kind: 'COM', fMHz: 4.22, shiftPerQuantum: -1.77e-19, nbar: 5.68, nbarErr: 0.49, kappa: 2.3, nbarDoppler: 5.5 },
  { id: 'x-str', axis: 'x', kind: 'STR', fMHz: 3.48, shiftPerQuantum: -6.48e-19, nbar: 6.69, nbarErr: 0.51, kappa: 2.3, nbarDoppler: 6.8 },
  { id: 'y-com', axis: 'y', kind: 'COM', fMHz: 5.37, shiftPerQuantum: -1.42e-19, nbar: 4.31, nbarErr: 0.14, kappa: 2.3, nbarDoppler: 4.4 },
  { id: 'y-str', axis: 'y', kind: 'STR', fMHz: 4.75, shiftPerQuantum: -6.53e-19, nbar: 4.84, nbarErr: 0.24, kappa: 2.3, nbarDoppler: 5.0 },
] as const

// M25 Table 1: fractional shift and uncertainty, units of 1e-19.
export const BUDGET_M25 = [
  { effect: 'Quadratic Zeeman (dc)', shift: -6317.9, unc: 2.5 },
  { effect: 'Secular motion', shift: -114.6, unc: 3.8 },
  { effect: 'Cooling laser Stark', shift: -37.2, unc: 2.0 },
  { effect: 'Blackbody radiation', shift: -30.7, unc: 1.7 },
  { effect: 'Excess micromotion', shift: -1.6, unc: 1.6 },
  { effect: 'Clock laser Stark', shift: 0, unc: 0.8 },
  { effect: 'Quadratic Zeeman (ac)', shift: -0.54, unc: 0.06 },
  { effect: 'Background gas', shift: -0.3, unc: 0.4 },
] as const
export const BUDGET_TOTAL = { shift: -6502.8, unc: 5.5 }
export const INSTABILITY_M25 = 3.5e-16 // / sqrt(tau / s)
export const PROBE_M25 = 1 // s, Rabi
export const DUTY_M25 = 0.8

// Raman cooling and readout. Mg+ qubit |down> = |F=3, mF=-3>, |up> = |F=2, mF=-2> (C17).
// C17 Table 1 gives eta(z-COM) = 0.18 at 2.7 MHz, which fixes the effective Raman wavevector.
export const RAMAN_DK = 2.92e7 // 1/m along the axis
export const HEATING_Z = { 'z-com': 9.12, 'z-str': 0.34 } as const // quanta/s, C17 Table 2
export const RAMAN_SCATTER_Z = { 'z-com': 8.7e-5, 'z-str': 5.9e-5 } as const // Raman + Rayleigh, quanta/us, C17 Table 2
export const PULSES_2ND = 15 // C17
export const PULSES_1ST = 25 // C17
export const PI_TIME_MG_US = 10 // first-order sideband pi time; not published for Mg+, consistent with B19's 35 us per pulse and repump
export const PI_TIME_AL_US = 30 // Al+ 3P1 sideband pi time, R07
export const BRIGHT_COUNTS = 8 // photons in 250 us from |down>, C17
export const DARK_COUNTS = 0.9 // photons in 250 us from |up>, C17
export const DETECT_US = 250 // C17
export const LIKELIHOOD_STOP = 1e3 // H07
export const READOUT_CYCLE_MS = 2 // R07
