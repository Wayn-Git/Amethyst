import re
with open("frontend/src/components/Settings.jsx", "r") as f:
    code = f.read()

# 1. Update useApp() extraction
if "accentColor, setAccentColor" not in code:
    code = code.replace("theme, setTheme } = useApp()", "theme, setTheme, accentColor, setAccentColor } = useApp()")

# 2. Add the custom color picker right after </button>\n          ))}\n        </div>
color_picker_jsx = """
        <div className="set-row" style={{ marginTop: '24px', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500 }}>Custom Accent Color</span>
            <span style={{ fontSize: '13px', color: 'var(--text-faint)', marginTop: '2px' }}>
              Overrides the default purple for buttons and highlights.
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {accentColor && (
              <button 
                type="button" 
                className="btn btn--outline" 
                style={{ padding: '6px 12px', fontSize: '12px' }}
                onClick={() => setAccentColor('')}
              >
                Reset
              </button>
            )}
            <input 
              type="color" 
              value={accentColor || (theme === 'dark' ? '#855bfb' : '#7132f5')} 
              onChange={(e) => setAccentColor(e.target.value)}
              style={{ width: '32px', height: '32px', padding: 0, border: 'none', borderRadius: '50%', cursor: 'pointer', background: 'transparent', overflow: 'hidden' }}
              title="Pick an accent color"
            />
          </div>
        </div>
"""

# Find the exact insertion point (after the theme-picker div)
target = """          ))}
        </div>"""

if "Custom Accent Color" not in code:
    code = code.replace(target, target + "\n" + color_picker_jsx)

with open("frontend/src/components/Settings.jsx", "w") as f:
    f.write(code)

print("Settings.jsx patched")
