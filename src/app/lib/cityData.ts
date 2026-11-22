// The city is generated once, by the "Survey city layout" workflow, which walks
// every repository under the account and commits `city-layout.txt`. At runtime we
// only read that file: no GitHub API calls, no per-visitor survey, no rate limits.

export const CITY_OWNER = 'jason1015-coder'

/** The layout file the survey workflow writes and the site reads. */
export const LAYOUT_FILE = 'city-layout.txt'

export interface RepoSummary {
  name: string
  description: string
  language: string | null
  stars: number
  forks: number
  sizeKb: number
  branch: string
  pushedAt: string
  url: string
  fork: boolean
  /** Text files that became buildings, once the layout is known. */
  fileCount?: number
}

export interface CityFile {
  path: string
  lines: number
  bytes: number
  language: string
  color: string
  /** In-repo import specifiers the survey found in this file's source. */
  imports: string[]
}

export interface DistrictData {
  repo: string
  files: CityFile[]
  lines: number
  bytes: number
  totalFiles: number
  fetchedAt: number
}

export interface CityLayout {
  owner: string
  /** Newest push time across the surveyed repositories. */
  updatedAt: string
  districts: DistrictData[]
  repos: RepoSummary[]
}

interface Language {
  label: string
  color: string
}

const LANGUAGES: Record<string, Language> = {
  ts: { label: 'TypeScript', color: '#4c8fd0' },
  tsx: { label: 'TypeScript', color: '#4c8fd0' },
  js: { label: 'JavaScript', color: '#e8d46a' },
  jsx: { label: 'JavaScript', color: '#e8d46a' },
  mjs: { label: 'JavaScript', color: '#e8d46a' },
  cjs: { label: 'JavaScript', color: '#e8d46a' },
  rs: { label: 'Rust', color: '#c98b6b' },
  cpp: { label: 'C++', color: '#c2567f' },
  cc: { label: 'C++', color: '#c2567f' },
  cxx: { label: 'C++', color: '#c2567f' },
  hpp: { label: 'C++', color: '#b06a92' },
  c: { label: 'C', color: '#7f92a8' },
  h: { label: 'C', color: '#7f92a8' },
  py: { label: 'Python', color: '#4f7fb0' },
  go: { label: 'Go', color: '#5cc8d8' },
  md: { label: 'Markdown', color: '#8fa4b8' },
  mdx: { label: 'Markdown', color: '#8fa4b8' },
  json: { label: 'JSON', color: '#b8b273' },
  jsonc: { label: 'JSON', color: '#b8b273' },
  yml: { label: 'YAML', color: '#a98ed6' },
  yaml: { label: 'YAML', color: '#a98ed6' },
  toml: { label: 'TOML', color: '#b08c6e' },
  css: { label: 'CSS', color: '#7a6fbf' },
  scss: { label: 'CSS', color: '#7a6fbf' },
  html: { label: 'HTML', color: '#d1794f' },
  htm: { label: 'HTML', color: '#d1794f' },
  svg: { label: 'SVG', color: '#d1a04f' },
  sh: { label: 'Shell', color: '#7fae6a' },
  bash: { label: 'Shell', color: '#7fae6a' },
  zsh: { label: 'Shell', color: '#7fae6a' },
  ps1: { label: 'Shell', color: '#7fae6a' },
  sql: { label: 'SQL', color: '#c08a5e' },
  cmake: { label: 'CMake', color: '#8f9aa6' },
  java: { label: 'Java', color: '#b0714f' },
  kt: { label: 'Kotlin', color: '#a97bd6' },
  swift: { label: 'Swift', color: '#d1875f' },
  rb: { label: 'Ruby', color: '#c26969' },
  php: { label: 'PHP', color: '#7d86b8' },
  cs: { label: 'C#', color: '#6fa27a' },
  lua: { label: 'Lua', color: '#6c8fd1' },
  vue: { label: 'Vue', color: '#63b78d' },
  svelte: { label: 'Svelte', color: '#d1704f' },
  astro: { label: 'Astro', color: '#a9789e' },
  txt: { label: 'Text', color: '#8d968f' },
  xml: { label: 'XML', color: '#a3895f' },
  ini: { label: 'Config', color: '#8d968f' },
  cfg: { label: 'Config', color: '#8d968f' },
  env: { label: 'Config', color: '#8d968f' },
  gitignore: { label: 'Config', color: '#8d968f' },
  dockerfile: { label: 'Docker', color: '#6996c4' },
  tf: { label: 'Terraform', color: '#9a7bc4' },
  zig: { label: 'Zig', color: '#c99a5f' },
}

export function languageFor(path: string): Language {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  if (name === 'dockerfile' || name.startsWith('dockerfile.')) return LANGUAGES.dockerfile
  if (name === 'makefile' || name === 'cmakelists.txt') return LANGUAGES.cmake
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1) : name
  return LANGUAGES[ext] ?? { label: 'Text', color: '#8d968f' }
}

/**
 * The survey reads repositories from GitHub's REST API, whose `url` field points
 * at api.github.com. A visitor wants the repository's page, so API links (in
 * layouts written before that was fixed) are rewritten to github.com here.
 */
