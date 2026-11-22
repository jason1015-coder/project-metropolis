#!/usr/bin/env node
/**
 * Surveys every public repository under the account and writes the city layout
 * the site renders.
 *
 * This is the only place that talks to GitHub. `.github/workflows/city-layout.yml`
 * runs it on a schedule with a token, commits `public/city-layout.txt`, and the
 * site just reads that file: visitors never trigger a live survey and never hit
 * GitHub's anonymous rate limit.
 *
 *   node scripts/survey-city.mjs                     # -> public/city-layout.txt
 *   node scripts/survey-city.mjs --output out.txt
 *   node scripts/survey-city.mjs --seed repos.json   # skip the repo listing
 *
 * The repository list and file trees come from the REST API when a token is
 * available; if the API refuses (anonymous rate limit) the trees fall back to
 * jsDelivr's package listing. File contents always come from raw.githubusercontent.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const API = 'https://api.github.com'
const RAW = 'https://raw.githubusercontent.com'
const CDN = 'https://cdn.jsdelivr.net/gh'
const CDN_LIST = 'https://data.jsdelivr.com/v1/packages/gh'

/** Every text file becomes a building; only multi-megabyte data dumps are skipped. */
const MAX_FILE_BYTES = 1_500_000
/** A single huge repository cannot flood the city. */
const MAX_FILES_PER_REPO = 900
const CONCURRENCY = 8

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'icns', 'bmp', 'tiff', 'tif', 'psd',
  'woff', 'woff2', 'ttf', 'otf', 'eot', 'mp3', 'wav', 'flac', 'ogg', 'm4a', 'mp4', 'mov',
  'webm', 'avi', 'mkv', 'pdf', 'zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'exe',
  'dll', 'so', 'dylib', 'a', 'o', 'obj', 'wasm', 'jar', 'class', 'pyc', 'bin', 'dat', 'db',
  'sqlite', 'sqlite3', 'riv', 'blend', 'fbx', 'glb', 'gltf', 'stl', 'step', 'stp', 'npy',
  'npz', 'pkl', 'onnx', 'parquet', 'ds_store', 'lock', 'snap', 'map', 'min',
])

const SKIP_DIRECTORY = /(^|\/)(node_modules|dist|build|out|vendor|third[_-]?party|\.git|\.next|\.nuxt|\.output|target|coverage|__pycache__|\.venv|venv|\.cache|\.turbo|pods|deriveddata|assets\/fonts)(\/|$)/i
const SKIP_FILE = /(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|gemfile\.lock|composer\.lock|poetry\.lock|go\.sum|flake\.lock|\.ds_store)(\/|$)/i

const args = process.argv.slice(2)
let output = 'public/city-layout.txt'
let seedPath = null
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--output' || arg === '-o') output = args[index + 1]
  else if (arg === '--seed') seedPath = args[index + 1]
  else if (!arg.startsWith('-')) output = arg
}

const OWNER = (process.env.CITY_OWNER || process.env.GITHUB_REPOSITORY_OWNER || 'jason1015-coder')
  .replace(/^@/, '')
  .trim()
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || ''

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function headers() {
  const value = { Accept: 'application/vnd.github+json', 'User-Agent': 'project-metropolis-survey' }
  if (TOKEN) value.Authorization = `Bearer ${TOKEN}`
  return value
}

async function request(url, init = {}, attempt = 0) {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
    if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`)
    return response
  } catch (error) {
    if (attempt >= 2) throw error
    await sleep(500 * (attempt + 1))
    return request(url, init, attempt + 1)
  }
}

async function api(pathname) {
  const response = await request(`${API}${pathname}`, { headers: headers() })
  if (!response.ok) {
    const limited = response.headers.get('x-ratelimit-remaining') === '0'
    throw new Error(`GitHub answered ${response.status}${limited ? ' (rate limit)' : ''}`)
  }
  return response.json()
}

/**
 * GitHub's REST API describes a repository with `url` set to its api.github.com
 * endpoint. Linking to that from the city only shows an API error, so always
 * write the human-facing page instead.
 */
function webUrl(repo) {
  if (repo.html_url) return String(repo.html_url)
  const api = String(repo.url ?? '')
  const match = api.match(/^https?:\/\/api\.github\.com\/repos\/([^/]+)\/([^/?#]+)\/?$/i)
  if (match) return `https://github.com/${match[1]}/${match[2]}`
  return api || `https://github.com/${OWNER}/${repo.name}`
}

function normalise(repo) {
  return {
    name: repo.name,
    description: String(repo.description ?? '').replace(/\s+/g, ' ').trim(),
    language: repo.language ?? null,
    stars: repo.stars ?? repo.stargazers_count ?? 0,
    forks: repo.forks ?? repo.forks_count ?? 0,
    sizeKb: repo.sizeKb ?? repo.size ?? 0,
    branch: repo.branch ?? repo.default_branch ?? 'main',
    pushedAt: repo.pushedAt ?? repo.pushed_at ?? '',
    fork: Boolean(repo.fork),
    url: webUrl(repo),
  }
}

async function listRepos() {
  if (seedPath) {
    const seeded = JSON.parse(await readFile(seedPath, 'utf8'))
    return seeded.map(normalise)
  }

  const rows = []
  for (let page = 1; page <= 10; page += 1) {
    const batch = await api(`/users/${encodeURIComponent(OWNER)}/repos?per_page=100&sort=updated&page=${page}`)
    if (!Array.isArray(batch) || batch.length === 0) break
    rows.push(...batch)
    if (batch.length < 100) break
  }
  return rows.filter((repo) => !repo.archived && !repo.disabled).map(normalise)
}

