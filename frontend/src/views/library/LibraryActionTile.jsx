import Icon from '../../components/Icon.jsx'

export default function LibraryActionTile({ onAction }) {
  return (
    <div className="lib-action-tile" role="region" aria-label="Quick capture shortcuts">
      <div className="lib-action-tile-core">
        {/* Action 1: Add a URL */}
        <button
          type="button"
          className="lib-action-tile-row"
          onClick={() => onAction?.('url')}
        >
          <div className="lib-action-tile-icon">
            <Icon name="link" size={16} />
          </div>
          <div className="lib-action-tile-text">
            <div className="lib-action-tile-title">Add a URL</div>
            <div className="lib-action-tile-sub">Articles, videos, podcasts & social</div>
          </div>
        </button>

        {/* Action 2: Upload or drop anywhere */}
        <button
          type="button"
          className="lib-action-tile-row"
          onClick={() => onAction?.('file')}
        >
          <div className="lib-action-tile-icon">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
          </div>
          <div className="lib-action-tile-text">
            <div className="lib-action-tile-title">Upload or drop anywhere</div>
            <div className="lib-action-tile-sub">PDF, images, .md & .txt</div>
          </div>
        </button>

        {/* Action 3: Note */}
        <button
          type="button"
          className="lib-action-tile-row"
          onClick={() => onAction?.('note')}
        >
          <div className="lib-action-tile-icon">
            <Icon name="edit" size={16} />
          </div>
          <div className="lib-action-tile-text">
            <div className="lib-action-tile-title">Note</div>
            <div className="lib-action-tile-sub">Write your own note</div>
          </div>
        </button>

        {/* Action 4: Wikipedia */}
        <button
          type="button"
          className="lib-action-tile-row"
          onClick={() => onAction?.('wiki')}
        >
          <div className="lib-action-tile-icon">
            <Icon name="globe" size={16} />
          </div>
          <div className="lib-action-tile-text">
            <div className="lib-action-tile-title">Wikipedia</div>
            <div className="lib-action-tile-sub">Add any topic</div>
          </div>
        </button>
      </div>
    </div>
  )
}
