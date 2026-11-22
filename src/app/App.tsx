import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'

import { CitySection } from './components/city/CitySection'
import { Preloader } from './components/Preloader'

function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const target = document.querySelector(hash)
      if (target) {
        window.setTimeout(() => target.scrollIntoView({ behavior: 'smooth' }), 50)
        return
      }
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

function Pages() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <Routes location={location}>
          <Route index element={<Home />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.main>
    </AnimatePresence>
  )
}

// Matches the Vite base, so routing works when the site is served from a
// subpath such as GitHub Pages' /project-metropolis/.
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

export function App() {
  return (
    <BrowserRouter basename={basename}>
      <Preloader />
      <ScrollManager />
      <Pages />
    </BrowserRouter>
  )
}

function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative flex min-h-[100svh] flex-col justify-end overflow-hidden">
        <HeroField />
        <div className="relative mx-auto w-full max-w-[1400px] px-5 pb-10 pt-28 sm:px-8 sm:pb-14">
          <div className="mono flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] uppercase tracking-[0.16em] text-muted">
            <span className="inline-flex items-center gap-2 text-accent">
              <span className="round size-1.5 animate-pulse rounded-full bg-accent" />
              Live from GitHub
            </span>
            <span className="text-faint">/</span>
            <span>jason1015-coder</span>
          </div>

          <h1 className="font-display text-[clamp(56px,11.5vw,176px)] mt-6">
            Project<br />Metropolis
          </h1>

          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.9, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative mb-1 shrink-0 sm:mb-2 mt-2"
          >
            <div aria-hidden className="pointer-events-none absolute -inset-4 rounded-[28px] bg-[radial-gradient(closest-side,rgb(88_166_255/0.22),transparent)] blur-xl" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="mt-8 max-w-2xl"
          >
            <p className="font-display text-balance text-[26px] leading-[1.12] sm:text-[32px]">
              One continuous 3D city, built from your GitHub repositories.
            </p>
            <p className="mt-4 text-pretty text-[16.5px] leading-relaxed text-muted sm:text-[17.5px]">
              Every repository is a district in the city, every text file a building, and roads run between the blocks.
              Height is lines of code, footprint is file size, read live from GitHub.
              Drag to walk around, scroll to lean in, hover a tower to inspect it.
              Auto-updates when your repos change.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a
                href="#city"
                className="inline-flex h-12 items-center gap-2 rounded-[12px] bg-accent px-6 text-[14.5px] font-medium text-bg transition-colors hover:bg-[#7cb9ff]"
              >
                Explore the city
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </a>
              <a
                href={`https://github.com/jason1015-coder`}
                className="link-draw inline-flex h-12 items-center gap-1.5 px-2 text-[14.5px] text-fg"
              >
                GitHub
                <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M18 15l-6-6-6 6" />
                </svg>
              </a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* The city */}
      <CitySection />
    </>
  )
}

function HeroField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,#000_55%,transparent_97%)]">
      <div className="absolute inset-0 grid-lines" />
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
        className="absolute inset-0"
      >
        <div className="round absolute -top-[30%] right-[-10%] h-[85%] w-[65%] animate-drift-a rounded-full bg-[radial-gradient(closest-side,rgb(88_166_255/0.22),transparent)] blur-3xl" />
        <div className="round absolute top-[8%] left-[-14%] h-[75%] w-[55%] animate-drift-b rounded-full bg-[radial-gradient(closest-side,rgb(216_180_254/0.08),transparent)] blur-3xl" />
      </motion.div>
      <div className="grain absolute inset-0" />
    </div>
  )
}
