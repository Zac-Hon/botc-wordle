import { useState } from 'react'
import Button from '@mui/material/Button'
import Divider from '@mui/material/Divider'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import AccountCircleIcon from '@mui/icons-material/AccountCircle'
import LogoutIcon from '@mui/icons-material/Logout'
import QueryStatsIcon from '@mui/icons-material/QueryStats'
import PersonIcon from '@mui/icons-material/Person'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/auth'

/**
 * Clicking your name opens a menu rather than signing you out on the spot --
 * a single click that ends the session is far too easy to trigger by accident.
 */
export function AccountMenu() {
  const { user, username, signOut, loading } = useAuth()
  const [anchor, setAnchor] = useState<null | HTMLElement>(null)
  const navigate = useNavigate()

  if (loading) return null

  if (!user) {
    return (
      <Button size="small" component={RouterLink} to="/signin" startIcon={<AccountCircleIcon />}>
        Sign in
      </Button>
    )
  }

  const close = () => setAnchor(null)

  return (
    <>
      <Button
        size="small"
        onClick={(e) => setAnchor(e.currentTarget)}
        startIcon={<AccountCircleIcon />}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
      >
        {username ?? 'Account'}
      </Button>

      <Menu anchorEl={anchor} open={Boolean(anchor)} onClose={close}>
        <MenuItem
          onClick={() => {
            close()
            navigate('/profile')
          }}
        >
          <ListItemIcon>
            <PersonIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Profile</ListItemText>
        </MenuItem>

        <MenuItem
          onClick={() => {
            close()
            navigate('/collection')
          }}
        >
          <ListItemIcon>
            <CollectionsBookmarkIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Collection</ListItemText>
        </MenuItem>

        <MenuItem
          onClick={() => {
            close()
            navigate('/stats')
          }}
        >
          <ListItemIcon>
            <QueryStatsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Stats</ListItemText>
        </MenuItem>

        <Divider />

        <MenuItem
          onClick={() => {
            close()
            void signOut().then(() => navigate('/'))
          }}
        >
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Log out</ListItemText>
        </MenuItem>
      </Menu>
    </>
  )
}
