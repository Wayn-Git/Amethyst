import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../../components/Icon.jsx'
import { api } from '../../api.js'

function formatWhen(value) {
  if (!value) return ''
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return value
  const now = new Date()
  const diffHours = (now - at) / (1000 * 60 * 60)
  if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))}m`
  if (diffHours < 24) return `${Math.round(diffHours)}h`
  return `${Math.round(diffHours / 24)}d`
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

      // Try fetching weather from local backend
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

  const userName = profile?.name || profile?.user_name || 'You'
  const userInitial = userName.charAt(0).toUpperCase() || 'U'

  const completedTasks = tasks.filter((t) => t.status === 'completed' || t.completed).length
  const totalTasks = tasks.length
  const displayDone = totalTasks > 0 ? `${completedTasks}/${totalTasks}` : '0/0'

  const cpuPercent = telemetry?.cpu_percent !== undefined
    ? `${Math.round(telemetry.cpu_percent)}%`
    : '--%'

  const activeJobs = jobs.filter((j) => j.state === 'running' || j.state === 'queued')

  // Real 48 activity dots mapped from completed task updates
  const completedTimestamps = new Set(
    tasks
      .filter((t) => t.status === 'completed' || t.completed)
      .map((t) => new Date(t.updated_at || t.created_at || Date.now()).getDate())
  )

  return (
    <motion.div
      className="m-body"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Top Greeting Bar */}
      <div className="m-r m-sp">
        <div className="m-r" style={{ gap: 12 }}>
          <span
            className="m-av"
            style={{ width: 48, height: 48, background: '#111113', color: '#D6F23E', fontSize: 17 }}
          >
            {userInitial}
          </span>
          <div>
            <div className="m-gl" style={{ fontSize: 18 }}>
              Hi, {userName}
            </div>
            <div
              className="m-dsp"
              style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.035em', lineHeight: 1.1 }}
            >
              {greetingTime()}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="m-ib"
          aria-label="Notifications"
          onClick={onOpenNotifications}
        >
          <Icon name="bell" size={20} />
        </button>
      </div>

      {/* Real Live Approval Banner (only when real pending confirmations exist) */}
      {confirmations.length > 0 && (
        <div
          className="m-r"
          style={{
            background: '#111113',
            color: '#fff',
            borderRadius: 999,
            padding: '8px 18px 8px 8px',
            gap: 12,
            cursor: 'pointer',
          }}
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
            <Icon name="sparkle" size={22} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="m-dsp" style={{ fontSize: 20, fontWeight: 500, lineHeight: 1.1 }}>
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
          <Icon name="chevron-right" size={20} />
        </div>
      )}

      {/* Quick Access Carousel */}
      <div className="m-r m-sp" style={{ marginTop: 4 }}>
        <span className="m-st">Quick access</span>
        <button
          type="button"
          onClick={onOpenAddWidgets}
          className="m-m"
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
        >
          Edit
        </button>
      </div>

      <div
        className="m-r"
        style={{
          gap: 12,
          overflowX: 'auto',
          marginRight: -18,
          paddingRight: 18,
          scrollbarWidth: 'none',
        }}
      >
        {/* Weather Card */}
        <div
          style={{
            width: 150,
            height: 168,
            borderRadius: 28,
            padding: 16,
            background: '#F9F8F6',
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
          }}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#ECEAE6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="sun" size={18} />
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {weather?.condition || 'Weather'}
            </div>
            <div
              className="m-dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {weather?.temp !== undefined ? `${weather.temp}°` : '--°'}
            </div>
          </div>
        </div>

        {/* PC CPU Card */}
        <div
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
              background: '#2B2B2E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="desktop" size={18} />
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>PC, CPU</div>
            <div
              className="m-dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {cpuPercent}
            </div>
          </div>
        </div>

        {/* Tasks Done Card */}
        <div
          style={{
            width: 150,
            height: 168,
            borderRadius: 28,
            padding: 16,
            background: '#F9F8F6',
            color: '#141414',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            flex: 'none',
            cursor: 'pointer',
          }}
          onClick={() => onSelectTab('tasks')}
        >
          <span
            style={{
              width: 38,
              height: 38,
              borderRadius: '50%',
              background: '#ECEAE6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name="check-circle" size={18} />
          </span>
          <div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>Tasks done</div>
            <div
              className="m-dsp"
              style={{ fontSize: 36, fontWeight: 500, letterSpacing: '-0.04em', lineHeight: 1.1 }}
            >
              {displayDone}
            </div>
          </div>
        </div>
      </div>

      {/* Your Day Card */}
      <div className="m-c m-col" style={{ gap: 12 }}>
        <div className="m-r m-sp">
          <span className="m-st">Your day</span>
          <button
            type="button"
            className="m-m"
            style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
            onClick={() => onSelectTab('tasks')}
          >
            See all
          </button>
        </div>

        {/* Focus time bar */}
        <div className="m-r">
          <span className="m-m" style={{ width: 48 }}>
            Tasks
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 500 }}>
              {totalTasks > 0 ? `${completedTasks} of ${totalTasks} completed` : 'No tasks scheduled'}
            </div>
            <div style={{ marginTop: 6 }}>
              <div className="m-pb">
                <div
                  style={{
                    width: totalTasks > 0 ? `${Math.round((completedTasks / totalTasks) * 100)}%` : '0%',
                    height: '100%',
                    background: '#111113',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Upcoming events */}
        {calendarEvents.length > 0 ? (
          <div className="m-r">
            <span className="m-m" style={{ width: 48 }}>
              {calendarEvents[0].start_time
                ? new Date(calendarEvents[0].start_time).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })
                : 'Next'}
            </span>
            <div
              style={{
                flex: 1,
                fontWeight: 500,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {calendarEvents[0].title || calendarEvents[0].summary}
            </div>
          </div>
        ) : (
          <div className="m-m" style={{ fontStyle: 'italic', color: '#888' }}>
            No upcoming events today
          </div>
        )}
      </div>

      {/* Agent Activity Grid */}
      <div className="m-c m-r m-sp">
        <div className="m-col" style={{ gap: 6 }}>
          <span className="m-st">Agent activity</span>
          <span className="m-m">
            {completedTasks > 0 ? `${completedTasks} tasks done` : 'No runs today'}
          </span>
          <button
            type="button"
            className="m-bt"
            style={{ minHeight: 40, fontSize: 13, marginTop: 4, width: 'fit-content' }}
            onClick={() => onSelectTab('agent')}
          >
            View trace
          </button>
        </div>

        {/* 12x4 matrix contribution dots */}
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(12, 9px)', gap: 3 }}
          aria-hidden="true"
        >
          {Array.from({ length: 48 }).map((_, i) => {
            const dayNum = (i % 31) + 1
            const active = completedTimestamps.has(dayNum)
            return (
              <i
                key={i}
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 2,
                  background: active ? '#111113' : '#DAD6CF',
                  display: 'block',
                }}
              />
            )
          })}
        </div>
      </div>

      {/* Agent Working Card */}
      <div className="m-blk m-col" style={{ gap: 14 }}>
        <div className="m-r m-sp">
          <div className="m-r" style={{ gap: 8 }}>
            <span
              className={activeJobs.length > 0 ? 'm-spn' : 'm-d'}
              style={
                activeJobs.length > 0
                  ? { borderColor: '#3A3A3E', borderTopColor: '#D6F23E' }
                  : { background: '#22c55e' }
              }
            />
            <span className="m-st">{activeJobs.length > 0 ? 'Agent working' : 'Agent idle'}</span>
          </div>
          <span className="m-m">{activeJobs.length} active jobs</span>
        </div>

        {activeJobs.length > 0 ? (
          activeJobs.slice(0, 2).map((job, idx) => (
            <div key={job.id || idx} className="m-col" style={{ gap: 6 }}>
              <div className="m-r m-sp">
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.kind || job.name || 'Running job'}
                </span>
                <span className="m-m">{job.state || 'running'}</span>
              </div>
              <div className="m-pb">
                <div
                  style={{
                    width: `${job.progress !== undefined ? Math.round(job.progress * 100) : 60}%`,
                    height: '100%',
                    background: '#D6F23E',
                  }}
                />
              </div>
            </div>
          ))
        ) : (
          <div className="m-m" style={{ color: '#A9A6A0' }}>
            All background tasks and workers are idle.
          </div>
        )}
      </div>

      {/* Needs You Card */}
      <div className="m-c m-col" style={{ gap: 12 }}>
        <div className="m-r m-sp">
          <span className="m-st">Needs you</span>
          <span className="m-m">
            {unreadMails.length > 0 ? `${unreadMails.length} unread` : 'Inbox clear'}
          </span>
        </div>

        {unreadMails.length > 0 ? (
          unreadMails.slice(0, 2).map((mail, idx) => (
            <div key={mail.id || idx} className="m-r">
              <span
                className="m-av"
                style={{ width: 36, height: 36, background: '#D6F23E', color: '#111113' }}
              >
                {(mail.from || 'U').charAt(0).toUpperCase()}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mail.from || 'Email'}
                </div>
                <div
                  className="m-m"
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {mail.subject || mail.snippet || 'No subject'}
                </div>
              </div>
              <span className="m-m">{formatWhen(mail.date || mail.updated_at)}</span>
            </div>
          ))
        ) : (
          <div className="m-m" style={{ color: '#6E6A64' }}>
            No pending items requiring your attention.
          </div>
        )}
      </div>

      {/* From Your Library Card */}
      {libraryHighlight ? (
        <div style={{ position: 'relative' }}>
          <div
            style={{
              width: '100%',
              height: 170,
              borderRadius: 28,
              background: '#D6F23E',
              overflow: 'hidden',
              flex: 'none',
            }}
          >
            <svg
              viewBox="0 0 100 100"
              width="100%"
              height="100%"
              preserveAspectRatio="xMidYMid slice"
              aria-hidden="true"
            >
              <path
                d="M50 12C54 38 62 46 88 50 62 54 54 62 50 88 46 62 38 54 12 50 38 46 46 38 50 12Z"
                fill="#111113"
              />
              <circle cx="82" cy="18" r="4" fill="#111113" />
            </svg>
          </div>

          <span
            className="m-ch"
            style={{ position: 'absolute', left: 14, top: 14, background: '#fff' }}
          >
            From your Library
          </span>

          <div
            style={{ position: 'absolute', left: 16, right: 16, bottom: 14 }}
            className="m-r m-sp"
          >
            <div style={{ minWidth: 0, flex: 1, marginRight: 12 }}>
              <div
                className="m-st"
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {libraryHighlight.title || 'Untitled save'}
              </div>
              <div className="m-m" style={{ color: '#2B2B2E' }}>
                {libraryHighlight.created_at
                  ? new Date(libraryHighlight.created_at).toLocaleDateString()
                  : 'Saved item'}
              </div>
            </div>
            <button
              type="button"
              className="m-ib"
              style={{ background: '#111113', color: '#fff', flex: 'none' }}
              aria-label="Open"
              onClick={() => onSelectTab('library', libraryHighlight)}
            >
              <Icon name="arrow-up-right" size={20} />
            </button>
          </div>
        </div>
      ) : (
        <div
          className="m-c m-col"
          style={{ gap: 8, padding: 18, cursor: 'pointer' }}
          onClick={() => onSelectTab('library')}
        >
          <div className="m-r m-sp">
            <span className="m-st">From your Library</span>
            <Icon name="book" size={20} />
          </div>
          <div className="m-m">No saved items yet. Tap to explore your library.</div>
        </div>
      )}

      {/* Split Cards: Pull Requests & Playing on PC */}
      <div className="m-g2">
        <div className="m-c m-col" style={{ height: 130, justifyContent: 'space-between' }}>
          <div className="m-r m-sp">
            <span className="m-m">Pull requests</span>
            <Icon name="git-pull-request" size={18} />
          </div>
          <div>
            <div
              className="m-dsp"
              style={{ fontSize: 26, fontWeight: 500, letterSpacing: '-0.04em' }}
            >
              {prData?.items ? `${prData.items.length} open` : '0 open'}
            </div>
            <div className="m-r" style={{ gap: 8, marginTop: 6 }}>
              <span
                className="m-d"
                style={{ background: prData?.items?.length ? '#22c55e' : '#9A958E' }}
              />
              <span className="m-m">
                {prData?.items?.length ? 'CI active' : 'No open PRs'}
              </span>
            </div>
          </div>
        </div>

        <div className="m-c m-col" style={{ height: 130, justifyContent: 'space-between' }}>
          <span className="m-m">Playing on PC</span>
          <div
            className="m-st"
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 16,
            }}
          >
            {media?.title || 'Nothing playing'}
          </div>
          <div className="m-m" style={{ color: '#6E6A64' }}>
            {media?.artist || (media?.status === 'playing' ? 'Active playback' : 'Paused')}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