function isModelled(entry) {
  const path = entry.path
  if (SKIP_DIRECTORY.test(path) || SKIP_FILE.test(path)) return false
  if (/\.(min\.(js|css)|map|snap)$/i.test(path)) return false
  const size = entry.size ?? 0
  if (size <= 0 || size > MAX_FILE_BYTES) return false
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  return !BINARY_EXT.has(ext)
}

async function cdnTree(repo) {
  try {
    const response = await request(`${CDN_LIST}/${OWNER}/${repo.name}@${encodeURIComponent(repo.branch)}`)
    if (!response.ok) return null
    const json = await response.json()
    const entries = []
    const walk = (nodes, prefix) => {
      for (const node of nodes ?? []) {
        const path = prefix ? `${prefix}/${node.name}` : node.name
        if (node.type === 'directory') walk(node.files, path)
        else entries.push({ path, size: node.size ?? 0 })
      }
    }
    walk(json.files, '')
    return entries.length > 0 ? entries : null
  } catch {
    return null
  }
}

async function listFiles(repo) {
  try {
    const tree = await api(
      `/repos/${encodeURIComponent(OWNER)}/${encodeURIComponent(repo.name)}/git/trees/${encodeURIComponent(repo.branch)}?recursive=1`,
    )
    return (tree.tree ?? []).filter((entry) => entry.type === 'blob').map((entry) => ({ path: entry.path, size: entry.size ?? 0 }))
  } catch (error) {
    const fallback = await cdnTree(repo)
    if (!fallback) throw error
    return fallback
  }
}

function encodePath(path) {
  return path.split('/').map(encodeURIComponent).join('/')
}

async function readText(repo, path) {
  const encoded = encodePath(path)
  const branch = encodeURIComponent(repo.branch)
  const urls = [
    `${RAW}/${OWNER}/${repo.name}/${branch}/${encoded}`,
    `${CDN}/${OWNER}/${repo.name}@${branch}/${encoded}`,
  ]
  for (const url of urls) {
    try {
      const response = await request(url)
      if (!response.ok) continue
      return await response.text()
    } catch {
      // Try the next mirror.
    }
  }
  return null
}

function countLines(text) {
  if (!text) return 0
  let lines = 1
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) lines += 1
  }
  if (text.endsWith('\n')) lines -= 1
  return Math.max(0, lines)
}

async function mapLimit(items, limit, task) {
  const results = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

async function surveyRepo(repo) {
  process.stderr.write(`· ${repo.name}\n`)

  let entries = []
  try {
    entries = await listFiles(repo)
  } catch (error) {
    process.stderr.write(`  ! ${repo.name}: ${error.message}\n`)
    return { repo, files: [] }
  }

  const candidates = entries
    .filter(isModelled)
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_FILES_PER_REPO)

  const files = []
  await mapLimit(candidates, CONCURRENCY, async (entry) => {
    const text = await readText(repo, entry.path)
    if (text === null || text.includes('\u0000')) return null
    files.push({ path: entry.path, lines: countLines(text), bytes: entry.size || text.length })
    return true
  })

  files.sort((a, b) => a.path.localeCompare(b.path))
  process.stderr.write(`  ${files.length} buildings\n`)
  return { repo, files }
}

function render(surveyed) {
  const buildings = surveyed.reduce((sum, district) => sum + district.files.length, 0)
  const updated = surveyed.reduce((latest, district) => {
    const stamp = district.repo.pushedAt
    return stamp > latest ? stamp : latest
  }, '')

  const lines = [
    '# project-metropolis — city layout',
    '#',
    '# Generated by .github/workflows/city-layout.yml: it surveys every public',
    '# repository under the account, so the site never has to call GitHub itself.',
    '# Do not edit by hand — re-run the "Survey city layout" workflow instead.',
    '#',
    '#   district <name>                one district per repository',
    '#     <key> <value>                repository metadata',
    '#     file <lines> <bytes> <path>  one building per text file',
    '',
    `owner ${OWNER}`,
    `updated ${updated || new Date().toISOString()}`,
    `districts ${surveyed.length}`,
    `buildings ${buildings}`,
  ]

  for (const district of surveyed) {
    const { repo, files } = district
    const totalLines = files.reduce((sum, file) => sum + file.lines, 0)
    lines.push('')
    lines.push(`district ${repo.name}`)
    lines.push(`  description ${repo.description}`)
    lines.push(`  language ${repo.language ?? 'null'}`)
    lines.push(`  stars ${repo.stars}`)
    lines.push(`  forks ${repo.forks}`)
    lines.push(`  size ${repo.sizeKb}`)
    lines.push(`  branch ${repo.branch}`)
    lines.push(`  pushed ${repo.pushedAt}`)
    lines.push(`  fork ${repo.fork ? 'true' : 'false'}`)
    lines.push(`  url ${repo.url}`)
    lines.push(`  files ${files.length}`)
    lines.push(`  lines ${totalLines}`)
    for (const file of files) lines.push(`  file ${file.lines} ${file.bytes} ${file.path}`)
  }

  return `${lines.join('\n')}\n`
}

async function main() {
  const repos = await listRepos()
  if (repos.length === 0) throw new Error(`No public repositories found for ${OWNER}.`)
  repos.sort((a, b) => a.name.localeCompare(b.name))

  const surveyed = []
  for (let index = 0; index < repos.length; index += 3) {
    const batch = repos.slice(index, index + 3)
    surveyed.push(...(await Promise.all(batch.map(surveyRepo))))
  }

  const text = render(surveyed)
  await mkdir(dirname(output), { recursive: true })
  await writeFile(output, text, 'utf8')
  process.stderr.write(`\n${output}: ${surveyed.length} districts, ${text.length.toLocaleString('en-GB')} bytes\n`)
}

main().catch((error) => {
  process.stderr.write(`survey failed: ${error.message}\n`)
  process.exitCode = 1
})
