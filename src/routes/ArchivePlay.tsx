import { Navigate, useParams } from 'react-router-dom'
import { Daily } from './Daily'
import { todayUTC, type DailyMode } from '../game/daily'

/**
 * Plays one past puzzle. The date comes from the URL, so it is validated here
 * before reaching the RPC: the server refuses future dates too, but a bad URL
 * should show the archive rather than an error.
 */
export function ArchivePlay() {
  const { mode, date } = useParams<{ mode: string; date: string }>()

  const validMode = mode === 'classic' || mode === 'full'
  const validDate = Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date))
  if (!validMode || !validDate) return <Navigate to="/archive" replace />

  // Today is not archive material; send it to the live daily so the result counts.
  if (date === todayUTC()) return <Navigate to={`/daily/${mode}`} replace />

  return <Daily mode={mode as DailyMode} date={date} />
}
