import {MAX_WORDS, emptyData, validateText, validateBackup, wordKey, mergeWords, isCorrect, variants, shuffled, wordExtras, CATEGORY_LABELS, POS_LABELS} from './core.mjs';
import {SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY} from './config.js';
import {plainWord, sameContent, checkedCloud, desiredRow, pendingCount, reconcile} from './sync.mjs';
import {SupabaseConnection} from './cloud.mjs';
const $ = id => document.getElementById(id);
// Path isolates this dictionary from other projects on the same GitHub Pages origin.
const STORAGE_KEY = `my-vocabulary:v1:${new URL('./', location.href).pathname}`;
let data = emptyData(), baseline = null, damagedRaw = null, storageUnavailable = false, conflict = false;
let editingOriginal = null;
let syncBusy = false, syncAgain = false, syncTimer, syncConflicts = [], syncMessage = '', syncError = false, loggingIn = false;
const SESSION_KEY = `${STORAGE_KEY}:session:${SUPABASE_URL}`;
const connection = new SupabaseConnection({url:SUPABASE_URL,key:SUPABASE_PUBLISHABLE_KEY,storage:localStorage,sessionKey:SESSION_KEY});
let editing = null, quiz = null, tab = 'quiz', toastTimer, pendingWorker;
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function notify(message, error = false) {
  if($('word-editor').open) { $('editor-message').textContent=message; $('editor-message').classList.toggle('error',error); return; }
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4500);
}
function warning(message) { $('storage-warning-text').textContent = message; $('storage-warning').hidden = false; }
try {
  baseline = localStorage.getItem(STORAGE_KEY);
  if (baseline !== null) {
    try { const saved=JSON.parse(baseline); data=validateBackup(saved); if(saved.cloud) data.cloud=checkedCloud(saved.cloud); }
    catch { damagedRaw = baseline; warning('Збережені дані не вдалося прочитати. Ми їх не перезаписуємо. У «Налаштуваннях» збережи пошкоджені дані та віднови справну копію в режимі заміни.'); }
  }
  const probe = `${STORAGE_KEY}:probe`;
  localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
} catch { storageUnavailable = true; warning('Браузер не дозволяє локальне збереження. Зміни недоступні. Відкрий сайт у звичайному режимі Safari та перевір вільне місце.'); }
function commit(next, recovering = false, fromCloud = false) {
  if (storageUnavailable) { notify('Локальне збереження недоступне. Зміни не збережено.', true); return false; }
  if (damagedRaw !== null && !recovering) { notify('Спочатку віднови справну копію у «Налаштуваннях».', true); return false; }
  try {
    if (conflict || localStorage.getItem(STORAGE_KEY) !== baseline) {
      conflict = true; warning('Словник змінено в іншій вкладці. Перезавантаж сторінку, щоб отримати актуальні дані. Поточні незбережені зміни буде втрачено.'); return false;
    }
    const serialized = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, serialized);
    const wordsChanged = next.words !== data.words;
    baseline = serialized; data = next;
    if (recovering) { damagedRaw = null; $('storage-warning').hidden = true; $('export-raw').hidden = true; }
    render(!wordsChanged); if(syncConflicts.length) renderConflicts(); if(!fromCloud && data.cloud) { syncMessage = ''; scheduleSync(); } renderAccount(); return true;
  } catch { notify('Не вдалося зберегти: перевір вільне місце або налаштування браузера. Попередній словник залишився без змін.', true); return false; }
}
window.addEventListener('storage', event => {
  if (event.key === SESSION_KEY) { renderAccount(); scheduleSync(); }
  if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== baseline) {
    conflict = true; warning('Дані змінилися в іншій вкладці. Перезавантаж сторінку перед наступними змінами.');
  }
});
$('reload').onclick = () => { if (confirm('Перезавантажити? Незбережені поля й поточний квіз буде втрачено.')) location.reload(); };
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function render(skipWords=false) {
  $('word-count').textContent = data.words.length;
  $('available-count').textContent = data.words.length ? `У словнику: ${data.words.length}` : 'Додай слова, які хочеш запам’ятати.';
  $('start').disabled = !data.words.length; $('quiz-empty').hidden = Boolean(data.words.length);
  $('export').disabled = damagedRaw !== null; $('export-raw').hidden = damagedRaw === null;
  const q = data.lastQuiz;
  $('last-quiz').textContent = q ? `Остання практика · ${new Date(q.date).toLocaleDateString('uk-UA')} · ${q.direction === 'en-uk' ? 'EN → UK' : 'UK → EN'} · ${q.correct} з ${q.total}` : '';
  if(!skipWords) renderWords();
}
function renderWords() {
  const query = $('search').value.trim().toLocaleLowerCase('uk');
  const words = data.words.filter(w => `${w.en} ${w.uk}`.toLocaleLowerCase('uk').includes(query));
  $('list-count').textContent = query ? `${words.length} з ${data.words.length}` : `Слів: ${data.words.length}`;
  $('word-list').replaceChildren();
  for (const word of [...words].reverse()) {
    const li = document.createElement('li'); const content = element('div', '', 'word-content');
    content.append(element('strong', word.en));
    if(word.category)content.append(element('span',CATEGORY_LABELS[word.category],'word-label'));
    if(word.category==='word' && word.part_of_speech)content.append(element('span',POS_LABELS[word.part_of_speech],'pos-label'));
    content.append(element('p', word.uk));
    if(word.pattern || word.example_en || word.example_uk || word.note){
      const details=element('details','','word-examples');details.append(element('summary',word.pattern ? 'Конструкція та приклад' : 'Приклад і примітка'));
      if(word.pattern)details.append(element('p',`Pattern: ${word.pattern}`,'word-pattern'));
      if(word.example_en)details.append(element('p',word.example_en));
      if(word.example_uk)details.append(element('p',word.example_uk,'muted'));
      if(word.note)details.append(element('p',word.note,'hint'));
      content.append(details);
    }
    const menu=document.createElement('details'); menu.className='word-menu';
    const summary=element('summary','⋯'); summary.setAttribute('aria-label',`Дії для ${word.en}`);
    menu.addEventListener('toggle',()=>{
      if(!menu.open)return;
      const bottom=(window.visualViewport?.height || window.innerHeight)+(window.visualViewport?.offsetTop || 0);
      menu.dataset.side=summary.getBoundingClientRect().bottom+120>bottom-90 ? 'up' : 'down';
      document.querySelectorAll('.word-menu').forEach(other=>{if(other!==menu)other.open=false;});
    });
    const actions = element('div', '', 'word-actions');
    const edit = element('button', 'Редагувати'); edit.type = 'button'; edit.setAttribute('aria-label', `Редагувати ${word.en}`); edit.onclick = () => {menu.open=false;editWord(word);};
    const del = element('button', 'Видалити', 'delete'); del.type = 'button'; del.setAttribute('aria-label', `Видалити ${word.en}`);
    del.onclick = () => {
      menu.open=false;
      if (!confirm(`Видалити «${word.en}» зі словника?`)) return;
      if (commit({...data, words:data.words.filter(w => w.id !== word.id)})) { if (editing === word.id) resetForm(); notify('Слово видалено.'); }
    };
    actions.append(edit, del); menu.append(summary,actions); li.append(content, menu); $('word-list').append(li);
  }
  $('list-empty').textContent = !data.words.length ? 'Тут буде твій словник. Натисни «+ Додати», щоб почати.' : !words.length ? 'За цим запитом нічого не знайдено.' : '';
}
function resetForm() {
  editing=null;editingOriginal=null;$('word-form').reset();
  $('category').value='word';updateCategoryFields();
  $('form-title').textContent='Додати слово';$('save-word').textContent='Додати';
  $('add-another-row').hidden=false;$('editor-message').textContent='';
}
function selectedCategory() {return $('category').value;}
function updateCategoryFields() {
  const isWord=selectedCategory()==='word';
  $('pos-row').hidden=!isWord;$('part-of-speech').disabled=!isWord;
  if(!isWord)$('part-of-speech').value='';
}
$('category').addEventListener('change',updateCategoryFields);
function editorHasContent() {
  return selectedCategory()!=='word' || $('part-of-speech').value ||
    ['english','ukrainian','example-en','example-uk','word-note','pattern'].some(id=>$(id).value.trim());
}
function closeEditor(force=false) {
  if(!force && editorHasContent() && !confirm('Закрити форму без збереження?'))return;
  $('word-editor').close();resetForm();
}
function openEditor() {
  if(!$('word-editor').open){resetForm();$('word-editor').showModal();}
  $('english').focus();
}
function editWord(word) {
  if($('word-editor').open && editorHasContent() && !confirm('Замінити незбережені поля вибраним словом?'))return;
  resetForm();editing=word.id;editingOriginal={...word};
  $('english').value=word.en;$('ukrainian').value=word.uk;
  $('example-en').value=word.example_en || '';$('example-uk').value=word.example_uk || '';$('word-note').value=word.note || '';
  $('category').value=word.category || '';$('part-of-speech').value=word.part_of_speech || '';
  $('pattern').value=word.pattern || '';updateCategoryFields();
  $('form-title').textContent='Редагувати слово';$('save-word').textContent='Зберегти';
  $('add-another-row').hidden=true;
  if(!$('word-editor').open)$('word-editor').showModal();
  $('english').focus();
}
$('quick-add').onclick=openEditor;$('add-word').onclick=openEditor;
$('close-editor').onclick=()=>closeEditor();$('cancel-edit').onclick=()=>closeEditor();
$('word-editor').addEventListener('cancel',event=>{event.preventDefault();closeEditor();});
$('english').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();$('ukrainian').focus();}});
document.addEventListener('click',event=>{if(!event.target.closest('.word-menu'))document.querySelectorAll('.word-menu').forEach(menu=>{menu.open=false;});});
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.word-menu').forEach(menu=>{menu.open=false;});});
$('word-form').onsubmit = event => {
  event.preventDefault();
  if(!Object.hasOwn(CATEGORY_LABELS,selectedCategory())){notify('Обери категорію картки.',true);return;}
  if(editing && !sameContent({...editingOriginal,deleted:false}, {...data.words.find(w=>w.id===editing),deleted:false})) { notify('Слово змінилося під час редагування. Скопіюй свої поля за потреби, скасуй редагування та відкрий слово знову.',true); return; }
  const word = {id: editing || makeId(), en:$('english').value.trim(), uk:$('ukrainian').value.trim(),
    ...wordExtras({example_en:$('example-en').value,example_uk:$('example-uk').value,note:$('word-note').value,category:selectedCategory(),
      part_of_speech:selectedCategory()==='word' ? $('part-of-speech').value : '',pattern:$('pattern').value})};
  if (!validateText(word.en) || !validateText(word.uk)) { notify('Введи слово та переклад: до 500 символів у кожному полі.', true); return; }
  if (!editing && data.words.length >= MAX_WORDS) { notify('Ліміт першої версії — 5000 слів.', true); return; }
  if (data.words.some(w => w.id !== word.id && wordKey(w) === wordKey(word))) { notify('Така картка вже є у словнику.', true); return; }
  const words = editing ? data.words.map(w => w.id === editing ? word : w) : [...data.words, word];
  const wasEditing = Boolean(editing);
  const keepOpen=!wasEditing && $('add-another').checked;
  if(commit({...data,words})){
    if(keepOpen){resetForm();$('english').focus();}else{closeEditor(true);}
    notify(wasEditing ? 'Зміни збережено.' : 'Слово додано ✓');
  }
};
$('search').oninput = renderWords;
function showTab(next) {
  if (next === tab) return true;
  if (quiz && !quiz.finished && next !== 'quiz') {
    if (!confirm('Залишити квіз? Поточні відповіді не буде збережено.')) return false;
    quiz = null; showQuizScreen('setup');
  }
  tab = next;
  for (const name of ['quiz','words','backup']) $(`${name}-view`).hidden = name !== next;
  document.querySelectorAll('[data-tab]').forEach(button => { if (button.dataset.tab === next) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
  document.activeElement?.blur();window.scrollTo({top:0});return true;
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => showTab(button.dataset.tab));
$('add-first').onclick = () => { if(showTab('words'))openEditor(); };
function showQuizScreen(screen) { for (const name of ['setup','active','result']) $(`quiz-${name}`).hidden = name !== screen; }
function startQuiz(words, direction, limit = words.length) {
  quiz = {words: shuffled(words, limit), direction, index:0, answers:[], checked:false, finished:false};
  showQuizScreen('active'); showQuestion();
}
$('start-form').onsubmit = event => { event.preventDefault(); if (data.words.length) startQuiz(data.words, $('direction').value, $('quiz-size').value === 'all' ? data.words.length : Number($('quiz-size').value)); };
function showQuestion() {
  const word = quiz.words[quiz.index]; const toUk = quiz.direction === 'en-uk';
  $('quiz-progress').textContent = `СЛОВО ${quiz.index + 1} ІЗ ${quiz.words.length}`;
  $('progress').max = quiz.words.length; $('progress').value = quiz.index;
  $('question').textContent = variants(toUk ? word.en : word.uk)[0];
  $('answer-language').textContent = toUk ? 'Переклади українською' : 'Напиши англійською';
  $('answer').value = ''; $('answer').disabled = false; $('answer').lang = toUk ? 'uk' : 'en';
  $('check').hidden = false; $('skip').hidden = false; $('feedback').hidden = true;
  $('next').textContent = quiz.index === quiz.words.length - 1 ? 'Переглянути підсумок →' : 'Наступне слово →';
  quiz.checked = false; $('answer').focus();
}
function checkAnswer(skipped = false) {
  if (!quiz || quiz.checked) return;
  const answer = skipped ? '' : $('answer').value.trim();
  if (!skipped && !answer) { $('answer').focus(); return; }
  const word = quiz.words[quiz.index], expected = quiz.direction === 'en-uk' ? word.uk : word.en;
  const correct = !skipped && isCorrect(answer, expected, quiz.direction === 'en-uk' ? 'uk' : 'en');
  quiz.answers.push({word, answer, expected, correct, skipped}); quiz.checked = true;
  $('answer').disabled = true; $('check').hidden = true; $('skip').hidden = true;
  $('feedback').hidden = false; $('feedback').classList.toggle('wrong', !correct);
  $('feedback-title').textContent = correct ? 'Правильно ✓' : skipped ? 'Наступного разу згадаєш.' : 'Поки що не збігається.';
  $('expected').textContent = `Правильна відповідь: ${expected}`;
  $('quiz-example').replaceChildren();
  if(word.pattern)$('quiz-example').append(element('p',`Pattern: ${word.pattern}`,'word-pattern'));
  if(word.example_en)$('quiz-example').append(element('p',word.example_en));
  if(word.example_uk)$('quiz-example').append(element('p',word.example_uk,'muted'));
  if(word.note)$('quiz-example').append(element('p',word.note,'hint'));
  $('quiz-example').hidden=!$('quiz-example').childElementCount;
  $('accept').hidden = correct || skipped; $('next').focus();
}
$('answer-form').onsubmit = event => { event.preventDefault(); checkAnswer(); }; $('skip').onclick = () => checkAnswer(true);
$('accept').onclick = () => {
  if (!quiz || !quiz.checked) return;
  quiz.answers.at(-1).correct = true; $('feedback').classList.remove('wrong');
  $('feedback-title').textContent = 'Зараховано тобою ✓'; $('accept').hidden = true;
};
$('next').onclick = () => {
  if (!quiz?.checked) return;
  quiz.index++; if (quiz.index < quiz.words.length) showQuestion(); else finishQuiz();
};
$('end-quiz').onclick = () => { if (confirm('Завершити квіз зараз? Підсумок врахує лише перевірені відповіді.')) finishQuiz(); };
function finishQuiz() {
  quiz.finished = true;
  if (!quiz.answers.length) { quiz = null; showQuizScreen('setup'); return; }
  const total = quiz.answers.length, correct = quiz.answers.filter(a => a.correct).length;
  const saved = commit({...data, lastQuiz:{direction:quiz.direction, total, correct, date:new Date().toISOString()}});
  $('result-score').textContent = `${correct} / ${total}`;
  $('result-description').textContent = `Правильних відповідей: ${Math.round(correct / total * 100)}%.${total < quiz.words.length ? ` Квіз завершено достроково: ${total} із ${quiz.words.length} слів.` : ''}${saved ? '' : ' Підсумок не збережено — зроби скриншот за потреби.'}`;
  const wrong = quiz.answers.filter(a => !a.correct); $('retry').hidden = !wrong.length;
  $('mistakes').replaceChildren(element('h2', wrong.length ? 'Слова для повторення' : 'Усі відповіді правильні. До наступної практики!'));
  for (const a of wrong) {
    const div = element('div', '', 'mistake'); div.append(element('strong', variants(quiz.direction === 'en-uk' ? a.word.en : a.word.uk)[0]), element('p', `Твоя відповідь: ${a.skipped ? 'пропущено' : a.answer}`, 'muted'), element('p', `Правильно: ${a.expected}`)); $('mistakes').append(div);
  }
  document.activeElement?.blur();showQuizScreen('result'); $('quiz-result').focus();
}
$('again').onclick = () => { quiz = null; showQuizScreen('setup'); };
$('retry').onclick = () => startQuiz(quiz.answers.filter(a => !a.correct).map(a => a.word), quiz.direction);
function download(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('export').onclick = () => {
  download(JSON.stringify({schemaVersion:1, words:data.words, lastQuiz:data.lastQuiz, exportedAt:new Date().toISOString()}, null, 2), `my-vocabulary-${new Date().toISOString().slice(0,10)}.json`);
  notify('Копію підготовлено. Перевір завантаження у «Файли».');
};
$('export-raw').onclick = () => { if (damagedRaw !== null) download(damagedRaw, 'my-vocabulary-recovery.json'); };
$('import-form').onsubmit = async event => {
  event.preventDefault(); const file = $('import-file').files[0]; if (!file) return;
  if (file.size > 32 * 1024 * 1024) { notify('Файл завеликий. Максимум — 32 МБ.', true); return; }
  // Capture the selected operation before the asynchronous file read.
  const mode = $('import-mode').value; $('import').disabled = true;
  try {
    const incoming = validateBackup(JSON.parse(await file.text()));
    if (damagedRaw !== null && mode !== 'replace') throw new Error('Для відновлення пошкоджених даних обери «Замінити весь словник». Спочатку збережи пошкоджені дані.');
    if (mode === 'replace' && !confirm(`Замінити весь поточний словник (${data.words.length} слів) копією (${incoming.words.length} слів)? Після входу ця заміна пошириться на хмару та інші пристрої. Спочатку збережи експорт, якщо потрібні старі слова.`)) return;
    const next = mode === 'replace' ? {...incoming,...(data.cloud?{cloud:data.cloud}:{})} : {...data, words:mergeWords(data.words, incoming.words, makeId)};
    const added = next.words.length - data.words.length;
    if (commit(next, mode === 'replace')) { resetForm(); $('import-form').reset(); notify(mode === 'replace' ? `Відновлено ${next.words.length} слів.` : `Додано ${added} слів. Дублікати пропущено.`); }
  } catch (err) { notify(err instanceof SyntaxError ? 'Це не коректний JSON-файл. Дані не змінено.' : err.message || 'Не вдалося прочитати копію.', true); }
  finally { $('import').disabled = false; }
};
// Update only after an explicit tap, so a new worker cannot interrupt a quiz.
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).then(reg => {
    const announce = worker => { pendingWorker = worker; $('update-notice').hidden = false; };
    if (reg.waiting) announce(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed' && navigator.serviceWorker.controller) announce(worker); });
    });
    navigator.serviceWorker.ready.then(() => { $('offline-status').textContent = navigator.onLine ? 'Готово до роботи офлайн' : 'Офлайн'; });
  }).catch(() => { $('offline-status').textContent = 'Офлайн-кеш недоступний'; });
}
let updating = false;
$('update').onclick = () => { if (pendingWorker && confirm('Оновити зараз? Поточний квіз і незбережені поля буде втрачено.')) { updating = true; pendingWorker.postMessage({type:'SKIP_WAITING'}); } };
navigator.serviceWorker?.addEventListener('controllerchange', () => { if (updating) location.reload(); });
window.addEventListener('offline', () => { $('offline-status').textContent = 'Офлайн'; });
window.addEventListener('online', () => { $('offline-status').textContent = 'Знову онлайн'; scheduleSync(); });
render();


