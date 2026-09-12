import { create } from 'zustand'

const KEY = 'botc-wordle:settings'

export interface Settings {
  /**
   * Adds a symbol to every clue cell on top of its colour.
   *
   * Off by default: the colours alone are the intended look. On, each cell
   * carries a tick, tilde or cross so the grid is readable without relying on
   * hue at all.
   */
  colourblind: boolean
}

const DEFAULTS: Settings = { colourblind: false }

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS
  } catch {
    // Storage can be blocked entirely; defaults are a fine answer.
    return DEFAULTS
  }
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void
}

export const useSettings = create<SettingsState>((setState, get) => ({
  ...load(),
  set: (patch) => {
    setState(patch)
    try {
      const { set: _set, ...rest } = get()
      localStorage.setItem(KEY, JSON.stringify({ ...rest, ...patch }))
    } catch {
      // Setting still applies for this session even if it cannot be saved.
    }
  },
}))
