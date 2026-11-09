import React from 'react'
import * as si from 'simple-icons'

const COMPOSIO_PATH =
  'M30.3675 4.7266C30.2658 4.7665 30.1591 4.797 30.0475 4.8149L19.8962 6.4389C18.6942 6.6312 17.6052 7.5597 17.6052 8.777V17.1144C17.6053 17.2582 17.6259 17.3974 17.6631 17.5298L9.08694 9.38701H9.08354L9.06822 9.37922C7.50284 8.58332 5.67969 9.8052 5.67969 11.5362V14.6548V14.7797C5.75338 16.3986 7.1856 17.6749 8.84759 17.5457L30.3675 15.8672V4.7266ZM9.08694 24.3168V21.4398H9.08354L30.3675 19.8436V30.9323L17.4953 31.9169V24.5828C17.4952 24.3853 17.4475 24.195 17.3606 24.0207L17.2528 23.1519C17.4061 23.3917 17.4952 23.6759 17.4953 23.9794V40.1801C17.4953 40.3679 17.4601 40.5478 17.398 40.7148L30.3675 39.7468V24.1307L17.2528 23.1519ZM32.195 4.7266V12.7623L57.2985 18.0099V21.1824C57.2985 22.8221 55.9444 24.1234 54.3367 24.0842L54.1808 24.0762H54.1774L32.195 22.4348V12.7623H32.1984H32.2137C33.7791 13.5582 35.6022 12.3363 35.6022 10.6053V7.48671V7.36178C35.5285 5.74288 34.0963 4.46659 32.4343 4.59577L32.195 4.7266ZM32.195 41.4432V50.9825L57.2826 45.7388V42.6735L57.2798 42.5184C57.2047 40.924 55.8073 39.6754 54.1808 39.8023H54.1774L32.195 41.4432Z'

const SLACK_PATH =
  'M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z'

export default function BrandIcon({ name, slug, size = 18, color, className = '', style = {} }) {
  const key = (name || slug || '').toLowerCase().replace(/[-_ ]/g, '')

  // Composio
  if (key === 'composio') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={COMPOSIO_PATH} fill={color || 'currentColor'} />
      </svg>
    )
  }

  // Microsoft To Do
  if (key === 'microsofttodo' || key === 'microsoft-todo' || key === 'microsoft') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color || '#2441ff'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" />
        <path d="M8 12.5l3 3 5-6" />
      </svg>
    )
  }

  // Google Drive
  if (key === 'googledrive' || key === 'gdrive' || key === 'drive') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siGoogledrive.path} fill={color || '#2684fc'} />
      </svg>
    )
  }

  // Slack
  if (key === 'slack') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={SLACK_PATH} fill={color || '#e01e5a'} />
      </svg>
    )
  }

  // GitHub
  if (key === 'github') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siGithub.path} fill={color || '#ffffff'} />
      </svg>
    )
  }

  // Linear
  if (key === 'linear') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siLinear.path} fill={color || '#5e6ad2'} />
      </svg>
    )
  }

  // Notion
  if (key === 'notion') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siNotion.path} fill={color || '#ffffff'} />
      </svg>
    )
  }

  // Gmail
  if (key === 'gmail') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siGmail.path} fill={color || '#ea4335'} />
      </svg>
    )
  }

  // Google Calendar
  if (key === 'googlecalendar' || key === 'calendar' || key === 'gcal') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siGooglecalendar.path} fill={color || '#4285f4'} />
      </svg>
    )
  }

  // Discord
  if (key === 'discord') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siDiscord.path} fill={color || '#5865f2'} />
      </svg>
    )
  }

  // Spotify
  if (key === 'spotify') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siSpotify.path} fill={color || '#1db954'} />
      </svg>
    )
  }

  // Figma
  if (key === 'figma') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siFigma.path} fill={color || '#f24e1e'} />
      </svg>
    )
  }

  // Jira
  if (key === 'jira') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siJira.path} fill={color || '#0052cc'} />
      </svg>
    )
  }

  // Trello
  if (key === 'trello') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siTrello.path} fill={color || '#0079bf'} />
      </svg>
    )
  }

  // Airtable
  if (key === 'airtable') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siAirtable.path} fill={color || '#fcb400'} />
      </svg>
    )
  }

  // Dropbox
  if (key === 'dropbox') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siDropbox.path} fill={color || '#0061ff'} />
      </svg>
    )
  }

  // Zoom
  if (key === 'zoom') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siZoom.path} fill={color || '#2d8cff'} />
      </svg>
    )
  }

  // X / Twitter
  if (key === 'twitter' || key === 'x') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siX.path} fill={color || '#ffffff'} />
      </svg>
    )
  }

  // GitLab
  if (key === 'gitlab') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siGitlab.path} fill={color || '#fc6d26'} />
      </svg>
    )
  }

  // Docker
  if (key === 'docker') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siDocker.path} fill={color || '#2496ed'} />
      </svg>
    )
  }

  // Postman
  if (key === 'postman') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siPostman.path} fill={color || '#ff6c37'} />
      </svg>
    )
  }

  // Supabase
  if (key === 'supabase') {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si.siSupabase.path} fill={color || '#3ecf8e'} />
      </svg>
    )
  }

  // Dynamic simple-icons fallback
  const siKey = 'si' + key.charAt(0).toUpperCase() + key.slice(1)
  if (si[siKey]?.path) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={{ flexShrink: 0, ...style }}
        aria-hidden="true"
      >
        <path d={si[siKey].path} fill={color || 'currentColor'} />
      </svg>
    )
  }

  // Generic fallback
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color || 'currentColor'}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}
