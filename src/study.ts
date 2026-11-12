import layout from './study.html?raw';
import { emptyDraft, readBackup, validEntry, type StudyDraft, type StudyEntry, type StudyKind } from './study-model';
import { localEntries, writeLocal } from './study-local';
import type { CloudState, StudyCloud } from './study-cloud';
import './study.css';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
  const element = document.createElement(tag); element.textContent = text; element.className = className; return element;
}
export function setupStudy(notify: (message: string) => void) {
  const fragment = document.createElement('template'); fragment.innerHTML = layout;
  document.querySelector('.topbar')!.after(fragment.content);
  const workspace = document.querySelector<HTMLElement>('.workspace')!;
  workspace.id = 'reader-panel'; workspace.setAttribute('role', 'tabpanel'); workspace.setAttribute('aria-labelledby', 'tab-reader');
  let cloud: StudyCloud | undefined;
  let remote: CloudState | undefined;
  let entries: StudyEntry[] = [];
  let ready = false;
  let error = '';
  let view: 'reader' | StudyKind = 'reader';
  let limit = 40;
  let editorEntry: StudyEntry | undefined;
  let editorKind: StudyKind = 'word';
  let editorOwner = '';
  let scrollTop = 0;
  let epoch = 0;
  let importing = false;
  const editor = $<HTMLDialogElement>('study-editor');
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('leaf-study-local');
  const owner = () => remote?.user?.uid || 'local';
  function showError(message: string) { error = message; render(); notify(message); }
  async function refreshLocal() {
    const token = epoch;
    try { const local = await localEntries(); if (token === epoch && !remote?.user) { entries = local; ready = true; error = ''; render(); } }
    catch { if (token === epoch) { ready = false; showError('기기에 학습 기록을 저장할 수 없어요. 브라우저 저장소 설정을 확인해 주세요.'); } }
  }
  if (channel) channel.onmessage = () => { if (!remote?.user) void refreshLocal(); };
  function button(text: string, action: () => void, className = 'text-button') {
    const element = node('button', text, className); element.type = 'button'; element.onclick = action; return element;
  }
  function render() {
    const user = remote?.user;
    $('study-sync').textContent = user
      ? `${user.email || user.displayName || '내 계정'} · ${remote?.error ? '동기화 오류' : !remote?.ready ? '기록 불러오는 중…' : remote.pending ? '전송 대기 중' : remote.cached ? '연결 확인 중 · 기기 사본' : '동기화 완료'}`
      : ready ? '이 기기에 저장 · 로그인하면 계정 동기화' : '학습 기록 준비 중…';
    $('study-login').hidden = !cloud || !!user;
    $('study-logout').hidden = !user;
    $<HTMLButtonElement>('study-logout').disabled = !!remote?.pending || importing;
    $<HTMLButtonElement>('study-login').disabled = !ready;
    $('study-migrate').hidden = !user;
    for (const id of ['study-add', 'study-import', 'study-migrate']) $<HTMLButtonElement>(id).disabled = !ready || importing || (!!user && (remote!.pending || remote!.cached) && id !== 'study-add');
    $<HTMLButtonElement>('study-export').disabled = !entries.length;
    $('study-error').hidden = !(error || remote?.error);
    $('study-error').textContent = error || remote?.error || '';
    if (view === 'reader') return;
    const query = $<HTMLInputElement>('study-search').value.toLocaleLowerCase().trim();
    const filter = $<HTMLSelectElement>('study-filter').value;
    const all = entries.filter(entry => entry.kind === view);
    const visible = all.filter(entry => (filter === 'all' || entry.learned === (filter === 'learned'))
      && [entry.text, entry.english, entry.korean, entry.example, entry.note, entry.source].some(text => text.toLocaleLowerCase().includes(query)))
      .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
    $('study-count').textContent = `${visible.length}개 / 전체 ${all.length}개 · 외웠어요 ${all.filter(entry => entry.learned).length}개`;
    $('study-empty').hidden = !ready || visible.length > 0;
    $('study-empty').querySelector('h2')!.textContent = query || filter !== 'all' ? '조건에 맞는 기록이 없어요' : '아직 모아 둔 기록이 없어요';
    $('study-more').hidden = visible.length <= limit;
    const conceal = $<HTMLInputElement>('study-hide').checked;
    const list = $('study-list'); list.replaceChildren();
    for (const entry of visible.slice(0, limit)) {
      const card = node('article', '', 'study-card'); card.dataset.id = entry.id;
      const heading = node('div', '', 'study-card-heading');
      heading.append(node('h2', entry.text));
      if (entry.learned) heading.append(node('span', '외웠어요', 'study-learned'));
      card.append(heading);
      const answer = node('div', '', 'study-answer');
      answer.append(node('p', entry.korean || '한국어 뜻·번역을 추가해 보세요.', 'study-korean'));
      if (entry.english) answer.append(node('p', entry.english, 'study-english'));
      if (entry.example) card.append(node('blockquote', entry.example, 'study-example'));
      if (entry.note) answer.append(node('p', entry.note, 'study-note'));
      if (conceal) {
        const reveal = node('details', '', 'study-reveal'); reveal.append(node('summary', '뜻·번역 확인'), answer); card.append(reveal);
      } else card.append(answer);
      const footer = node('div', '', 'study-card-footer');
      footer.append(node('span', [entry.source, entry.page ? `${entry.page}쪽` : ''].filter(Boolean).join(' · '), 'study-source'));
      const actions = node('div', '', 'study-card-actions');
      actions.append(button(entry.learned ? '다시 학습' : '외웠어요', () => void learned(entry)), button('수정', () => openEditor(entry, entry)), button('삭제', () => void remove(entry), 'text-button danger'));
      for (const action of actions.querySelectorAll('button')) action.disabled = !ready || importing;
      footer.append(actions); card.append(footer); list.append(card);
    }
  }
  function switchView(next: typeof view) {
    if (view === 'reader' && next !== 'reader') scrollTop = $('reader-scroll').scrollTop;
    view = next; limit = 40;
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(tab => {
      const active = tab.dataset.view === next; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
    });
    workspace.hidden = next !== 'reader'; $('study-panel').hidden = next === 'reader';
    $('selection-tools').hidden = true;
    if (next === 'reader') requestAnimationFrame(() => $('reader-scroll').scrollTop = scrollTop);
    else {
      $('study-panel').setAttribute('aria-labelledby', next === 'word' ? 'tab-words' : 'tab-sentences');
      $('study-title').textContent = next === 'word' ? '나의 단어장' : '나의 문장';
      $('study-description').textContent = next === 'word' ? '읽다가 만난 단어를, 내 표현으로 기억하세요.' : '다시 읽고 싶은 문장을 한곳에 모아 보세요.';
    }
    render();
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(tab => {
    tab.onclick = () => switchView(tab.dataset.view as typeof view);
    tab.onkeydown = event => {
      const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-view]')]; const index = tabs.indexOf(tab);
      const next = ({ ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 } as Record<string, number>)[event.key];
      if (next !== undefined) { event.preventDefault(); tabs[next].click(); tabs[next].focus(); }
    };
  });
  function openEditor(draft: StudyDraft, existing?: StudyEntry) {
    if (!ready) { notify('학습 기록을 준비 중이에요. 잠시 후 다시 눌러 주세요.'); return; }
    editorEntry = existing; editorKind = draft.kind; editorOwner = owner();
    $('study-editor-title').textContent = `${draft.kind === 'word' ? '단어' : '문장'} ${existing ? '수정' : '저장'}`;
    $('study-text-label').textContent = draft.kind === 'word' ? '단어' : '영어 문장';
    $('study-korean-label').textContent = draft.kind === 'word' ? '한국어 뜻' : '한국어 번역';
    $('study-word-fields').hidden = draft.kind !== 'word';
    $('study-editor-storage').textContent = remote?.user ? '내 계정에 저장합니다. 연결이 끊기면 전송 대기 상태로 보관해요.' : '현재 브라우저에 저장합니다. 나중에 로그인해서 기기 기록을 가져올 수 있어요.';
    for (const key of ['text', 'english', 'korean', 'example', 'note', 'source', 'page'] as const) $<HTMLInputElement>(`study-${key}`).value = String(draft[key]);
    $('study-form-error').hidden = true;
    $<HTMLButtonElement>('study-submit').disabled = false;
    duplicate(); editor.showModal();
  }
  function duplicate() {
    $('study-duplicate').hidden = !entries.some(entry => entry.kind === editorKind && entry.id !== editorEntry?.id && entry.text.toLocaleLowerCase() === $<HTMLTextAreaElement>('study-text').value.trim().toLocaleLowerCase());
  }
  $('study-text').oninput = duplicate;
  $('study-cancel').onclick = $('study-dismiss').onclick = () => editor.close();
  $('study-add').onclick = () => openEditor(emptyDraft(view === 'sentence' ? 'sentence' : 'word'));
  $<HTMLFormElement>('study-form').onsubmit = async event => {
    event.preventDefault();
    const submit = $<HTMLButtonElement>('study-submit'); submit.disabled = true;
    try {
      if (editorOwner !== owner()) throw new Error('계정이 바뀌었어요. 현재 계정에서 다시 저장해 주세요.');
      const get = (key: string) => $<HTMLInputElement>('study-' + key).value.trim();
      const entry: StudyEntry = { id: editorEntry?.id || crypto.randomUUID(), kind: editorKind, text: get('text'), english: editorKind === 'word' ? get('english') : '', korean: get('korean'), example: editorKind === 'word' ? get('example') : '', note: get('note'), source: get('source'), page: Number(get('page')), learned: editorEntry?.learned || false, createdAt: editorEntry?.createdAt || Date.now(), updatedAt: Date.now() };
      if (!validEntry(entry)) throw new Error('내용과 페이지 번호를 확인해 주세요.');
      if (remote?.user) cloud!.save(entry, !editorEntry);
      else { await writeLocal([entry]); channel?.postMessage('changed'); await refreshLocal(); }
      editor.close(); notify(remote?.user ? '학습 기록을 저장했어요. 동기화 상태를 확인해 주세요.' : '이 기기에 저장했어요.');
    } catch (reason) { $('study-form-error').textContent = reason instanceof Error ? reason.message : '저장하지 못했어요. 내용을 복사해 보관해 주세요.'; $('study-form-error').hidden = false; }
    finally { submit.disabled = false; }
  };
  async function learned(entry: StudyEntry) {
    try {
      if (remote?.user) cloud!.learned(entry);
      else { await writeLocal([{ ...entry, learned: !entry.learned, updatedAt: Date.now() }]); channel?.postMessage('changed'); await refreshLocal(); }
    } catch { showError('복습 상태를 저장하지 못했어요.'); }
  }
  async function remove(entry: StudyEntry) {
    const identity = owner(); const dialog = $<HTMLDialogElement>('study-delete-dialog'); dialog.returnValue = '';
    dialog.showModal();
    await new Promise<void>(resolve => dialog.addEventListener('close', () => resolve(), { once: true }));
    if (dialog.returnValue !== 'delete' || identity !== owner()) return;
    try {
      if (remote?.user) cloud!.remove(entry);
      else { await writeLocal([], entry.id); channel?.postMessage('changed'); await refreshLocal(); }
    } catch { showError('삭제하지 못했어요. 다시 시도해 주세요.'); }
  }
  $('study-search').oninput = $('study-filter').onchange = $('study-hide').onchange = () => { limit = 40; render(); };
  $('study-more').onclick = () => { limit += 40; render(); };
  $('study-export').onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'leaf-study', version: 1, exportedAt: new Date().toISOString(), entries }, null, 2)], { type: 'application/json' }));
    const link = node('a'); link.href = url; link.download = `leaf-study-${new Date().toISOString().slice(0, 10)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  async function importEntries(incoming: StudyEntry[], identity: string) {
    if (identity !== owner()) throw new Error('계정이 바뀌었어요. 가져오기를 다시 눌러 주세요.');
    importing = true; render();
    try {
      let count: number;
      if (remote?.user) count = await cloud!.importMissing(incoming);
      else { const current = await localEntries(); const fresh = incoming.filter(entry => !current.some(item => item.id === entry.id)); await writeLocal(fresh); count = fresh.length; channel?.postMessage('changed'); await refreshLocal(); }
      notify(`${count}개를 가져왔어요. 같은 번호의 기존 기록은 덮어쓰지 않았어요.`);
    } finally { importing = false; render(); }
  }
  let importOwner = '';
  $('study-import').onclick = () => { importOwner = owner(); $<HTMLInputElement>('study-import-file').click(); };
  $<HTMLInputElement>('study-import-file').onchange = async event => {
    const input = event.target as HTMLInputElement; const file = input.files?.[0]; input.value = ''; if (!file) return;
    try { if (file.size > 30 * 1024 * 1024) throw new Error('백업은 최대 30MB까지 가져올 수 있어요.'); await importEntries(readBackup(await file.text()), importOwner); }
    catch (reason) { showError(reason instanceof Error ? reason.message : '백업을 가져오지 못했어요.'); }
  };
  $('study-migrate').onclick = async () => { const identity = owner(); try { await importEntries(await localEntries(), identity); } catch (reason) { showError(reason instanceof Error ? reason.message : '기기 기록을 가져오지 못했어요.'); } };
  $('study-login').onclick = async () => {
    try { await cloud?.login(); } catch (reason) { const { cloudError } = await import('./study-cloud'); showError(cloudError(reason)); }
  };
  $('study-logout').onclick = async () => {
    if (remote?.pending || importing) { notify('전송이 끝난 뒤 로그아웃해 주세요.'); return; }
    try { await cloud?.logout(); } catch { showError('로그아웃하지 못했어요. 다시 시도해 주세요.'); }
  };
  window.addEventListener('leaf-study-write-error', ((event: CustomEvent<{ message: string; entry?: StudyEntry }>) => {
    showError(event.detail.message);
    if (event.detail.entry && !editor.open) openEditor(event.detail.entry, entries.find(entry => entry.id === event.detail.entry!.id));
  }) as EventListener);
  window.addEventListener('beforeunload', event => { if (importing) { event.preventDefault(); event.returnValue = ''; } });
  async function init() {
    let config: Record<string, string> | undefined;
    try {
      if (import.meta.env.VITE_FIREBASE_CONFIG) config = JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG);
      else {
        const response = await fetch(import.meta.env.BASE_URL + 'firebase-config.json', { signal: AbortSignal.timeout(5000) });
        if (response.ok && response.headers.get('content-type')?.includes('json')) config = await response.json();
      }
      if (config) {
        if (!['apiKey', 'authDomain', 'projectId', 'appId'].every(key => typeof config![key] === 'string' && config![key])) throw new Error('Firebase 설정 값이 비어 있어요.');
        const { createStudyCloud } = await import('./study-cloud');
        cloud = await createStudyCloud(config, state => {
          const previous = owner(); remote = state;
          if (previous !== owner()) { epoch++; entries = []; error = ''; editor.close(); $<HTMLDialogElement>('study-delete-dialog').close(); }
          if (state.user) { entries = state.entries; ready = state.ready; render(); }
          else void refreshLocal();
        });
        render(); return;
      }
    } catch { notify('동기화 설정을 불러오지 못했어요. 우선 이 기기에 저장합니다.'); }
    $('study-setup').hidden = false;
    await refreshLocal();
  }
  void init();
  return { openEditor, showReader: () => switchView('reader') };
}
