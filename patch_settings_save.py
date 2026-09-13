import re
with open("frontend/src/components/Settings.jsx", "r") as f:
    code = f.read()

# I will add a local state for the color draft.
# First, I need to add `useState` if not imported (it is imported).
# I'll replace the existing Custom Accent Color section with one that uses a local draft state and a Save button.

# Let's find the General component definition.
target_general = """function General() {"""
replacement_general = """function General() {
  const [colorDraft, setColorDraft] = useState(null)"""

if "colorDraft" not in code:
    code = code.replace(target_general, replacement_general)

# Now, let's replace the Custom Accent Color block.
old_block = """        <div className="set-row" style={{ marginTop: '24px', alignItems: 'center' }}>
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
        </div>"""

new_block = """        <div className="set-row" style={{ marginTop: '24px', alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontWeight: 500 }}>Custom Accent Color</span>
            <span style={{ fontSize: '13px', color: 'var(--text-faint)', marginTop: '2px', maxWidth: '300px' }}>
              Overrides the default purple. Pick a color or enter a hex code.
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input 
                type="color" 
                value={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')} 
                onChange={(e) => setColorDraft(e.target.value)}
                style={{ width: '32px', height: '32px', padding: 0, border: 'none', cursor: 'pointer', background: 'transparent' }}
                title="Pick an accent color"
              />
              <input
                type="text"
                value={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')}
                onChange={(e) => setColorDraft(e.target.value)}
                style={{ width: '90px', padding: '6px 8px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--surface)', color: 'var(--text)' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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

if "colorDraft" not in code or "Save Color" not in code:
    code = code.replace(old_block, new_block)

with open("frontend/src/components/Settings.jsx", "w") as f:
    f.write(code)

print("Settings.jsx patched for explicit save")
