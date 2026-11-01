import fs from 'node:fs';
import path from 'node:path';

async function generateWidget(promptFilePath, widgetId, size) {
  const prompt = fs.readFileSync(promptFilePath, 'utf8');
  console.log(`Generating widget ${widgetId} (${size}) from ${promptFilePath}...`);

  const response = await fetch('https://widgets.gan.dev/api/author-widget', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Amethyst-Widget-Generator/1.0'
    },
    body: JSON.stringify({
      prompt: prompt,
      referenceImages: []
    })
  });

  if (!response.ok) {
    throw new Error(`API returned ${response.status}: ${await response.text()}`);
  }

  const result = await response.json();
  const { template, data, theme, designSpec, stages } = result;

  console.log(`Generation complete for ${widgetId}!`);
  console.log('DesignSpec:', designSpec);

  // Check production rules:
  const brokenRules = [];
  if (template.includes('#') || template.match(/#[0-9a-fA-F]{3,8}/)) {
    brokenRules.push('Hex color detected');
  }
  if (template.includes('linear-gradient') || template.includes('radial-gradient')) {
    brokenRules.push('Gradient detected');
  }
  if (template.includes('RunInterval') || template.includes('updateState') || template.includes('patchState')) {
    brokenRules.push('Simulated state or interval detected');
  }
  if (template.toLowerCase().includes('demo') || template.toLowerCase().includes('preview') || template.toLowerCase().includes('sample')) {
    brokenRules.push('Demo/preview/sample text detected');
  }

  if (brokenRules.length > 0) {
    console.warn('Production rules warnings:', brokenRules);
  }

  // Save artifacts
  const outDir = path.resolve('widgets', widgetId);
  fs.mkdirSync(outDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'template.txt'), template, 'utf8');
  fs.writeFileSync(path.join(outDir, 'data.fixture.json'), JSON.stringify(data, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'meta.json'), JSON.stringify({
    widgetId,
    size,
    designSpec,
    theme,
    stages,
    generatedAt: new Date().toISOString(),
    promptFile: promptFilePath,
    brokenRules
  }, null, 2), 'utf8');

  console.log(`Saved artifacts to ${outDir}`);
  return { template, data, designSpec, theme, brokenRules };
}

// CLI usage: node scripts/generate-widget.mjs <promptFile> <widgetId> <size>
const [,, promptFile, widgetId, size] = process.argv;
if (promptFile && widgetId && size) {
  generateWidget(promptFile, widgetId, size).catch(err => {
    console.error('Generation failed:', err);
    process.exit(1);
  });
}

export { generateWidget };
