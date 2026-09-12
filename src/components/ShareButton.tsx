import { useState } from 'react'
import Button from '@mui/material/Button'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import IosShareIcon from '@mui/icons-material/IosShare'
import Snackbar from '@mui/material/Snackbar'
import Stack from '@mui/material/Stack'
import { cellEmoji } from '../game/compare'
import type { GuessEntry } from './GuessGrid'

export interface ShareOptions {
  /** Mode label, e.g. "Daily Classic" or "Endless". */
  mode: string
  /** Puzzle date. Omitted for Endless, which has no date to compare against. */
  date?: string
  guesses: GuessEntry[]
  solved: boolean
  isArchive?: boolean
}

/**
 * Builds the spoiler-free result for pasting into Discord.
 *
 * It contains no character names and no letters from the answer -- only the
 * colour pattern, the count, and a link -- so it is safe to post in a channel
 * where people have not played yet. That is the whole point, so do not be
 * tempted to add the character's name or token here.
 */
export function buildShareText(opts: ShareOptions, url: string): string {
  const { mode, date, guesses, solved, isArchive } = opts
  const score = solved ? String(guesses.length) : 'X'
  const tag = isArchive ? ' (archive)' : ''

  const heading = ['Clocktowerdle', mode.replace(/^Daily /, '')].join(' ')
  const lines = [
    date ? `${heading} · ${date}${tag}` : `${heading}${tag}`,
    `${score}/∞${solved && guesses.length <= 3 ? ' 🔥' : ''}`,
    '',
    ...guesses.map((g) => g.clue.map((c) => cellEmoji(c.result)).join('')),
  ]

  if (url) lines.push('', url)
  return lines.join('\n')
}

export function ShareButton(opts: ShareOptions) {
  const [toast, setToast] = useState<string | null>(null)

  // Link to the game, not to this result: a friend following it should land on
  // today's puzzle rather than on a page that spoils it.
  const url = typeof window !== 'undefined' ? window.location.origin : ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(buildShareText(opts, url))
      setToast('Result copied, paste it in Discord')
    } catch {
      // Clipboard is unavailable over plain http and inside some embedded views.
      setToast('Could not copy automatically, select the grid and copy it')
    }
  }

  const share = async () => {
    if (!navigator.share) {
      await copy()
      return
    }
    try {
      await navigator.share({ text: buildShareText(opts, url) })
    } catch (err) {
      // Cancelling the native sheet is not an error worth reporting.
      if (err instanceof DOMException && err.name === 'AbortError') return
      await copy()
    }
  }

  return (
    <>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }} useFlexGap>
        <Button variant="outlined" onClick={copy} startIcon={<ContentCopyIcon />}>
          Copy result
        </Button>
        {typeof navigator !== 'undefined' && Boolean(navigator.share) && (
          <Button variant="outlined" onClick={share} startIcon={<IosShareIcon />}>
            Share
          </Button>
        )}
      </Stack>
      <Snackbar
        open={toast !== null}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  )
}
