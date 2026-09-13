import re
with open("frontend/src/components/Settings.jsx", "r") as f:
    code = f.read()

# We want to intercept the onChange of the text input to ensure it adds a # if missing, 
# or just let them type but format it when passing to HexColorPicker.
# It's better to just ensure the text input adds `#` automatically.

target_input = """<input
                type="text"
                value={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')}
                onChange={(e) => setColorDraft(e.target.value)}
                style={{ width: '90px', padding: '6px 8px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--surface)', color: 'var(--text)' }}
              />"""

replacement_input = """<input
                type="text"
                value={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')}
                onChange={(e) => {
                  let val = e.target.value;
                  if (val && !val.startsWith('#')) val = '#' + val;
                  setColorDraft(val);
                }}
                style={{ width: '90px', padding: '6px 8px', fontSize: '13px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--hairline)', background: 'var(--surface)', color: 'var(--text)' }}
              />"""

code = code.replace(target_input, replacement_input)

# Also ensure HexColorPicker receives a valid hex.
target_picker = """<HexColorPicker 
                color={colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')} 
                onChange={setColorDraft} 
                style={{ width: '200px', height: '150px' }}
              />"""

replacement_picker = """<HexColorPicker 
                color={(colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')).startsWith('#') ? (colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5')) : '#' + (colorDraft ?? accentColor ?? (theme === 'dark' ? '#855bfb' : '#7132f5'))} 
                onChange={setColorDraft} 
                style={{ width: '200px', height: '150px' }}
              />"""

code = code.replace(target_picker, replacement_picker)

with open("frontend/src/components/Settings.jsx", "w") as f:
    f.write(code)

print("Settings.jsx text input patched")
