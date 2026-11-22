// The city itself: one continuous grid of blocks on the page background, one
// block per repository and one instanced building per file, with the streets
// running between the blocks. Everything is three.js, driven imperatively so a
// few hundred buildings stay cheap.

import * as THREE from 'three'

import {
  CITY_BOUNDS,
  layoutCity,
  layoutBuildings,
  type Building,
  type Plot,
  type RoadNetwork,
  ROAD_WIDTH,
} from '../../lib/cityLayout'
import {
  fileUrl,
  type CityFile,
  type DistrictData,
  type RepoSummary,
} from '../../lib/githubCity'
import { createTamagotchi, type PetMood, type Tamagotchi } from './tamagotchi'
import { makeContactShadow, makeDistrictLabel, makeGlowTexture } from './textures'

const GROUND_Y = 0
const BLOCK_H = 0.12
const BUILDING_BASE = BLOCK_H
const LABEL_BAND = 0.7
const PET_POSITION = new THREE.Vector3(-8, GROUND_Y, CITY_BOUNDS.d / 2 + 2.4)

const BLOCK_COLOURS = ['#202a27', '#232d29', '#1e2724', '#262f2b', '#212a27', '#28322e']

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

interface DistrictNode {
  repo: RepoSummary
  plot: Plot
  buildings: THREE.Group
  mesh: THREE.InstancedMesh | null
  data: DistrictData | null
  files: CityFile[]
  layout: Building[]
  block: THREE.Mesh
  label: THREE.Mesh
  labelTexture: THREE.CanvasTexture
  appear: number
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
  private roadMarks: THREE.InstancedMesh | null = null
  private roadCount = 0
  private readonly highlight: THREE.LineSegments
  private readonly pet: Tamagotchi
  private readonly observer: ResizeObserver
  private readonly reducedMotion: boolean
  private raf = 0
  private disposed = false
  private hovered: DistrictNode | null = null
  private hoveredFile: CityFile | null = null
  private hoverKey = ''
  private pointerInside = false
  private dragging = false
  private dragDistance = 0
  private lastPointer = { x: 0, y: 0 }
  private lastInput = 0
  private yaw = 0.62
  private pitch = 0.48
  private distance = 38
  private readonly target = new THREE.Vector3(0, 1.4, 0)
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
    this.renderer.toneMappingExposure = 1.05
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
    const highlightMaterial = new THREE.LineBasicMaterial({ color: '#f2ffb0', transparent: true, opacity: 0.95 })
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

  setRepos(repos: RepoSummary[]): void {
    for (const node of this.nodes.values()) this.removeNode(node)
    this.nodes.clear()
    this.hovered = null
    this.hoveredFile = null

    // Clear the streets
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

    const { plots, roadNetwork } = layoutCity(repos)
    for (const plot of plots) this.addNode(plot)

    // Build roads
    this.buildRoads(roadNetwork)

    this.renderer.shadowMap.needsUpdate = true
    this.emitStats()
  }

