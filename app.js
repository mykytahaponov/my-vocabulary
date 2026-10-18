import {MAX_WORDS, emptyData, validateText, validateBackup, wordKey, mergeWords, isCorrect, variants, shuffled} from './core.mjs';
const $ = id => document.getElementById(id);
// Path isolates this dictionary from other projects on the same GitHub Pages origin.
const STORAGE_KEY = `my-vocabulary:v1:${new URL('./', location.href).pathname}`;
let data = emptyData(), baseline = null, damagedRaw = null, storageUnavailable = false, conflict = false;
let editing = null, quiz = null, tab = 'quiz', toastTimer, pendingWorker;
const makeId = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
function notify(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 9000 : 4500);
}
function warning(message) { $('storage-warning-text').textContent = message; $('storage-warning').hidden = false; }
try {
  baseline = localStorage.getItem(STORAGE_KEY);
  if (baseline !== null) {
    try { data = validateBackup(JSON.parse(baseline)); }
    catch { damagedRaw = baseline; warning('Збережені дані не вдалося прочитати. Ми їх не перезаписуємо. У розділі «Копія» збережи пошкоджені дані та віднови справну копію в режимі заміни.'); }
  }
  const probe = `${STORAGE_KEY}:probe`;
  localStorage.setItem(probe, '1'); localStorage.removeItem(probe);
} catch { storageUnavailable = true; warning('Браузер не дозволяє локальне збереження. Зміни недоступні. Відкрий сайт у звичайному режимі Safari та перевір вільне місце.'); }
function commit(next, recovering = false) {
  if (storageUnavailable) { notify('Локальне збереження недоступне. Зміни не збережено.', true); return false; }
  if (damagedRaw !== null && !recovering) { notify('Спочатку віднови справну копію в розділі «Копія».', true); return false; }
  try {
    if (conflict || localStorage.getItem(STORAGE_KEY) !== baseline) {
      conflict = true; warning('Словник змінено в іншій вкладці. Перезавантаж сторінку, щоб отримати актуальні дані. Поточні незбережені зміни буде втрачено.'); return false;
    }
    const serialized = JSON.stringify(next);
    localStorage.setItem(STORAGE_KEY, serialized);
    baseline = serialized; data = next;
    if (recovering) { damagedRaw = null; $('storage-warning').hidden = true; $('export-raw').hidden = true; }
    render(); return true;
  } catch { notify('Не вдалося зберегти: перевір вільне місце або налаштування браузера. Попередній словник залишився без змін.', true); return false; }
}
window.addEventListener('storage', event => {
  if ((event.key === STORAGE_KEY || event.key === null) && event.newValue !== baseline) {
    conflict = true; warning('Дані змінилися в іншій вкладці. Перезавантаж сторінку перед наступними змінами.');
  }
});
$('reload').onclick = () => { if (confirm('Перезавантажити? Незбережені поля й поточний квіз буде втрачено.')) location.reload(); };
function element(tag, text, className) { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; }
function render() {
  $('word-count').textContent = data.words.length;
  $('available-count').textContent = `У словнику: ${data.words.length}. Слова з’являтимуться у випадковому порядку.`;
  $('start').disabled = !data.words.length; $('quiz-empty').hidden = Boolean(data.words.length);
  $('export').disabled = damagedRaw !== null; $('export-raw').hidden = damagedRaw === null;
  const q = data.lastQuiz;
  $('last-quiz').textContent = q ? `Остання практика · ${new Date(q.date).toLocaleDateString('uk-UA')} · ${q.direction === 'en-uk' ? 'EN → UK' : 'UK → EN'} · ${q.correct} з ${q.total}` : '';
  renderWords();
}
function renderWords() {
  const query = $('search').value.trim().toLocaleLowerCase('uk');
  const words = data.words.filter(w => `${w.en} ${w.uk}`.toLocaleLowerCase('uk').includes(query));
  $('list-count').textContent = query ? `${words.length} з ${data.words.length}` : `${data.words.length} слів`;
  $('word-list').replaceChildren();
  for (const word of [...words].reverse()) {
    const li = document.createElement('li'); const content = element('div', '', 'word-content');
    content.append(element('strong', word.en), element('p', word.uk));
    const actions = element('div', '', 'word-actions');
    const edit = element('button', 'Редагувати'); edit.type = 'button'; edit.setAttribute('aria-label', `Редагувати ${word.en}`); edit.onclick = () => editWord(word);
    const del = element('button', 'Видалити', 'delete'); del.type = 'button'; del.setAttribute('aria-label', `Видалити ${word.en}`);
    del.onclick = () => {
      if (!confirm(`Видалити «${word.en}» зі словника?`)) return;
      if (commit({...data, words:data.words.filter(w => w.id !== word.id)})) { if (editing === word.id) resetForm(); notify('Слово видалено.'); }
    };
    actions.append(edit, del); li.append(content, actions); $('word-list').append(li);
  }
  $('list-empty').textContent = !data.words.length ? 'Тут буде твій словник. Додай перше слово вище.' : !words.length ? 'За цим запитом нічого не знайдено.' : '';
}
function resetForm() { editing = null; $('word-form').reset(); $('form-title').textContent = 'Додати слово'; $('save-word').textContent = 'Додати слово +'; $('cancel-edit').hidden = true; }
function editWord(word) {
  if (($('english').value || $('ukrainian').value) && !confirm('Замінити незбережені поля вибраним словом?')) return;
  editing = word.id; $('english').value = word.en; $('ukrainian').value = word.uk;
  $('form-title').textContent = 'Редагувати слово'; $('save-word').textContent = 'Зберегти зміни'; $('cancel-edit').hidden = false;
  $('word-form').scrollIntoView({block:'start'}); $('english').focus();
}
$('word-form').onsubmit = event => {
  event.preventDefault();
  const word = {id: editing || makeId(), en:$('english').value.trim(), uk:$('ukrainian').value.trim()};
  if (!validateText(word.en) || !validateText(word.uk)) { notify('Введи слово та переклад: до 500 символів у кожному полі.', true); return; }
  if (!editing && data.words.length >= MAX_WORDS) { notify('Ліміт першої версії — 5000 слів.', true); return; }
  if (data.words.some(w => w.id !== word.id && wordKey(w) === wordKey(word))) { notify('Така картка вже є у словнику.', true); return; }
  const words = editing ? data.words.map(w => w.id === editing ? word : w) : [...data.words, word];
  const wasEditing = Boolean(editing);
  if (commit({...data, words})) { resetForm(); $('english').focus(); notify(wasEditing ? 'Зміни збережено.' : 'Слово додано.'); }
};
$('cancel-edit').onclick = resetForm; $('search').oninput = renderWords;
function showTab(next) {
  if (next === tab) return;
  if (quiz && !quiz.finished && next !== 'quiz') {
    if (!confirm('Залишити квіз? Поточні відповіді не буде збережено.')) return;
    quiz = null; showQuizScreen('setup');
  }
  tab = next;
  for (const name of ['quiz','words','backup']) $(`${name}-view`).hidden = name !== next;
  document.querySelectorAll('[data-tab]').forEach(button => { if (button.dataset.tab === next) button.setAttribute('aria-current','page'); else button.removeAttribute('aria-current'); });
}
document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => showTab(button.dataset.tab));
$('add-first').onclick = () => { showTab('words'); $('english').focus(); };
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
  $('given').textContent = skipped ? 'Ти пропустив це слово.' : `Твоя відповідь: ${answer}`;
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
  showQuizScreen('result'); $('quiz-result').focus();
}
$('again').onclick = () => { quiz = null; showQuizScreen('setup'); };
$('retry').onclick = () => startQuiz(quiz.answers.filter(a => !a.correct).map(a => a.word), quiz.direction);
function download(contents, filename) {
  const url = URL.createObjectURL(new Blob([contents], {type:'application/json;charset=utf-8'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
$('export').onclick = () => {
  download(JSON.stringify({...data, exportedAt:new Date().toISOString()}, null, 2), `my-vocabulary-${new Date().toISOString().slice(0,10)}.json`);
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
    if (mode === 'replace' && !confirm(`Замінити весь поточний словник (${data.words.length} слів) копією (${incoming.words.length} слів)? Спочатку збережи експорт, якщо потрібні старі слова.`)) return;
    const next = mode === 'replace' ? incoming : {...data, words:mergeWords(data.words, incoming.words, makeId)};
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
window.addEventListener('online', () => { $('offline-status').textContent = 'Знову онлайн'; });
render();
