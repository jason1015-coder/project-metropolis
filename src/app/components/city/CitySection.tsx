import { ArrowUpRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { CITY_OWNER, LAYOUT_FILE, loadCityLayout, type CityLayout } from '../../lib/cityData'
import { Lines, Reveal } from '../motion'
import { CityScene, type CityStats, type HoverEvent } from './scene'

type Status = 'loading' | 'live' | 'error'

const EMPTY_STATS: CityStats = { districts: 0, buildings: 0, lines: 0, bytes: 0, roads: 0 }

export function CitySection() {
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CityScene | null>(null)
  const layoutRef = useRef<CityLayout | null>(null)

  const [layout, setLayout] = useState<CityLayout | null>(null)
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState('')
  const [hover, setHover] = useState<HoverEvent | null>(null)
  const [stats, setStats] = useState<CityStats>(EMPTY_STATS)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const scene = new CityScene(element, { onHover: setHover, onStats: setStats })
    sceneRef.current = scene
    if (layoutRef.current) scene.setLayout(layoutRef.current)
    return () => {
      scene.dispose()
      sceneRef.current = null
    }
  }, [])

  // The survey already happened in CI: read the generated layout once.
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setStatus('loading')
    setError('')

    loadCityLayout(controller.signal)
      .then((next) => {
        if (!active) return
        layoutRef.current = next
        setLayout(next)
        sceneRef.current?.setLayout(next)
        setStatus('live')
      })
      .catch((caught: unknown) => {
        if (!active) return
        if (caught instanceof DOMException && caught.name === 'AbortError') return
        setStatus('error')
        setError(caught instanceof Error ? caught.message : `${LAYOUT_FILE} could not be read.`)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [attempt])

  const repos = layout?.repos ?? []
  const districts = layout?.districts ?? []
  const fileCount = useMemo(() => districts.reduce((sum, district) => sum + district.files.length, 0), [districts])
  const surveyed = districts.length

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene) return
    const progress = layout ? 1 : 0
    if (hover) {
      const { payload } = hover
      scene.setPet({
        mood: 'live',
        headline: payload.title,
        detail:
          payload.kind === 'file'
            ? `${payload.lines.toLocaleString('en-GB')} lines · ${payload.language ?? 'file'}`
            : `${payload.shown ?? 0}/${payload.files ?? 0} files · ★ ${payload.stars ?? 0}`,
        progress,
      })
      return
    }
    scene.setPet({
      mood: status === 'error' ? 'error' : status === 'loading' ? 'loading' : 'live',
      headline: status === 'error' ? 'offline' : status === 'loading' ? 'surveying' : `${stats.buildings} buildings`,
      detail:
        status === 'error'
          ? `${LAYOUT_FILE} missing`
          : status === 'loading'
            ? `reading ${LAYOUT_FILE}…`
            : `${stats.lines.toLocaleString('en-GB')} lines · ${surveyed} districts`,
      progress,
    })
  }, [hover, status, stats, surveyed, layout])

  const legend = useMemo(() => {
    const counts = new Map<string, { count: number; color: string }>()
    for (const district of districts) {
      for (const file of district.files) {
        const entry = counts.get(file.language) ?? { count: 0, color: file.color }
        entry.count += 1
        counts.set(file.language, entry)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([label, value]) => ({ label, ...value }))
  }, [districts])

  const stage = stageRef.current
  const canvasLayer = canvasRef.current
  let layerX = 0
  let layerY = 0
  let viewHeight = 0
  if (stage && canvasLayer) {
    const stageBox = stage.getBoundingClientRect()
    const layerBox = canvasLayer.getBoundingClientRect()
    layerX = layerBox.left - stageBox.left
    layerY = layerBox.top - stageBox.top
    viewHeight = layerBox.height
  }
  const cardWidth = Math.min(320, Math.max(210, (stage?.clientWidth ?? 320) - 24))
  const maxLeft = Math.max(8, (stage?.clientWidth ?? 0) - cardWidth - 8)
  const cardLeft = Math.min(layerX + (hover?.x ?? 0) + 18, maxLeft)
  // The card carries a whole line map now, so it can be taller than the stage:
  // open it on the side with more room and cap its height, scrolling the rest
  // instead of letting the stage clip it.
  const roomBelow = Math.max(0, viewHeight - (hover?.y ?? 0) - 30)
  const roomAbove = Math.max(0, (hover?.y ?? 0) - 30)
  const flipY = Boolean(hover && roomBelow < 460 && roomAbove > roomBelow)
  const cardMaxHeight = Math.max(220, Math.min(560, flipY ? roomAbove : roomBelow))

  return (
    <section id="city" className="relative scroll-mt-20 pt-24 sm:pt-28">
      <div className="mx-auto max-w-[1400px] px-5 sm:px-8">
        <div className="flex items-end justify-between gap-6">
          <Lines as="h2" className="font-display text-[44px] sm:text-[64px]" lines={['Connected City']} />
          <Reveal className="mono hidden pb-2 text-[11.5px] uppercase tracking-[0.14em] text-faint sm:block">
            surveyed from github.com/{CITY_OWNER}
          </Reveal>
        </div>

        <div className="mt-6 flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-2xl text-pretty text-[16.5px] leading-relaxed text-muted">
            One continuous city: every repository is a district, its biggest files become its buildings, and the streets run between them.
            Height is lines of code, footprint is file size, and a scheduled GitHub Action surveys every repository on the
            account to write {LAYOUT_FILE}. Districts are mapped by glowing floating boundaries, not by plinths. Drag to
            walk the streets (WASD, Shift to hurry), hold ⌘ or Ctrl and scroll to lean in, and hover a building to light up its
            line map: imports in green, importers in pink, the same type in cyan, the same name in amber, and the rest of its
            district in violet, each one a link to the file on GitHub.
          </p>
          <dl className="grid shrink-0 grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4 lg:gap-x-10">
            {[
              { label: 'districts', value: String(repos.length || '–') },
              { label: 'buildings', value: stats.buildings ? stats.buildings.toLocaleString('en-GB') : '–' },
              { label: 'lines', value: stats.lines ? compact(stats.lines) : '–' },
              { label: 'roads', value: stats.roads ? String(stats.roads) : '–' },
            ].map((item) => (
              <div key={item.label}>
                <dt className="mono text-[10px] uppercase tracking-[0.14em] text-faint">{item.label}</dt>
                <dd className="font-display mt-1 text-[28px] leading-none tabular-nums">{item.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <div ref={stageRef} className="relative mt-8 w-full overflow-hidden">
        <div
          ref={canvasRef}
          role="img"
          aria-label="One continuous 3D city where each GitHub repository is a district marked by a glowing floating boundary, each file is a building, and streets run between the blocks, with a tamagotchi standing at the edge."
          className="relative h-[clamp(520px,84vh,880px)] w-full touch-none"
        />

        <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-bg via-bg/40 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-bg via-bg/50 to-transparent" />

        <div className="pointer-events-none absolute inset-x-0 top-0 mx-auto flex max-w-[1400px] flex-wrap items-start justify-between gap-3 px-5 py-4 sm:px-8 sm:py-5">
          <p className="mono flex items-center gap-2 text-[10.5px] uppercase tracking-[0.16em] text-faint">
            <span className={`round size-1.5 rounded-full ${status === 'error' ? 'bg-danger' : 'bg-accent'} ${status === 'loading' ? 'animate-pulse' : ''}`} />
            continuous city / {status === 'error' ? 'no layout' : status === 'loading' ? 'loading' : 'ready'}
          </p>
          <p className="mono hidden text-[10px] uppercase tracking-[0.14em] text-faint sm:block">
            WASD move · drag · ⌘/ctrl scroll
          </p>
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 mx-auto flex max-w-[1400px] flex-wrap items-end justify-between gap-3 px-5 py-4 sm:px-8 sm:py-5">
          <div className="min-w-[180px]">
            <p className="mono text-[10px] uppercase tracking-[0.1em] text-faint">
              {surveyed || '–'} districts · {fileCount ? fileCount.toLocaleString('en-GB') : '–'} files
            </p>
            <p className="mono mt-2 text-[10px] uppercase tracking-[0.1em] text-faint">
              {layout ? `surveyed ${formatSurveyed(layout.updatedAt)}` : `waiting for ${LAYOUT_FILE}`}
            </p>
          </div>
          <p className="mono text-right text-[10px] uppercase leading-relaxed tracking-[0.12em] text-faint">
            area = repo size · height = lines
            <br />
            one model · glowing district boundaries
          </p>
        </div>

        {status === 'loading' && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <p className="mono animate-pulse text-[11px] uppercase tracking-[0.18em] text-accent">
              laying out the city…
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="absolute inset-0 grid place-items-center p-6 text-center">
            <div className="max-w-sm rounded-[18px] border border-line bg-bg/85 px-6 py-6 backdrop-blur">
              <p className="mono text-[10.5px] uppercase tracking-[0.18em] text-danger">no city layout</p>
              <p className="mx-auto mt-3 text-[14px] leading-relaxed text-muted">{error}</p>
              <button
                type="button"
                onClick={() => setAttempt((value) => value + 1)}
                className="mono mt-5 rounded-[10px] border border-line-strong px-4 py-2 text-[10.5px] uppercase tracking-[0.14em] text-fg transition-colors hover:border-accent hover:text-accent"
              >
                try again
              </button>
            </div>
          </div>
        )}

        {hover && (
          <div
            onPointerEnter={() => sceneRef.current?.pinHover(true)}
            onPointerLeave={() => sceneRef.current?.pinHover(false)}
            className="absolute z-20 w-[min(320px,calc(100%-24px))] overflow-y-auto overscroll-contain rounded-[14px] border border-line-strong bg-bg/92 p-3.5 shadow-[0_18px_40px_-16px_rgb(0_0_0/0.85)] backdrop-blur-md"
            style={{
              left: cardLeft,
              top: flipY ? undefined : layerY + hover.y + 16,
              bottom: flipY ? (stage?.clientHeight ?? 0) - layerY - hover.y + 16 : undefined,
              maxHeight: cardMaxHeight,
            }}
          >
            {hover.payload.kind === 'file' ? (
              <>
                <p className="mono text-[10px] uppercase tracking-[0.14em] text-faint">{hover.payload.subtitle}</p>
                <p className="mono mt-1.5 line-clamp-2 break-all text-[12.5px] leading-snug text-fg">
                  {hover.payload.title}
                </p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3">
                  <div>
                    <dt className="mono text-[9.5px] uppercase tracking-[0.12em] text-faint">lines</dt>
                    <dd className="text-[14px] tabular-nums text-fg">{hover.payload.lines.toLocaleString('en-GB')}</dd>
                  </div>
                  <div>
                    <dt className="mono text-[9.5px] uppercase tracking-[0.12em] text-faint">size</dt>
                    <dd className="text-[14px] tabular-nums text-fg">{formatBytes(hover.payload.bytes)}</dd>
                  </div>
                  <div className="col-span-2 flex items-center gap-2">
                    <span className="round size-1.5 rounded-full" style={{ background: hover.payload.color }} />
                    <span className="mono text-[10.5px] uppercase tracking-[0.1em] text-muted">
                      {hover.payload.language}
                    </span>
                  </div>
                </dl>

                {hover.payload.links && hover.payload.links.length > 0 && (
                  <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                    <p className="mono text-[9px] uppercase tracking-[0.14em] text-faint">line map</p>
                    {hover.payload.links.map((group) => (
                      <div key={group.kind}>
                        <p className="mono flex items-center gap-1.5 text-[9px] uppercase tracking-[0.14em] text-muted">
                          <span className="round size-1.5 shrink-0 rounded-full" style={{ background: group.color }} />
                          {group.label}
                          <span className="text-faint">{group.total}</span>
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {group.links.map((link) => (
                            <li key={link.url}>
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noreferrer"
                                title={`${link.label} — ${link.meta}`}
                                className="flex items-baseline gap-1.5 text-[11.5px] leading-snug text-muted transition-colors hover:text-accent"
                              >
                                <span className="truncate">{link.label}</span>
                                <span className="mono shrink-0 text-[9px] uppercase tracking-[0.1em] text-faint">
                                  {link.meta}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                <a
                  href={hover.payload.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-3 flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-accent transition-colors hover:text-[#9fcaff]"
                >
                  {hover.payload.hint}
                  <ArrowUpRight className="size-3" />
                </a>
              </>
            ) : (
              <>
                <p className="mono text-[10px] uppercase tracking-[0.14em] text-faint">district</p>
                <p className="font-display mt-1 text-[21px] leading-tight">{hover.payload.title}</p>
                <p className="mt-2 line-clamp-3 text-[12.5px] leading-relaxed text-muted">{hover.payload.subtitle}</p>
                <dl className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2 border-t border-line pt-3">
                  <div>
                    <dt className="mono text-[9.5px] uppercase tracking-[0.1em] text-faint">files</dt>
                    <dd className="text-[13px] tabular-nums text-fg">
                      {hover.payload.shown}/{hover.payload.files}
                    </dd>
                  </div>
                  <div>
                    <dt className="mono text-[9.5px] uppercase tracking-[0.1em] text-faint">lines</dt>
                    <dd className="text-[13px] tabular-nums text-fg">{compact(hover.payload.lines)}</dd>
                  </div>
                  <div>
                    <dt className="mono text-[9.5px] uppercase tracking-[0.1em] text-faint">stars</dt>
                    <dd className="text-[13px] tabular-nums text-fg">{hover.payload.stars ?? 0}</dd>
                  </div>
                </dl>
                <a
                  href={hover.payload.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mono mt-2.5 flex items-center gap-1 text-[9.5px] uppercase tracking-[0.12em] text-accent transition-colors hover:text-[#9fcaff]"
                >
                  {hover.payload.hint}
                  <ArrowUpRight className="size-3" />
                </a>
              </>
            )}
          </div>
        )}
      </div>

      <div className="mono mx-auto mt-4 flex max-w-[1400px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 text-[10px] uppercase tracking-[0.13em] text-faint sm:px-8">
        <ul className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {legend.length === 0 && <li>reading languages…</li>}
          {legend.map((item) => (
            <li key={item.label} className="flex items-center gap-1.5">
              <span className="round size-1.5 rounded-full" style={{ background: item.color }} />
              {item.label} <span className="text-fg/40">{item.count}</span>
            </li>
          ))}
        </ul>
        <p className="text-right">
          {LAYOUT_FILE} · surveyed by a scheduled github action · re-run when your repos change
        </p>
      </div>
    </section>
  )
}

function compact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  return value.toLocaleString('en-GB')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function formatSurveyed(stamp: string): string {
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) return 'by github actions'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
