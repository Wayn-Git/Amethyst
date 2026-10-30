// Runs before the application bundle or native storage is ready.
export async function startApplication(load, { timeout = 15000 } = {}) {
  const root = document.getElementById('root')
  const show = (message) => {
    if (!root.querySelector('[data-startup]')) return
    root.replaceChildren()
    const panel = document.createElement('section')
    panel.dataset.startup = 'error'
    panel.setAttribute('role', 'alert')
    const title = document.createElement('h1'); title.textContent = 'Amethyst could not start'
    const detail = document.createElement('p'); detail.textContent = message
    const retry = document.createElement('button'); retry.textContent = 'Try again'
    retry.onclick = () => window.location.reload()
    panel.append(title, detail, retry); root.append(panel)
  }
  const timer = setTimeout(() => show('Startup is taking longer than expected. Unlock your phone, then try again.'), timeout)
  try {
    const module = await load()
    await module.appReady
  } catch (error) {
    show(error?.message || 'The application could not be loaded. Please try again.')
  } finally { clearTimeout(timer) }
}
