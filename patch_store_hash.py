import re
with open("frontend/src/store.jsx", "r") as f:
    code = f.read()

target = """function applyAccentColor(hex) {
  const root = document.documentElement
  if (!hex) {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--accent-hover')
    root.style.removeProperty('--ember')
    return
  }
  root.style.setProperty('--accent', hex)
  root.style.setProperty('--accent-hover', `color-mix(in srgb, ${hex} 85%, black)`)
  root.style.setProperty('--ember', hex)
}"""

replacement = """function applyAccentColor(hex) {
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

if "validHex" not in code:
    code = code.replace(target, replacement)

with open("frontend/src/store.jsx", "w") as f:
    f.write(code)

print("store.jsx patched for hash check")
