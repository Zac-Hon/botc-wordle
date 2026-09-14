import Avatar from '@mui/material/Avatar'
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { Link as RouterLink } from 'react-router-dom'
import { frameSx } from '../game/frames'
import { tokenSrc } from '../lib/tokens'

export interface PlayerIdentity {
  username: string
  pronouns?: string | null
  avatar?: string | null
  title?: string | null
  frame?: string | null
}

/**
 * A player's identity wherever one is shown: token, frame, name, pronouns and
 * earned title.
 *
 * There were three copies of this before, one in Stats, one in VersusStats and
 * one inline in the Versus lobby, which meant every new piece of identity had
 * to be added in three places and drifted the moment one was missed.
 */
export function PlayerChip({
  username,
  pronouns = null,
  avatar = null,
  title = null,
  frame = null,
  size = 26,
  link = true,
}: PlayerIdentity & {
  size?: number
  /** Links to the public profile. Off where the whole row is already a link. */
  link?: boolean
}) {
  const src = tokenSrc(avatar)

  const name = (
    <Typography
      variant="body2"
      sx={{
        fontWeight: 600,
        lineHeight: 1.1,
        color: 'inherit',
        textDecoration: 'none',
        '&:hover': link ? { textDecoration: 'underline' } : undefined,
      }}
      noWrap
      {...(link ? { component: RouterLink, to: `/player/${encodeURIComponent(username)}` } : {})}
    >
      {username}
    </Typography>
  )

  // Pronouns and title share one line so a chip stays two lines tall whether a
  // player has neither, either or both.
  const secondary = [title, pronouns].filter(Boolean).join(' · ')

  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', minWidth: 0 }}>
      <Box
        sx={{
          ...frameSx(frame),
          borderRadius: '50%',
          p: '2px',
          display: 'inline-flex',
          flexShrink: 0,
        }}
      >
        <Avatar
          src={src}
          sx={{
            width: size,
            height: size,
            bgcolor: 'background.default',
            fontSize: Math.round(size * 0.46),
          }}
        >
          {username[0]?.toUpperCase()}
        </Avatar>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {name}
        {secondary && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1 }} noWrap>
            {secondary}
          </Typography>
        )}
      </Box>
    </Stack>
  )
}
