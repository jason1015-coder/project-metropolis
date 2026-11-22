// The city itself: one continuous model. Every repository is a district, every
// file an instanced building, and all buildings live in one pair of instanced
// meshes over a single paved ground. Districts are marked by glowing floating
// boundaries instead of raised plates, so nothing reads as a separate model.

import * as THREE from 'three'

import {
  CITY_BOUNDS,
  layoutBuildings,
  layoutCity,
  layoutLanes,
  ROAD_WIDTH,
  type Building,
  type Plot,
  type Rect,
  type RoadNetwork,
} from '../../lib/cityLayout'
import {
  fileUrl,
  type CityFile,
  type CityLayout,
  type DistrictData,
  type RepoSummary,
} from '../../lib/cityData'
import { createTamagotchi, type PetMood, type Tamagotchi } from './tamagotchi'
import { makeContactShadow, makeDistrictLabel, makeGlowTexture } from './textures'

const GROUND_Y = 0
/** Building bases sit on the pavement, not on a per-district plinth. */
const BUILDING_BASE = 0.008
/** Where a district boundary floats before its buildings are known. */
const BOUNDARY_Y = 0.9
const PET_POSITION = new THREE.Vector3(-8, GROUND_Y, CITY_BOUNDS.d / 2 + 2.4)

const ZOOM_MIN = 16
const ZOOM_MAX = 68

/** District light colours: the glow that maps a district's floating boundary. */
const ACCENTS = ['#63b3ff', '#7fe3c4', '#ffcf7a', '#c9a7ff', '#ff9d7a', '#9fb7ff', '#8ef0dd']

export interface FileLink {
  label: string
  meta: string
  url: string
}

/** Files related to the hovered one: same name, same type, same district. */
export interface LinkGroup {
  kind: 'name' | 'type' | 'district'
  label: string
  links: FileLink[]
}

export interface HoverPayload {
  kind: 'file' | 'repo'
  title: string
  subtitle: string
  lines: number
  bytes: number
  files?: number
  shown?: number
  stars?: number
  language?: string
  color?: string
  url: string
  hint: string
  links?: LinkGroup[]
}

export interface HoverEvent {
  payload: HoverPayload
  x: number
  y: number
}

export interface CityStats {
  districts: number
  buildings: number
  lines: number
  bytes: number
  roads: number
}

export interface CityCallbacks {
  onHover: (event: HoverEvent | null) => void
  onStats: (stats: CityStats) => void
}

interface FileEntry {
  node: DistrictNode
  file: CityFile
}

interface CityBuilding extends FileEntry {
  building: Building
}

interface DistrictNode {
  repo: RepoSummary
  plot: Plot
  data: DistrictData | null
  files: CityFile[]
  layout: Building[]
  /** The little roads between this district's buildings. */
  lanes: Rect[]
  label: THREE.Mesh
  labelTexture: THREE.CanvasTexture
  boundary: THREE.Group
  boundaryMaterial: THREE.MeshBasicMaterial
  edgeMaterial: THREE.MeshBasicMaterial
  /** Height the boundary hovers at: just above the district's own rooftops. */
  boundaryBase: number
  pick: THREE.Mesh
  accent: string
  phase: number
}

export class CityScene {
  private readonly container: HTMLElement
  private readonly callbacks: CityCallbacks
  private readonly renderer: THREE.WebGLRenderer
  private readonly scene = new THREE.Scene()
  private readonly camera: THREE.PerspectiveCamera
  private readonly clock = new THREE.Clock()
  private readonly raycaster = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2(0, 0)
  private readonly pointerPx = { x: 0, y: 0 }
  private readonly nodes = new Map<string, DistrictNode>()
  private readonly roadMeshes: THREE.Mesh[] = []
  private readonly byName = new Map<string, FileEntry[]>()
  private readonly byExtension = new Map<string, FileEntry[]>()
  private roadMarks: THREE.InstancedMesh | null = null
  private roadCount = 0
  private buildingMesh: THREE.InstancedMesh | null = null
  private detailMesh: THREE.InstancedMesh | null = null
  private laneMesh: THREE.InstancedMesh | null = null
  private pickList: CityBuilding[] = []
  private rise = 1
  private readonly highlight: THREE.LineSegments
  private readonly pet: Tamagotchi
  private readonly observer: ResizeObserver
  private readonly reducedMotion: boolean
  private raf = 0
  private disposed = false
  private hovered: DistrictNode | null = null
  private hoveredFile: CityFile | null = null
  private hoverKey = ''
  private hoverPinned = false
  private hoverTimer = 0
  private pointerInside = false
  private dragging = false
  private dragDistance = 0
  private lastPointer = { x: 0, y: 0 }
  private lastInput = 0
  private readonly pressed = new Set<string>()
  private yaw = 0.62
  private pitch = 0.42
  private distance = 30
  private readonly target = new THREE.Vector3(0, 1.9, 0)
  private frame = 0

