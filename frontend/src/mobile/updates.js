export function newerUpdate(release, installedBuild) {
  if (!release || !Number.isSafeInteger(release.version_code) || release.version_code < 1
    || typeof release.version !== 'string' || !release.version.trim()
    || !/^[0-9a-f]{64}$/.test(release.sha256 || '')
    || !Number.isSafeInteger(release.size) || release.size < 1 || release.size > 100 * 1024 * 1024) {
    throw new Error('The desktop returned invalid update information.')
  }
  const current = Number(installedBuild)
  if (!Number.isSafeInteger(current) || current < 1) throw new Error('Could not read the installed app version.')
  return release.version_code > current
}
