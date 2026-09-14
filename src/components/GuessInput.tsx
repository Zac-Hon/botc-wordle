import { useMemo, useState } from 'react'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import Box from '@mui/material/Box'
import ListSubheader from '@mui/material/ListSubheader'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { VALUE_LABELS } from '../game/clueSpec'
import { normalise } from '../game/closeness'
import type { Character } from '../game/types'
import { tokenSrcFromFile } from '../lib/tokens'

/**
 * Matches on a normalised substring, so "washer" finds Washerwoman and
 * "lilmonsta" finds Lil' Monsta without the player fighting the apostrophe.
 */
const filter = createFilterOptions<Character>({
  stringify: (c) => `${c.name} ${normalise(c.name)}`,
  trim: true,
})

/**
 * Groups run alphabetically by group name (Demon, Minion, Outsider, Townsfolk,
 * Traveller) rather than in the game's usual good-to-evil order, and characters
 * are alphabetical inside each group. Predictable beats thematic when someone
 * is scanning 156 options mid-game.
 */
function groupOf(c: Character): string {
  return VALUE_LABELS[c.attrs.team] ?? c.attrs.team
}

export function GuessInput({
  pool,
  guessed,
  disabled,
  onGuess,
  placeholder = 'Name a character...',
}: {
  pool: Character[]
  /** Ids already guessed; kept visible but disabled rather than hidden. */
  guessed: Set<string>
  disabled?: boolean
  onGuess: (c: Character) => void
  placeholder?: string
}) {
  const [value, setValue] = useState<Character | null>(null)
  const [input, setInput] = useState('')

  // Sorted once per pool: group name first, then character name.
  const options = useMemo(
    () =>
      [...pool].sort((a, b) => {
        const g = groupOf(a).localeCompare(groupOf(b))
        return g !== 0 ? g : a.name.localeCompare(b.name)
      }),
    [pool],
  )

  return (
    <Autocomplete
      options={options}
      value={value}
      inputValue={input}
      disabled={disabled}
      filterOptions={filter}
      groupBy={groupOf}
      getOptionLabel={(c) => c.name}
      getOptionDisabled={(c) => guessed.has(c.id)}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      openOnFocus
      autoHighlight
      blurOnSelect
      clearOnBlur
      handleHomeEndKeys
      noOptionsText="No character by that name"
      // The input sits below the guess grid so the list opens into empty space.
      // Flipping would put it back over the guesses, which is the whole problem
      // this layout exists to solve; the caller reserves the room below.
      slotProps={{
        popper: {
          placement: 'bottom-start',
          modifiers: [
            { name: 'flip', enabled: false },
            { name: 'preventOverflow', enabled: false },
          ],
        },
        listbox: { sx: { maxHeight: 280 } },
      }}
      onInputChange={(_, v) => setInput(v)}
      onChange={(_, c) => {
        if (!c || guessed.has(c.id)) return
        onGuess(c)
        // Clear both halves so the next guess starts from empty.
        setValue(null)
        setInput('')
      }}
      renderInput={(params) => <TextField {...params} autoFocus placeholder={placeholder} />}
      renderGroup={(params) => (
        <li key={params.key}>
          <ListSubheader
            sx={{
              bgcolor: 'background.paper',
              color: 'primary.main',
              fontWeight: 700,
              lineHeight: '30px',
              fontSize: 12,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            {params.group}
          </ListSubheader>
          <Box component="ul" sx={{ p: 0, m: 0 }}>
            {params.children}
          </Box>
        </li>
      )}
      renderOption={(props, c) => {
        const { key, ...rest } = props as React.HTMLAttributes<HTMLLIElement> & { key: string }
        const already = guessed.has(c.id)
        return (
          <Box component="li" key={key} {...rest} sx={{ gap: 1.25, opacity: already ? 0.4 : 1 }}>
            <Box
              component="img"
              src={tokenSrcFromFile(c.image)}
              alt=""
              loading="lazy"
              width={30}
              height={30}
              sx={{ width: 30, height: 30 }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {c.name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {already ? 'Already guessed' : (VALUE_LABELS[c.attrs.script] ?? c.attrs.script)}
              </Typography>
            </Box>
          </Box>
        )
      }}
    />
  )
}
