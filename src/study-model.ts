export type StudyKind = 'word' | 'sentence';
export type StudyEntry = {
  id: string;
  kind: StudyKind;
  text: string;
  english: string;
  korean: string;
  example: string;
  note: string;
  source: string;
  page: number;
  learned: boolean;
  createdAt: number;
  updatedAt: number;
};
export type StudyDraft = Pick<StudyEntry, 'kind' | 'text' | 'english' | 'korean' | 'example' | 'note' | 'source' | 'page'>;
export const textLimits = { text: 4000, english: 4000, korean: 4000, example: 4000, note: 4000, source: 500 } as const;
export function validEntry(value: unknown): value is StudyEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as StudyEntry;
  return typeof e.id === 'string' && /^[\w-]{1,100}$/.test(e.id)
    && Object.keys(e).every(key => ['id', 'kind', 'text', 'english', 'korean', 'example', 'note', 'source', 'page', 'learned', 'createdAt', 'updatedAt'].includes(key))
    && ['word', 'sentence'].includes(e.kind)
    && Object.entries(textLimits).every(([key, limit]) => typeof e[key as keyof StudyEntry] === 'string' && (e[key as keyof StudyEntry] as string).length <= limit)
    && e.text.trim().length > 0 && typeof e.learned === 'boolean'
    && Number.isInteger(e.page) && e.page >= 0 && e.page <= 1000000
    && Number.isFinite(e.createdAt) && Number.isFinite(e.updatedAt);
}
export function readBackup(raw: string): StudyEntry[] {
  const data = JSON.parse(raw);
  if (data?.format !== 'leaf-study' || data.version !== 1 || !Array.isArray(data.entries)
    || data.entries.length > 10000 || !data.entries.every(validEntry)) throw new Error('Leaf 학습 기록 백업 파일을 선택해 주세요. 한 번에 최대 10,000개를 가져올 수 있어요.');
  return [...new Map<string, StudyEntry>(data.entries.map((e: StudyEntry) => [e.id, e])).values()];
}
export function emptyDraft(kind: StudyKind): StudyDraft {
  return { kind, text: '', english: '', korean: '', example: '', note: '', source: '', page: 0 };
}
