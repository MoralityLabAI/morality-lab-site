import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const sourceArg = process.argv.slice(2).find(value => !value.startsWith('--'));
const root = path.resolve(sourceArg || '../storyworlds');
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.find(value => value.startsWith('--limit='));
const limit = limitArg ? Number.parseInt(limitArg.slice(8), 10) : Infinity;
const excluded = /(^|[\\/])(generated|benchmarks|runs|archive|vendor|node_modules)([\\/]|$)/i;
const { sql } = dryRun ? { sql: null } : await import('@vercel/postgres');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (excluded.test(path.relative(root, fullPath))) continue;
    if (entry.isDirectory() && !entry.name.startsWith('.')) files.push(...await walk(fullPath));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) files.push(fullPath);
  }
  return files;
}

function textValue(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value.value === 'string') return value.value.trim();
  return '';
}

function words(value) {
  return textValue(value).split(/\s+/).filter(Boolean).length;
}

function catalogRecord(world, absolutePath) {
  const title = textValue(world.title) || textValue(world.storyworld_title) || path.basename(absolutePath, '.json');
  const description = textValue(world.description) || textValue(world.about_text) || `Interactive storyworld: ${title}`;
  const properties = Array.isArray(world.authored_properties) ? world.authored_properties : [];
  const encounters = Array.isArray(world.encounters) ? world.encounters : [];
  const firstText = encounters.find(item => words(item.text_script || item.text || item.description) > 0);
  const estimatedLength = Math.max(200, Math.min(1500, words(firstText?.text_script || firstText?.text || description)));
  const relativePath = path.relative(root, absolutePath).replaceAll(path.sep, '/');
  return {
    title: title.slice(0, 255),
    description,
    num_characters: Math.max(1, Math.min(10, Array.isArray(world.characters) ? world.characters.length : 1)),
    num_themes: Math.max(1, Math.min(5, new Set(properties.map(item => item.property_name).filter(Boolean)).size || 1)),
    num_variables: Math.max(3, Math.min(20, properties.length || 3)),
    encounter_length: estimatedLength,
    custom_prompt: `Imported from GPTStoryworld corpus (${relativePath})`,
    encounter: world,
    system_prompt: null,
    model_used: 'corpus-import',
    source_path: relativePath
  };
}

const files = (await walk(root)).slice(0, limit);
let imported = 0;
let skipped = 0;
for (const file of files) {
  try {
    const world = JSON.parse(await readFile(file, 'utf8'));
    const record = catalogRecord(world, file);
    if (dryRun) {
      console.log(`${record.source_path}\t${record.title}\t${record.num_characters} chars\t${record.num_variables} vars`);
    } else {
      await sql`
        INSERT INTO storyworlds (
          title, description, num_characters, num_themes, num_variables,
          encounter_length, custom_prompt, encounter, system_prompt,
          is_public, model_used, source_path
        ) VALUES (
          ${record.title}, ${record.description}, ${record.num_characters},
          ${record.num_themes}, ${record.num_variables}, ${record.encounter_length},
          ${record.custom_prompt}, ${JSON.stringify(record.encounter)},
          ${record.system_prompt}, true, ${record.model_used}, ${record.source_path}
        )
        ON CONFLICT (source_path) WHERE source_path IS NOT NULL DO UPDATE SET
          title = EXCLUDED.title,
          description = EXCLUDED.description,
          encounter = EXCLUDED.encounter,
          num_characters = EXCLUDED.num_characters,
          num_themes = EXCLUDED.num_themes,
          num_variables = EXCLUDED.num_variables,
          encounter_length = EXCLUDED.encounter_length,
          updated_at = NOW()
      `;
    }
    imported += 1;
  } catch (error) {
    skipped += 1;
    console.error(`SKIP ${path.relative(root, file)}: ${error.message}`);
  }
}

console.log(`${dryRun ? 'Would import' : 'Imported'} ${imported} worlds; skipped ${skipped}; source ${root}`);
