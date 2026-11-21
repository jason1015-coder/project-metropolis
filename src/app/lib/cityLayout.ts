// Pure geometry for the sand table: repositories become districts sized by the
// repository, and their files become buildings inside those districts.
// Districts are connected by a road network with intersections.

import type { CityFile, RepoSummary } from './githubCity'

export interface Rect {
  x: number
  z: number
  w: number
  d: number
}

export interface Plot {
  repo: RepoSummary
  rect: Rect
  index: number
}

export interface Building {
  file: CityFile
  x: number
  z: number
  w: number
  d: number
  h: number
  color: string
}

/** The usable sand area, in world units, centred on the table. */
export const SAND_BOUNDS: Rect = { x: 0, z: 0, w: 16.1, d: 10.1 }

const GAP = 0.13
const WALKWAY = 0.42
/** Lines of code that reach full height. Bigger files are clamped, not scaled. */
const TALLEST_LINES = 1400
const MAX_HEIGHT = 4.05
const MAX_FOOTPRINT = 0.95

// Road system constants
export const ROAD_WIDTH = 0.28
const MIN_DISTRICT_GAP = 0.8

export interface RoadNode {
  x: number
  z: number
  connections: number[] // indices into roadNodes array
  isIntersection: boolean
}

export interface RoadSegment {
  from: number
  to: number
  fromNode: RoadNode
  toNode: RoadNode
}

export interface RoadNetwork {
  nodes: RoadNode[]
  segments: RoadSegment[]
}

/**
 * Layout districts with connected road network.
 * Returns both the district plots and the road network connecting them.
 */
export function layoutCity(
  repos: RepoSummary[],
  bounds: Rect = SAND_BOUNDS,
): { plots: Plot[]; roadNetwork: RoadNetwork } {
  if (repos.length === 0) return { plots: [], roadNetwork: { nodes: [], segments: [] } }

  const weighted = repos
    .map((repo) => ({
      repo,
      weight:
        repo.fileCount && repo.fileCount > 0
          ? 1 + Math.sqrt(repo.fileCount)
          : 1 + Math.log1p(Math.max(0, repo.sizeKb)),
    }))
    .sort((a, b) => b.weight - a.weight || a.repo.name.localeCompare(b.repo.name))

  const plots = squarify(weighted, (entry) => entry.weight, bounds).map((entry, index) => ({
    repo: entry.item.repo,
    rect: shrink(entry.rect, GAP),
    index,
  }))

  // Build road network connecting districts
  const roadNetwork = buildRoadNetwork(plots, bounds)

  return { plots, roadNetwork }
}