  constructor(container: HTMLElement, callbacks: CityCallbacks) {
    this.container = container
    this.callbacks = callbacks
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.shadowMap.needsUpdate = true
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.16
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    container.appendChild(this.renderer.domElement)

    this.scene.fog = new THREE.FogExp2(0x0a0c0b, 0.014)

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 240)
    this.camera.position.set(17, 20, 18)

    this.buildGround()
    this.buildLights()

    const highlightGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1))
    const highlightMaterial = new THREE.LineBasicMaterial({ color: '#ffe94a', transparent: true, opacity: 0.95 })
    this.highlight = new THREE.LineSegments(highlightGeometry, highlightMaterial)
    this.highlight.visible = false
    this.scene.add(this.highlight)

    this.pet = createTamagotchi()
    this.pet.group.scale.setScalar(1.6)
    this.pet.group.position.copy(PET_POSITION)
    this.scene.add(this.pet.group)

    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(container)
    this.resize()
    this.attach()
    this.updateCamera()
    this.tick()
  }

  /**
   * Build the whole metropolis at once: one grid of districts on a shared
   * pavement, one instanced mesh for every building in the city.
   */
  setLayout(layout: CityLayout): void {
    this.clearCity()

    const { plots, roadNetwork } = layoutCity(layout.repos)
    for (const plot of plots) this.addNode(plot)
    this.buildRoads(roadNetwork)

    for (const district of layout.districts) this.applyDistrict(district)
    this.buildLinkIndex()
    this.rebuildLanes()
    this.rebuildCity()

    this.renderer.shadowMap.needsUpdate = true
    this.emitStats()
  }

  setPet(state: { mood: PetMood; headline: string; detail: string; progress: number }): void {
    this.pet.setState(state)
  }

  /** Keep a hovered building alive while the pointer is on the hover card. */
  pinHover(pinned: boolean): void {
    this.hoverPinned = pinned
    if (pinned) {
      window.clearTimeout(this.hoverTimer)
      this.hoverTimer = 0
      return
    }
    this.clearHover()
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
    window.clearTimeout(this.hoverTimer)
    this.detach()
    this.observer.disconnect()
    this.pet.dispose()
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) {
          const map = (material as THREE.MeshStandardMaterial).map
          if (map) map.dispose()
          material.dispose()
        }
      }
    })
    this.nodes.clear()
    this.renderer.dispose()
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement)
    }
  }

  private buildGround(): void {
    // The city stands straight on the page background: one ground plane, no tray.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.MeshStandardMaterial({ color: '#171c21', roughness: 0.96, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = GROUND_Y
    ground.receiveShadow = true
    this.scene.add(ground)

    // One shared pavement under every district: the city is a single surface,
    // not a tray of separate blocks.
    const paving = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_BOUNDS.w + ROAD_WIDTH, CITY_BOUNDS.d + ROAD_WIDTH),
      new THREE.MeshStandardMaterial({ color: '#2b333c', roughness: 0.94, metalness: 0.03 }),
    )
    paving.rotation.x = -Math.PI / 2
    paving.position.set(CITY_BOUNDS.x, GROUND_Y + 0.006, CITY_BOUNDS.z)
    paving.receiveShadow = true
    this.scene.add(paving)

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_BOUNDS.w * 1.9, CITY_BOUNDS.d * 2.1),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(),
        color: '#9fb6d6',
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    )
    glow.rotation.x = -Math.PI / 2
    glow.position.set(0, GROUND_Y + 0.004, 0)
    this.scene.add(glow)

    const petShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(4.2, 3.2),
      new THREE.MeshBasicMaterial({
        map: makeContactShadow(),
        transparent: true,
        depthWrite: false,
        opacity: 0.85,
      }),
    )
    petShadow.rotation.x = -Math.PI / 2
    petShadow.position.set(PET_POSITION.x, GROUND_Y + 0.008, PET_POSITION.z)
    this.scene.add(petShadow)
  }

  private buildLights(): void {
    // Overcast city light: a cool sky, a white key and no warm cast, so the
    // concrete reads as clay-grey rather than sepia.
    this.scene.add(new THREE.HemisphereLight(0xeaf2ff, 0x39414a, 1.3))

    const key = new THREE.DirectionalLight(0xffffff, 2.3)
    key.position.set(18, 32, 14)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -27
    key.shadow.camera.right = 27
    key.shadow.camera.top = 27
    key.shadow.camera.bottom = -27
    key.shadow.camera.near = 1
    key.shadow.camera.far = 90
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(0xa8c8ff, 0.72)
    rim.position.set(-12, 8, -10)
    this.scene.add(rim)
  }

  private clearCity(): void {
    for (const node of this.nodes.values()) this.removeNode(node)
    this.nodes.clear()
    this.hovered = null
    this.hoveredFile = null
    this.hoverKey = ''
    this.byName.clear()
    this.byExtension.clear()

    for (const mesh of this.roadMeshes) {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
      mesh.removeFromParent()
    }
    this.roadMeshes.length = 0
    if (this.roadMarks) {
      this.roadMarks.geometry.dispose()
      ;(this.roadMarks.material as THREE.Material).dispose()
      this.roadMarks.removeFromParent()
      this.roadMarks = null
    }
    this.roadCount = 0

    this.disposeCityMeshes()
    this.disposeLanes()
    this.highlight.visible = false
  }

  private buildRoads(roadNetwork: RoadNetwork): void {
    const roadMaterial = new THREE.MeshStandardMaterial({ color: '#39424d', roughness: 0.94, metalness: 0.02 })
    const roadGeometry = new THREE.PlaneGeometry(ROAD_WIDTH, 1)
    roadGeometry.rotateX(-Math.PI / 2)

    const marks: THREE.Matrix4[] = []
    const dummy = new THREE.Object3D()

    for (const segment of roadNetwork.segments) {
      const from = roadNetwork.nodes[segment.from]
      const to = roadNetwork.nodes[segment.to]
      const dx = to.x - from.x
      const dz = to.z - from.z
      const length = Math.hypot(dx, dz)
      if (length < 0.01) continue

      const angle = Math.atan2(dx, dz)
      const mesh = new THREE.Mesh(roadGeometry, roadMaterial)
      // Reach into each junction so the grid reads as one continuous surface.
      mesh.scale.set(1, 1, length + ROAD_WIDTH)
      mesh.position.set((from.x + to.x) / 2, GROUND_Y + 0.02, (from.z + to.z) / 2)
      mesh.rotation.y = angle
      mesh.receiveShadow = true
      this.scene.add(mesh)
      this.roadMeshes.push(mesh)

      for (let travelled = 0.6; travelled < length; travelled += 1.15) {
        const t = travelled / length
        dummy.position.set(from.x + dx * t, GROUND_Y + 0.031, from.z + dz * t)
        dummy.rotation.set(0, angle, 0)
        dummy.updateMatrix()
        marks.push(dummy.matrix.clone())
      }
    }

    if (marks.length > 0) {
      const markGeometry = new THREE.PlaneGeometry(0.075, 0.5)
      markGeometry.rotateX(-Math.PI / 2)
      const markMaterial = new THREE.MeshBasicMaterial({ color: '#c8cdb6', transparent: true, opacity: 0.42 })
      const markMesh = new THREE.InstancedMesh(markGeometry, markMaterial, marks.length)
      marks.forEach((matrix, index) => markMesh.setMatrixAt(index, matrix))
      markMesh.instanceMatrix.needsUpdate = true
      this.scene.add(markMesh)
      this.roadMarks = markMesh
    }

    this.roadCount = roadNetwork.segments.length
  }

  private addNode(plot: Plot): void {
    const { rect, repo, index } = plot
    const accent = accentFor(repo.name)

    // The district's map: a glowing band of light floating above that district's
    // own rooftops, so the boundary reads as a hovering outline rather than as a
    // plinth the buildings stand on.
    const boundary = new THREE.Group()
    boundary.position.set(rect.x, BOUNDARY_Y, rect.z)

    const boundaryMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    const edgeMaterial = new THREE.MeshBasicMaterial({
      color: accent,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
    boundary.add(frameMesh(rect.w, rect.d, 0.34, boundaryMaterial, edgeMaterial))

    this.scene.add(boundary)

    // An invisible disc over the district, so hovering empty ground still names
    // the repository that owns it.
    const pick = new THREE.Mesh(
      new THREE.PlaneGeometry(Math.max(0.2, rect.w), Math.max(0.2, rect.d)),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
    )
    pick.rotation.x = -Math.PI / 2
    pick.position.set(rect.x, GROUND_Y + 0.012, rect.z)
    this.scene.add(pick)

    const labelTexture = makeDistrictLabel(repo.name, `${repo.language ?? 'repository'} · ${formatKb(repo.sizeKb)}`)
    const labelWidth = Math.min(rect.w * 0.8, 3.2)
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(labelWidth, labelWidth * (176 / 1024)),
      new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false, toneMapped: false }),
    )
    label.rotation.x = -Math.PI / 2
    // The name rides with the glowing boundary, floating over the street that
    // fronts the district, so the dense blocks never cover it.
    label.position.set(0, 0.02, rect.d / 2 + 0.45)
    boundary.add(label)

    const node: DistrictNode = {
      repo,
      plot,
      data: null,
      files: [],
      layout: [],
      lanes: [],
      label,
      labelTexture,
      boundary,
      boundaryMaterial,
      edgeMaterial,
      boundaryBase: BOUNDARY_Y,
      pick,
      accent,
      phase: index * 0.7,
    }
    pick.userData.node = node
    this.nodes.set(repo.name, node)
  }

  private applyDistrict(data: DistrictData): void {
    const node = this.nodes.get(data.repo)
    if (!node) return

    node.data = data
    node.files = data.files
    node.layout = layoutBuildings(data.files, node.plot.rect)
    node.lanes = layoutLanes(data.files, node.plot.rect)

    // Float the boundary clear of the tallest tower in this district, so the
    // outline hovers over the city instead of being lost among the rooftops.
    let rooftop = 0
    for (const building of node.layout) rooftop = Math.max(rooftop, building.h)
    node.boundaryBase = Math.max(BOUNDARY_Y + 0.3, rooftop + 1.1)
    node.boundary.position.y = node.boundaryBase

    const labelTexture = makeDistrictLabel(
      node.repo.name,
      `${node.layout.length} buildings · ${data.lines.toLocaleString('en-GB')} lines`,
    )
    node.labelTexture.dispose()
    node.labelTexture = labelTexture
    const labelMaterial = node.label.material as THREE.MeshBasicMaterial
    labelMaterial.map = labelTexture
    labelMaterial.needsUpdate = true
  }

  /** One instanced mesh for every building and one for every roof detail. */
  private rebuildCity(): void {
    this.disposeCityMeshes()

    const entries: CityBuilding[] = []
    for (const node of this.nodes.values()) {
      for (const building of node.layout) entries.push({ node, file: building.file, building })
    }
    if (entries.length === 0) return

    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    const colour = new THREE.Color()

    const geometry = new THREE.BoxGeometry(1, 1, 1)
    geometry.translate(0, 0.5, 0)
    const material = new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.1 })
    const mesh = new THREE.InstancedMesh(geometry, material, entries.length)
    mesh.castShadow = true
    mesh.receiveShadow = true

    entries.forEach((entry, index) => {
      const { building } = entry
      position.set(building.x, BUILDING_BASE, building.z)
      scale.set(building.w, building.h, building.d)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, facadeColour(building, colour))
    })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.computeBoundingSphere()

    this.buildingMesh = mesh
    this.pickList = entries
    this.scene.add(mesh)

    // Roof massing per file: setbacks, masts and plant boxes are one more
    // instanced pass, so a city full of varied silhouettes stays cheap.
    const detailed = entries.filter((entry) => entry.building.detail !== null)
    if (detailed.length > 0) {
      const detailGeometry = new THREE.BoxGeometry(1, 1, 1)
      detailGeometry.translate(0, 0.5, 0)
      const detailMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.16 })
      const detailMesh = new THREE.InstancedMesh(detailGeometry, detailMaterial, detailed.length)
      detailMesh.castShadow = true

      detailed.forEach((entry, index) => {
        const { building } = entry
        const detail = building.detail
        if (!detail) return
        position.set(building.x + detail.dx, BUILDING_BASE + building.h, building.z + detail.dz)
        scale.set(detail.w, detail.h, detail.d)
        matrix.compose(position, quaternion, scale)
        detailMesh.setMatrixAt(index, matrix)
        detailMesh.setColorAt(index, facadeColour(building, colour, 0.06))
      })
      detailMesh.instanceMatrix.needsUpdate = true
      if (detailMesh.instanceColor) detailMesh.instanceColor.needsUpdate = true
      detailMesh.computeBoundingSphere()

      this.detailMesh = detailMesh
      this.scene.add(detailMesh)
    }

    this.rise = this.reducedMotion ? 1 : 0
    const start = Math.max(0.001, this.rise)
    this.buildingMesh.scale.y = start
    if (this.detailMesh) this.detailMesh.scale.y = start
  }

  /** One instanced mesh for every little road between every pair of buildings. */
  private rebuildLanes(): void {
    this.disposeLanes()

    const lanes: Rect[] = []
    for (const node of this.nodes.values()) lanes.push(...node.lanes)
    if (lanes.length === 0) return

    const geometry = new THREE.PlaneGeometry(1, 1)
    geometry.rotateX(-Math.PI / 2)
    const material = new THREE.MeshStandardMaterial({ color: '#39424d', roughness: 0.95, metalness: 0.02 })
    const mesh = new THREE.InstancedMesh(geometry, material, lanes.length)
    mesh.receiveShadow = true

    const matrix = new THREE.Matrix4()
    const quaternion = new THREE.Quaternion()
    const position = new THREE.Vector3()
    const scale = new THREE.Vector3()
    lanes.forEach((lane, index) => {
      position.set(lane.x, GROUND_Y + 0.014, lane.z)
      scale.set(lane.w, 1, lane.d)
      matrix.compose(position, quaternion, scale)
      mesh.setMatrixAt(index, matrix)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()

    this.laneMesh = mesh
    this.scene.add(mesh)
  }

  private disposeLanes(): void {
    if (!this.laneMesh) return
    this.laneMesh.removeFromParent()
    this.laneMesh.geometry.dispose()
    ;(this.laneMesh.material as THREE.Material).dispose()
    this.laneMesh = null
  }

  private disposeCityMeshes(): void {
    for (const mesh of [this.buildingMesh, this.detailMesh]) {
      if (!mesh) continue
      mesh.removeFromParent()
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    }
    this.buildingMesh = null
    this.detailMesh = null
    this.pickList = []
  }

  /** Index every file by name and by type, so hovering can offer neighbours. */
  private buildLinkIndex(): void {
    this.byName.clear()
    this.byExtension.clear()
    for (const node of this.nodes.values()) {
      for (const file of node.files) {
        const entry: FileEntry = { node, file }
        push(this.byName, basename(file.path), entry)
        push(this.byExtension, extensionOf(file.path), entry)
      }
    }
  }

  private removeNode(node: DistrictNode): void {
    for (const object of [node.label, node.boundary, node.pick]) {
      object.removeFromParent()
      object.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) material.dispose()
        }
      })
    }
    node.labelTexture.dispose()
    this.highlight.visible = false
  }

  private attach(): void {
    const el = this.renderer.domElement
    el.style.touchAction = 'none'
    el.addEventListener('pointerdown', this.onPointerDown)
    el.addEventListener('pointermove', this.onPointerMove)
    el.addEventListener('pointerup', this.onPointerUp)
    el.addEventListener('pointerleave', this.onPointerLeave)
    el.addEventListener('wheel', this.onWheel, { passive: false })
    el.addEventListener('dblclick', this.resetCamera)
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
  }

  private detach(): void {
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointerleave', this.onPointerLeave)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('dblclick', this.resetCamera)
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.pressed.clear()
  }

  /** WASD walks the city: W/S along the view, A/D across it, Shift doubles the pace. */
  private onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
    if (!this.inView()) return

    const key = event.key.toLowerCase()
    if (key !== 'w' && key !== 'a' && key !== 's' && key !== 'd' && key !== 'shift') return
    this.pressed.add(key)
    this.lastInput = performance.now()
    if (key !== 'shift') event.preventDefault()
  }

  private onKeyUp = (event: KeyboardEvent) => {
    this.pressed.delete(event.key.toLowerCase())
  }

  private onBlur = () => {
    this.pressed.clear()
  }

  /** True while the city is on screen, so typing elsewhere never moves the camera. */
  private inView(): boolean {
    const box = this.container.getBoundingClientRect()
    const viewport = window.innerHeight || 0
    return box.bottom > 0 && box.top < viewport
  }

  private moveCamera(delta: number): void {
    const forward = Number(this.pressed.has('w')) - Number(this.pressed.has('s'))
    const strafe = Number(this.pressed.has('d')) - Number(this.pressed.has('a'))
    if (forward === 0 && strafe === 0) return

    const pace = this.distance * 0.45 * (this.pressed.has('shift') ? 2.2 : 1) * delta
    const sin = Math.sin(this.yaw)
    const cos = Math.cos(this.yaw)

    // The camera sits along (sin, cos) from the target, so forward is the
    // opposite way and right is the perpendicular of that.
    this.target.x += (-sin * forward + cos * strafe) * pace
    this.target.z += (-cos * forward - sin * strafe) * pace

    const limitX = CITY_BOUNDS.w / 2 + 4
    const limitZ = CITY_BOUNDS.d / 2 + 4
    this.target.x = THREE.MathUtils.clamp(this.target.x, -limitX, limitX)
    this.target.z = THREE.MathUtils.clamp(this.target.z, -limitZ, limitZ)

    this.lastInput = performance.now()
  }

  private onPointerDown = (event: PointerEvent) => {
    this.dragging = true
    this.dragDistance = 0
    this.lastPointer = { x: event.clientX, y: event.clientY }
    this.lastInput = performance.now()
    this.renderer.domElement.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointerPx.x = event.clientX - rect.left
    this.pointerPx.y = event.clientY - rect.top
    this.pointer.x = (this.pointerPx.x / rect.width) * 2 - 1
    this.pointer.y = -(this.pointerPx.y / rect.height) * 2 + 1
    this.pointerInside = true
    this.lastInput = performance.now()

    if (this.dragging) {
      const dx = event.clientX - this.lastPointer.x
      const dy = event.clientY - this.lastPointer.y
      this.lastPointer = { x: event.clientX, y: event.clientY }
      this.dragDistance += Math.abs(dx) + Math.abs(dy)
      this.yaw -= dx * 0.005
      this.pitch = THREE.MathUtils.clamp(this.pitch + dy * 0.004, 0.18, 1.35)
    }
  }

  private onPointerUp = (event: PointerEvent) => {
    this.dragging = false
    this.lastInput = performance.now()
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId)
    }
    if (this.dragDistance < 7 && this.hoveredFile && this.hovered) {
      window.open(fileUrl(this.hovered.repo, this.hoveredFile.path), '_blank', 'noopener')
    } else if (this.dragDistance < 7 && this.hovered) {
      window.open(this.hovered.repo.url, '_blank', 'noopener')
    }
  }

  private onPointerLeave = () => {
    this.pointerInside = false
    this.dragging = false
    if (this.hoverPinned) return
    // The hover card sits over the canvas and offers links, so give the pointer
    // a moment to reach it before the selection is dropped.
    window.clearTimeout(this.hoverTimer)
    this.hoverTimer = window.setTimeout(() => {
      if (!this.hoverPinned) this.clearHover()
    }, 320)
  }

  private onWheel = (event: WheelEvent) => {
    // The city fills most of the viewport, so a plain wheel has to keep
    // scrolling the page. Zoom only when asked for with a modifier, or while a
    // gesture is already pinned at a zoom limit, so it cannot leak into the page
    // halfway through.
    const pinned =
      (event.deltaY > 0 && this.distance >= ZOOM_MAX - 0.01) ||
      (event.deltaY < 0 && this.distance <= ZOOM_MIN + 0.01)
    if (!event.ctrlKey && !event.metaKey && !pinned) return

    event.preventDefault()
    this.distance = THREE.MathUtils.clamp(
      this.distance * Math.exp(event.deltaY * 0.0011),
      ZOOM_MIN,
      ZOOM_MAX,
    )
    this.lastInput = performance.now()
  }

  private resetCamera = () => {
    this.yaw = 0.62
    this.pitch = 0.42
    this.distance = 30
    this.target.set(0, 1.9, 0)
    this.pressed.clear()
  }

  private clearHover(): void {
    this.highlight.visible = false
    this.hovered = null
    this.hoveredFile = null
    if (this.hoverKey !== '') {
      this.hoverKey = ''
      this.callbacks.onHover(null)
    }
  }

  private pick(): void {
    if (!this.pointerInside) return
    this.raycaster.setFromCamera(this.pointer, this.camera)

    if (this.buildingMesh) {
      const hits = this.raycaster.intersectObject(this.buildingMesh, false)
      const index = hits[0]?.instanceId
      if (index !== undefined) {
        const entry = this.pickList[index]
        if (entry) {
          this.setHover(entry.node, entry.file, entry.building, `${entry.node.repo.name}:${entry.file.path}`)
          return
        }
      }
    }

    const picks: THREE.Mesh[] = []
    for (const node of this.nodes.values()) picks.push(node.pick)
    const hits = this.raycaster.intersectObjects(picks, false)
    if (hits.length > 0) {
      const node = hits[0].object.userData.node as DistrictNode | undefined
      if (node) {
        this.setHover(node, null, null, `repo:${node.repo.name}`)
        return
      }
    }

    this.clearHover()
  }

  private setHover(node: DistrictNode, file: CityFile | null, building: Building | null, key: string): void {
    this.hovered = node
    this.hoveredFile = file

    if (building) {
      const rise = this.buildingMesh?.scale.y ?? 1
      this.highlight.visible = true
      this.highlight.position.set(building.x, BUILDING_BASE + (building.h * rise) / 2, building.z)
      this.highlight.scale.set(building.w * 1.16, building.h * rise + 0.02, building.d * 1.16)
    } else {
      this.highlight.visible = false
    }

    if (key === this.hoverKey) return
    this.hoverKey = key
    this.callbacks.onHover({
      payload: file ? this.filePayload(node, file) : this.repoPayload(node),
      x: this.pointerPx.x,
      y: this.pointerPx.y,
    })
  }

  private filePayload(node: DistrictNode, file: CityFile): HoverPayload {
    return {
      kind: 'file',
      title: file.path,
      subtitle: node.repo.name,
      lines: file.lines,
      bytes: file.bytes,
      language: file.language,
      color: file.color,
      url: fileUrl(node.repo, file.path),
      hint: 'open the file on github',
      links: this.fileLinks(node, file),
    }
  }

  /**
   * Neighbours of the hovered file: the same file name elsewhere, other files of
   * the same type, and the rest of its own district. Every one is a link.
   */
  private fileLinks(node: DistrictNode, file: CityFile): LinkGroup[] {
    const groups: LinkGroup[] = []
    const used = new Set([linkKey(node, file)])

    const take = (
      kind: LinkGroup['kind'],
      label: string,
      entries: FileEntry[],
      limit: number,
      metaOf: (entry: FileEntry) => string,
    ) => {
      const links: FileLink[] = []
      for (const entry of entries) {
        const key = linkKey(entry.node, entry.file)
        if (used.has(key)) continue
        used.add(key)
        links.push({
          label: entry.file.path,
          meta: metaOf(entry),
          url: fileUrl(entry.node.repo, entry.file.path),
        })
        if (links.length >= limit) break
      }
      if (links.length > 0) groups.push({ kind, label, links })
    }

    const elsewhereFirst = (entries: FileEntry[]) =>
      [...entries].sort(
        (a, b) =>
          Number(a.node === node) - Number(b.node === node) || a.file.path.localeCompare(b.file.path),
      )

    take('name', 'same name', elsewhereFirst(this.byName.get(basename(file.path)) ?? []), 3, (entry) => entry.node.repo.name)
    take('type', 'same type', elsewhereFirst(this.byExtension.get(extensionOf(file.path)) ?? []), 3, (entry) => entry.node.repo.name)
    take('district', 'same district', siblings(node, file), 3, (entry) => dirnameOf(entry.file.path))

    return groups
  }

  private repoPayload(node: DistrictNode): HoverPayload {
    const data = node.data
    return {
      kind: 'repo',
      title: node.repo.name,
      subtitle: node.repo.description || 'A repository with no description yet.',
      lines: data?.lines ?? 0,
      bytes: data?.bytes ?? 0,
      files: data?.totalFiles ?? 0,
      shown: node.layout.length,
      stars: node.repo.stars,
      language: node.repo.language ?? undefined,
      url: node.repo.url,
      hint: 'open the repository',
    }
  }

  private emitStats(): void {
    let lines = 0
    let bytes = 0
    for (const node of this.nodes.values()) {
      lines += node.data?.lines ?? 0
      bytes += node.data?.bytes ?? 0
    }
    this.callbacks.onStats({
      districts: this.nodes.size,
      buildings: this.pickList.length,
      lines,
      bytes,
      roads: this.roadCount,
    })
  }

  private resize(): void {
    const width = this.container.clientWidth || 1
    const height = this.container.clientHeight || 1
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private updateCamera(): void {
    const fit = this.camera.aspect < 1.5 ? 1.5 / Math.max(0.6, this.camera.aspect) : 1
    const distance = THREE.MathUtils.clamp(this.distance * fit, 16, 84)
    const horizontal = Math.cos(this.pitch) * distance
    this.camera.position.set(
      this.target.x + horizontal * Math.sin(this.yaw),
      this.target.y + Math.sin(this.pitch) * distance,
      this.target.z + horizontal * Math.cos(this.yaw),
    )
    this.camera.lookAt(this.target)
  }

  private tick = () => {
    if (this.disposed) return
    this.raf = requestAnimationFrame(this.tick)
    const delta = Math.min(this.clock.getDelta(), 0.05)
    const elapsed = this.clock.elapsedTime
    const now = performance.now()

    if (!this.dragging && !this.hovered && !this.reducedMotion && now - this.lastInput > 3500) {
      this.yaw += delta * 0.032
    }
    this.moveCamera(delta)
    this.updateCamera()

    if (this.rise < 1) {
      this.rise = Math.min(1, this.rise + delta * 1.5)
      const eased = 1 - Math.pow(1 - this.rise, 3)
      if (this.buildingMesh) this.buildingMesh.scale.y = Math.max(0.001, eased)
      if (this.detailMesh) this.detailMesh.scale.y = Math.max(0.001, eased)
      this.renderer.shadowMap.needsUpdate = true
    }

    // The district boundaries breathe and drift, and the hovered district lights up.
    for (const node of this.nodes.values()) {
      const pulse = this.reducedMotion ? 0.5 : Math.sin(elapsed * 1.15 + node.phase) * 0.5 + 0.5
      const active = node === this.hovered
      node.boundaryMaterial.opacity = (active ? 0.5 : 0.2) + pulse * 0.12
      node.edgeMaterial.opacity = (active ? 0.95 : 0.55) + pulse * 0.18
      node.boundary.position.y =
        node.boundaryBase + (this.reducedMotion ? 0 : Math.sin(elapsed * 0.7 + node.phase) * 0.07)
    }

    this.pet.update(elapsed, this.camera)

    this.frame += 1
    if (this.frame % 3 === 0) this.pick()

    this.renderer.render(this.scene, this.camera)
  }
}

