import re
with open("frontend/src/components/Settings.jsx", "r") as f:
    code = f.read()

# Add import
if "HexColorPicker" not in code:
    code = code.replace("import Switch from './ui/Switch.jsx'", "import Switch from './ui/Switch.jsx'\nimport { HexColorPicker } from 'react-colorful'")

# We replace the whole custom accent color block with a more expansive one.
old_block_regex = r'<div className="set-row" style={{ marginTop: \'24px\', alignItems: \'flex-start\' }}>.*?Save Color\n                </button>\n              \)}\n            </div>\n          </div>\n        </div>'

new_block = """        <div className="set-row" style={{ marginTop: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500 }}>Custom Accent Color</span>
            <span style={{ fontSize: '13px', color: 'var(--text-faint)', marginTop: '2px', maxWidth: '300px' }}>
              Pick a hex color from the palette to override the default buttons and highlights.
            </span>
            <div style={{ marginTop: '16px' }}>
              <HexColorPicker 
                color={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')} 
                onChange={setColorDraft} 
                style={{ width: '200px', height: '150px' }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-start', minWidth: '150px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', color: 'var(--text-dim)' }}>HEX</span>
              <input
                type="text"
                value={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')}
                onChange={(e) => setColorDraft(e.target.value)}
                style={{ width: '90px', padding: '6px 8px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--surface)', color: 'var(--text)' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
              {(accentColor || colorDraft) && (
                <button 
                  type="button" 
                  className="btn btn--outline" 
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => { setColorDraft(null); setAccentColor(''); }}
                >
                  Reset
                </button>
              )}
              {colorDraft !== null && colorDraft !== accentColor && (
                <button 
                  type="button" 
                  className="btn btn--primary" 
                  style={{ padding: '6px 12px', fontSize: '12px' }}
                  onClick={() => { setAccentColor(colorDraft); setColorDraft(null); }}
                >
                  Save Color
                </button>
              )}
            </div>
          </div>
        </div>"""

code = re.sub(old_block_regex, new_block, code, flags=re.DOTALL)

with open("frontend/src/components/Settings.jsx", "w") as f:
    f.write(code)

print("Settings.jsx patched with react-colorful")
