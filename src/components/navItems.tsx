import type { ReactNode } from 'react'
import HomeIcon from '@mui/icons-material/Home'
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth'
import WhatshotIcon from '@mui/icons-material/Whatshot'
import AllInclusiveIcon from '@mui/icons-material/AllInclusive'
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark'
import HistoryIcon from '@mui/icons-material/History'
import SportsKabaddiIcon from '@mui/icons-material/SportsKabaddi'

export interface NavItem {
  to: string
  label: string
  icon: ReactNode
}

/** Shared by the desktop tab strip and the phone drawer. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/home', label: 'Home', icon: <HomeIcon /> },
  { to: '/daily/classic', label: 'Classic', icon: <CalendarMonthIcon /> },
  { to: '/daily/full', label: 'Full', icon: <WhatshotIcon /> },
  { to: '/endless', label: 'Endless', icon: <AllInclusiveIcon /> },
  { to: '/collection', label: 'Collection', icon: <CollectionsBookmarkIcon /> },
  { to: '/archive', label: 'Archive', icon: <HistoryIcon /> },
  { to: '/pvp', label: 'Versus', icon: <SportsKabaddiIcon /> },
]
