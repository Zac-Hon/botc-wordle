import { useMemo, useState } from 'react'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Paper from '@mui/material/Paper'
import Stack from '@mui/material/Stack'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { ALL_CHARACTERS } from '../data/pools'
import { VALUE_LABELS } from '../game/clueSpec'
import { useCollection } from '../game/useCollection'
import { isConfigured } from '../lib/supabase'
import { useAuth } from '../store/auth'
import type { Character } from '../game/types'

/** Display order for the sets, most familiar first. */
const SET_ORDER = ['tb', 'bmr', 'snv', 'experimental', 'fabled', 'loric'] as const

export function Collection() {
  const { user, loading: authLoading } = useAuth()
  const { owned, byId, loading } = useCollection()
  const [showStoryteller, setShowStoryteller] = useState(false)

  const bySet = useMemo(() => {
    const groups = new Map<string, Character[]>()
    for (const c of ALL_CHARACTERS) {
      if (c.pools.isStoryteller && !showStoryteller) continue
      const key = c.attrs.script
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(c)
    }
    for (const list of groups.values()) list.sort((a, b) => a.name.localeCompare(b.name))
    return [...groups.entries()].sort(
      (a, b) => SET_ORDER.indexOf(a[0] as never) - SET_ORDER.indexOf(b[0] as never),
    )
  }, [showStoryteller])

  if (!isConfigured) {
    return (
      <Alert severity="warning" sx={{ mt: 2 }}>
        The collection needs the Supabase keys in <code>.env</code>, see SETUP.md.
      </Alert>
    )
  }

  if (authLoading || loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!user) {
    return (
      <Paper elevation={0} sx={{ p: 3, textAlign: 'center', mt: 2 }}>
        <Typography variant="h6" gutterBottom>
          Collection
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Sign in to keep track of the characters you have named.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/signin">
          Sign in
        </Button>
      </Paper>
    )
  }

  const total = ALL_CHARACTERS.filter((c) => showStoryteller || !c.pools.isStoryteller).length
  const have = ALL_CHARACTERS.filter(
    (c) => (showStoryteller || !c.pools.isStoryteller) && owned.has(c.id),
  ).length

  return (
    <Stack spacing={2} sx={{ py: 1 }}>
      <Box>
        <Typography variant="h5">Collection</Typography>
        <Typography variant="body2" color="text.secondary">
          Every character you have correctly named, from the dailies, Endless and Versus.
        </Typography>
      </Box>

      <Paper elevation={0} sx={{ p: 2 }}>
        <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }} spacing={1}>
          <Typography variant="h6" sx={{ fontFamily: 'inherit', fontWeight: 700 }}>
            {have} / {total}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showStoryteller}
                onChange={(e) => setShowStoryteller(e.target.checked)}
              />
            }
            label={<Typography variant="body2">Fabled & Loric</Typography>}
          />
        </Stack>
        <LinearProgress
          variant="determinate"
          value={total > 0 ? (have / total) * 100 : 0}
          sx={{ height: 8, borderRadius: 4 }}
        />
      </Paper>

      {bySet.map(([script, characters]) => {
        const setHave = characters.filter((c) => owned.has(c.id)).length
        const setDaily = characters.filter((c) => byId.get(c.id)?.earned_daily).length
        return (
          <Accordion
            key={script}
            // Open by default: the point of the page is seeing what you have.
            defaultExpanded
            disableGutters
            elevation={0}
            sx={{ '&:before': { display: 'none' } }}
          >
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack
                direction="row"
                spacing={1}
                sx={{ alignItems: 'center', flex: 1, pr: 1, flexWrap: 'wrap' }}
                useFlexGap
              >
                <Typography variant="subtitle1">{VALUE_LABELS[script] ?? script}</Typography>
                <Box sx={{ flex: 1 }} />
                <Chip
                  size="small"
                  variant="outlined"
                  color="primary"
                  label={`${setDaily} daily`}
                />
                <Chip
                  size="small"
                  variant="outlined"
                  color={setHave === characters.length ? 'success' : 'default'}
                  label={`${setHave} / ${characters.length}`}
                />
              </Stack>
            </AccordionSummary>

            <AccordionDetails>
              <Box
                sx={{
                  display: 'grid',
                  gap: 1,
                  gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
                }}
              >
                {characters.map((c) => {
                  const entry = byId.get(c.id)
                  const has = owned.has(c.id)
                  const daily = Boolean(entry?.earned_daily)
                  return (
                    <Box key={c.id} sx={{ textAlign: 'center' }}>
                      <Box
                        sx={{
                          p: 0.35,
                          borderRadius: '50%',
                          // The ring marks the best way that character can be
                          // earned: a daily for player characters, and Endless
                          // for Fabled and Loric, which the dailies never
                          // serve. Set server side by record_collection.
                          border: '2px solid',
                          borderColor: daily ? 'primary.main' : 'transparent',
                          boxShadow: daily ? '0 0 10px rgba(200,169,81,0.45)' : 'none',
                          display: 'inline-block',
                          lineHeight: 0,
                        }}
                      >
                        <Box
                          component="img"
                          src={`${import.meta.env.BASE_URL}tokens/${c.image}`}
                          alt={has ? c.name : 'Not yet named'}
                          loading="lazy"
                          width={52}
                          height={52}
                          sx={{
                            width: 52,
                            height: 52,
                            // Unearned characters are silhouetted rather than
                            // hidden, so the shape of what is left is visible.
                            filter: has ? 'none' : 'grayscale(1) brightness(0.28)',
                            opacity: has ? 1 : 0.55,
                          }}
                        />
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{
                          display: 'block',
                          fontSize: 9.5,
                          lineHeight: 1.1,
                          color: has ? 'text.secondary' : 'transparent',
                          userSelect: has ? 'auto' : 'none',
                        }}
                      >
                        {has ? c.name : '???'}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </AccordionDetails>
          </Accordion>
        )
      })}

      <Typography variant="caption" color="text.secondary" align="center">
        A gold ring means you earned that character the best way it can be earned: in a daily for
        most, or in Endless for Fabled and Loric, which never appear in the dailies. Endless and
        Versus wins on everyone else unlock the character without the ring.
      </Typography>

    </Stack>
  )
}
