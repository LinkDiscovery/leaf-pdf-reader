import { emptyDraft, type StudyDraft } from './study-model';

export type ReadingSource = { source: string; page: number; example: string };
export type Sense = { pos: string; text: string; example?: string; detail?: string; headword?: string; local?: boolean };
export type Lookup = { senses: Sense[]; label: string; phonetics?: string[]; sources?: string[]; error?: string };
export type Language = 'english' | 'korean';
export type SearchRecord = {
  id: string; query: string; kind: 'word' | 'sentence'; source: ReadingSource; pos: string;
  english?: Lookup; korean?: Lookup; selectedEnglish?: string[]; selectedKorean?: string[];
};
export type DictionaryHistory = { entries: SearchRecord[]; index: number };
export const historyKey = 'leaf-dictionary-history-v1';
export const posLabels: Record<string, string> = {
  noun: '명사', verb: '동사', adjective: '형용사', adverb: '부사', pronoun: '대명사', preposition: '전치사',
  conjunction: '접속사', interjection: '감탄사', determiner: '한정사', numeral: '수사', suffix: '접미사',
  prefix: '접두사', article: '관사', phrase: '구문', abbreviation: '약어', 'auxiliary verb': '조동사',
};
const aliases: Record<string, string> = { 'n.': 'noun', 'v.': 'verb', 'adj.': 'adjective', 'adv.': 'adverb', 'pron.': 'pronoun', 'prep.': 'preposition', 'conj.': 'conjunction', 'interj.': 'interjection', 'det.': 'determiner', 'num.': 'numeral', 'suf.': 'suffix', 'pref.': 'prefix', 'art.': 'article' };
export function canonicalPos(value: string) {
  const text = value.toLowerCase().trim();
  return aliases[text] || (Object.hasOwn(posLabels, text) ? text : Object.keys(posLabels).find(key => posLabels[key] === text) || '');
}
export const senseKey = (sense: Sense) => JSON.stringify([sense.pos, sense.text]);
export function selection(record: SearchRecord, language: Language) { return (language === 'english' ? record.selectedEnglish : record.selectedKorean) || []; }
export function setSelection(record: SearchRecord, language: Language, keys: string[]) {
  const counts = new Map<string, number>();
  const selected = (record[language]?.senses || []).filter(sense => {
    if (!keys.includes(senseKey(sense))) return false;
    const count = counts.get(sense.pos) || 0; counts.set(sense.pos, count + 1); return count < 3;
  }).map(senseKey);
  if (language === 'english') record.selectedEnglish = selected; else record.selectedKorean = selected;
}
export function visibleSenses(record: SearchRecord, language: Language) { return record[language]?.senses.filter(sense => record.pos === 'all' || sense.pos === record.pos) || []; }
export function initializeSelection(record: SearchRecord, language: Language) {
  if ((language === 'english' ? record.selectedEnglish : record.selectedKorean) === undefined && record[language]) {
    const seen = new Set<string>();
    setSelection(record, language, record[language]!.senses.filter(sense => {
      if (seen.has(sense.pos)) return false; seen.add(sense.pos); return true;
    }).map(senseKey));
  }
}
export function lookupDraft(record: SearchRecord): StudyDraft {
  const picked = (language: Language) => visibleSenses(record, language).filter(sense => selection(record, language).includes(senseKey(sense)));
  const format = (senses: Sense[]) => senses.map(sense => (posLabels[sense.pos] ? `[${posLabels[sense.pos]}] ` : '') + sense.text).join('\n');
  const english = picked('english'), korean = picked('korean');
  return { ...emptyDraft(record.kind), text: record.query, source: record.source.source, page: record.source.page,
    english: record.kind === 'word' ? format(english) : '', korean: record.kind === 'sentence' ? record.korean?.senses[0]?.text || '' : format(korean),
    example: record.kind === 'word' ? record.source.example || english.find(sense => sense.example)?.example || '' : '',
  };
}
export function boundedSenses(senses: Sense[]): Sense[] {
  const unique = new Map<string, Sense>();
  for (const sense of senses) {
    const value = { ...sense, text: sense.text.trim().slice(0, 1200), pos: canonicalPos(sense.pos), example: sense.example?.slice(0, 4000), detail: sense.detail?.slice(0, 2000), headword: sense.headword?.slice(0, 100) };
    if (value.text && !unique.has(senseKey(value))) unique.set(senseKey(value), value);
  }
  // Bound storage while retaining at least some senses for every supplied POS.
  const counts = new Map<string, number>();
  return [...unique.values()].filter(sense => { const count = counts.get(sense.pos) || 0; counts.set(sense.pos, count + 1); return count < 6; }).slice(0, 60);
}
export function addSearch(history: DictionaryHistory, record: SearchRecord) {
  history.entries = history.entries.slice(0, history.index + 1);
  if (history.entries.at(-1)?.query === record.query) history.entries.pop();
  history.entries.push(record); history.entries = history.entries.slice(-3); history.index = history.entries.length - 1;
}
