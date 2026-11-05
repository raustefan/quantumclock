// The instrument in 3D. One world unit is one micrometre, so every zoom level is true to scale:
// the 500 um wafer, the 250 um ion-electrode distance, the endcaps 4 mm away, the 3.9 um ion pair.
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { ENDCAP_DISTANCE_M, ION_ELECTRODE_M, KHAT_DOPPLER, PROBE_COS_Z, WAFER_THICKNESS_M } from '@/lib/physics/constants'
import { viz, type BeamName } from '@/lib/viz'

export const COLORS = { mg: 0xf07cc0, al: 0x7fdcf5, gold: 0xe8b94f, clock: 0xfff1c0, cool: 0xa596ff, raman: 0xf07cc0, ground: 0x171130 }
const R_TIP = ION_ELECTRODE_M * 1e6, THICK = WAFER_THICKNESS_M * 1e6, ENDCAP = ENDCAP_DISTANCE_M * 1e6
const WAFER = 2600

const glowTexture = (() => {
  let tex: THREE.CanvasTexture | null = null
  return () => {
    if (tex) return tex
    const c = document.createElement('canvas'); c.width = c.height = 128
    const g = c.getContext('2d')!, r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.45)'); r.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = r; g.fillRect(0, 0, 128, 128)
    tex = new THREE.CanvasTexture(c)
    return tex
  }
})()

// Aperture contour: four blade tips on the trap's x and y axes, radius R_TIP at the tips.
const aperture = (theta: number) => R_TIP + 900 * Math.abs(Math.sin(2 * theta)) ** 0.65
const WAFER_CLEARANCE = 6 // the wafer sits just behind the gold, so the two surfaces never coincide

function waferGeometry() {
  const shape = new THREE.Shape()
  shape.moveTo(-WAFER, -WAFER); shape.lineTo(WAFER, -WAFER); shape.lineTo(WAFER, WAFER); shape.lineTo(-WAFER, WAFER); shape.closePath()
  const hole = new THREE.Path()
  for (let i = 0; i <= 240; i++) {
    const th = (i / 240) * Math.PI * 2, r = aperture(th) + WAFER_CLEARANCE, x = r * Math.cos(th), y = r * Math.sin(th)
    if (i === 0) hole.moveTo(x, y); else hole.lineTo(x, y)
  }
  shape.holes.push(hole)
  return extruded(shape, THICK)
}

function extruded(shape: THREE.Shape, depth: number) {
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 })
  g.translate(0, 0, -depth / 2)
  g.rotateY(Math.PI / 2) // extrusion axis along world x (the trap axis)
  return g
}

// Gold-coated blade around one tip.
function bladeGeometry(angle: number) {
  const shape = new THREE.Shape(), half = 0.46, n = 32
  for (let i = 0; i <= n; i++) {
    const th = angle - half + (2 * half * i) / n, r = aperture(th)
    const x = r * Math.cos(th), y = r * Math.sin(th)
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y)
  }
  const out = 1500
  shape.lineTo(out * Math.cos(angle + half), out * Math.sin(angle + half))
  shape.lineTo(out * Math.cos(angle - half), out * Math.sin(angle - half))
  shape.closePath()
  return extruded(shape, THICK + 30)
}

function endcap(sign: number, mat: THREE.Material) {
  const pts: THREE.Vector2[] = []
  for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI * 0.5; pts.push(new THREE.Vector2(380 * Math.sin(a), 380 * (1 - Math.cos(a)))) }
  pts.push(new THREE.Vector2(620, 1100), new THREE.Vector2(620, 6000))
  const g = new THREE.LatheGeometry(pts, 64)
  g.rotateZ(-Math.PI / 2 * sign) // tip towards the ions
  const m = new THREE.Mesh(g, mat)
  m.position.x = sign * ENDCAP
  return m
}

