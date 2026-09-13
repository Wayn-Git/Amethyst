import re
with open("frontend/src/store.jsx", "r") as f:
    code = f.read()

# 1. Add applyAccentColor
apply_accent_str = """
function applyAccentColor(hex) {
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
}
applyAccentColor(loadPrefs().accentColor)
"""

if "applyAccentColor" not in code:
    code = code.replace("applyTheme(THEMES.includes(loadPrefs().theme) ? loadPrefs().theme : 'light')", 
                        "applyTheme(THEMES.includes(loadPrefs().theme) ? loadPrefs().theme : 'light')\n" + apply_accent_str)

# 2. Add useState for accentColor
state_str = """
  const [accentColor, setAccentColorRaw] = useState(prefs.accentColor || '')
  const setAccentColor = useCallback((value) => {
    setAccentColorRaw(value)
    applyAccentColor(value)
    savePrefs({ accentColor: value })
  }, [])
"""
if "setAccentColorRaw" not in code:
    code = code.replace("const [theme, setThemeRaw] = useState(", state_str + "\n  const [theme, setThemeRaw] = useState(")

# 3. Add to context
if "accentColor," not in code:
    code = code.replace("theme, setTheme,", "theme, setTheme,\n    accentColor, setAccentColor,")

with open("frontend/src/store.jsx", "w") as f:
    f.write(code)

print("store.jsx patched")