  setDistrict(data: DistrictData): void {
    const node = this.nodes.get(data.repo)
    if (!node) return
    const firstBuild = node.mesh === null
    node.data = data
    node.files = data.files

    const labelTexture = makeDistrictLabel(
      node.repo.name,
      `${data.files.length} buildings · ${data.lines.toLocaleString('en-GB')} lines`,
    )
    node.labelTexture.dispose()
    node.labelTexture = labelTexture
    const labelMaterial = node.label.material as THREE.MeshBasicMaterial
    labelMaterial.map = labelTexture
    labelMaterial.needsUpdate = true

    const inner = {
      x: node.plot.rect.x,
      z: node.plot.rect.z - LABEL_BAND / 2,
      w: node.plot.rect.w,
      d: node.plot.rect.d - LABEL_BAND,
    }
    node.layout = layoutBuildings(data.files, inner)

    if (node.mesh) {
      node.buildings.remove(node.mesh)
      node.mesh.geometry.dispose()
      ;(node.mesh.material as THREE.Material).dispose()
      node.mesh = null
    }

    if (node.layout.length > 0) {
      const geometry = new THREE.BoxGeometry(1, 1, 1)
      geometry.translate(0, 0.5, 0)
      const material = new THREE.MeshStandardMaterial({ roughness: 0.58, metalness: 0.1 })
      const mesh = new THREE.InstancedMesh(geometry, material, node.layout.length)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.userData.node = node

      const matrix = new THREE.Matrix4()
      const quaternion = new THREE.Quaternion()
      const position = new THREE.Vector3()
      const scale = new THREE.Vector3()
      const colour = new THREE.Color()

      node.layout.forEach((building, index) => {
        position.set(building.x, 0, building.z)
        scale.set(building.w, building.h, building.d)
        matrix.compose(position, quaternion, scale)
        mesh.setMatrixAt(index, matrix)
        mesh.setColorAt(index, colour.set(building.color))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingSphere()

      node.mesh = mesh
      node.buildings.add(mesh)
      if (firstBuild) {
        node.buildings.scale.y = this.reducedMotion ? 1 : 0.001
        node.appear = this.reducedMotion ? 1 : 0
      }
    }

    this.renderer.shadowMap.needsUpdate = true
    this.emitStats()
  }

  setPet(state: { mood: PetMood; headline: string; detail: string; progress: number }): void {
    this.pet.setState(state)
  }

  dispose(): void {
    this.disposed = true
    cancelAnimationFrame(this.raf)
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
      new THREE.MeshStandardMaterial({ color: '#0e1413', roughness: 0.96, metalness: 0 }),
    )
    ground.rotation.x = -Math.PI / 2
    ground.position.y = GROUND_Y
    ground.receiveShadow = true
    this.scene.add(ground)

    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(CITY_BOUNDS.w * 1.9, CITY_BOUNDS.d * 2.1),
      new THREE.MeshBasicMaterial({
        map: makeGlowTexture(),
        transparent: true,
        opacity: 0.5,
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
    this.scene.add(new THREE.HemisphereLight(0xffe7c2, 0x101815, 0.95))

    const key = new THREE.DirectionalLight(0xfff0d2, 2.4)
    key.position.set(16, 26, 18)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -24
    key.shadow.camera.right = 24
    key.shadow.camera.top = 24
    key.shadow.camera.bottom = -24
    key.shadow.camera.near = 1
    key.shadow.camera.far = 90
    key.shadow.bias = -0.0004
    key.shadow.normalBias = 0.02
    this.scene.add(key)

    const rim = new THREE.DirectionalLight(0x8fb6ff, 0.7)
    rim.position.set(-12, 8, -10)
    this.scene.add(rim)

    const fill = new THREE.PointLight(0xffcf94, 40, 34, 2)
    fill.position.set(0, 12, 6)
    this.scene.add(fill)
  }

  private buildRoads(roadNetwork: RoadNetwork): void {
    const roadMaterial = new THREE.MeshStandardMaterial({ color: '#2c3331', roughness: 0.94, metalness: 0.02 })
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

    const block = new THREE.Mesh(
      new THREE.BoxGeometry(rect.w, BLOCK_H, rect.d),
      new THREE.MeshStandardMaterial({
        color: BLOCK_COLOURS[index % BLOCK_COLOURS.length],
        roughness: 0.92,
        metalness: 0.02,
      }),
    )
    block.position.set(rect.x, GROUND_Y + BLOCK_H / 2, rect.z)
    block.receiveShadow = true
    block.userData.node = null
    this.scene.add(block)

    const kerb = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(rect.w, BLOCK_H, rect.d)),
      new THREE.LineBasicMaterial({ color: '#4b5b54', transparent: true, opacity: 0.5 }),
    )
    kerb.position.copy(block.position)
    this.scene.add(kerb)

    const labelTexture = makeDistrictLabel(repo.name, `${repo.language ?? 'repository'} · ${formatKb(repo.sizeKb)}`)
    const labelWidth = Math.min(rect.w * 0.72, 3.6)
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(labelWidth, labelWidth * (176 / 1024)),
      new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false, toneMapped: false }),
    )
    label.rotation.x = -Math.PI / 2
    label.position.set(rect.x, BUILDING_BASE + 0.01, rect.z + rect.d / 2 - LABEL_BAND / 2)
    this.scene.add(label)

    const buildings = new THREE.Group()
    buildings.position.y = BUILDING_BASE
    buildings.scale.y = this.reducedMotion ? 1 : 0.001
    this.scene.add(buildings)

    const node: DistrictNode = {
      repo,
      plot,
      buildings,
      mesh: null,
      data: null,
      files: [],
      layout: [],
      block,
      label,
      labelTexture,
      appear: this.reducedMotion ? 1 : 0,
    }
    block.userData.node = node
    this.nodes.set(repo.name, node)
  }

  private removeNode(node: DistrictNode): void {
    for (const object of [node.block, node.label, node.buildings]) {
      object.removeFromParent()
      object.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.LineSegments) {
          child.geometry.dispose()
          const materials = Array.isArray(child.material) ? child.material : [child.material]
          for (const material of materials) material.dispose()
        }
      })
      if (object === node.label) node.labelTexture.dispose()
    }
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
  }

  private detach(): void {
    const el = this.renderer.domElement
    el.removeEventListener('pointerdown', this.onPointerDown)
    el.removeEventListener('pointermove', this.onPointerMove)
    el.removeEventListener('pointerup', this.onPointerUp)
    el.removeEventListener('pointerleave', this.onPointerLeave)
    el.removeEventListener('wheel', this.onWheel)
    el.removeEventListener('dblclick', this.resetCamera)
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
    this.clearHover()
  }

  private onWheel = (event: WheelEvent) => {
    event.preventDefault()
    this.distance = THREE.MathUtils.clamp(this.distance * Math.exp(event.deltaY * 0.0011), 16, 68)
    this.lastInput = performance.now()
  }

  private resetCamera = () => {
    this.yaw = 0.62
    this.pitch = 0.48
    this.distance = 38
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

    const meshes: THREE.InstancedMesh[] = []
    for (const node of this.nodes.values()) {
      if (node.mesh) meshes.push(node.mesh)
    }

    const buildingHits = this.raycaster.intersectObjects(meshes, false)
    if (buildingHits.length > 0) {
      const hit = buildingHits[0]
      const mesh = hit.object as THREE.InstancedMesh
      const node = mesh.userData.node as DistrictNode | undefined
      const index = hit.instanceId
      if (node && index !== undefined) {
        const building = node.layout[index]
        if (building) {
          this.setHover(node, building.file, building, `${node.repo.name}:${building.file.path}`)
          return
        }
      }
    }

    const blocks: THREE.Mesh[] = []
    for (const node of this.nodes.values()) blocks.push(node.block)
    const blockHits = this.raycaster.intersectObjects(blocks, false)
    if (blockHits.length > 0) {
      const node = blockHits[0].object.userData.node as DistrictNode | undefined
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
      const rise = node.buildings.scale.y
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
      hint: 'click to open the file',
    }
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
      shown: data?.files.length ?? 0,
      stars: node.repo.stars,
      language: node.repo.language ?? undefined,
      url: node.repo.url,
      hint: 'click to open the repository',
    }
  }

  private emitStats(): void {
    let buildings = 0
    let lines = 0
    let bytes = 0
    for (const node of this.nodes.values()) {
      buildings += node.layout.length
      lines += node.data?.lines ?? 0
      bytes += node.data?.bytes ?? 0
    }
    this.callbacks.onStats({
      districts: this.nodes.size,
      buildings,
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
    this.updateCamera()

    let rising = false
    for (const node of this.nodes.values()) {
      if (node.appear < 1) {
        node.appear = Math.min(1, node.appear + delta * 1.5)
        const eased = 1 - Math.pow(1 - node.appear, 3)
        node.buildings.scale.y = 0.001 + eased * 0.999
        rising = true
      }
    }
    if (rising) this.renderer.shadowMap.needsUpdate = true

    this.pet.update(elapsed, this.camera)

    this.frame += 1
    if (this.frame % 3 === 0) this.pick()

    this.renderer.render(this.scene, this.camera)
  }
}

function formatKb(sizeKb: number): string {
  if (sizeKb >= 1024) return `${(sizeKb / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(sizeKb))} KB`
}