function beamMaterial(color: number) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { color: { value: new THREE.Color(color) }, strength: { value: 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
    fragmentShader: 'uniform vec3 color; uniform float strength; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(abs(dot(normalize(vN),normalize(vV))),2.2); gl_FragColor = vec4(color, f*strength); }',
  })
}

type Beam = { mesh: THREE.Mesh; mat: THREE.ShaderMaterial; level: number }

export class InstrumentScene {
  renderer: THREE.WebGLRenderer
  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(36, 1, 1, 200000)
  controls: OrbitControls
  composer: EffectComposer
  bloomPass: UnrealBloomPass
  private hardware = new THREE.Group()
  private rfA: THREE.MeshStandardMaterial
  private rfB: THREE.MeshStandardMaterial
  private ions: { mesh: THREE.Mesh; glow: THREE.Sprite; cloud: THREE.Sprite }[] = []
  private beams = {} as Record<BeamName, Beam>
  private saddle: THREE.Mesh
  private photons: THREE.Points
  private photonVel = new Float32Array(400 * 3)
  private photonLife = new Float32Array(400)
  private photonNext = 0
  private trails: { line: THREE.Line; count: number }[] = []
  private bloch = new THREE.Group()
  private blochArrow: THREE.Mesh
  private blochHead: THREE.Mesh
  private blochTrace: THREE.Line
  private goalDistance = 15000
  private goalDir = new THREE.Vector3(0.62, 0.4, 0.67).normalize()
  private flying = true
  private lastStage = ''
  private el: Record<'scale' | 'scaleBar' | 'time' | 'motion' | 'mg' | 'al' | 'north' | 'south', HTMLElement | null>
  private lastFrame = performance.now()
  private frameId = 0
  private width = 1; private height = 1
  private resize: ResizeObserver
  private reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  constructor(canvas: HTMLCanvasElement, overlay: HTMLElement) {
    this.el = {
      scale: overlay.querySelector('[data-scale-label]'), scaleBar: overlay.querySelector('[data-scale-bar]'),
      time: overlay.querySelector('[data-time]'), motion: overlay.querySelector('[data-motion]'),
      mg: overlay.querySelector('[data-label-mg]'), al: overlay.querySelector('[data-label-al]'),
      north: overlay.querySelector('[data-label-north]'), south: overlay.querySelector('[data-label-south]'),
    }
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    this.renderer = r
    r.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05
    const pm = new THREE.PMREMGenerator(r)
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    this.scene.environmentIntensity = 0.75
    this.scene.background = new THREE.Color(0x261a44)
    this.camera.position.set(9000, 6000, 12000)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08; this.controls.enablePan = false
    this.controls.minDistance = 3; this.controls.maxDistance = 40000; this.controls.zoomSpeed = 1.3
    this.controls.addEventListener('start', () => { this.flying = false })

    // Light: a soft key and a violet rim that reads as UV scatter on the gold.
    const key = new THREE.DirectionalLight(0xfff4e0, 1.6); key.position.set(1, 2, 1.5); this.scene.add(key)
    const rim = new THREE.DirectionalLight(0x8a7bff, 1.4); rim.position.set(-2, -1, -1); this.scene.add(rim)

    // Diamond wafer.
    const diamond = new THREE.MeshPhysicalMaterial({ color: 0xb9bdf5, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.1, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide, depthWrite: false })
    const wafer = waferGeometry()
    this.scene.add(this.hardware)
    this.hardware.add(new THREE.Mesh(wafer, diamond))
    this.hardware.add(new THREE.LineSegments(new THREE.EdgesGeometry(wafer, 30), new THREE.LineBasicMaterial({ color: 0xcfd2ff, transparent: true, opacity: 0.28 })))

    // Gold RF blades, driven differentially: opposite tips share a phase.
    const gold = () => new THREE.MeshStandardMaterial({ color: 0xd9a93f, metalness: 1, roughness: 0.26, emissive: 0xff8a3c, emissiveIntensity: 0 })
    this.rfA = gold(); this.rfB = gold()
    this.rfB.emissive = new THREE.Color(0x6a7bff)
    for (const [angle, mat] of [[0, this.rfA], [Math.PI, this.rfA], [Math.PI / 2, this.rfB], [-Math.PI / 2, this.rfB]] as const) {
      this.hardware.add(new THREE.Mesh(bladeGeometry(angle), mat))
      // Gold trace from blade root out to the wafer edge.
      const trace = new THREE.Mesh(new THREE.BoxGeometry(THICK + 24, WAFER - 1300, 190), mat)
      const pivot = new THREE.Group()
      trace.position.y = (1300 + WAFER) / 2
      pivot.add(trace)
      pivot.rotation.x = angle - Math.PI / 2 // blade contour angle in the wafer plane, seen from +x
      this.hardware.add(pivot)
    }
    // Titanium endcaps, biased for axial confinement, 4 mm from the ions.
    const ti = new THREE.MeshStandardMaterial({ color: 0x8f93a6, metalness: 1, roughness: 0.42 })
    this.hardware.add(endcap(1, ti), endcap(-1, ti))

    // Beams, in world axes: x = trap z, y = trap x, z = trap y.
    const [kx, ky, kz] = KHAT_DOPPLER, c = PROBE_COS_Z, s = Math.sqrt(1 - c * c)
    this.addBeam('cool', COLORS.cool, [kz, kx, ky])
    this.addBeam('clock', COLORS.clock, [c, s, 0])
    this.addBeam('al', COLORS.al, [c, -s * 0.8, s * 0.6])
    this.addBeam('ramanA', COLORS.mg, [Math.SQRT1_2, Math.SQRT1_2, 0])
    this.addBeam('ramanB', COLORS.mg, [-Math.SQRT1_2, Math.SQRT1_2, 0])
    this.addBeam('repump', 0xc0b0ff, [0.42, -0.6, 0.68])

    // Instantaneous potential of the RF quadrupole across the aperture.
    const sg = new THREE.PlaneGeometry(2 * R_TIP * 0.98, 2 * R_TIP * 0.98, 44, 44)
    sg.rotateY(Math.PI / 2)
    this.saddle = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ color: COLORS.gold, wireframe: true, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false }))
    this.saddle.visible = false
    this.scene.add(this.saddle)

    // Ions.
    for (const color of [COLORS.mg, COLORS.al]) {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6, roughness: 0.3 }))
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, depthTest: false }))
      const cloud = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }))
      this.scene.add(mesh, glow, cloud)
      this.ions.push({ mesh, glow, cloud })
      const pos = new Float32Array(400 * 3), col = new Float32Array(400 * 3)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3))
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
      line.frustumCulled = false; line.visible = false
      this.scene.add(line)
      this.trails.push({ line, count: 0 })
    }

    // Fluorescence photons.
    const pg = new THREE.BufferGeometry()
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 3), 3))
    pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(400 * 3), 3))
    this.photons = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.5, sizeAttenuation: false, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture() }))
    this.photons.frustumCulled = false
    this.scene.add(this.photons)

    // Bloch sphere for the clock qubit: state space, drawn beside the Al+ ion.
    const ringMat = new THREE.LineBasicMaterial({ color: 0x8f88c2, transparent: true, opacity: 0.55 })
    const ring = (rot: (g: THREE.BufferGeometry) => void) => {
      const pts = Array.from({ length: 97 }, (_, i) => new THREE.Vector3(Math.cos((i / 96) * Math.PI * 2), Math.sin((i / 96) * Math.PI * 2), 0))
      const g = new THREE.BufferGeometry().setFromPoints(pts); rot(g)
      this.bloch.add(new THREE.Line(g, ringMat))
    }
    ring(() => {}); ring(g => g.rotateX(Math.PI / 2)); ring(g => g.rotateY(Math.PI / 2))
    this.bloch.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), new THREE.MeshStandardMaterial({ color: 0x7fdcf5, transparent: true, opacity: 0.06, depthWrite: false })))
    const arrowMat = new THREE.MeshStandardMaterial({ color: COLORS.gold, emissive: COLORS.gold, emissiveIntensity: 1.2 })
    this.blochArrow = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 12), arrowMat)
    this.blochHead = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 16), arrowMat)
    this.bloch.add(this.blochArrow, this.blochHead)
    const tg = new THREE.BufferGeometry()
    tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(600 * 3), 3))
    this.blochTrace = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: COLORS.gold, transparent: true, opacity: 0.8 }))
    this.blochTrace.frustumCulled = false
    this.bloch.add(this.blochTrace)
    this.bloch.visible = false
    this.scene.add(this.bloch)

    this.composer = new EffectComposer(r)
    this.composer.addPass(new RenderPass(this.scene, this.camera))
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.42, 0.6, 0.86)
    this.composer.addPass(this.bloomPass)
    this.composer.addPass(new OutputPass())

    this.resize = new ResizeObserver(() => this.onResize(canvas))
    this.resize.observe(canvas)
    this.onResize(canvas)
    this.loop()
  }

  private addBeam(name: BeamName, color: number, dir: [number, number, number]) {
    const mat = beamMaterial(color)
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 60000, 24, 1, true), mat)
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize())
    mesh.visible = false
    this.scene.add(mesh)
    this.beams[name] = { mesh, mat, level: 0 }
  }

  private onResize(canvas: HTMLCanvasElement) {
    this.width = Math.max(1, canvas.clientWidth); this.height = Math.max(1, canvas.clientHeight)
    this.renderer.setSize(this.width, this.height, false)
    this.composer.setPixelRatio(this.renderer.getPixelRatio())
    this.composer.setSize(this.width, this.height)
    this.camera.aspect = this.width / this.height
    this.camera.updateProjectionMatrix()
  }

  private spawnPhoton(px: number, py: number, pz: number, dist: number) {
    const i = this.photonNext; this.photonNext = (i + 1) % 400
    const pos = this.photons.geometry.attributes.position as THREE.BufferAttribute
    pos.setXYZ(i, px, py, pz)
    const u = Math.random() * 2 - 1, phi = Math.random() * Math.PI * 2, st = Math.sqrt(1 - u * u), sp = dist * 0.5
    this.photonVel[3 * i] = sp * st * Math.cos(phi); this.photonVel[3 * i + 1] = sp * st * Math.sin(phi); this.photonVel[3 * i + 2] = sp * u
    this.photonLife[i] = 1
  }

  private loop = () => {
    this.frameId = requestAnimationFrame(this.loop)
    const now = performance.now(), dt = Math.min((now - this.lastFrame) / 1000, 0.1)
    this.lastFrame = now
    this.update(dt)
    this.composer.render()
  }

  private update(dt: number) {
    const cam = this.camera, ctl = this.controls
    if (viz.stage !== this.lastStage) {
      this.lastStage = viz.stage; this.flying = true; this.goalDistance = viz.cameraDistance
      this.goalDir.set(...viz.cameraDir).normalize()
      this.bloch.visible = false
    }
    // Camera falls through the scales in log distance, the same way one would zoom a microscope.
    let dist = cam.position.distanceTo(ctl.target)
    if (this.flying) {
      const k = this.reduced ? 1 : 1 - Math.exp(-dt * 2.2)
      const next = Math.exp(Math.log(dist) + (Math.log(this.goalDistance) - Math.log(dist)) * k)
      const heading = cam.position.clone().sub(ctl.target).normalize().lerp(this.goalDir, k).normalize()
      cam.position.copy(heading.multiplyScalar(next)).add(ctl.target)
      if (Math.abs(Math.log(next / this.goalDistance)) < 0.003 && heading.distanceTo(this.goalDir.clone().multiplyScalar(next)) < next * 0.01) this.flying = false
      dist = next
    }
    ctl.update()
    cam.near = Math.max(dist * 0.02, 0.05); cam.far = Math.max(dist * 40, 60000); cam.updateProjectionMatrix()

    // RF drive.
    const rf = Math.cos(viz.rfPhase), glow = viz.rfVisible * 0.26
    this.rfA.emissiveIntensity = glow * Math.max(0, rf); this.rfB.emissiveIntensity = glow * Math.max(0, -rf)
    this.saddle.visible = viz.saddle > 0.01
    if (this.saddle.visible) {
      const pos = this.saddle.geometry.attributes.position as THREE.BufferAttribute, h = 90 * viz.saddle * rf
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / R_TIP, z = pos.getZ(i) / R_TIP
        pos.setX(i, h * (y * y - z * z))
      }
      pos.needsUpdate = true
    }

    // Beams: fade towards their target level. Drawn narrower than life so the ions stay visible.
    // At ion scale the electrodes are hundreds of um away, and only hide the ions.
    this.hardware.visible = dist > 90
    const beamR = Math.max(3.4, dist * 0.0014), beamGain = dist < 90 ? 0.14 : 0.5
    for (const name of Object.keys(this.beams) as BeamName[]) {
      const b = this.beams[name], goal = viz.beams[name]
      b.level += (goal - b.level) * Math.min(1, dt * 14)
      b.mesh.visible = b.level > 0.005
      b.mesh.scale.set(beamR, 1, beamR)
      b.mat.uniforms.strength.value = b.level * beamGain
    }

    // Ions. Radius not to scale: a real ion's wave packet is tens of nanometres, invisible here.
    const pxToWorld = (2 * dist * Math.tan((cam.fov * Math.PI) / 360)) / this.height
    const w = viz.ions, r = Math.max(0.2, pxToWorld * 4)
    const glows = [viz.mgGlow, viz.alGlow]
    this.ions.forEach((ion, i) => {
      const x = w[3 * i], y = w[3 * i + 1], z = w[3 * i + 2], g = glows[i]
      ion.mesh.position.set(x, y, z); ion.mesh.scale.setScalar(r)
      ;(ion.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.5 + 2.4 * g
      ion.glow.position.set(x, y, z); ion.glow.scale.setScalar(r * (5 + 11 * g))
      ion.glow.material.opacity = 0.25 + 0.75 * g
      ion.cloud.visible = viz.wave > 0
      ion.cloud.position.set(x, y, z); ion.cloud.scale.setScalar(viz.wave * 2.6)
    })

    // Motion trails.
    for (let t = 0; t < 2; t++) {
      const tr = this.trails[t]; tr.line.visible = viz.trail
      if (viz.trailClear) tr.count = 0
      if (!viz.trail) continue
      const pos = tr.line.geometry.attributes.position as THREE.BufferAttribute, col = tr.line.geometry.attributes.color as THREE.BufferAttribute
      const n = pos.count
      ;(pos.array as Float32Array).copyWithin(3, 0, (n - 1) * 3)
      pos.setXYZ(0, w[3 * t], w[3 * t + 1], w[3 * t + 2]); pos.needsUpdate = true
      tr.count = Math.min(tr.count + 1, n)
      const c = new THREE.Color(t ? COLORS.al : COLORS.mg)
      for (let i = 0; i < n; i++) { const a = i < tr.count ? (1 - i / tr.count) ** 2 * 0.8 : 0; col.setXYZ(i, c.r * a, c.g * a, c.b * a) }
      col.needsUpdate = true
      tr.line.geometry.setDrawRange(0, tr.count)
    }
    viz.trailClear = false

    // Photons.
    const toEmit = Math.min(viz.photons, 40); viz.photons = 0
    for (let i = 0; i < toEmit; i++) this.spawnPhoton(w[0], w[1], w[2], dist)
    const pp = this.photons.geometry.attributes.position as THREE.BufferAttribute, pc = this.photons.geometry.attributes.color as THREE.BufferAttribute
    const c = new THREE.Color(COLORS.cool)
    for (let i = 0; i < 400; i++) {
      const life = this.photonLife[i]
      if (life <= 0) { pc.setXYZ(i, 0, 0, 0); continue }
      this.photonLife[i] = life - dt * 1.4
      pp.setXYZ(i, pp.getX(i) + this.photonVel[3 * i] * dt, pp.getY(i) + this.photonVel[3 * i + 1] * dt, pp.getZ(i) + this.photonVel[3 * i + 2] * dt)
      pc.setXYZ(i, c.r * life * 2, c.g * life * 2, c.b * life * 2)
    }
    pp.needsUpdate = true; pc.needsUpdate = true

    // Bloch vector: north is 3P0, south is 1S0. The drive axis points at the viewer, so the rotation is seen face on.
    const B = viz.bloom
    this.bloch.visible = B.visible
    if (B.visible) {
      this.bloch.position.set(w[3], w[4] + 3.4, w[5]); this.bloch.scale.setScalar(1.5)
      const v = new THREE.Vector3(B.y, B.z, B.x), len = Math.max(v.length(), 1e-3), dirn = v.clone().normalize()
      this.blochArrow.scale.set(1, len, 1); this.blochArrow.position.copy(dirn.clone().multiplyScalar(len / 2))
      this.blochArrow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirn)
      this.blochHead.position.copy(dirn.clone().multiplyScalar(len)); this.blochHead.quaternion.copy(this.blochArrow.quaternion)
      const pos = this.blochTrace.geometry.attributes.position as THREE.BufferAttribute, n = Math.min(B.trace.length, pos.count)
      for (let i = 0; i < n; i++) { const q = B.trace[i]; pos.setXYZ(i, q[1], q[2], q[0]) }
      pos.needsUpdate = true; this.blochTrace.geometry.setDrawRange(0, n)
    }

    // Lenses and labels.
    const nice = this.niceScale(pxToWorld * 120)
    if (this.el.scale) this.el.scale.textContent = nice.label
    if (this.el.scaleBar) this.el.scaleBar.style.width = `${nice.um / pxToWorld}px`
    if (this.el.time) this.el.time.textContent = viz.timeLens
    if (this.el.motion) this.el.motion.textContent = viz.motionLens
    this.placeLabel(this.el.mg, w[0], w[1] - r * 3, w[2], dist < 400)
    this.placeLabel(this.el.al, w[3], w[4] - r * 3, w[5], dist < 400)
    const bx = this.bloch.position.x, by = this.bloch.position.y, bz = this.bloch.position.z, br = this.bloch.scale.x
    this.placeLabel(this.el.north, bx, by + br + 0.45, bz, B.visible)
    this.placeLabel(this.el.south, bx, by - br - 0.1, bz, B.visible)
  }

  private niceScale(um: number) {
    const p = Math.pow(10, Math.floor(Math.log10(um))), m = um / p, step = m < 2 ? 1 : m < 5 ? 2 : 5, v = step * p
    return { um: v, label: v >= 1000 ? `${v / 1000} mm` : v >= 1 ? `${v} µm` : `${Math.round(v * 1000)} nm` }
  }

  private placeLabel(el: HTMLElement | null, x: number, y: number, z: number, visible: boolean) {
    if (!el) return
    const v = new THREE.Vector3(x, y, z).project(this.camera)
    const on = visible && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1
    el.style.opacity = on ? '1' : '0'
    if (on) el.style.transform = `translate(calc(${((v.x + 1) / 2) * this.width}px - 50%), ${((1 - v.y) / 2) * this.height + 6}px)`
  }

  dispose() {
    cancelAnimationFrame(this.frameId)
    this.resize.disconnect()
    this.controls.dispose()
    this.renderer.dispose()
  }
}