function buildRoadNetwork(plots: Plot[], bounds: Rect): RoadNetwork {
  const nodes: RoadNode[] = []
  const segments: RoadSegment[] = []

  if (plots.length === 0) return { nodes, segments }

  // Create intersection nodes at district corners and along roads
  // Use a grid-based approach for efficient road layout

  const districtCenters: { x: number; z: number; rect: Rect; repo: RepoSummary }[] = plots.map((p) => ({
    x: p.rect.x,
    z: p.rect.z,
    rect: p.rect,
    repo: p.repo,
  }))

  // Create a main road grid based on district positions
  const mainRoadsX = new Set<number>()
  const mainRoadsZ = new Set<number>()

  // Add roads around each district (perimeter roads)
  for (const plot of plots) {
    const r = plot.rect
    // Road goes around the district
    const roadInset = ROAD_WIDTH / 2 + 0.1
    mainRoadsX.add(r.x - roadInset)
    mainRoadsX.add(r.x + r.w + roadInset)
    mainRoadsZ.add(r.z - roadInset)
    mainRoadsZ.add(r.z + r.d + roadInset)
  }

  // Add main arterial roads through the middle
  const centerX = bounds.x
  const centerZ = bounds.z
  mainRoadsX.add(centerX - 1.5)
  mainRoadsX.add(centerX + 1.5)
  mainRoadsZ.add(centerZ - 1.2)
  mainRoadsZ.add(centerZ + 1.2)

  // Convert to sorted arrays
  const roadXPositions = [...mainRoadsX].sort((a, b) => a - b)
  const roadZPositions = [...mainRoadsZ].sort((a, b) => a - b)

  // Create intersection nodes at grid crossings
  const nodeMap = new Map<string, number>()
  for (const x of roadXPositions) {
    for (const z of roadZPositions) {
      // Skip nodes inside districts
      const insideDistrict = plots.some((p) => {
        const r = p.rect
        return x >= r.x - 0.3 && x <= r.x + r.w + 0.3 && z >= r.z - 0.3 && z <= r.z + r.d + 0.3
      })
      if (!insideDistrict) {
        const key = `${x.toFixed(2)},${z.toFixed(2)}`
        const idx = nodes.length
        nodes.push({ x, z, connections: [], isIntersection: true })
        nodeMap.set(key, idx)
      }
    }
  }

  // Also add connection points at district edges (entry/exit points for roads)
  for (const plot of plots) {
    const r = plot.rect
    const entryPoints = [
      { x: r.x, z: r.z - ROAD_WIDTH / 2 }, // south
      { x: r.x + r.w / 2, z: r.z - ROAD_WIDTH / 2 - 0.3 }, // south center
      { x: r.x + r.w, z: r.z }, // east
      { x: r.x + r.w / 2, z: r.z + r.d + ROAD_WIDTH / 2 + 0.3 }, // north center
      { x: r.x, z: r.z + r.d }, // north
      { x: r.x - ROAD_WIDTH / 2 - 0.3, z: r.z + r.d / 2 }, // west center
      { x: r.x + r.w, z: r.z + r.d }, // northeast
      { x: r.x - ROAD_WIDTH / 2 - 0.3, z: r.z }, // west
      { x: r.x, z: r.z + r.d }, // north
    ]

    for (const pt of entryPoints) {
      const key = `${pt.x.toFixed(2)},${pt.z.toFixed(2)}`
      if (!nodeMap.has(key)) {
        const idx = nodes.length
        // Check if this point is inside any other district
        const insideOther = plots.some((p) => {
          if (p.repo.name === plot.repo.name) return false
          const r2 = p.rect
          return pt.x >= r2.x - 0.2 && pt.x <= r2.x + r2.w + 0.2 && pt.z >= r2.z - 0.2 && pt.z <= r2.z + r2.d + 0.2
        })
        if (!insideOther) {
          nodes.push({ x: pt.x, z: pt.z, connections: [], isIntersection: false })
          nodeMap.set(key, idx)
        }
      }
    }
  }

  // Connect nearby nodes along roads
  const connectionDistance = ROAD_WIDTH * 3 + 0.5

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]
      const b = nodes[j]
      const dist = Math.hypot(a.x - b.x, a.z - b.z)

      if (dist < connectionDistance) {
        // Check if the road between them would pass through a district
        const midX = (a.x + b.x) / 2
        const midZ = (a.z + b.z) / 2
        const passesThroughDistrict = plots.some((p) => {
          const r = p.rect
          return midX >= r.x - 0.3 && midX <= r.x + r.w + 0.3 && midZ >= r.z - 0.3 && midZ <= r.z + r.d + 0.3
        })

        if (!passesThroughDistrict) {
          a.connections.push(j)
          b.connections.push(i)
          segments.push({ from: i, to: j, fromNode: a, toNode: b })
        }
      }
    }
  }

  // Add some longer connecting roads along the grid lines for better connectivity
  for (let xi = 0; xi < roadXPositions.length - 1; xi++) {
    for (let zi = 0; zi < roadZPositions.length - 1; zi++) {
      const x1 = roadXPositions[xi]
      const x2 = roadXPositions[xi + 1]
      const z1 = roadZPositions[zi]
      const z2 = roadZPositions[zi + 1]

      // Horizontal connection
      const hKey1 = `${x1.toFixed(2)},${z1.toFixed(2)}`
      const hKey2 = `${x2.toFixed(2)},${z1.toFixed(2)}`
      const hIdx1 = nodeMap.get(hKey1)
      const hIdx2 = nodeMap.get(hKey2)
      if (hIdx1 !== undefined && hIdx2 !== undefined) {
        const dist = Math.abs(x2 - x1)
        if (dist < 5) {
          nodes[hIdx1].connections.push(hIdx2)
          nodes[hIdx2].connections.push(hIdx1)
          segments.push({ from: hIdx1, to: hIdx2, fromNode: nodes[hIdx1], toNode: nodes[hIdx2] })
        }
      }

      // Vertical connection
      const vKey1 = `${x1.toFixed(2)},${z1.toFixed(2)}`
      const vKey2 = `${x1.toFixed(2)},${z2.toFixed(2)}`
      const vIdx1 = nodeMap.get(vKey1)
      const vIdx2 = nodeMap.get(vKey2)
      if (vIdx1 !== undefined && vIdx2 !== undefined) {
        const dist = Math.abs(z2 - z1)
        if (dist < 5) {
          nodes[vIdx1].connections.push(vIdx2)
          nodes[vIdx2].connections.push(vIdx1)
          segments.push({ from: vIdx1, to: vIdx2, fromNode: nodes[vIdx1], toNode: nodes[vIdx2] })
        }
      }
    }
  }

  return { nodes, segments }
}

