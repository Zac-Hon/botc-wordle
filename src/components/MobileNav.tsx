import { useState } from 'react'
import Box from '@mui/material/Box'
import Divider from '@mui/material/Divider'
import Drawer from '@mui/material/Drawer'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemIcon from '@mui/material/ListItemIcon'
import ListItemText from '@mui/material/ListItemText'
import Typography from '@mui/material/Typography'
import MenuIcon from '@mui/icons-material/Menu'
import { useLocation, useNavigate } from 'react-router-dom'
import type { NavItem } from './navItems'

/**
 * The phone navigation.
 *
 * Seven scrolling tabs plus a title plus an account button wrapped onto three
 * rows and took a third of the screen height before any game was visible. A
 * drawer gives all of it back and makes the destinations easier to hit than a
 * horizontally scrolling tab strip ever was.
 */
export function MobileNav({ items }: { items: NavItem[] }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  return (
    <>
      <IconButton
        edge="start"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        sx={{ mr: 0.5 }}
      >
        <MenuIcon />
      </IconButton>

      <Drawer
        anchor="left"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{ paper: { sx: { width: 260 } } }}
      >
        <Box sx={{ p: 2, pb: 1 }}>
          <Typography variant="h6" sx={{ color: 'primary.main' }}>
            Clocktowerdle
          </Typography>
        </Box>
        <Divider />
        <List>
          {items.map((item) => (
            <ListItemButton
              key={item.to}
              selected={pathname.startsWith(item.to)}
              onClick={() => {
                setOpen(false)
                navigate(item.to)
              }}
            >
              <ListItemIcon sx={{ minWidth: 40, color: 'inherit' }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
    </>
  )
}
