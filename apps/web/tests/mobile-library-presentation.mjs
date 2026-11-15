import assert from 'node:assert/strict'
import { getLibraryDetailScreen } from '../src/mobile/views/libraryPresentation.js'
import { parseRecipe } from '../src/mobile/views/recipeParser.js'

assert.equal(getLibraryDetailScreen({ kind: 'video', category: 'movie' }), 'movie')
assert.equal(getLibraryDetailScreen({ kind: 'article' }, [{ type: 'recipe', name: 'Soup' }]), 'recipe')
assert.equal(getLibraryDetailScreen({ kind: 'video' }, [{ type: 'book' }]), 'book')
assert.equal(getLibraryDetailScreen({ kind: 'note' }), 'note')
assert.equal(getLibraryDetailScreen({ kind: 'reel', is_reel: true }), 'video')
assert.equal(getLibraryDetailScreen({ kind: 'unsupported' }), 'article')
assert.equal(getLibraryDetailScreen({ kind: 'article', category: 'food' }), 'recipe')
assert.equal(getLibraryDetailScreen({ kind: 'article', category: 'food', entity: { attributes: { Cuisine: 'Thai' } } }), 'place')
assert.deepEqual(parseRecipe('## Ingredients\n- 2 cloves garlic\n\n### Preparation:\n1. Chop garlic\n2. Cook it\n## Notes\nServe warm'), {
  ingredients: ['2 cloves garlic'],
  steps: ['Chop garlic', 'Cook it'],
})
