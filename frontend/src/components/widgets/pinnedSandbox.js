// Scripted frames can navigate themselves despite connect-src; Home pins are inert snapshots.
export const PIN_CSP = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"

export function pinnedHtml(html) {
  const template = document.createElement('template')
  template.innerHTML = html
  const tags = new Set('div span p pre code h1 h2 h3 h4 h5 h6 ul ol li dl dt dd section article header footer main aside strong em b i u s small sub sup br hr blockquote table thead tbody tfoot tr th td caption colgroup col label input select option textarea button progress meter details summary svg g path circle ellipse rect line polyline polygon text tspan defs lineargradient radialgradient stop clippath'.split(' '))
  const attributes = new Set('class style title role aria-label aria-hidden colspan rowspan open value min max step type checked selected disabled width height viewbox d cx cy r rx ry x y x1 y1 x2 y2 points fill stroke stroke-width transform offset stop-color opacity id'.split(' '))
  function clean(parent) {
    for (const node of [...parent.children]) {
      if (!tags.has(node.localName.toLowerCase())) { node.remove(); continue }
      for (const attr of [...node.attributes]) {
        if (!attributes.has(attr.name.toLowerCase())) node.removeAttribute(attr.name)
      }
      if (node.matches('input,select,textarea,button')) node.setAttribute('disabled', '')
      clean(node)
    }
  }
  clean(template.content)
  return template.innerHTML
}