/**
 * A glowing floating frame: a soft flat ribbon with a raised light bar along it,
 * so the district boundary is legible from above and from the side.
 */
function frameMesh(
  w: number,
  d: number,
  band: number,
  bandMaterial: THREE.Material,
  barMaterial: THREE.Material,
): THREE.Group {
  const group = new THREE.Group()
  const halfW = Math.max(0.05, w / 2)
  const halfD = Math.max(0.05, d / 2)

  const strip = (width: number, depth: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), bandMaterial)
    mesh.rotation.x = -Math.PI / 2
    mesh.position.set(x, 0, z)
    group.add(mesh)
  }
  strip(w, band, 0, -halfD)
  strip(w, band, 0, halfD)
  strip(band, d, -halfW, 0)
  strip(band, d, halfW, 0)

  const bar = (width: number, depth: number, x: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, 0.09, depth), barMaterial)
    mesh.position.set(x, 0, z)
    group.add(mesh)
  }
  bar(w, 0.1, 0, -halfD)
  bar(w, 0.1, 0, halfD)
  bar(0.1, d, -halfW, 0)
  bar(0.1, d, halfW, 0)

  return group
}


function accentFor(name: string): string {
  let hash = 0
  for (let index = 0; index < name.length; index += 1) {
    hash = (Math.imul(hash, 31) + name.charCodeAt(index)) >>> 0
  }
  return ACCENTS[hash % ACCENTS.length]
}