export function layoutBuildings(files: CityFile[], district: Rect): Building[] {
  if (files.length === 0) return []
  const area = shrink(district, WALKWAY)
  if (area.w <= 0 || area.d <= 0) return []

  const aspect = area.w / area.d
  const cols = Math.max(1, Math.min(48, Math.round(Math.sqrt(files.length * aspect))))
  const rows = Math.ceil(files.length / cols)
  const cellW = area.w / cols
  const cellD = area.d / rows
  const cell = Math.min(cellW, cellD)

  const cells: { x: number; z: number }[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x: area.x - area.w / 2 + cellW * (col + 0.5),
        z: area.z - area.d / 2 + cellD * (row + 0.5),
      })
    }
  }

  cells.sort((a, b) => Math.hypot(a.x - area.x, a.z - area.z) - Math.hypot(b.x - area.x, b.z - area.z))
  const ordered = [...files].sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)
  const biggest = Math.max(1, ...files.map((file) => file.bytes))

  return ordered.slice(0, cells.length).map((file, index) => {
    const cellCentre = cells[index]
    const footprint = Math.min(MAX_FOOTPRINT, Math.max(0.028, cell * (0.5 + 0.36 * Math.sqrt(file.bytes / biggest))))
    return {
      file,
      x: cellCentre.x,
      z: cellCentre.z,
      w: footprint,
      d: footprint,
      h: heightFor(file.lines),
      color: file.color,
    }
  })
}

export function heightFor(lines: number): number {
  const normalised = Math.min(1, Math.log1p(Math.max(0, lines)) / Math.log1p(TALLEST_LINES))
  return 0.16 + Math.pow(normalised, 2) * MAX_HEIGHT
}

function shrink(rect: Rect, amount: number): Rect {
  return {
    x: rect.x,
    z: rect.z,
    w: Math.max(0, rect.w - amount * 2),
    d: Math.max(0, rect.d - amount * 2),
  }
}

function squarify<T>(items: T[], weightOf: (item: T) => number, box: Rect): { item: T; rect: Rect }[] {
  const total = items.reduce((sum, item) => sum + weightOf(item), 0) || 1
  const scale = (box.w * box.d) / total
  const areas = items.map((item) => ({ item, area: Math.max(1e-6, weightOf(item) * scale) }))

  const output: { item: T; rect: Rect }[] = []
  let left = box.x - box.w / 2
  let top = box.z - box.d / 2
  let width = box.w
  let depth = box.d
  let cursor = 0

  while (cursor < areas.length && width > 1e-4 && depth > 1e-4) {
    const shortSide = Math.min(width, depth)
    const row = [areas[cursor]]
    let sum = areas[cursor].area
    let next = cursor + 1
    let worst = worstRatio(row, sum, shortSide)

    while (next < areas.length) {
      const candidate = [...row, areas[next]]
      const candidateSum = sum + areas[next].area
      const candidateWorst = worstRatio(candidate, candidateSum, shortSide)
      if (candidateWorst > worst) break
      row.push(areas[next])
      sum = candidateSum
      worst = candidateWorst
      next += 1
    }

    if (width >= depth) {
      const stripWidth = sum / depth
      let offset = top
      for (const entry of row) {
        const entryDepth = entry.area / stripWidth
        output.push({
          item: entry.item,
          rect: { x: left + stripWidth / 2, z: offset + entryDepth / 2, w: stripWidth, d: entryDepth },
        })
        offset += entryDepth
      }
      left += stripWidth
      width -= stripWidth
    } else {
      const stripDepth = sum / width
      let offset = left
      for (const entry of row) {
        const entryWidth = entry.area / stripDepth
        output.push({
          item: entry.item,
          rect: { x: offset + entryWidth / 2, z: top + stripDepth / 2, w: entryWidth, d: stripDepth },
        })
        offset += entryWidth
      }
      top += stripDepth
      depth -= stripDepth
    }

    cursor = next
  }

  return output
}

function worstRatio(row: { area: number }[], sum: number, side: number): number {
  let largest = 0
  let smallest = Number.POSITIVE_INFINITY
  for (const entry of row) {
    largest = Math.max(largest, entry.area)
    smallest = Math.min(smallest, entry.area)
  }
  const sumSquared = sum * sum
  const sideSquared = side * side
  return Math.max((sideSquared * largest) / sumSquared, sumSquared / (sideSquared * smallest))
}
