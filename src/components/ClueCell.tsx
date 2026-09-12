import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { CLUE_COLORS } from '../theme/theme'
import { VALUE_LABELS } from '../game/clueSpec'
import { useSettings } from '../store/settings'
import type { ClueCell as Cell } from '../game/compare'

/** Human readable text for whatever the column holds. */
function displayValue(cell: Cell): string {
  const v = cell.value
  // Not a dash: a blank cell should say what it means. Characters who never
  // wake on the first night genuinely have no order, and "N/A" says so.
  if (v === null) return 'N/A'
  if (Array.isArray(v)) {
    return v.map((t) => VALUE_LABELS[t] ?? t.replace(/-/g, ' ')).join(', ')
  }
  if (typeof v === 'string') return VALUE_LABELS[v] ?? v
  return String(v)
}

/**
 * Screen reader text. The grid is a wall of colour, so each cell states its own
 * verdict in words. This is independent of the colourblind setting: assistive
 * technology should never depend on a visual preference being switched on.
 */
function describe(cell: Cell): string {
  const verdict =
    cell.result === 'match' ? 'correct' : cell.result === 'partial' ? 'close' : 'wrong'
  const arrow =
    cell.direction === 'up'
      ? ', answer is higher'
      : cell.direction === 'down'
        ? ', answer is lower'
        : ''
  return `${cell.label}: ${displayValue(cell)}, ${verdict}${arrow}`
}

const GLYPH = { match: '✓', partial: '~', miss: '✗' } as const

export function ClueCell({ cell, delayMs = 0 }: { cell: Cell; delayMs?: number }) {
  const colourblind = useSettings((s) => s.colourblind)

  const bg = CLUE_COLORS[cell.result]
  const fg =
    cell.result === 'match'
      ? CLUE_COLORS.matchText
      : cell.result === 'partial'
        ? CLUE_COLORS.partialText
        : CLUE_COLORS.missText

  const arrow = cell.direction === 'up' ? '▲' : cell.direction === 'down' ? '▼' : null

  // No tooltip: the column headers already name every column, and a tooltip
  // that fires on every cell you sweep past is noise rather than help.
  return (
    <Box
      role="gridcell"
      aria-label={describe(cell)}
      sx={{
        position: 'relative',
        bgcolor: bg,
        color: fg,
        borderRadius: 1.5,
        minHeight: 56,
        px: 0.75,
        py: 0.5,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        gap: 0.25,
        animation: 'clueFlip 380ms ease-out both',
        animationDelay: `${delayMs}ms`,
        '@keyframes clueFlip': {
          from: { transform: 'rotateX(-90deg)', opacity: 0 },
          to: { transform: 'rotateX(0deg)', opacity: 1 },
        },
      }}
    >
      {/* Only in colourblind mode. By default the colour carries the verdict. */}
      {colourblind && (
        <Box
          aria-hidden
          sx={{
            position: 'absolute',
            top: 3,
            left: 5,
            fontSize: 12,
            fontWeight: 700,
            opacity: 0.9,
            lineHeight: 1,
          }}
        >
          {GLYPH[cell.result]}
          </Box>
        )}

        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            lineHeight: 1.15,
            fontSize: { xs: 10, sm: 11.5 },
            wordBreak: 'break-word',
          }}
        >
          {displayValue(cell)}
        </Typography>

        {arrow && (
          <Box aria-hidden sx={{ fontSize: 13, lineHeight: 1 }}>
            {arrow}
          </Box>
        )}
    </Box>
  )
}
