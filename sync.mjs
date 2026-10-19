import {MAX_WORDS, validateText, wordKey, wordExtras} from './core.mjs';
export const plainWord = row => ({id:row.id, en:row.en, uk:row.uk, ...wordExtras(row)});
export function sameContent(a, b) {
  return Boolean(a && b && a.en === b.en && a.uk === b.uk && Boolean(a.deleted) === Boolean(b.deleted) &&
    ['example_en','example_uk','note','category'].every(key => (a[key] || '') === (b[key] || '')));
}
export function checkedRow(row, allowStaged=false) {
  if (!row || typeof row.id !== 'string' || !row.id || row.id.length > 100 || !validateText(row.en) || !validateText(row.uk) || typeof row.deleted !== 'boolean' || !Number.isSafeInteger(row.revision) || row.revision < (allowStaged ? 0 : 1))
    throw new Error('Хмара повернула некоректну картку. Локальний словник не замінено.');
  return {...plainWord(row), deleted:row.deleted, revision:row.revision};
}
export function checkedCloud(value) {
  if (!value || typeof value.owner !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.owner) || typeof value.email !== 'string' || !Array.isArray(value.base) || value.base.length > 100000)
    throw new Error('Некоректні локальні дані синхронізації.');
  const base = value.base.map(row=>checkedRow(row,true));
  if (new Set(base.map(r => r.id)).size !== base.length) throw new Error('Повторні ID у даних синхронізації.');
  return {owner:value.owner, email:value.email, base};
}
export function desiredRow(words, base, id) {
  const word = words.find(w => w.id === id);
  if (word) return {...word, deleted:false};
  const prior = base.find(r => r.id === id);
  return prior ? {...plainWord(prior), deleted:true} : null;
}
export function pendingCount(words, base) {
  const local = new Map(words.map(w => [w.id, {...w, deleted:false}]));
  let count = 0;
  for (const row of base) {
    const desired = local.get(row.id) || {...plainWord(row), deleted:true};
    if (row.revision===0 || !sameContent(desired, row)) count++;
    local.delete(row.id);
  }
  return count + local.size;
}
// Three-way merge: local state, last acknowledged cloud state, current cloud.
// Conflicting edits are kept locally and require an explicit human choice.
export function reconcile(words, baseRows, remoteRows) {
  const local = new Map(words.map(w => [w.id, {...w, deleted:false}]));
  const base = new Map(baseRows.map(r => [r.id, r]));
  const remote = new Map(remoteRows.map(r => {const checked=checkedRow(r); return [checked.id,checked]}));
  const nextBase = new Map(), nextWords = new Map(), writes = [], conflicts = [];
  const remoteKeys = new Map([...remote.values()].filter(r => !r.deleted).map(r => [wordKey(r),r]));
  const adopt = row => { if (row) {nextBase.set(row.id,row); if (!row.deleted) nextWords.set(row.id,plainWord(row));} };
  for (const id of new Set([...remote.keys(), ...base.keys(), ...local.keys()])) {
    const old=base.get(id), current=remote.get(id), here=local.get(id);
    const desired=here || (old ? {...plainWord(old),deleted:true} : null);
    if (!desired || (old && old.revision!==0 && sameContent(desired,old))) {adopt(current); continue;}
    if (sameContent(desired,current)) {adopt(current); continue;}
    // Two devices can independently add the same card with different IDs.
    if (!old && !current && here && remoteKeys.has(wordKey(here))) {adopt(remoteKeys.get(wordKey(here))); continue;}
    // Revision zero is a durably staged INSERT whose response may have been lost.
    if(old?.revision===0 && !current){
      if(desired.deleted)continue;
      nextBase.set(id,old);nextWords.set(id,plainWord(desired));
      writes.push({id,desired,revision:null});continue;
    }
    const stagedMatch=old?.revision===0 && current && sameContent(old,current);
    const unchanged = old && current && old.revision === current.revision && sameContent(old,current);
    if ((!old && !current) || unchanged || stagedMatch) {
      if (old) nextBase.set(id,stagedMatch ? current : old);
      if (!desired.deleted) nextWords.set(id,plainWord(desired));
      writes.push({id, desired, revision:stagedMatch ? current.revision : old?.revision ?? null});
    } else {
      if (old) nextBase.set(id,old);
      if (!desired.deleted) nextWords.set(id,plainWord(desired));
      conflicts.push({id, local:desired, remote:current || null});
    }
  }
  if (nextWords.size > MAX_WORDS) throw new Error('Спільний словник перевищує 5000 слів. Синхронізацію зупинено; локальні зміни збережені.');
  const ordered=[];
  for(const word of words)if(nextWords.has(word.id)){ordered.push(nextWords.get(word.id));nextWords.delete(word.id);}
  return {words:[...ordered,...nextWords.values()], base:[...nextBase.values()], writes, conflicts};
}
