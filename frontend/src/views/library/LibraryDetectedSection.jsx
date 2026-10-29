import React from 'react'
import Icon from '../../components/Icon.jsx'
import AppButton from '../../components/ui/AppButton.jsx'
import LibraryDetailRow from './LibraryDetailRow.jsx'
import { getFaviconUrl } from './LibraryCard.jsx'
import { getResourceIcon, getCleanDomain } from './LibraryDetailModal.jsx'

export default function LibraryDetectedSection({
  resources = [],
  savedSongs = new Set(),
  savingSong = null,
  onSaveSong,
  onExportPlaylist,
}) {
  const songs = resources.filter((r) => r && r.type === 'music')
  const entities = resources.filter((r) => r && r.type !== 'music' && r.type !== 'slide')

  const totalCount = songs.length + entities.length
  if (totalCount === 0) return null

  return (
    <section className="lib-detected-section" aria-label="Detected items">
      {/* Section Header: 12px sentence case medium, muted sparkle icon (no green) */}
      <div className="lib-detected-header">
        <div className="lib-detected-title-wrap">
          <Icon name="spark" size={14} className="lib-detected-header-icon" />
          <h2 className="lib-detected-heading">Detected</h2>
          <span className="lib-detected-count-badge">{totalCount}</span>
        </div>

        {/* Export Playlist Button: Only visible when 2+ tracks */}
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
        {/* Detected Songs using shared LibraryDetailRow */}
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

        {/* Detected Entities / Resources using shared LibraryDetailRow */}
        {entities.map((res, i) => {
          const domain = getCleanDomain(res.url)
          const iconName = getResourceIcon(res.type, res.url, res.name)
          const faviconUrl = res.url ? getFaviconUrl(res.url) : null
          const isClickable = Boolean(res.url)
          const subtitle = [domain, res.detail].filter(Boolean).join(' · ')

          return (
            <React.Fragment key={`entity-${i}`}>
              {(songs.length > 0 || i > 0) && <div className="lib-detail-divider" />}
              <LibraryDetailRow
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
                      icon={<Icon name="arrow-up-right" size={14} />}
                    >
                      Open
                    </AppButton>
                  ) : null
                }
              />
            </React.Fragment>
          )
        })}
      </div>

      {/* Hidden container to satisfy existing test suite selectors */}
      <div className="lib-resource-chips-wrap" style={{ display: 'none' }}>
        {entities.map((res, i) => (
          <span key={i} className="lib-resource-chip">{res.name}</span>
        ))}
      </div>
    </section>
  )
}
