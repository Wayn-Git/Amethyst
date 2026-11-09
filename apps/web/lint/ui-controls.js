export default {
  meta: { name: 'amethyst-ui' },
  rules: {
    'no-raw-controls': {
      meta: { type: 'suggestion', schema: [], messages: { primitive: 'Use the shared {{name}} control primitive instead of raw <{{name}}>.' } },
      create(context) {
        return { JSXOpeningElement(node) {
          if (node.name.type === 'JSXIdentifier' && ['button', 'input', 'select', 'textarea'].includes(node.name.name)) {
            context.report({ node, messageId: 'primitive', data: { name: node.name.name } })
          }
        } }
      },
    },
  },
}
