// Turning the imports the survey recorded back into paths in the same district,
// so the line map knows which building an edge should land on. Specifiers that
// point at a package ("react", "node:fs") are dropped: packages have no building
// in the city, only files in the surveyed repositories do.

export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** The directory of a path, or '' for a file at the repository root. */
export function dirnameOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash > 0 ? path.slice(0, slash) : ''
}

export function extensionOf(path: string): string {
  const name = basename(path).toLowerCase()
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : name
}

/** Extensions a bundler fills in for an extensionless import, in priority order. */
const SCRIPT_SUFFIXES = [
  '',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.svelte',
  '.vue',
  '.astro',
  '.json',
  '.css',
  '.scss',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '/index.mjs',
]

/**
 * Resolve one import specifier written in `fromPath` to a path that exists in
 * the same repository, or null when it leaves the repository.
 */
export function resolveImport(
  fromPath: string,
  specifier: string,
  exists: (path: string) => boolean,
): string | null {
  const spec = specifier.trim().replace(/[?#].*$/, '')
  if (!spec) return null

  const extension = extensionOf(fromPath)
  if (extension === 'py') return resolvePython(fromPath, spec, exists)
  if (extension === 'rs') return resolveRust(fromPath, spec, exists)
  return resolveScript(fromPath, spec, exists)
}

function resolveScript(
  fromPath: string,
  spec: string,
  exists: (path: string) => boolean,
): string | null {
  const bases: string[] = []
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const base = normalise(`${dirnameOf(fromPath)}/${spec}`)
    if (base) bases.push(base)
  } else if (spec.startsWith('/')) {
    const base = normalise(spec.slice(1))
    if (base) bases.push(base)
  } else if (spec.startsWith('@/') || spec.startsWith('~/')) {
    // Source aliases point at one of the repository's own roots. The usual ones
    // come first, then every folder the importing file already lives under, so
    // an alias like `@/app/...` mapped to `source/` resolves too.
    const rest = spec.slice(2)
    const roots = new Set(['src/', 'source/', 'app/', 'lib/', ''])
    const segments = fromPath.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      roots.add(`${segments.slice(0, index).join('/')}/`)
    }
    for (const root of roots) {
      const base = normalise(`${root}${rest}`)
      if (base) bases.push(base)
    }
  } else {
    return null
  }

  for (const base of bases) {
    for (const candidate of withSuffixes(base)) {
      if (exists(candidate)) return candidate
    }
  }
  return null
}

/** Every file a bundler could mean by `base`, including Node's `./foo.js` -> foo.ts. */
function withSuffixes(base: string): string[] {
  const candidates = SCRIPT_SUFFIXES.map((suffix) => `${base}${suffix}`)
  const stem = base.replace(/\.(js|mjs|cjs)$/, '')
  if (stem !== base) {
    for (const suffix of ['.ts', '.tsx', '.d.ts']) candidates.push(`${stem}${suffix}`)
  }
  return candidates
}

/** `from .utils import x` and `from ..lib import y`, Python's relative imports. */
function resolvePython(
  fromPath: string,
  spec: string,
  exists: (path: string) => boolean,
): string | null {
  const dots = spec.match(/^\.+/)?.[0].length ?? 0
  if (dots === 0) return null

  let directory = dirnameOf(fromPath)
  for (let index = 1; index < dots; index += 1) directory = dirnameOf(directory)
  const rest = spec.slice(dots).replace(/\./g, '/')
  const base = normalise(directory ? `${directory}/${rest}` : rest)
  if (!base) return null

  for (const candidate of [`${base}.py`, `${base}/__init__.py`]) {
    if (exists(candidate)) return candidate
  }
  return null
}

/** `use crate::foo::Bar`, `use self::bar`, `use super::baz`: Rust modules. */
function resolveRust(
  fromPath: string,
  spec: string,
  exists: (path: string) => boolean,
): string | null {
  let root: string
  let tail: string
  if (spec.startsWith('crate::')) {
    root = 'src'
    tail = spec.slice('crate::'.length)
    if (exists(normalise(tail) ? `${normalise(tail)}.rs` : '')) root = ''
  } else if (spec.startsWith('self::')) {
    root = dirnameOf(fromPath)
    tail = spec.slice('self::'.length)
  } else if (spec.startsWith('super::')) {
    root = dirnameOf(dirnameOf(fromPath))
    tail = spec.slice('super::'.length)
  } else {
    return null
  }

  const segments = tail.split('::').filter(Boolean)
  const prefixes = root === 'src' ? ['src', ''] : [root]
  // `use crate::foo::Bar` names the item too: try the whole path, then shorter.
  for (let length = segments.length; length > 0; length -= 1) {
    const path = segments.slice(0, length).join('/')
    for (const prefix of prefixes) {
      const base = normalise(prefix ? `${prefix}/${path}` : path)
      if (!base) continue
      for (const candidate of [`${base}.rs`, `${base}/mod.rs`]) {
        if (exists(candidate)) return candidate
      }
    }
  }
  return null
}

function normalise(path: string): string | null {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (parts.length === 0) return null
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join('/')
}
