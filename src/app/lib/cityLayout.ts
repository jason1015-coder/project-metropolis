// Pure geometry for the city: one continuous metropolis made of city blocks.
// Each repository owns a block, its files become buildings on that block, and
// the streets run between the blocks along a shared grid.

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

export type DetailKind = 'setback' | 'spire' | 'tank'

/** The extra mass on a roof that gives a building its silhouette. */
export interface BuildingDetail {
  kind: DetailKind
  w: number
  d: number
  h: number
  dx: number
  dz: number
}

export interface Building {
  file: CityFile
  x: number
  z: number
  w: number
  d: number
  h: number
  color: string
  /** Style seed for this file: the same file always builds the same way. */
  seed: number
  /** Small lightness shift so neighbouring facades are not identical. */
  shade: number
  detail: BuildingDetail | null
}

/** The city footprint, in world units, centred on the origin. */
export const CITY_BOUNDS: Rect = { x: 0, z: 0, w: 34, d: 23 }

/** The width of the streets that run between the blocks. */
export const ROAD_WIDTH = 1.35

/** Pavement between a building and the kerb: buildings front straight onto the streets. */
const FRONTAGE = 0.14
/** Lines of code that reach full height. Bigger files are clamped, not scaled. */
const TALLEST_LINES = 1600
const MAX_HEIGHT = 4.4
const MAX_FOOTPRINT = 1.6

export interface RoadNode {
  x: number
  z: number
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
 * Lay the repositories out as blocks of one continuous city. The blocks share a
 * single street grid, so neighbouring districts are separated by a road rather
 * than by a gap of empty ground.
 */
export function layoutCity(
  repos: RepoSummary[],
  bounds: Rect = CITY_BOUNDS,
): { plots: Plot[]; roadNetwork: RoadNetwork } {
  if (repos.length === 0) return { plots: [], roadNetwork: { nodes: [], segments: [] } }

  const weighted = repos
    .map((repo) => ({ repo, weight: weightOf(repo) }))
    .sort((a, b) => b.weight - a.weight || a.repo.name.localeCompare(b.repo.name))

  const count = weighted.length
  const aspect = bounds.w / bounds.d
  const cols = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * aspect))))
  const rows = Math.ceil(count / cols)

  const cells = weighted.map((entry, index) => ({
    ...entry,
    row: Math.floor(index / cols),
    col: index % cols,
  }))

  // Wider columns and deeper rows for the blocks that hold the bigger districts,
  // so the city keeps the "area = repository size" feel without breaking the grid.
  const colWeights = new Array<number>(cols).fill(0)
  const rowWeights = new Array<number>(rows).fill(0)
  for (const cell of cells) {
    colWeights[cell.col] += cell.weight
    rowWeights[cell.row] += cell.weight
  }
  for (let i = 0; i < cols; i += 1) if (colWeights[i] === 0) colWeights[i] = 1
  for (let j = 0; j < rows; j += 1) if (rowWeights[j] === 0) rowWeights[j] = 1

  const xs = axis(bounds.x - bounds.w / 2, bounds.w, colWeights)
  const zs = axis(bounds.z - bounds.d / 2, bounds.d, rowWeights)

  const plots = cells.map((cell, index) => {
    const cellW = xs[cell.col + 1] - xs[cell.col]
    const cellD = zs[cell.row + 1] - zs[cell.row]
    return {
      repo: cell.repo,
      rect: {
        x: (xs[cell.col] + xs[cell.col + 1]) / 2,
        z: (zs[cell.row] + zs[cell.row + 1]) / 2,
        w: Math.max(0, cellW - ROAD_WIDTH),
        d: Math.max(0, cellD - ROAD_WIDTH),
      },
      index,
    }
  })

  return { plots, roadNetwork: buildRoadNetwork(xs, zs) }
}

/** One continuous street grid: a road on every block boundary. */
function buildRoadNetwork(xs: number[], zs: number[]): RoadNetwork {
  const nodes: RoadNode[] = []
  const indexOf = (col: number, row: number) => row * xs.length + col

  for (let row = 0; row < zs.length; row += 1) {
    for (let col = 0; col < xs.length; col += 1) {
      nodes.push({ x: xs[col], z: zs[row], isIntersection: true })
    }
  }

  const segments: RoadSegment[] = []
  for (let row = 0; row < zs.length; row += 1) {
    for (let col = 0; col < xs.length; col += 1) {
      const from = indexOf(col, row)
      if (col + 1 < xs.length) {
        const to = indexOf(col + 1, row)
        segments.push({ from, to, fromNode: nodes[from], toNode: nodes[to] })
      }
      if (row + 1 < zs.length) {
        const to = indexOf(col, row + 1)
        segments.push({ from, to, fromNode: nodes[from], toNode: nodes[to] })
      }
    }
  }

  return { nodes, segments }
}

