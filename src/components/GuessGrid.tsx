import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import { CLUE_SPEC } from '../game/clueSpec'
import { ClueCell } from './ClueCell'
import type { ClueRow } from '../game/compare'

export interface GuessEntry {
  id: string
  name: string
  image: string
  clue: ClueRow
}

/**
 * Seven clue columns plus the character will not fit a phone, so the grid
 * scrolls horizontally inside its own container with the character column
 * pinned left. The page body itself must never scroll sideways.
 */
const NAME_COL = 132
const CLUE_COL = 84

export function GuessGrid({ guesses }: { guesses: GuessEntry[] }) {
  if (guesses.length === 0) return null

  const template = `${NAME_COL}px repeat(${CLUE_SPEC.length}, minmax(${CLUE_COL}px, 1fr))`

  return (
    <Box
      role="grid"
      aria-label="Your guesses"
      sx={{
        overflowX: 'auto',
        overflowY: 'visible',
        pb: 1,
        // Keep the scrollbar unobtrusive but present, so it is discoverable.
        '&::-webkit-scrollbar': { height: 8 },
        '&::-webkit-scrollbar-thumb': { bgcolor: 'rgba(200,169,81,0.3)', borderRadius: 4 },
      }}
    >
      <Box sx={{ minWidth: NAME_COL + CLUE_SPEC.length * CLUE_COL }}>
        {/* Header */}
        <Box role="row" sx={{ display: 'grid', gridTemplateColumns: template, gap: 0.75, mb: 0 }}>
          <Box sx={{ ...stickyName, bgcolor: 'transparent' }} />
          {CLUE_SPEC.map((col) => (
            <Typography
              key={col.key}
              role="columnheader"
              variant="caption"
              sx={{ textAlign: 'center', color: 'text.secondary', fontWeight: 600, fontSize: 11 }}
            >
              {col.shortLabel}
            </Typography>
          ))}
        </Box>

        {/* Oldest first, so the newest guess sits directly above the input that
            produced it -- the input lives below the grid precisely so its
            dropdown cannot cover these rows. */}
        {guesses.map((g, rowIndex) => (
          <Box
            key={`${g.id}-${rowIndex}`}
            role="row"
            sx={{ display: 'grid', gridTemplateColumns: template, gap: 0.75, mb: 0.75 }}
          >
            <Box role="rowheader" sx={stickyName}>
              <Box
                component="img"
                src={`${import.meta.env.BASE_URL}tokens/${g.image}`}
                alt=""
                loading="lazy"
                sx={{ width: 34, height: 34, flexShrink: 0 }}
              />
              <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.1, fontSize: 12.5 }}>
                {g.name}
              </Typography>
            </Box>

            {g.clue.map((cell, i) => (
              // Only the newest row animates; replaying every row on each guess
              // would be a strobe by guess ten.
              <ClueCell
                key={cell.key}
                cell={cell}
                delayMs={rowIndex === guesses.length - 1 ? i * 70 : 0}
              />
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

const stickyName = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  bgcolor: 'background.default',
  display: 'flex',
  alignItems: 'center',
  gap: 0.75,
  pr: 1,
  minHeight: 30,
} as const
