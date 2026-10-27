import { Button as HouseButton } from '../components/ui/bento/index.jsx'
import React, { useState, useEffect } from 'react';
import '../styles/install.css';

// Platform SVG Icons
function AppleIcon() {
  return (
    <svg className="install-card-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.06 1.72-.93 2.74 1.01.08 2.03-.5 2.64-1.24z" />
    </svg>
  );
}

function WindowsIcon() {
  return (
    <svg className="install-card-icon" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5.44l7.13-1 .01 6.86H3V5.44zm0 13.12l7.14 1 .01-6.86H3v6.86zm8.13 1.15l9.87 1.4V11.3h-9.87v8.41zm0-15.42v8.31h9.87V2.89L11.13 4.29z" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg className="install-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4 17 10 11 4 5"></polyline>
      <line x1="12" y1="19" x2="20" y2="19"></line>
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg className="install-card-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="2" width="14" height="20" rx="3" ry="3"></rect>
      <line x1="12" y1="18" x2="12.01" y2="18"></line>
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  );
}

export default function Install() {
  const [copiedMac, setCopiedMac] = useState(false);
  const [copiedWin, setCopiedWin] = useState(false);
  const [copiedLinux, setCopiedLinux] = useState(false);
  const [releaseTag, setReleaseTag] = useState('v0.1.0');
  const [downloadUrls, setDownloadUrls] = useState({
    mac: 'https://github.com/wayn-wayn/amethyst/releases',
    windows: 'https://github.com/wayn-wayn/amethyst/releases',
    linux: 'https://github.com/wayn-wayn/amethyst/releases',
  });

  useEffect(() => {
    fetch('https://api.github.com/repos/wayn-wayn/amethyst/releases/latest')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setReleaseTag(data.tag_name || 'v0.1.0');
        const assets = data.assets || [];
        const macAsset = assets.find((a) => a.name.endsWith('.dmg'));
        const winAsset = assets.find((a) => a.name.endsWith('.exe'));
        const linuxAsset = assets.find((a) => a.name.endsWith('.AppImage') || a.name.endsWith('.deb'));

        setDownloadUrls({
          mac: macAsset ? macAsset.browser_download_url : data.html_url,
          windows: winAsset ? winAsset.browser_download_url : data.html_url,
          linux: linuxAsset ? linuxAsset.browser_download_url : data.html_url,
        });
      })
      .catch(() => {});
  }, []);

  const copyToClipboard = (text, setCopied) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="install-container">
      <div className="install-header">
        <div className="install-tag">INSTALL</div>
        <h1 className="install-title">Install once.</h1>
        <p className="install-desc">
          Put Amethyst on the computer your agents run on, then pair your phone from it.
        </p>
      </div>

      <div className="install-grid">
        {/* Mac Card */}
        <div className="install-card">
          <div>
            <AppleIcon />
            <div className="install-card-title">Mac</div>
            <div className="install-card-body">
              Open Amethyst and it starts the host itself. Or install with Homebrew:
            </div>
            <div
              className="install-code-box"
              onClick={() => copyToClipboard('brew install --cask amethyst', setCopiedMac)}
              title="Click to copy"
            >
              <span className="install-code-text">brew install --cask amethyst</span>
              <HouseButton type="button" className="install-copy-btn">
                {copiedMac ? <CheckIcon /> : <CopyIcon />}
              </HouseButton>
            </div>
          </div>
          <a href={downloadUrls.mac} className="install-action-btn" target="_blank" rel="noreferrer">
            <AppleIcon />
            <span>Download for Mac</span>
          </a>
        </div>

        {/* Windows Card */}
        <div className="install-card">
          <div>
            <WindowsIcon />
            <div className="install-card-title">Windows</div>
            <div className="install-card-body">
              Run the Installer and Amethyst starts the host itself. Or install in PowerShell:
            </div>
            <div
              className="install-code-box"
              onClick={() => copyToClipboard('irm https://raw.githubusercontent.com/wayn-wayn/amethyst/master/install.ps1 | iex', setCopiedWin)}
              title="Click to copy PowerShell command"
            >
              <span className="install-code-text">irm https://raw.github.../install.ps1 | iex</span>
              <HouseButton type="button" className="install-copy-btn">
                {copiedWin ? <CheckIcon /> : <CopyIcon />}
              </HouseButton>
            </div>
          </div>
          <a href={downloadUrls.windows} className="install-action-btn" target="_blank" rel="noreferrer">
            <WindowsIcon />
            <span>Download for PC</span>
          </a>
        </div>

        {/* Linux and servers Card */}
        <div className="install-card">
          <div>
            <TerminalIcon />
            <div className="install-card-title">Linux and servers</div>
            <div className="install-card-body">
              The host, plus the desktop app when there is a display. Then run amethyst-host install:
            </div>
            <div
              className="install-code-box"
              onClick={() => copyToClipboard('curl -fsSL https://raw.githubusercontent.com/wayn-wayn/amethyst/master/install.sh | bash', setCopiedLinux)}
              title="Click to copy curl command"
            >
              <span className="install-code-text">curl -fsSL https://raw.github.../install.sh | bash</span>
              <HouseButton type="button" className="install-copy-btn">
                {copiedLinux ? <CheckIcon /> : <CopyIcon />}
              </HouseButton>
            </div>
          </div>
          <a href={downloadUrls.linux} className="install-action-btn" target="_blank" rel="noreferrer">
            <TerminalIcon />
            <span>Download .AppImage</span>
          </a>
        </div>

        {/* iPhone Card */}
        <div className="install-card">
          <div>
            <PhoneIcon />
            <div className="install-card-title">iPhone</div>
            <div className="install-card-body">
              Get the app, then scan the code from Pair iPhone... In the Mac menu bar, the Windows or Linux app, or amethyst-host pair.
            </div>
          </div>
          <a
            href="https://apps.apple.com"
            className="install-action-btn is-dark"
            target="_blank"
            rel="noreferrer"
          >
            <AppleIcon />
            <span>Download on the App Store</span>
          </a>
        </div>
      </div>

      <div className="install-release-tag">
        Current Release: {releaseTag} &bull; Cross-Platform Desktop Edition
      </div>
    </div>
  );
}