/** Split a span into cell boundaries proportionally to the cell weights. */
function axis(start: number, total: number, weights: number[]): number[] {
  const sum = weights.reduce((accumulator, weight) => accumulator + weight, 0) || 1
  const boundaries = [start]
  let cursor = start
  for (const weight of weights) {
    cursor += (total * weight) / sum
    boundaries.push(cursor)
  }
  return boundaries
}

function weightOf(repo: RepoSummary): number {
  return repo.fileCount && repo.fileCount > 0
    ? 1 + Math.sqrt(repo.fileCount)
    : 1 + Math.log1p(Math.max(0, repo.sizeKb))
}

export function layoutBuildings(files: CityFile[], district: Rect): Building[] {
  if (files.length === 0) return []
  const area = shrink(district, FRONTAGE)
  if (area.w <= 0 || area.d <= 0) return []

  const aspect = area.w / area.d
  const cols = Math.max(1, Math.min(48, Math.round(Math.sqrt(files.length * aspect))))
  const rows = Math.ceil(files.length / cols)
  const cellW = area.w / cols
  const cellD = area.d / rows

  // Street frontage first: a block lines its own roads before the middle of the
  // block is filled in, so every district meets the streets with buildings.
  const cells: { x: number; z: number; edge: number }[] = []
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        x: area.x - area.w / 2 + cellW * (col + 0.5),
        z: area.z - area.d / 2 + cellD * (row + 0.5),
        edge: Math.min(col, cols - 1 - col, row, rows - 1 - row),
      })
    }
  }
  cells.sort((a, b) => a.edge - b.edge)

  const ordered = [...files].sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)

  return ordered.slice(0, cells.length).map((file, index) => {
    const plot = cells[index]
    // Style is hashed from the file path, so it survives reloads and deploys.
    const seed = hashPath(file.path)
    const height = heightFor(file.lines) * (0.7 + unit(seed, 1) * 0.75)

    // Towers keep more air around them than low-rise buildings, but every plot
    // leaves an alley, so each file stays a building instead of merging into
    // its neighbours.
    const tall = height / (0.4 + MAX_HEIGHT)
    const fill = 0.9 - 0.24 * tall * unit(seed, 2)
    const w = clamp(cellW * fill * (0.84 + unit(seed, 3) * 0.16), 0.12, MAX_FOOTPRINT)
    const d = clamp(cellD * fill * (0.84 + unit(seed, 4) * 0.16), 0.12, MAX_FOOTPRINT)

    return {
      file,
      x: plot.x + (unit(seed, 12) - 0.5) * cellW * 0.06,
      z: plot.z + (unit(seed, 13) - 0.5) * cellD * 0.06,
      w,
      d,
      h: height,
      color: file.color,
      seed,
      shade: -0.07 + unit(seed, 5) * 0.14,
      detail: detailFor(seed, w, d, height),
    }
  })
}

/** Roof massing: a stepped setback, a mast, or a plant box on one corner. */
function detailFor(seed: number, w: number, d: number, h: number): BuildingDetail | null {
  const pick = unit(seed, 6)
  if (pick < 0.42) return null

  if (pick < 0.66) {
    return {
      kind: 'setback',
      w: w * (0.5 + unit(seed, 7) * 0.2),
      d: d * (0.5 + unit(seed, 7) * 0.2),
      h: Math.max(0.12, h * (0.1 + unit(seed, 8) * 0.1)),
      dx: 0,
      dz: 0,
    }
  }

  if (pick < 0.85) {
    return {
      kind: 'spire',
      w: Math.min(0.16, w * 0.3),
      d: Math.min(0.16, d * 0.3),
      h: Math.max(0.3, h * (0.22 + unit(seed, 9) * 0.25)),
      dx: 0,
      dz: 0,
    }
  }

  const size = Math.min(w, d) * 0.44
  return {
    kind: 'tank',
    w: size,
    d: size,
    h: Math.max(0.1, h * 0.09),
    dx: (w / 2 - size / 2 - 0.03) * (unit(seed, 10) > 0.5 ? 1 : -1),
    dz: (d / 2 - size / 2 - 0.03) * (unit(seed, 11) > 0.5 ? 1 : -1),
  }
}

/** Stable FNV-1a hash: the same file path always yields the same style. */
function hashPath(path: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < path.length; index += 1) {
    hash ^= path.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** Deterministic 0..1 value for one (file, salt) pair. */
function unit(seed: number, salt: number): number {
  let value = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0
  value ^= value >>> 15
  value = Math.imul(value, 0x2c1b3c6d) >>> 0
  value ^= value >>> 12
  value = Math.imul(value, 0x297a2d39) >>> 0
  value ^= value >>> 15
  return (value >>> 0) / 4294967296
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function heightFor(lines: number): number {
  const normalised = Math.min(1, Math.log1p(Math.max(0, lines)) / Math.log1p(TALLEST_LINES))
  return 0.4 + Math.pow(normalised, 2) * MAX_HEIGHT
}

function shrink(rect: Rect, amount: number): Rect {
  return {
    x: rect.x,
    z: rect.z,
    w: Math.max(0, rect.w - amount * 2),
    d: Math.max(0, rect.d - amount * 2),
  }
}