function push(map: Map<string, FileEntry[]>, key: string, entry: FileEntry): void {
  const bucket = map.get(key)
  if (bucket) bucket.push(entry)
  else map.set(key, [entry])
}

function linkKey(node: DistrictNode, file: CityFile): string {
  return `${node.repo.name}:${file.path}`
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : '.'
}

function extensionOf(path: string): string {
  const name = basename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : name
}

/** Files of the same district, nearest in the tree first. */
function siblings(node: DistrictNode, file: CityFile): FileEntry[] {
  const target = file.path.split('/')
  return node.files
    .filter((candidate) => candidate.path !== file.path)
    .map((candidate) => {
      const parts = candidate.path.split('/')
      let shared = 0
      while (shared < parts.length - 1 && shared < target.length - 1 && parts[shared] === target[shared]) {
        shared += 1
      }
      return { file: candidate, shared }
    })
    .sort((a, b) => b.shared - a.shared || a.file.path.localeCompare(b.file.path))
    .map((entry) => ({ node, file: entry.file }))
}

const CONCRETE = new THREE.Color('#dde2e7')

/**
 * Every building wears its file's language, eased a little toward concrete so a
 * full palette still reads as masonry under the city's hard light.
 */
function facadeColour(building: Building, out: THREE.Color, lift = 0): THREE.Color {
  return out
    .set(building.color)
    .offsetHSL(0, 0.08, building.shade + lift)
    .lerp(CONCRETE, 0.08)
}

function formatKb(sizeKb: number): string {
  if (sizeKb >= 1024) return `${(sizeKb / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(sizeKb))} KB`
}