// The old storage key and JSON backup format stay compatible with version 1.
function canSync() {
  const session=connection.session();
  return session && data.cloud?.owner===session.user.id && !storageUnavailable && damagedRaw===null && !conflict;
}
function renderAccount() {
  const session=connection.session(), owner=data.cloud;
  $('login-form').hidden=Boolean(session && owner?.owner===session.user.id);
  $('signed-in').hidden=$('login-form').hidden===false;
  $('account-email').textContent=session?.user.email || owner?.email || '';

  $('sync-now').hidden=!canSync(); $('sync-now').disabled=syncBusy;
  $('account-description').textContent=owner ? `Слова синхронізуються після входу. Підсумок квізу зберігається лише тут.` : 'Поки що слова зберігаються лише тут. Увійди для синхронізації.';
  const pending=owner ? pendingCount(data.words,owner.base) : 0;
  let status=syncMessage || (syncBusy ? 'Синхронізація…' : owner ? pending ? `На пристрої є непередані зміни: ${pending}.` : 'Локальна копія. Перевіряємо хмару після входу.' : 'Локально · увійди для синхронізації');
  if(owner && !session)status=`Увійди повторно для синхронізації.${pending ? ` Непередані зміни: ${pending}.` : ''}`;
  if(owner && navigator.onLine===false)status=`Офлайн · ${pending ? `непередані зміни: ${pending}` : 'локальний словник доступний'}`;
  $('sync-status').textContent=status;$('sync-status').classList.toggle('sync-error',syncError);
  let state='guest',label='Увійти';
  if(owner){
    if(syncError){state='error';label='Перевір зв’язок';}
    else if(navigator.onLine===false){state='offline';label='Офлайн';}
    else if(!session){state='guest';label='Увійти';}
    else if(syncBusy){state='busy';label='Синхронізація';}
    else if(syncConflicts.length){state='error';label='Обери версію';}
    else if(pending){state='pending';label=`Очікує: ${pending}`;}
    else {state=syncMessage.startsWith('Синхронізовано')?'synced':'busy';label=state==='synced'?'Збережено':'Підключено';}
  }
  $('account-shortcut').dataset.state=state;$('account-shortcut').setAttribute('aria-label',`Стан словника: ${status}. Відкрити налаштування`);
  $('sync-chip-label').textContent=label;
  const important=Boolean(owner && (syncError || pending || syncConflicts.length));
  $('sync-alert').hidden=!important;
  $('sync-alert-text').textContent=syncError ? 'Синхронізацію не завершено. Слова залишаються на пристрої.' : syncConflicts.length ? 'Є різні версії слів. Обери потрібну в налаштуваннях.' : `Є непередані зміни: ${pending}. ${navigator.onLine===false?'Відкрий застосунок з інтернетом для синхронізації.':'Збережено на цьому пристрої.'}`;

}
function scheduleSync(delay=700) {
  clearTimeout(syncTimer);
  if(syncBusy) {syncAgain=true;return;}
  if(canSync() && navigator.onLine!==false)syncTimer=setTimeout(()=>runSync(),delay);
}
function persistCloud(next) {
  // Metadata acknowledgements must not rebuild a long word list or move focus.
  if(next.words.length===data.words.length && next.words.every((w,i)=>w.id===data.words[i].id && sameContent(w,data.words[i]))) next={...next,words:data.words};
  return commit(next,false,true);
}
async function runSync() {
  if(syncBusy){syncAgain=true;return;}
  if(!canSync() || navigator.onLine===false){renderAccount();return;}
  syncBusy=true;syncAgain=false;syncMessage='';syncError=false;renderAccount();
  const owner=data.cloud.owner;
  try {
    const remote=await connection.list(owner);
    if(!canSync() || data.cloud.owner!==owner)return;
    // Read the latest local words AFTER the network wait; the user may have typed.
    const plan=reconcile(data.words,data.cloud.base,remote);
    if(!persistCloud({...data,words:plan.words,cloud:{...data.cloud,base:plan.base}}))throw new Error('Не вдалося зберегти локальну копію. Синхронізацію зупинено.');
    syncConflicts=plan.conflicts;renderConflicts();
    for(const operation of plan.writes){
      if(!canSync() || data.cloud.owner!==owner)break;
      // Do not send a stale operation if the user edited it while we were awaiting another request.
      if(!sameContent(desiredRow(data.words,data.cloud.base,operation.id),operation.desired)){syncAgain=true;continue;}
      // Stage an INSERT before sending it. A lost response followed by an offline
      // deletion must not resurrect the word on the next pull.
      if(operation.revision===null && !data.cloud.base.some(r=>r.id===operation.id)){
        const staged={...operation.desired,revision:0};
        if(!persistCloud({...data,cloud:{...data.cloud,base:[...data.cloud.base,staged]}}))throw new Error('Не вдалося зберегти чергу синхронізації.');
      }
      let row;
      try {row=await connection.write(owner,operation);}
      catch(error){if(error.status===409){syncAgain=true;continue;}throw error;}
      if(!canSync() || data.cloud.owner!==owner)break;
      const base=data.cloud.base.filter(r=>r.id!==row.id);base.push(row);
      // Only acknowledge the server revision. Any edits made in flight remain pending.
      if(!persistCloud({...data,cloud:{...data.cloud,base}}))throw new Error('Хмарний запис отримано, але локальне збереження не вдалося. Зроби JSON-копію.');
    }
    const pending=pendingCount(data.words,data.cloud.base);
    syncMessage=syncConflicts.length ? `Потрібно обрати версію: ${syncConflicts.length}. Відкрий «Налаштування».` : pending ? `Непередані зміни: ${pending}.` : `Синхронізовано · ${new Date().toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}`;
  } catch(error) {syncMessage=error.message || 'Синхронізацію не завершено. Локальні зміни залишилися на пристрої.';syncError=true;syncAgain=false;}
  finally {syncBusy=false;renderAccount();if(syncAgain)scheduleSync(1500);}
}
function renderConflicts() {
  $('sync-conflicts').hidden=!syncConflicts.length;$('conflict-list').replaceChildren();
  for(const item of syncConflicts){
    const div=element('div','','conflict-card');
    const describe=row=>!row||row.deleted ? 'Видалено' : [ `${row.en} → ${row.uk}`,CATEGORY_LABELS[row.category],POS_LABELS[row.part_of_speech],
      row.pattern && `Pattern: ${row.pattern}`,row.example_en,row.example_uk,row.note ].filter(Boolean).join(' · ');
    const local=desiredRow(data.words,data.cloud.base,item.id) || item.local;
    div.append(element('p',`На цьому пристрої: ${describe(local)}`),element('p',`У хмарі: ${describe(item.remote)}`));
    const buttons=element('div','','button-row');
    for(const [choice,label] of [['local','Залишити мою'],['remote','Взяти з хмари']]){
      const button=element('button',label,'secondary');button.type='button';
      button.onclick=()=>resolveConflict(item,choice);buttons.append(button);
    }
    div.append(buttons);$('conflict-list').append(div);
  }
}
function resolveConflict(item, choice) {
  if(syncBusy){notify('Дочекайся завершення синхронізації.');return;}
  if(!confirm(choice==='local' ? 'Передати поточну локальну версію в хмару? Якщо хмарна версія знову змінилася, застосунок перепитає.' : 'Замінити локальну версію показаною хмарною?'))return;
  let words=data.words;
  if(choice==='remote'){
    words=words.filter(w=>w.id!==item.id);
    if(item.remote && !item.remote.deleted)words=[...words,plainWord(item.remote)];
  }
  const base=data.cloud.base.filter(r=>r.id!==item.id);
  if(item.remote)base.push(item.remote);
  if(persistCloud({...data,words,cloud:{...data.cloud,base}})){
    syncConflicts=syncConflicts.filter(c=>c.id!==item.id);syncMessage='';renderConflicts();renderAccount();scheduleSync(0);
  }
}
$('account-shortcut').onclick=()=>showTab('backup');
$('show-sync').onclick=()=>showTab('backup');
$('sync-now').onclick=()=>runSync();
$('login-form').onsubmit=async event=>{
  event.preventDefault();if(loggingIn)return;
  if(storageUnavailable || damagedRaw!==null || conflict){notify('Спочатку усунь попередження про локальне сховище.',true);return;}
  loggingIn=true;$('login').disabled=true;
  try {
    const session=await connection.login($('login-email').value.trim(),$('login-password').value);
    if(data.cloud && data.cloud.owner!==session.user.id){await connection.logout();throw new Error('Цей словник належить іншому акаунту. Увійди з попередньою поштою; для іншого акаунта використовуй окремий профіль браузера.');}
    if(!data.cloud && !persistCloud({...data,cloud:{owner:session.user.id,email:session.user.email,base:[]}})){await connection.logout();throw new Error('Не вдалося зберегти підключення на пристрої.');}
    syncMessage='';notify('Вхід виконано. Синхронізуємо слова.');await runSync();
  }catch(error){notify(error.message || 'Не вдалося увійти.',true);}
  finally{loggingIn=false;$('login').disabled=false;$('login-password').value='';renderAccount();}
};
$('logout').onclick=async()=>{
  const pending=data.cloud ? pendingCount(data.words,data.cloud.base) : 0;
  if(!confirm(`Вийти? Локальна копія залишиться на цьому пристрої.${pending ? ` Непередані зміни: ${pending}.` : ''}`))return;
  // Remove credentials synchronously before awaiting the remote logout.
  const loggingOut=connection.logout();renderAccount();await loggingOut;notify('Вихід виконано. Локальний словник доступний.');
};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleSync(0);});
window.addEventListener('focus',()=>scheduleSync(0));
window.addEventListener('offline',()=>renderAccount());
setInterval(()=>{if(document.visibilityState==='visible')scheduleSync(0);},30000);
renderAccount();scheduleSync(0);

// Keep the bottom navigation clear of the software keyboard on narrow screens.
function updateViewport() {
  const viewport=window.visualViewport;
  const height=viewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--viewport-height',`${height}px`);
  const keyboard=Boolean(viewport && window.innerHeight-height>150 && /INPUT|TEXTAREA/.test(document.activeElement?.tagName || ''));
  document.body.classList.toggle('keyboard-open',keyboard);
}
window.visualViewport?.addEventListener('resize',updateViewport);
window.addEventListener('resize',updateViewport);
document.addEventListener('focusout',()=>setTimeout(updateViewport,0));
updateViewport();
