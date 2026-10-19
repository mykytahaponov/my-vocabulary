// Pure data and answer logic shared by the app and its dependency-free tests.
export const MAX_WORDS = 5000;
export const MAX_TEXT = 500;
export const CATEGORY_LABELS = {word:'Word',phrasal_verb:'Phrasal Verb',collocation:'Collocation',expression:'Expression'};
export const POS_LABELS = {noun:'Іменник',verb:'Дієслово',adjective:'Прикметник',adverb:'Прислівник',other:'Інше'};
export function wordCategory(word) {
  const value=word.category ?? '';
  if (!['','word','phrasal_verb','collocation','expression'].includes(value)) throw new Error('Невідома категорія картки. Дані не змінено.');
  return value;
}
export const EXTRA_LIMITS = {example_en:2000, example_uk:2000, note:500,pattern:1000};
export function wordExtras(word) {
  const extras = {};
  for (const [key, limit] of Object.entries(EXTRA_LIMITS)) {
    const value = word[key] ?? '';
    if (typeof value !== 'string' || value.length > limit) throw new Error('Некоректний приклад, Pattern або примітка в картці.');
    extras[key] = value.trim();
  }
  const category=wordCategory(word),pos=word.part_of_speech ?? '';
  if (!['','noun','verb','adjective','adverb','other'].includes(pos) || (pos && category!=='word'))
    throw new Error('Частину мови можна вказати лише для категорії Word.');
  return {...extras,category,part_of_speech:pos};
}
export function normalize(text, language) {
  let result = String(text).normalize('NFKC').toLocaleLowerCase(language === 'en' ? 'en' : 'uk')
    .replace(/[’‘ʼ`´]/g, "'").replace(/[‐‑‒–—]/g, '-').trim()
    .replace(/[.!?…]+$/g, '').trim().replace(/\s+/gu, ' ');
  if (language === 'en') result = result.replace(/^to\s+/, '');
  return result;
}
export function variants(text) { return text.split(/[;\n]/u).map(s => s.trim()).filter(Boolean); }
export function isCorrect(answer, expected, language) {
  const value = normalize(answer, language);
  return Boolean(value) && variants(expected).some(v => normalize(v, language) === value);
}
export function validateText(value) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT &&
    variants(value).length > 0 && variants(value).every(v => normalize(v, 'en') && normalize(v, 'uk'));
}
export function wordKey(word) {
  // Order of accepted variants does not make a new card.
  return JSON.stringify(['en','uk'].map(lang => [...new Set(variants(word[lang]).map(v => normalize(v, lang)))].sort()));
}
export function emptyData() { return {schemaVersion: 1, words: [], lastQuiz: null}; }
export function validateBackup(data) {
  if (!data || Array.isArray(data) || data.schemaVersion !== 1 || !Array.isArray(data.words) || data.words.length > MAX_WORDS)
    throw new Error('Невідомий формат копії або більше 5000 слів. Потрібен JSON, експортований цим застосунком.');
  const ids = new Set();
  const words = data.words.map(word => {
    if (!word || typeof word.id !== 'string' || !word.id || word.id.length > 100 || ids.has(word.id) || !validateText(word.en) || !validateText(word.uk))
      throw new Error('Копія містить некоректні слова або повторні ID. Імпорт скасовано.');
    ids.add(word.id);
    return {id: word.id, en: word.en.trim(), uk: word.uk.trim(), ...wordExtras(word)};
  });
  let lastQuiz = null;
  if (data.lastQuiz != null) {
    const q = data.lastQuiz;
    if (!q || !['en-uk','uk-en'].includes(q.direction) || !Number.isInteger(q.total) || q.total < 1 || q.total > MAX_WORDS || !Number.isInteger(q.correct) || q.correct < 0 || q.correct > q.total || typeof q.date !== 'string' || !Number.isFinite(Date.parse(q.date)))
      throw new Error('Некоректний підсумок квізу. Імпорт скасовано.');
    lastQuiz = {direction:q.direction, total:q.total, correct:q.correct, date:q.date};
  }
  return {schemaVersion: 1, words, lastQuiz};
}
export function mergeWords(existing, incoming, makeId) {
  const words = [...existing], keys = new Set(existing.map(wordKey));
  const ids = new Set(existing.map(w => w.id));
  for (const word of incoming) {
    const key = wordKey(word);
    if (keys.has(key)) {
      const index = words.findIndex(w => wordKey(w) === key);
      const prior = wordExtras(words[index]), extra = wordExtras(word);
      const category=prior.category || extra.category;
      words[index] = {...words[index], ...Object.fromEntries(Object.keys(EXTRA_LIMITS).map(k => [k, prior[k] || extra[k]])),category,
        part_of_speech:category==='word' ? prior.part_of_speech || extra.part_of_speech : ''};
      continue;
    }
    let id = word.id;
    while (ids.has(id)) id = makeId();
    words.push({...word, id}); keys.add(key); ids.add(id);
  }
  if (words.length > MAX_WORDS) throw new Error('Разом виходить більше 5000 слів. Імпорт скасовано.');
  return words;
}
export function shuffled(words, limit) {
  const result = words.map(w => ({...w}));
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, limit);
}
