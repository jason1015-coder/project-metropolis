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

export interface Building {
  file: CityFile
  x: number
  z: number
  w: number
  d: number
  h: number
  color: string
}

/** The city footprint, in world units, centred on the origin. */
export const CITY_BOUNDS: Rect = { x: 0, z: 0, w: 34, d: 23 }

/** The width of the streets that run between the blocks. */
export const ROAD_WIDTH = 1.35

const WALKWAY = 0.55
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

  // Fill the block edge to edge rather than clustering the tallest towers in
  // the middle, so neighbouring blocks read as one continuous city.
  const ordered = [...files].sort((a, b) => b.lines - a.lines || b.bytes - a.bytes)
  const biggest = Math.max(1, ...files.map((file) => file.bytes))

  return ordered.slice(0, cells.length).map((file, index) => {
    const cellCentre = cells[index]
    const footprint = Math.min(MAX_FOOTPRINT, Math.max(0.18, cell * (0.62 + 0.3 * Math.sqrt(file.bytes / biggest))))
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
