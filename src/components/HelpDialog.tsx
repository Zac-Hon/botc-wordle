import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Divider from '@mui/material/Divider'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { CLUE_SPEC } from '../game/clueSpec'
import { CLUE_COLORS } from '../theme/theme'
import { HANGMAN_START } from '../game/hangman'
import { useSettings } from '../store/settings'

/** A single colour swatch used to explain the traffic lights. */
function Swatch({ result, children }: { result: 'match' | 'partial' | 'miss'; children: string }) {
  const colourblind = useSettings((s) => s.colourblind)
  const glyph = { match: '✓', partial: '~', miss: '✗' }[result]
  return (
    <Box
      sx={{
        bgcolor: CLUE_COLORS[result],
        color:
          result === 'match'
            ? CLUE_COLORS.matchText
            : result === 'partial'
              ? CLUE_COLORS.partialText
              : CLUE_COLORS.missText,
        borderRadius: 1.5,
        px: 1.25,
        py: 0.75,
        fontWeight: 700,
        fontSize: 13,
        minWidth: 78,
        textAlign: 'center',
        flexShrink: 0,
      }}
    >
      {colourblind ? `${glyph} ${children}` : children}
    </Box>
  )
}

/**
 * What each colour and each column actually means.
 *
 * The Ability column is the one people ask about, so it gets the most room:
 * it compares a whole SET of tags, which makes amber far more common there than
 * anywhere else and green genuinely rare.
 */
const COLUMN_HELP: Record<string, string> = {
  team: 'Townsfolk, Outsider, Minion, Demon or Traveller. Amber means a different type on the same side: good is Townsfolk and Outsider, evil is Minion and Demon, and Travellers are their own side.',
  script:
    'Which set the character comes from: Trouble Brewing, Bad Moon Rising, Sects & Violets, or Experimental. Green or grey only, there is no partial match.',
  wake: 'When they act at night: never, first night only, other nights only, or both.',
  nightOrder:
    'Their position in the first night order. The arrow points towards the answer, so up means the answer wakes later than your guess. N/A means they do not wake on the first night at all, and two characters who both never wake count as a match.',
  tags: 'What kind of ability they have. This compares a whole set, so green needs an exact match on every tag and amber means you share at least one. Amber is common here, green is rare.',
  reminders:
    'How many reminder tokens the character uses. A rough proxy for how fiddly they are. The arrow points towards the answer.',
  jinxes:
    'How many other characters they have an official jinx with. The arrow points towards the answer.',
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colourblind, set } = useSettings()

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle>How to play</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" sx={{ mb: 2 }}>
          Name a character. Every guess is compared with the hidden character across seven
          attributes, and each cell tells you how close that attribute was.
        </Typography>

        <Stack direction="row" spacing={1} sx={{ my: 2, flexWrap: 'wrap' }} useFlexGap>
          <Swatch result="match">Exact</Swatch>
          <Swatch result="partial">Close</Swatch>
          <Swatch result="miss">Wrong</Swatch>
        </Stack>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Green means that attribute matches exactly. Amber means it is close: the same side for
          Type, a shared tag for Ability, or within one or two for the number columns. Grey means
          no relation. An arrow on a number column points towards the answer, so up means the
          answer is higher than your guess.
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          The columns
        </Typography>
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          {CLUE_SPEC.map((col) => (
            <Box key={col.key}>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                {col.label}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {COLUMN_HELP[col.key]}
              </Typography>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          Getting stuck
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          After {HANGMAN_START} wrong guesses the character's name appears as blanks, and every
          further wrong guess uncovers one more letter. Spaces and apostrophes are free. The
          dailies have no guess limit, so you will always get there eventually. Versus rounds are
          capped at eight.
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          Accessibility
        </Typography>
        <FormControlLabel
          control={
            <Switch checked={colourblind} onChange={(e) => set({ colourblind: e.target.checked })} />
          }
          label={
            <Box>
              <Typography variant="body2">Colourblind mode</Typography>
              <Typography variant="caption" color="text.secondary">
                Adds a tick, tilde or cross to each cell so you do not have to rely on colour.
              </Typography>
            </Box>
          }
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
