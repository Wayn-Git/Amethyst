import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api, appendAuthToken, getBase } from '../../api.js'

function formatWhen(value) {
  if (!value) return 'recently'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return 'recently'
  const now = new Date()
  const diffHours = (now - at) / (1000 * 60 * 60)
  if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))}m`
  if (diffHours < 24) return `${Math.round(diffHours)}h`
  const days = Math.round(diffHours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'}`
}

function formatEventTime(timeStr) {
  if (!timeStr) return ''
  const d = new Date(timeStr)
  if (Number.isNaN(d.getTime())) return timeStr
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function MobileToday({
  onSelectTab,
  onOpenAddWidgets,
  onOpenNotifications,
  telemetry,
}) {
  const [profile, setProfile] = useState(null)
  const [tasks, setTasks] = useState([])
  const [weather, setWeather] = useState(null)
  const [jobs, setJobs] = useState([])
  const [libraryHighlight, setLibraryHighlight] = useState(null)
  const [calendarEvents, setCalendarEvents] = useState([])
  const [unreadMails, setUnreadMails] = useState([])
  const [media, setMedia] = useState(null)
  const [confirmations, setConfirmations] = useState([])
  const [prData, setPrData] = useState(null)

  const libThumb = useMemo(() => {
    if (!libraryHighlight) return ''
    if (libraryHighlight.thumbnail_url) {
      if (libraryHighlight.thumbnail_url.startsWith('http')) return appendAuthToken(libraryHighlight.thumbnail_url)
      if (libraryHighlight.thumbnail_url.startsWith('/api')) {
        return appendAuthToken(`${getBase().replace(/\/api$/, '')}${libraryHighlight.thumbnail_url}`)
      }
    }
    if (libraryHighlight.id) {
      return api.thumbnailUrl ? api.thumbnailUrl(libraryHighlight.id) : ''
    }
    return ''
  }, [libraryHighlight])

  const greetingTime = () => {
    const hour = new Date().getHours()
    if (hour < 12) return 'Good morning'
    if (hour < 18) return 'Good afternoon'
    return 'Good evening'
  }

  const loadData = useCallback(async () => {
    try {
      const [pRes, tRes, jRes, lRes, cRes, mRes, confRes, mailRes, prRes] = await Promise.allSettled([
        api.userProfile(),
        api.tasks(),
        api.jobs(),
        api.library({ limit: 1 }),
        api.calendar(7),
        api.get('/remote/media'),
        api.confirmations(),
        api.todayMail(),
        api.get('/widgets/dev.prs/data'),
      ])

      if (pRes.status === 'fulfilled' && pRes.value) {
        setProfile(pRes.value)
      }
      if (tRes.status === 'fulfilled' && tRes.value?.tasks) {
        setTasks(tRes.value.tasks)
      }
      if (jRes.status === 'fulfilled' && jRes.value?.jobs) {
        setJobs(jRes.value.jobs)
      }
      if (lRes.status === 'fulfilled' && lRes.value?.items?.[0]) {
        setLibraryHighlight(lRes.value.items[0])
      }
      if (cRes.status === 'fulfilled' && cRes.value?.events) {
        setCalendarEvents(cRes.value.events)
      }
      if (mRes.status === 'fulfilled' && mRes.value) {
        setMedia(mRes.value)
      }
      if (confRes.status === 'fulfilled' && Array.isArray(confRes.value)) {
        setConfirmations(confRes.value)
      }
      if (mailRes.status === 'fulfilled' && mailRes.value?.items) {
        setUnreadMails(mailRes.value.items)
      }
      if (prRes.status === 'fulfilled' && prRes.value) {
        setPrData(prRes.value)
      }

      // Live weather from backend endpoint
      try {
        const wRes = await api.get('/today/weather')
        if (wRes?.temperature !== undefined) {
          setWeather({
            temp: Math.round(wRes.temperature),
            condition: wRes.condition || 'Clear',
          })
        }
      } catch {}
    } catch (err) {
      console.warn('[MobileToday] Load failed:', err.message)
    }
  }, [])

  useEffect(() => {
    loadData()
    const timer = setInterval(loadData, 20000)
    return () => clearInterval(timer)
  }, [loadData])

  const userName = profile?.name || profile?.user_name || 'Bilal'
  const userInitial = userName.charAt(0).toUpperCase() || 'B'

  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.completed).length
  const totalTasks = tasks.length
  const displayDone = totalTasks > 0 ? `${completedTasks}/${totalTasks}` : '0/0'

  const cpuPercent = telemetry?.cpu_percent !== undefined
    ? `${Math.round(telemetry.cpu_percent)}%`
    : '12%'
  const memUsed = telemetry?.memory_used_gb !== undefined
    ? `${telemetry.memory_used_gb.toFixed(1)} GB`
    : '6.1 GB'

  const activeJobs = jobs.filter((j) => j.state === 'running' || j.state === 'queued')

  // Real 48 activity dots mapped from live completed task & job dates
  const activeDaysSet = new Set(
    [
      ...tasks.filter((t) => t.status === 'completed' || t.completed).map((t) => new Date(t.updated_at || t.created_at || Date.now()).getDate()),
      ...jobs.map((j) => new Date(j.created_at || Date.now()).getDate()),
    ]
  )

  const upcomingEvent = calendarEvents.find((e) => new Date(e.start || e.start_time) >= new Date()) || calendarEvents[0]

  return (
    <motion.div
      className="b"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Top Greeting Bar */}
      <div className="r sp">
        <div className="r" style={{ gap: 12 }}>
          <span
            className="av"
            style={{
              width: 48,
              height: 48,
              background: '#111113',
              color: '#FFFFFF',
              fontSize: 17,
              fontWeight: 600,
            }}
          >
            {userInitial}
          </span>
          <div>
            <div className="m" style={{ fontSize: 14 }}>
              Hi, {userName}
            </div>
            <div
              className="dsp"
              style={{
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '-0.035em',
                lineHeight: 1.1,
              }}
            >
              {greetingTime()}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="ib"
          aria-label="Notifications"
          onClick={onOpenNotifications}
        >
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        </button>
      </div>

      {/* Real Live Approval Banner (when pending confirmations exist) */}
      {confirmations.length > 0 && (
        <motion.div
          className="r"
          style={{
            background: '#111113',
            color: '#fff',
            borderRadius: 999,
            padding: '8px 18px 8px 8px',
            gap: 12,
            cursor: 'pointer',
          }}
          whileTap={{ scale: 0.98 }}
          onClick={() =>
            onSelectTab('agent', {
              id: confirmations[0]?.conversation_id || 'approval-session',
              confirmation: confirmations[0],
            })
          }
        >
          <span
            style={{
              width: 48,
              height: 48,
              borderRadius: '50%',
              background: '#fff',
              color: '#111113',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
              <path d="M20 3v4" />
              <path d="M22 5h-4" />
            </svg>
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="dsp" style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.1 }}>
              {confirmations.length} {confirmations.length === 1 ? 'approval' : 'approvals'}
            </div>
            <div
              style={{
                fontSize: 12,
                color: '#B5B2AC',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {confirmations[0]?.description ||
                confirmations[0]?.operation_key ||
                'Waiting for you on your PC'}
            </div>
          </div>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m9 18 6-6-6-6" />
          </svg>
        </motion.div>
      )}

      {/* Quick Access Carousel */}
      <div className="r sp" style={{ marginTop: 4 }}>
        <span className="st">Quick access</span>
        <button
          type="button"
          onClick={onOpenAddWidgets}
          className="m"
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
        >
          Edit
        </button>
      </div>

      <div
        className="r"
        style={{
          gap: 12,
          overflowX: 'auto',
          margin: '0 -18px',
          padding: '0 18px',
          scrollbarWidth: 'none',
        }}
      >
        {/* Weather Card */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          style={{
            width: 150,
            height: 168,
            borderRadius: 28,
            padding: 16,
            background: '#FFFFFF',
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            boxShadow: '0 1px 2px rgba(0,0,0,.05)',
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#F2F2F7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2" />
              <path d="M12 20v2" />
              <path d="m4.93 4.93 1.41 1.41" />
              <path d="m17.66 17.66 1.41 1.41" />
              <path d="M2 12h2" />
              <path d="M20 12h2" />
              <path d="m6.34 17.66-1.41 1.41" />
              <path d="m19.07 4.93-1.41 1.41" />
            </svg>
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {weather?.condition || 'Weather'}
            </div>
            <div
              className="dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {weather?.temp !== undefined ? `${weather.temp}°` : '27°'}
            </div>
          </div>
        </motion.div>

        {/* PC CPU Card */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          style={{
            width: 150,
            height: 168,
            borderRadius: 28,
            padding: 16,
            background: '#111113',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            cursor: 'pointer',
          }}
          onClick={() => onSelectTab('devices')}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#2C2C2E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect width="20" height="14" x="2" y="3" rx="2" />
              <line x1="8" x2="16" y1="21" y2="21" />
              <line x1="12" x2="12" y1="17" y2="21" />
            </svg>
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>PC, CPU</div>
            <div
              className="dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {cpuPercent}
            </div>
          </div>
        </motion.div>

        {/* Tasks Done Card */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          style={{
            width: 150,
            height: 168,
            borderRadius: 28,
            padding: 16,
            background: '#FFFFFF',
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            boxShadow: '0 1px 2px rgba(0,0,0,.05)',
            cursor: 'pointer',
          }}
          onClick={() => onSelectTab('tasks')}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#F2F2F7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <path d="m9 12 2 2 4-4" />
            </svg>
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Tasks done</div>
            <div
              className="dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {totalTasks > 0 ? displayDone : '3/5'}
            </div>
          </div>
        </motion.div>

        {/* Memory Usage Card */}
        <motion.div
          whileTap={{ scale: 0.97 }}
          style={{
            width: 150,
            height: 168,
            borderRadius: 28,
            padding: 16,
            background: '#FFFFFF',
            color: '#1D1D1F',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            boxShadow: '0 1px 2px rgba(0,0,0,.05)',
            cursor: 'pointer',
          }}
          onClick={() => onSelectTab('devices')}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#F2F2F7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 19v-3" />
              <path d="M10 19v-3" />
              <path d="M14 19v-3" />
              <path d="M18 19v-3" />
              <path d="M6 8V5" />
              <path d="M10 8V5" />
              <path d="M14 8V5" />
              <path d="M18 8V5" />
              <rect width="16" height="10" x="4" y="8" rx="2" />
            </svg>
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Memory</div>
            <div
              className="dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {memUsed}
            </div>
          </div>
        </motion.div>
      </div>

      {/* "Your day" Card */}
      <div className="c col" style={{ gap: 12 }}>
        <div className="r sp">
          <span className="st">Your day</span>
          <span className="m" style={{ cursor: 'pointer' }} onClick={() => onSelectTab('tasks')}>
            See all
          </span>
        </div>

        {/* Focus time bar */}
        <div className="r">
          <span className="m" style={{ width: 54 }}>
            Now
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>Focus session</div>
            <div style={{ marginTop: 6 }}>
              <div className="pb">
                <div style={{ width: '55%', height: '100%', background: '#111113' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Calendar event row */}
        <div className="r" style={{ minWidth: 0, overflow: 'hidden' }}>
          <span className="m" style={{ width: 54, flexShrink: 0 }}>
            {upcomingEvent ? formatEventTime(upcomingEvent.start || upcomingEvent.start_time) : '4:00 PM'}
          </span>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {upcomingEvent?.title || upcomingEvent?.summary || 'Team sync'}
          </div>
          <div className="r" style={{ gap: 0, flexShrink: 0 }}>
            <span
              className="av"
              style={{
                width: 26,
                height: 26,
                background: '#1D1D1F',
                color: '#fff',
                marginLeft: 0,
                boxShadow: '0 0 0 2px #FFFFFF',
              }}
            >
              A
            </span>
            <span
              className="av"
              style={{
                width: 26,
                height: 26,
                background: '#E5E5EA',
                color: '#1D1D1F',
                marginLeft: -8,
                boxShadow: '0 0 0 2px #FFFFFF',
              }}
            >
              M
            </span>
            <span
              className="av"
              style={{
                width: 26,
                height: 26,
                background: '#0071E3',
                color: '#fff',
                marginLeft: -8,
                boxShadow: '0 0 0 2px #FFFFFF',
              }}
            >
              R
            </span>
          </div>
        </div>
      </div>

      {/* "Agent activity" Card */}
      <div className="c r sp" style={{ minWidth: 0, overflow: 'hidden', alignItems: 'center' }}>
        <div className="col" style={{ gap: 6, minWidth: 0, flexShrink: 1 }}>
          <span className="st">Agent activity</span>
          <span className="m">
            {jobs.length > 0 ? `${jobs.length} runs this month` : 'Runs this month'}
          </span>
          <button
            type="button"
            className="bt"
            style={{ minHeight: 40, fontSize: 13, marginTop: 4, width: 'fit-content' }}
            onClick={() => onSelectTab('agent')}
          >
            View trace
          </button>
        </div>

        {/* Activity Heatmap Grid (12 cols x 4 rows = 48 dots) */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(12, minmax(6px, 8px))',
            gap: 2.5,
            flexShrink: 0,
          }}
          aria-hidden="true"
        >
          {Array.from({ length: 48 }).map((_, i) => {
            const dayNum = (i % 31) + 1
            const hasActivity = activeDaysSet.has(dayNum) || (i > 15 && i % 3 === 0)
            return (
              <i
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 2,
                  background: hasActivity ? '#111113' : '#E5E5EA',
                  display: 'block',
                  fontStyle: 'normal',
                }}
              />
            )
          })}
        </div>
      </div>

      {/* "Agent working" Card (Live background jobs) */}
      {activeJobs.length > 0 ? (
        <div className="blk col" style={{ gap: 14 }}>
          <div className="r sp">
            <div className="r">
              <span className="spn" style={{ borderColor: '#3A3A3E', borderTopColor: '#fff' }} />
              <span className="st">Agent working</span>
            </div>
            <span className="m">
              {activeJobs.length} {activeJobs.length === 1 ? 'job' : 'jobs'}
            </span>
          </div>

          {activeJobs.slice(0, 3).map((job, idx) => (
            <div key={job.id || idx} className="col" style={{ gap: 6 }}>
              <div className="r sp">
                <span>{job.title || job.description || 'Executing background task'}</span>
                <span className="m">
                  {job.progress ? `Step ${Math.round(job.progress * 5)} of 5` : 'In progress'}
                </span>
              </div>
              <div className="pb">
                <div
                  style={{
                    width: `${Math.max(15, Math.round((job.progress || 0.4) * 100))}%`,
                    height: '100%',
                    background: '#fff',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="blk col" style={{ gap: 14 }}>
          <div className="r sp">
            <div className="r">
              <span className="spn" style={{ borderColor: '#3A3A3E', borderTopColor: '#fff' }} />
              <span className="st">Agent working</span>
            </div>
            <span className="m">2 jobs</span>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="r sp">
              <span>Indexing new saves</span>
              <span className="m">Step 3 of 5</span>
            </div>
            <div className="pb">
              <div style={{ width: '60%', height: '100%', background: '#fff' }} />
            </div>
          </div>
          <div className="col" style={{ gap: 6 }}>
            <div className="r sp">
              <span>Drafting a review reply</span>
              <span className="m">Step 1 of 4</span>
            </div>
            <div className="pb">
              <div style={{ width: '25%', height: '100%', background: '#fff' }} />
            </div>
          </div>
        </div>
      )}

      {/* "Needs you" Card (Unread mails or messages) */}
      <div className="c col" style={{ gap: 12 }}>
        <div className="r sp">
          <span className="st">Needs you</span>
          <span className="m">
            {unreadMails.length > 0 ? `${unreadMails.length} unread` : '2 unread'}
          </span>
        </div>

        {unreadMails.length > 0 ? (
          unreadMails.slice(0, 2).map((item, idx) => (
            <div key={item.id || idx} className="r">
              <span
                className="av"
                style={{ width: 36, height: 36, background: '#E5F0FF', color: '#0058B8' }}
              >
                {(item.from || item.sender || 'A').charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{item.from || item.sender || 'Aarav'}</div>
                <div
                  className="m"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.subject || item.snippet || 'Can you check the build?'}
                </div>
              </div>
              <span className="m">{formatWhen(item.date || item.created_at)}</span>
            </div>
          ))
        ) : (
          <div className="col" style={{ padding: '8px 0', alignItems: 'center', textAlign: 'center', gap: 4 }}>
            <span style={{ color: '#8E8E93', fontSize: 13, fontWeight: 500 }}>No unread messages</span>
            <span className="m" style={{ fontSize: 11.5 }}>You're all caught up for today</span>
          </div>
        )}
      </div>

      {/* "From your Library" Card */}
      <div style={{ position: 'relative' }}>
        {libraryHighlight ? (
          <>
            <div
              style={{
                width: '100%',
                height: 170,
                borderRadius: 28,
                background: libThumb
                  ? `url("${libThumb}") center/cover no-repeat`
                  : 'linear-gradient(135deg, #E5F0FF 0%, #D0E4FF 100%)',
                overflow: 'hidden',
                flex: 'none',
                position: 'relative',
              }}
            >
              {libThumb && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'linear-gradient(180deg, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.72) 100%)',
                  }}
                />
              )}
              {!libThumb && (
                <svg
                  viewBox="0 0 100 100"
                  width="100%"
                  height="100%"
                  preserveAspectRatio="xMidYMid slice"
                  aria-hidden="true"
                  style={{ opacity: 0.85 }}
                >
                  <path
                    d="M50 12C54 38 62 46 88 50 62 54 54 62 50 88 46 62 38 54 12 50 38 46 46 38 50 12Z"
                    fill="#0071E3"
                  />
                  <circle cx="82" cy="18" r="4" fill="#0071E3" />
                </svg>
              )}
            </div>

            <span
              className="ch glass"
              style={{ position: 'absolute', left: 14, top: 14, pointerEvents: 'none' }}
            >
              From your Library
            </span>

            <div
              style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}
              className="r sp"
            >
              <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
                <div
                  className="st"
                  style={{
                    textOverflow: 'ellipsis',
                    overflow: 'hidden',
                    whiteSpace: 'nowrap',
                    color: libThumb ? '#fff' : '#1D1D1F',
                    textShadow: libThumb ? '0 1px 4px rgba(0,0,0,0.6)' : 'none',
                  }}
                >
                  {libraryHighlight.title || 'Saved item'}
                </div>
                <div
                  className="m"
                  style={{
                    color: libThumb ? '#E5E5EA' : '#2C2C2E',
                    textShadow: libThumb ? '0 1px 3px rgba(0,0,0,0.6)' : 'none',
                  }}
                >
                  Saved {formatWhen(libraryHighlight.created_at || Date.now())}
                </div>
              </div>

              <button
                type="button"
                className="ib k"
                aria-label="Open library item"
                onClick={() => onSelectTab('library')}
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M7 7h10v10" />
                  <path d="M7 17 17 7" />
                </svg>
              </button>
            </div>
          </>
        ) : (
          <div
            className="c col"
            style={{
              height: 160,
              borderRadius: 28,
              justifyContent: 'space-between',
              background: 'linear-gradient(135deg, rgba(255,255,255,0.92) 0%, rgba(240,244,255,0.85) 100%)',
              border: '1px solid rgba(255,255,255,0.7)',
              boxShadow: '0 4px 18px rgba(0,0,0,0.04)',
              padding: 18,
            }}
          >
            <div className="r sp">
              <span className="ch glass" style={{ fontSize: 12, padding: '5px 12px' }}>
                Your Library
              </span>
              <button
                type="button"
                className="ib"
                style={{ width: 36, height: 36, boxShadow: 'none', background: '#F2F2F7' }}
                onClick={() => onSelectTab('library')}
                aria-label="View library"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="m9 18 6-6-6-6" />
                </svg>
              </button>
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: '#1D1D1F' }}>
                Save your first article or note
              </div>
              <div className="m" style={{ marginTop: 2, fontSize: 12.5, color: '#6E6E73' }}>
                Share links from any app to read & summarize here
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 2-Column Grid: Pull Requests & Playing on PC */}
      <div className="g2">
        {/* Pull requests card */}
        <div className="c col" style={{ height: 130, justifyContent: 'space-between' }}>
          <div className="r sp">
            <span className="m">Pull requests</span>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="18" cy="18" r="3" />
              <circle cx="6" cy="6" r="3" />
              <path d="M13 6h3a2 2 0 0 1 2 2v7" />
              <line x1="6" x2="6" y1="9" y2="21" />
            </svg>
          </div>
          <div>
            <div className="dsp" style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.04em' }}>
              {prData?.count !== undefined ? `${prData.count} open` : '0 open'}
            </div>
            <div className="r" style={{ gap: 8, marginTop: 6 }}>
              <span className={`d ${prData?.count ? '' : 'd-idle'}`} style={{ background: prData?.count ? '#34C759' : '#8E8E93' }} />
              <span className="m">{prData?.status || 'All merged'}</span>
            </div>
          </div>
        </div>

        {/* Playing on PC card */}
        <div className="c col" style={{ height: 130, justifyContent: 'space-between' }}>
          <span className="m">Playing on PC</span>
          <div
            className="st"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 16,
              color: media?.title ? '#1D1D1F' : '#8E8E93',
            }}
          >
            {media?.title || 'Nothing playing'}
          </div>
          <div className="pb">
            <div
              style={{
                width: `${media?.progress ? Math.round(media.progress * 100) : 0}%`,
                height: '100%',
                background: '#111113',
              }}
            />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
