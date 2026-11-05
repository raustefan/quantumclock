// Mutable state shared between the React stages (which run the physics) and the 3D scene (which draws it).
// World axes are micrometres: world x = trap axis z, world y = trap x, world z = trap y.
import { spacing, TRAP_M25, type IonCrystal } from './physics/trap.ts'

export type BeamName = 'cool' | 'al' | 'clock' | 'ramanA' | 'ramanB' | 'repump'

export const viz = {
  paused: false,
  stage: 'clock',
  cameraDistance: 13000,
  cameraDir: [0.62, 0.4, 0.67] as [number, number, number],
  // Ion world positions, um.
  ions: new Float64Array([-spacing(TRAP_M25) * 5e5, 0, 0, spacing(TRAP_M25) * 5e5, 0, 0]),
  rfPhase: 0,
  rfVisible: 0, // 0 hidden, 1 shown: blades glow and the saddle appears
  saddle: 0,
  beams: { cool: 0, al: 0, clock: 0, ramanA: 0, ramanB: 0, repump: 0 } as Record<BeamName, number>,
  photons: 0, // photons waiting to be emitted from Mg+ this frame
  mgGlow: 0.5,
  alGlow: 0.5,
  wave: 0, // wave packet radius as drawn, um
  trail: false,
  trailClear: false,
  bloom: { x: 0, y: 0, z: -1, visible: false, trace: [] as [number, number, number][] },
  // Text for the on-canvas lenses.
  timeLens: '',
  motionLens: '',
}

// Copy the crystal's true positions into world space, with displacement from equilibrium magnified.
export function writeIons(c: IonCrystal, magnify: number) {
  const d = spacing(c.trap), p = c.pos, w = viz.ions, um = 1e6
  w[0] = (-d / 2 + (p[2] + d / 2) * magnify) * um; w[1] = p[0] * magnify * um; w[2] = p[1] * magnify * um
  w[3] = (d / 2 + (p[5] - d / 2) * magnify) * um; w[4] = p[3] * magnify * um; w[5] = p[4] * magnify * um
}

export function placeIonsAtRest() {
  const d = spacing(TRAP_M25) * 1e6, w = viz.ions
  w[0] = -d / 2; w[1] = 0; w[2] = 0; w[3] = d / 2; w[4] = 0; w[5] = 0
}

export function clearBeams() {
  for (const k of Object.keys(viz.beams) as BeamName[]) viz.beams[k] = 0
}

// Common reset when a stage takes over the scene.
const FAR_VIEW: [number, number, number] = [0.62, 0.4, 0.67], AXIS_VIEW: [number, number, number] = [0.86, 0.3, 0.4], SIDE_VIEW: [number, number, number] = [0.12, 0.34, 0.93]
export function enterStage(stage: string, cameraDistance: number) {
  viz.stage = stage; viz.cameraDistance = cameraDistance
  viz.cameraDir = cameraDistance > 3000 ? FAR_VIEW : cameraDistance > 500 ? AXIS_VIEW : SIDE_VIEW
  viz.rfVisible = 0; viz.saddle = 0; viz.wave = 0; viz.trail = false; viz.trailClear = true
  viz.bloom.visible = false; viz.mgGlow = 0.5; viz.alGlow = 0.5; viz.timeLens = ''; viz.motionLens = ''
  clearBeams(); placeIonsAtRest()
}
