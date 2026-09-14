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
    'How far through the night they act, from 1 (earliest) to 100 (latest). The arrow points towards the answer, so up means the answer acts later than your guess. N/A means they never wake at all, and two characters who both never wake count as a match.',
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
          Your collection
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Every character you name correctly is added to your collection, from any mode, and any
          character in it can be used as your profile picture.
        </Typography>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 1 }}>
          <Box
            sx={{
              width: 34,
              height: 34,
              borderRadius: '50%',
              border: '2px solid',
              borderColor: 'primary.main',
              boxShadow: '0 0 10px rgba(200,169,81,0.45)',
              flexShrink: 0,
            }}
          />
          <Typography variant="body2" color="text.secondary">
            A gold ring means you earned that character the best way it can be earned: in a daily
            for most, or in Endless for Fabled and Loric, which never appear in the dailies.
          </Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Endless and Versus wins on everyone else still unlock the character, just without the
          ring. Characters you have not named yet show as dark silhouettes, so you can see what is
          left.
        </Typography>

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" gutterBottom>
          Versus
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Two players, three rounds a cycle. Round one shows a token and the fastest correct name
          scores most. Rounds two and three are the normal grid capped at eight guesses, scored on
          how few guesses you used and how quickly, with speed carrying the larger share. Round
          three lets you each choose the character the other has to find.
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Ranked matches are queued rather than arranged, and always use the Daily Full pool with
          one cycle, because a rating only means something if every ranked game is the same game.
          Your rating starts at 1000 and moves with each result, by more while your first ten
          games settle it. Private matches with a code never affect it.
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
