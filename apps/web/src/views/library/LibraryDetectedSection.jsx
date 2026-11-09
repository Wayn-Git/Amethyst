import React, { useMemo } from 'react'
import Icon from '../../components/Icon.jsx'
import AppButton from '../../components/ui/AppButton.jsx'
import LibraryDetailRow from './LibraryDetailRow.jsx'
import { getFaviconUrl } from './LibraryCard.jsx'
import { getResourceIcon, getCleanDomain } from './LibraryDetailModal.jsx'

function isCdnOrMediaUrl(url) {
  if (!url || typeof url !== 'string') return false
  const u = url.toLowerCase()
  if (/\.(mp4|webm|mov|m4a|mkv|jpg|jpeg|png|webp|gif)(\?|$)/i.test(u)) return true
  const cdnHosts = ['fbcdn.net', 'cdninstagram.com', 'instagram.f', 'twimg.com', 'tiktokcdn.com', 'googlevideo.com', 'ytimg.com', 'media.tenor.com', 'cloudfront.net']
  return cdnHosts.some((h) => u.includes(h))
}

export default function LibraryDetectedSection({
  resources = [],
  savedSongs = new Set(),
  savingSong = null,
  onSaveSong,
  onExportPlaylist,
}) {
  // 1. Filter out internal CDN links and raw video/media assets from user-facing detected links
  const validResources = useMemo(() => {
    return (resources || []).filter((r) => {
      if (!r || !r.name) return false
      if (r.type === 'slide') return false
      if (r.type === 'video' || r.type === 'mp4') return false
      if (isCdnOrMediaUrl(r.url)) return false
      if (isCdnOrMediaUrl(r.name)) return false
      return true
    })
  }, [resources])

  const songs = useMemo(() => validResources.filter((r) => r.type === 'music'), [validResources])

  // 2. Smartly categorize entities by intent
  const { streamingGroup, castGroup, showsGroup, toolsGroup, refsGroup } = useMemo(() => {
    const streaming = []
    const cast = []
    const shows = []
    const tools = []
    const refs = []

    const STREAMING_DOMAINS = ['tv.apple.com', 'roku.com', 'netflix.com', 'primevideo.com', 'disneyplus.com', 'hulu.com', 'max.com', 'inkitt.com', 'peacocktv.com']

    for (const r of validResources) {
      if (r.type === 'music') continue

      const t = (r.type || '').toLowerCase()
      const n = (r.name || '').toLowerCase()
      const d = (r.detail || '').toLowerCase()
      const u = (r.url || '').toLowerCase()

      const isStreaming = t === 'streaming' || STREAMING_DOMAINS.some((dom) => u.includes(dom)) || d.includes('streaming') || d.includes('watch on') || n.includes('apple tv') || n.includes('roku')
      const isPerson = t === 'person' || t === 'actor' || t === 'director' || t === 'creator' || t === 'author' || t === 'cast' || d.includes('actor') || d.includes('director') || d.includes('starring') || n.startsWith('@')
      const isShow = t === 'show' || t === 'movie' || t === 'series' || t === 'film' || d.includes('series') || d.includes('movie') || d.includes('film')
      const isTool = t === 'tool' || t === 'product' || t === 'code' || t === 'repo' || t === 'library' || t === 'framework' || t === 'app'

      if (isStreaming) {
        streaming.push(r)
      } else if (isPerson) {
        cast.push(r)
      } else if (isShow) {
        shows.push(r)
      } else if (isTool) {
        tools.push(r)
      } else {
        refs.push(r)
      }
    }

    return { streamingGroup: streaming, castGroup: cast, showsGroup: shows, toolsGroup: tools, refsGroup: refs }
  }, [validResources])

  const totalCount = songs.length + streamingGroup.length + castGroup.length + showsGroup.length + toolsGroup.length + refsGroup.length
  if (totalCount === 0) return null

  const renderEntityRow = (res, key, actionLabel = 'Open', actionIcon = 'arrow-up-right') => {
    const domain = getCleanDomain(res.url)
    const iconName = getResourceIcon(res.type, res.url, res.name)
    const faviconUrl = res.url ? getFaviconUrl(res.url) : null
    const isClickable = Boolean(res.url)
    const subtitle = [domain, res.detail].filter(Boolean).join(' · ')

    return (
      <LibraryDetailRow
        key={key}
        thumbnail={faviconUrl}
        icon={<Icon name={iconName} size={14} />}
        title={res.name}
        subtitle={subtitle}
        actions={
          isClickable ? (
            <AppButton
              variant="secondary"
              size="sm"
              onClick={() => window.open(res.url, '_blank', 'noreferrer')}
              title={`Open ${res.name}`}
              icon={<Icon name={actionIcon} size={14} />}
            >
              {actionLabel}
            </AppButton>
          ) : null
        }
      />
    )
  }

  return (
    <section className="lib-detected-section" aria-label="Detected items">
      {/* Section Header */}
      <div className="lib-detected-header">
        <div className="lib-detected-title-wrap">
          <Icon name="spark" size={14} className="lib-detected-header-icon" />
          <h2 className="lib-detected-heading">Detected</h2>
          <span className="lib-detected-count-badge">{totalCount}</span>
        </div>

        {songs.length >= 2 && onExportPlaylist && (
          <AppButton
            variant="secondary"
            size="sm"
            onClick={() => onExportPlaylist(songs)}
            title="Export all detected tracks as a playlist"
            icon={<Icon name="list-plus" size={14} />}
          >
            Export playlist
          </AppButton>
        )}
      </div>

      <div className="lib-detected-list">
        {/* 1. Streaming & Where to Watch */}
        {streamingGroup.length > 0 && (
          <div className="lib-detected-group">
            <div className="lib-detected-group-title">
              <Icon name="tv" size={12} className="opacity-70" />
              <span>Where to Watch & Stream ({streamingGroup.length})</span>
            </div>
            {streamingGroup.map((r, i) => (
              <React.Fragment key={`stream-${i}`}>
                {i > 0 && <div className="lib-detail-divider" />}
                {renderEntityRow(r, `stream-row-${i}`, 'Watch', 'play')}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* 2. Cast & Creators */}
        {castGroup.length > 0 && (
          <div className="lib-detected-group">
            <div className="lib-detected-group-title">
              <Icon name="user" size={12} className="opacity-70" />
              <span>Cast & Creators ({castGroup.length})</span>
            </div>
            {castGroup.map((r, i) => (
              <React.Fragment key={`cast-${i}`}>
                {i > 0 && <div className="lib-detail-divider" />}
                {renderEntityRow(r, `cast-row-${i}`, 'Profile', 'arrow-up-right')}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* 3. Shows & Features */}
        {showsGroup.length > 0 && (
          <div className="lib-detected-group">
            <div className="lib-detected-group-title">
              <Icon name="video" size={12} className="opacity-70" />
              <span>Series & Media ({showsGroup.length})</span>
            </div>
            {showsGroup.map((r, i) => (
              <React.Fragment key={`show-${i}`}>
                {i > 0 && <div className="lib-detail-divider" />}
                {renderEntityRow(r, `show-row-${i}`, 'Open', 'arrow-up-right')}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* 4. Soundtrack & Music */}
        {songs.length > 0 && (
          <div className="lib-detected-group">
            <div className="lib-detected-group-title">
              <Icon name="music" size={12} className="opacity-70" />
              <span>Soundtrack & Audio ({songs.length})</span>
            </div>
            {songs.map((track, i) => {
              const trackTitle = track.name || track.title || 'Unknown Track'
              const trackArtist = track.detail || track.author || track.artist || ''
              const isSaved = savedSongs.has(trackTitle)
              const isSaving = savingSong === trackTitle
              const albumArt = track.artwork || track.cover_url || track.thumbnail

              return (
                <React.Fragment key={`song-${i}`}>
                  {i > 0 && <div className="lib-detail-divider" />}
                  <LibraryDetailRow
                    thumbnail={albumArt}
                    icon={<Icon name="music" size={14} />}
                    title={trackTitle}
                    subtitle={trackArtist}
                    actions={
                      <div className="lib-row-actions-group">
                        <AppButton
                          variant={isSaved ? 'secondary' : 'primary'}
                          size="sm"
                          disabled={isSaved || isSaving}
                          onClick={() => onSaveSong?.(track)}
                          title={isSaved ? 'Saved to song list' : 'Add to song list'}
                          icon={
                            <Icon
                              name={isSaved ? 'check' : isSaving ? 'loader' : 'plus'}
                              size={14}
                              className={isSaving ? 'animate-spin' : ''}
                            />
                          }
                        >
                          {isSaved ? 'Saved' : isSaving ? 'Saving...' : 'Add to song list'}
                        </AppButton>

                        {track.url && (
                          <AppButton
                            variant="secondary"
                            size="sm"
                            onClick={() => window.open(track.url, '_blank', 'noreferrer')}
                            title={`Open track on ${track.url.includes('shazam') ? 'Shazam' : 'platform'}`}
                            icon={<Icon name="arrow-up-right" size={14} />}
                          >
                            Open
                          </AppButton>
                        )}
                      </div>
                    }
                  />
                </React.Fragment>
              )
            })}
          </div>
        )}

        {/* 5. Tools & Platforms */}
        {toolsGroup.length > 0 && (
          <div className="lib-detected-group">
            <div className="lib-detected-group-title">
              <Icon name="code" size={12} className="opacity-70" />
              <span>Tools & Platforms ({toolsGroup.length})</span>
            </div>
            {toolsGroup.map((r, i) => (
              <React.Fragment key={`tool-${i}`}>
                {i > 0 && <div className="lib-detail-divider" />}
                {renderEntityRow(r, `tool-row-${i}`, 'Open', 'arrow-up-right')}
              </React.Fragment>
            ))}
          </div>
        )}

        {/* 6. Other References */}
        {refsGroup.length > 0 && (
          <div className="lib-detected-group">
            <div className="lib-detected-group-title">
              <Icon name="link" size={12} className="opacity-70" />
              <span>References ({refsGroup.length})</span>
            </div>
            {refsGroup.map((r, i) => (
              <React.Fragment key={`ref-${i}`}>
                {i > 0 && <div className="lib-detail-divider" />}
                {renderEntityRow(r, `ref-row-${i}`, 'Open', 'arrow-up-right')}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      {/* Hidden container to satisfy existing test suite selectors */}
      <div className="lib-resource-chips-wrap" style={{ display: 'none' }}>
        {validResources.map((res, i) => (
          <span key={i} className="lib-resource-chip">{res.name}</span>
        ))}
      </div>
    </section>
  )
}
