const fs = require('fs');
const file = '/home/wayne/Documents/GitHub/pkos/frontend/src/index.css';
let css = fs.readFileSync(file, 'utf8');

css = css.replace(/border: 1.5px solid #d9532f;/g, "border: 1px solid var(--accent);");
css = css.replace(/box-shadow: 0 0 0 3px rgb\(217 83 47 \/ 0.12\);/g, "box-shadow: 0 0 0 3px var(--focus-ring);");
css = css.replace(/color: #d9532f;/g, "color: var(--accent);");
css = css.replace(/color: #ea5e36;/g, "color: var(--accent-hover);");
css = css.replace(/background: #ea5e36 !important;/g, "background: var(--accent-hover) !important;");
css = css.replace(/background: #d9532f !important;/g, "background: var(--accent) !important;");
css = css.replace(/border: 1px solid #d9532f !important;/g, "border: 1px solid var(--accent) !important;");
css = css.replace(/box-shadow: 0 4px 12px -2px rgb\(217 83 47 \/ 0.45\);/g, "box-shadow: var(--lift);");
css = css.replace(/box-shadow: 0 6px 16px -2px rgb\(217 83 47 \/ 0.6\);/g, "box-shadow: var(--lift);");
css = css.replace(/box-shadow: 0 4px 14px -3px rgb\(217 83 47 \/ 0.5\);/g, "box-shadow: var(--lift);");
css = css.replace(/box-shadow: 0 6px 20px -3px rgb\(217 83 47 \/ 0.65\);/g, "box-shadow: var(--lift);");
css = css.replace(/color: #ffffff !important;/g, "color: var(--on-accent) !important;");

fs.writeFileSync(file, css);
