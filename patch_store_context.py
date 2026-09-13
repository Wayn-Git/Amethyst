import re
with open("frontend/src/store.jsx", "r") as f:
    code = f.read()

target1 = "theme, setTheme,"
replacement1 = "theme, setTheme,\n    accentColor, setAccentColor,"

# Replace all occurrences just to be sure (both in the object and the dependency array)
code = code.replace(target1, replacement1)

with open("frontend/src/store.jsx", "w") as f:
    f.write(code)

print("store.jsx context patched")
