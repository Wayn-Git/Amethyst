import re
with open("frontend/src/components/Settings.jsx", "r") as f:
    code = f.read()

# Replace `??` with `||` in the color fallback chains
code = code.replace("colorDraft ?? accentColor ??", "colorDraft || accentColor ||")

with open("frontend/src/components/Settings.jsx", "w") as f:
    f.write(code)

print("Settings.jsx fallback patched")
