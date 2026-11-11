import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
const archivePath = process.argv[2] || 'public/dictionary/en-ko-source.zip';
const archive = await readFile(archivePath);
const files = unzipSync(archive);
const find = suffix => {
  const key = Object.keys(files).find(k => k.endsWith(suffix));
  if (!key) throw new Error('Missing StarDict file: ' + suffix);
  return Buffer.from(files[key]);
};
const ifo = find('.ifo').toString('utf8');
if (!ifo.includes('sametypesequence=h')) throw new Error('Only HTML StarDict data is supported');
const data = gunzipSync(find('.dict.dz'));
const index = find('.idx');
const entries = [];
const lookup = Object.create(null);
const append = (word, id) => {
  const key = word.normalize('NFKC').toLowerCase();
  const ids = lookup[key] ??= [];
  if (!ids.includes(id)) ids.push(id);
};
let cursor = 0;
while (cursor < index.length) {
  const end = index.indexOf(0, cursor);
  if (end < 0 || end + 9 > index.length) throw new Error('Invalid index');
  const word = index.toString('utf8', cursor, end);
  const offset = index.readUInt32BE(end + 1);
  const length = index.readUInt32BE(end + 5);
  if (offset + length > data.length) throw new Error('Invalid dictionary range');
  entries.push([word, data.toString('utf8', offset, offset + length)]);
  append(word, entries.length - 1);
  cursor = end + 9;
}
const synonyms = find('.syn');
cursor = 0;
let forms = 0;
while (cursor < synonyms.length) {
  const end = synonyms.indexOf(0, cursor);
  if (end < 0 || end + 5 > synonyms.length) throw new Error('Invalid synonym index');
  const word = synonyms.toString('utf8', cursor, end);
  const id = synonyms.readUInt32BE(end + 1);
  if (!entries[id]) throw new Error('Invalid synonym target');
  append(word, id);
  forms++;
  cursor = end + 5;
}
const metadata = {
  name: 'KOReader Dicts · English → Korean',
  source: 'https://danielgregorini.github.io/koreader-dicts/en/en-ko/',
  download: 'https://github.com/DanielGregorini/koreader-dicts/releases/latest/download/en-ko.zip',
  version: ifo.match(/^date=(.+)$/m)?.[1],
  sha256: createHash('sha256').update(archive).digest('hex'),
  license: 'CC-BY-SA-4.0',
  licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  changes: 'StarDict HTML entries and synonym links converted to indexed JSON; original definitions unchanged.',
  entries: entries.length, synonymLinks: forms
};
await mkdir('public/dictionary', { recursive: true });
await writeFile('public/dictionary/en-ko.json', JSON.stringify({ metadata, entries, lookup }));
await writeFile('public/dictionary/metadata.json', JSON.stringify(metadata, null, 2));
for (const name of ['ATTRIBUTION', 'LICENSE', 'README.txt']) await writeFile('public/dictionary/' + name, find('/' + name));
if (archivePath.replaceAll('\\\\', '/') !== 'public/dictionary/en-ko-source.zip') await copyFile(archivePath, 'public/dictionary/en-ko-source.zip');
console.log(JSON.stringify(metadata, null, 2));
