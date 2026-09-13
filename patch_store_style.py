import re
with open("frontend/src/store.jsx", "r") as f:
    code = f.read()

target = """function applyAccentColor(hex) {
  const root = document.documentElement
  if (!hex || typeof hex !== 'string') {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--ember')
    return
  }
  
  // Ensure the hex code starts with a # for valid CSS
  const validHex = hex.startsWith('#') ? hex : '#' + hex;
  
  root.style.setProperty('--accent', validHex)
  root.style.setProperty('--accent-hover', `color-mix(in srgb, ${validHex} 85%, black)`)
  root.style.setProperty('--ember', validHex)
}"""

replacement = """function applyAccentColor(hex) {
  const root = document.documentElement
  let styleTag = document.getElementById('custom-accent-style');
  
  if (!hex || typeof hex !== 'string') {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--ember')
    if (styleTag) styleTag.remove()
    return
  }
  
  const validHex = hex.startsWith('#') ? hex : '#' + hex;
  const hoverHex = `color-mix(in srgb, ${validHex} 85%, black)`;
  
  root.style.setProperty('--accent', validHex)
  root.style.setProperty('--accent-hover', hoverHex)
  root.style.setProperty('--ember', validHex)
  
  // The user explicitly requested this to apply to default buttons as well
  if (!styleTag) {
    styleTag = document.createElement('style')
    styleTag.id = 'custom-accent-style'
    document.head.appendChild(styleTag)
  }
  
  styleTag.innerHTML = `
    .btn {
      background: var(--accent) !important;
      color: var(--on-accent, #ffffff) !important;
      border-color: transparent !important;
    }
    @media (hover: hover) and (pointer: fine) {
      .btn:hover {
        background: var(--accent-hover) !important;
      }
    }
    .btn--outline {
      background: transparent !important;
      color: var(--accent) !important;
      border-color: var(--accent) !important;
    }
    @media (hover: hover) and (pointer: fine) {
      .btn--outline:hover {
        background: color-mix(in srgb, var(--accent) 10%, transparent) !important;
      }
    }
  `
}"""

code = code.replace(target, replacement)

with open("frontend/src/store.jsx", "w") as f:
    f.write(code)

print("store.jsx style injection patched")