export function webRepoUrl(url: string): string {
  const api = url.trim().match(/^https?:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?#]+)\/?$/i)
  return api ? `https://github.com/${api[1]}/${api[2]}` : url.trim()
}

/** GitHub link for a file, used by the hover card and its neighbour links. */
export function fileUrl(repo: RepoSummary, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `${webRepoUrl(repo.url)}/blob/${encodeURIComponent(repo.branch)}/${encoded}`
}

export function repositoryUrl(repo: RepoSummary): string {
  return webRepoUrl(repo.url)
}

function layoutUrl(): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env
  const base = env?.BASE_URL ?? '/'
  return `${base.replace(/\/*$/, '/')}${LAYOUT_FILE}`
}

export async function loadCityLayout(signal?: AbortSignal): Promise<CityLayout> {
  const response = await fetch(layoutUrl(), {
    signal: signal ?? AbortSignal.timeout(20_000),
    cache: 'no-cache',
    headers: { Accept: 'text/plain' },
  })
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'city-layout.txt is not there yet. Run the "Survey city layout" workflow (or node scripts/survey-city.mjs) to generate it.'
        : `city-layout.txt could not be read (HTTP ${response.status}).`,
    )
  }

  const layout = parseCityLayout(await response.text())
  if (layout.districts.length === 0) {
    throw new Error('city-layout.txt has no districts. Re-run the "Survey city layout" workflow.')
  }
  return layout
}

/**
 * Read the generated file. The format is line based so it diffs well:
 *
 *   district <name>
 *     description <text>
 *     language <label|null>
 *     stars / forks / size / branch / pushed / fork / url
 *     files <count> / lines <count>
 *     file <lines> <bytes> <path>
 *       import <specifier>
 *
 * The optional `import` lines under a file are what the line map draws: each one
 * is a relationship between two buildings in the same district.
 */
export function parseCityLayout(text: string): CityLayout {
  const districts: DistrictData[] = []
  const repos: RepoSummary[] = []
  let owner = CITY_OWNER
  let updatedAt = ''
  let pending: { repo: RepoSummary; files: CityFile[] } | null = null
  let currentFile: CityFile | null = null

  const flush = () => {
    if (!pending) return
    const files = pending.files
    const repo = pending.repo
    repo.fileCount = files.length
    repos.push(repo)
    districts.push({
      repo: repo.name,
      files,
      lines: files.reduce((sum, file) => sum + file.lines, 0),
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      totalFiles: files.length,
      fetchedAt: Date.now(),
    })
    pending = null
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s+/, '').trimEnd()
    if (line === '' || line.startsWith('#')) continue

    const gap = line.indexOf(' ')
    const key = gap === -1 ? line : line.slice(0, gap)
    const value = gap === -1 ? '' : line.slice(gap + 1)

    if (key === 'district') {
      flush()
      currentFile = null
      const name = value.trim()
      if (!name) continue
      pending = {
        repo: {
          name,
          description: '',
          language: null,
          stars: 0,
          forks: 0,
          sizeKb: 0,
          branch: 'main',
          pushedAt: '',
          url: `https://github.com/${owner}/${name}`,
          fork: false,
        },
        files: [],
      }
      continue
    }

    if (!pending) {
      if (key === 'owner' && value.trim()) owner = value.trim()
      else if (key === 'updated') updatedAt = value.trim()
      continue
    }

    const repo = pending.repo
    switch (key) {
      case 'description':
        repo.description = value.trim()
        break
      case 'language':
        repo.language = value.trim() === '' || value.trim().toLowerCase() === 'null' ? null : value.trim()
        break
      case 'stars':
        repo.stars = Number.parseInt(value, 10) || 0
        break
      case 'forks':
        repo.forks = Number.parseInt(value, 10) || 0
        break
      case 'size':
        repo.sizeKb = Number.parseInt(value, 10) || 0
        break
      case 'branch':
        repo.branch = value.trim() || 'main'
        break
      case 'pushed':
        repo.pushedAt = value.trim()
        break
      case 'fork':
        repo.fork = value.trim() === 'true'
        break
      case 'url':
        repo.url = webRepoUrl(value) || repo.url
        break
      case 'file': {
        const first = value.indexOf(' ')
        if (first === -1) break
        const second = value.indexOf(' ', first + 1)
        if (second === -1) break
        const path = value.slice(second + 1).trim()
        if (!path) break
        const language = languageFor(path)
        const file: CityFile = {
          path,
          lines: Number.parseInt(value.slice(0, first), 10) || 0,
          bytes: Number.parseInt(value.slice(first + 1, second), 10) || 0,
          language: language.label,
          color: language.color,
          imports: [],
        }
        currentFile = file
        pending.files.push(file)
        break
      }
      case 'import':
        if (currentFile && value.trim()) currentFile.imports.push(value.trim())
        break
      default:
        break
    }
  }

  flush()

  return {
    owner,
    updatedAt,
    districts,
    repos,
  }
}
