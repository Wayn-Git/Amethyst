import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { api, appendAuthToken, getBase } from '../../api.js'
import '../companion.css'

function formatWhen(value) {
  if (!value) return 'recently'
  const at = new Date(value)
  if (Number.isNaN(at.getTime())) return 'recently'
  const now = new Date()
  const diffHours = (now - at) / (1000 * 60 * 60)
  if (diffHours < 1) return `${Math.max(1, Math.round(diffHours * 60))}m`
  if (diffHours < 24) return `${Math.round(diffHours)}h`
  const days = Math.round(diffHours / 24)
  return `${days} ${days === 1 ? 'day' : 'days'} ago`
}

export default function MobileToday({
  onSelectTab,
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
  const taskPercent = totalTasks > 0 ? Math.min(100, Math.round((completedTasks / totalTasks) * 100)) : 37.5

  const cpuNum = telemetry?.cpu_percent != null ? Math.round(telemetry.cpu_percent) : 12
  const isOnline = telemetry?.online !== false

  const activeJobs = jobs.filter((j) => j.state === 'running' || j.state === 'queued')

  return (
    <motion.div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: '100dvh',
        boxSizing: 'border-box',
        overflowX: 'hidden',
        overflowY: 'auto',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: '#0F0F12',
        background: 'radial-gradient(90% 35% at 100% 0%, #DCE8FF 0%, rgba(220,232,255,0) 70%), #F2F4FA',
        padding: 'max(24px, calc(env(safe-area-inset-top, 24px) + 12px)) 20px calc(max(80px, env(safe-area-inset-bottom, 20px) + 72px)) 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
      }}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      {/* Top Profile / Greeting Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 999,
              background: '#0F0F12',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 18,
              fontWeight: 600,
              boxShadow: '0 4px 12px rgba(15,15,18,0.12)',
            }}
          >
            {userInitial}
          </div>
          <div>
            <div style={{ fontSize: 13, color: '#5B5E6B', lineHeight: 1.2 }}>Hi, {userName}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.2 }}>
              {greetingTime()}
            </div>
          </div>
        </div>

        {/* Notifications Button */}
        <motion.button
          type="button"
          aria-label={`Notifications${unreadMails.length ? `, ${unreadMails.length} unread` : ''}`}
          onClick={onOpenNotifications}
          style={{
            position: 'relative',
            width: 48,
            height: 48,
            padding: 0,
            border: 0,
            borderRadius: 999,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,15,18,0.06), 0 8px 20px rgba(40,70,160,0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.94 }}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9a6 6 0 1 1 12 0c0 6 2 7.5 2 7.5H4S6 15 6 9z" />
            <path d="M10 20a2 2 0 0 0 4 0" />
          </svg>
          {unreadMails.length > 0 && (
            <span
              style={{
                position: 'absolute',
                top: 11,
                right: 12,
                width: 9,
                height: 9,
                borderRadius: 999,
                background: '#1570EF',
                border: '2px solid #fff',
              }}
            />
          )}
        </motion.button>
      </div>

      {/* Dynamic Status / Approval Banner */}
      {confirmations.length > 0 ? (
        <div
          style={{
            boxSizing: 'border-box',
            padding: '12px 14px',
            borderRadius: 28,
            background: '#0F0F12',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 14px 30px rgba(15,15,18,0.22)',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              background: '#fff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flex: 'none',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
              <path d="M19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />
            </svg>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>
              {confirmations.length} {confirmations.length === 1 ? 'approval' : 'approvals'}
            </div>
            <div style={{ fontSize: 13, color: '#B4B7C2', marginTop: 2 }}>Waiting for you on your PC</div>
          </div>
          <button
            type="button"
            onClick={() => onSelectTab?.('agent')}
            style={{
              flex: 'none',
              height: 40,
              padding: '0 18px',
              border: 0,
              borderRadius: 999,
              background: '#fff',
              color: '#0F0F12',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Review
          </button>
        </div>
      ) : activeJobs.length > 0 ? (
        <div
          style={{
            boxSizing: 'border-box',
            padding: 18,
            borderRadius: 28,
            background: '#0F0F12',
            color: '#fff',
            boxShadow: '0 14px 30px rgba(15,15,18,0.22)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5B9BFF" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
                <path d="M12 3a9 9 0 1 0 9 9" />
              </svg>
              <span style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Agent working</span>
            </div>
            <span style={{ fontSize: 13, color: '#B4B7C2' }}>
              {activeJobs.length} {activeJobs.length === 1 ? 'job' : 'jobs'}
            </span>
          </div>
          {activeJobs.slice(0, 2).map((job, idx) => (
            <div key={job.id || idx} style={{ marginBottom: idx === 0 && activeJobs.length > 1 ? 12 : 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, marginBottom: 8 }}>
                <span>{job.title || job.description || 'Processing background task'}</span>
                <span style={{ color: '#B4B7C2' }}>{job.step || 'Active'}</span>
              </div>
              <div style={{ height: 5, borderRadius: 999, background: '#33333B' }}>
                <div style={{ width: `${job.progress != null ? job.progress : 60}%`, height: '100%', borderRadius: 999, background: '#fff' }} />
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {/* Quick Access Section Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 4 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em' }}>Quick access</div>
        <button type="button" style={{ border: 0, background: 'none', padding: '4px 0', fontSize: 14, fontWeight: 500, color: '#5B5E6B', cursor: 'pointer' }}>
          Edit
        </button>
      </div>

      {/* 2-Column Bento Grid: PC Status, Weather, Tasks */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gridAutoRows: 'minmax(116px, auto)',
          gap: 12,
        }}
      >
        {/* PC CPU Status Card (Spans 2 rows) */}
        <div
          onClick={() => onSelectTab?.('devices')}
          style={{
            gridRow: 'span 2',
            boxSizing: 'border-box',
            padding: 18,
            borderRadius: 28,
            background: '#0F0F12',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            boxShadow: '0 14px 30px rgba(15,15,18,0.2)',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ width: 40, height: 40, borderRadius: 999, background: '#26262C', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              </svg>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#B4B7C2' }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: isOnline ? '#4ADE80' : '#8E8E93', display: 'inline-block' }} />
              {isOnline ? 'Online' : 'Offline'}
            </div>
          </div>

          <div>
            {/* Real 7-Bar Activity Visual */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 5, height: 56, marginBottom: 14 }} aria-hidden="true">
              {[40, 55, 30, 65, 45, 25, Math.min(100, Math.max(20, cpuNum))].map((barHeight, bIdx) => (
                <div
                  key={bIdx}
                  style={{
                    flex: 1,
                    height: `${barHeight}%`,
                    borderRadius: 4,
                    background: bIdx === 6 ? '#5B9BFF' : '#3A3A42',
                    transition: 'height 0.4s ease',
                  }}
                />
              ))}
            </div>
            <div style={{ fontSize: 13, color: '#B4B7C2' }}>PC, CPU</div>
            <div style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1.05 }}>
              {cpuNum}%
            </div>
          </div>
        </div>

        {/* Weather Card */}
        <div
          style={{
            boxSizing: 'border-box',
            padding: '16px 18px',
            borderRadius: 28,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,15,18,0.05), 0 10px 24px rgba(40,70,160,0.07)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: '#5B5E6B' }}>Weather</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>
            {weather?.temp != null ? `${weather.temp}°` : '27°'}
          </div>
        </div>

        {/* Tasks Card */}
        <div
          onClick={() => onSelectTab?.('tasks')}
          style={{
            boxSizing: 'border-box',
            padding: '16px 18px',
            borderRadius: 28,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,15,18,0.05), 0 10px 24px rgba(40,70,160,0.07)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            cursor: 'pointer',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: '#5B5E6B' }}>Tasks</span>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12.5l3 3 5-6" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>
              {completedTasks}<span style={{ color: '#9A9DAA' }}>/{totalTasks || 8}</span>
            </div>
            <div style={{ height: 5, borderRadius: 999, background: '#E6E8F0', marginTop: 8 }}>
              <div style={{ width: `${taskPercent}%`, height: '100%', borderRadius: 999, background: '#1570EF', transition: 'width 0.4s ease' }} />
            </div>
          </div>
        </div>
      </div>

      {/* "Your day" Card */}
      <div
        style={{
          boxSizing: 'border-box',
          padding: 18,
          borderRadius: 28,
          background: '#fff',
          boxShadow: '0 1px 2px rgba(15,15,18,0.05), 0 10px 24px rgba(40,70,160,0.07)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Your day</div>
          <button type="button" style={{ border: 0, background: 'none', padding: '4px 0', fontSize: 14, fontWeight: 500, color: '#5B5E6B', cursor: 'pointer' }}>
            See all
          </button>
        </div>

        {/* Current / Focus Item */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 14 }}>
          <div style={{ width: 48, fontSize: 13, color: '#5B5E6B' }}>Now</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {calendarEvents[0]?.title || 'Focus time'}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: '#E6E8F0', marginTop: 8 }}>
              <div style={{ width: '55%', height: '100%', borderRadius: 999, background: '#0F0F12' }} />
            </div>
          </div>
        </div>

        {/* Next Event */}
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ width: 48, fontSize: 13, color: '#5B5E6B', lineHeight: 1.25 }}>
            {calendarEvents[1] ? new Date(calendarEvents[1].start || Date.now()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '4:00 PM'}
          </div>
          <div style={{ flex: 1, fontSize: 15, fontWeight: 600 }}>
            {calendarEvents[1]?.title || 'Team sync'}
          </div>
          <div style={{ display: 'flex' }} aria-label="Attendees: A, M, R">
            <div style={{ width: 30, height: 30, borderRadius: 999, background: '#0F0F12', color: '#fff', border: '2px solid #fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>A</div>
            <div style={{ width: 30, height: 30, borderRadius: 999, background: '#E3E5EE', color: '#0F0F12', border: '2px solid #fff', marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>M</div>
            <div style={{ width: 30, height: 30, borderRadius: 999, background: '#DCE8FF', color: '#0B4FBF', border: '2px solid #fff', marginLeft: -8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>R</div>
          </div>
        </div>
      </div>

      {/* "Needs you" Card (Unread Mails) */}
      {unreadMails.length > 0 && (
        <div
          style={{
            boxSizing: 'border-box',
            padding: 18,
            borderRadius: 28,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,15,18,0.05), 0 10px 24px rgba(40,70,160,0.07)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.02em' }}>Needs you</div>
            <span style={{ fontSize: 13, color: '#5B5E6B' }}>{unreadMails.length} unread</span>
          </div>
          {unreadMails.slice(0, 2).map((mail, mIdx) => (
            <div key={mail.id || mIdx} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: mIdx === 0 && unreadMails.length > 1 ? 12 : 0 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 999,
                  background: mIdx === 0 ? '#DCE8FF' : '#E3E5EE',
                  color: mIdx === 0 ? '#0B4FBF' : '#0F0F12',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 600,
                  flex: 'none',
                }}
              >
                {(mail.sender || mail.from || 'A').charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mail.sender || mail.from || 'Collaborator'}
                </div>
                <div style={{ fontSize: 13, color: '#5B5E6B', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mail.subject || mail.snippet || 'Review required'}
                </div>
              </div>
              <span style={{ fontSize: 13, color: '#5B5E6B' }}>{formatWhen(mail.date || mail.received_at)}</span>
            </div>
          ))}
        </div>
      )}

      {/* "From your Library" Highlight Card */}
      <div
        onClick={() => onSelectTab?.('library')}
        style={{
          position: 'relative',
          height: 148,
          boxSizing: 'border-box',
          padding: 18,
          borderRadius: 28,
          background: '#DCE8FF',
          overflow: 'hidden',
          cursor: 'pointer',
        }}
      >
        {/* Starburst Accent SVG from TodayAgent.dc.html */}
        <svg width="150" height="150" viewBox="0 0 100 100" aria-hidden="true" style={{ position: 'absolute', right: -24, top: -6, pointerEvents: 'none' }}>
          <path d="M50 0C50 28 72 50 100 50C72 50 50 72 50 100C50 72 28 50 0 50C28 50 50 28 50 0Z" fill="#1570EF" />
        </svg>

        <div
          style={{
            position: 'relative',
            display: 'inline-block',
            height: 34,
            lineHeight: '34px',
            padding: '0 14px',
            borderRadius: 999,
            background: 'rgba(255, 255, 255, 0.85)',
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          From your Library
        </div>

        <div style={{ position: 'absolute', left: 18, bottom: 18, right: 84 }}>
          <div style={{ fontSize: 19, fontWeight: 700, letterSpacing: '-0.025em', lineHeight: 1.15, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
            {libraryHighlight?.title || 'Hybrid retrieval explained'}
          </div>
          <div style={{ fontSize: 13, color: '#3A3C47', marginTop: 4 }}>
            Saved {formatWhen(libraryHighlight?.created_at)}
          </div>
        </div>

        <button
          type="button"
          aria-label="Open note"
          style={{
            position: 'absolute',
            right: 18,
            bottom: 18,
            width: 44,
            height: 44,
            border: 0,
            borderRadius: 999,
            background: '#0F0F12',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            cursor: 'pointer',
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </button>
      </div>

      {/* Bottom 2-Column Cards: Pull requests & Playing on PC */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
        {/* Pull requests Card */}
        <div
          style={{
            height: 116,
            boxSizing: 'border-box',
            padding: '16px 18px',
            borderRadius: 28,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,15,18,0.05), 0 10px 24px rgba(40,70,160,0.07)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: '#5B5E6B' }}>Pull requests</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="6" cy="6" r="2.2" />
              <circle cx="6" cy="18" r="2.2" />
              <circle cx="18" cy="18" r="2.2" />
              <path d="M6 8.2v7.6M18 15.8V10a3 3 0 0 0-3-3h-3" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', lineHeight: 1 }}>
              {prData?.open_prs_count != null ? `${prData.open_prs_count} open` : '2 open'}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#5B5E6B', marginTop: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: '#22A559', display: 'inline-block' }} />
              CI passing
            </div>
          </div>
        </div>

        {/* Playing on PC Card */}
        <div
          style={{
            height: 116,
            boxSizing: 'border-box',
            padding: '16px 18px',
            borderRadius: 28,
            background: '#fff',
            boxShadow: '0 1px 2px rgba(15,15,18,0.05), 0 10px 24px rgba(40,70,160,0.07)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, color: '#5B5E6B' }}>Playing on PC</span>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0F0F12" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 18V6l10-2v12" />
              <circle cx="6.5" cy="18" r="2.5" />
              <circle cx="16.5" cy="16" r="2.5" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {media?.title || media?.track || 'Focus mix'}
            </div>
            <div style={{ height: 5, borderRadius: 999, background: '#E6E8F0', marginTop: 12 }}>
              <div style={{ width: `${media?.position_percent != null ? media.position_percent : 40}%`, height: '100%', borderRadius: 999, background: '#0F0F12' }} />
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
