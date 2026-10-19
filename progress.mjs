// An append-only review log makes offline practice on two devices merge safely.
export const MAX_REVIEWS = 30000;
const DAY = 86400000;
const INTERVALS = [1, 3, 7, 14, 30];
export const DIRECTIONS = ['en-uk', 'uk-en'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function checkedReview(row) {
  if (!row || !uuid.test(row.id) || typeof row.word_id !== 'string' || !row.word_id || row.word_id.length > 100 ||
    typeof row.word_key !== 'string' || !row.word_key || row.word_key.length > 5000 ||
    !DIRECTIONS.includes(row.direction) || typeof row.correct !== 'boolean' ||
    typeof row.reviewed_at !== 'string' || !Number.isFinite(Date.parse(row.reviewed_at)) ||
    Date.parse(row.reviewed_at) < Date.UTC(2020,0,1) || Date.parse(row.reviewed_at) > Date.UTC(2100,0,1) ||
    (row.replaces != null && (!uuid.test(row.replaces) || row.replaces === row.id || !row.correct)))
    throw new Error('Некоректна історія повторень. Дані не змінено.');
  return {id:row.id.toLowerCase(),word_id:row.word_id,word_key:row.word_key,direction:row.direction,
    correct:row.correct,reviewed_at:new Date(row.reviewed_at).toISOString(),replaces:row.replaces?.toLowerCase() || null};
}
export function mergeReviews(...logs) {
  const rows = new Map();
  for (const log of logs) {
    if (!Array.isArray(log) || log.length > MAX_REVIEWS) throw new Error('Історія повторень завелика або має неправильний формат.');
    for (const raw of log) {
      const row=checkedReview(raw), prior=rows.get(row.id);
      if (prior && JSON.stringify(prior)!==JSON.stringify(row)) throw new Error('Конфлікт записів прогресу. Збережи JSON-копію.');
      rows.set(row.id,row);
    }
  }
  if (rows.size > MAX_REVIEWS) throw new Error('Історія досягла ліміту 30 000 записів. Збережи JSON-копію.');
  return [...rows.values()].sort((a,b)=>a.reviewed_at.localeCompare(b.reviewed_at) || a.id.localeCompare(b.id));
}
export const progressKey = (id,key,direction) => JSON.stringify([id,key,direction]);
export function buildProgress(reviews, now=Date.now()) {
  const originals = new Map(reviews.filter(r=>!r.replaces).map(r=>[r.id,r]));
  const accepted = new Set();
  for (const r of reviews) {
    const original=originals.get(r.replaces);
    if (r.correct && original && r.word_id===original.word_id && r.word_key===original.word_key && r.direction===original.direction && r.reviewed_at===original.reviewed_at)
      accepted.add(original.id);
  }
  const grouped=new Map();
  for(const row of originals.values()) {
    const key=progressKey(row.word_id,row.word_key,row.direction);
    if(!grouped.has(key))grouped.set(key,[]);
    grouped.get(key).push({...row,correct:row.correct || accepted.has(row.id)});
  }
  const result=new Map();
  for(const [key,rows] of grouped) {
    rows.sort((a,b)=>a.reviewed_at.localeCompare(b.reviewed_at) || a.id.localeCompare(b.id));
    let correct=0,streak=0,stage=0,due=0,last=0;
    for(const row of rows) {
      const time=Date.parse(row.reviewed_at);last=time;
      if(row.correct) {
        correct++;streak++;
        // Early practice counts as an attempt, but never advances spaced mastery.
        if(time>=due) {stage=Math.min(stage+1,5);due=time+INTERVALS[stage-1]*DAY;}
      } else {streak=0;stage=0;due=time+10*60000;}
    }
    result.set(key,{total:rows.length,correct,streak,stage,due,last,dueNow:due<=now,
      label:due<=now ? 'Час повторити' : stage>=5 ? 'Засвоєно' : stage>=2 ? 'Закріплюю' : 'Вчу'});
  }
  return result;
}
export function progressFor(index,id,key,direction) {
  return index.get(progressKey(id,key,direction)) || {total:0,correct:0,streak:0,stage:0,due:0,last:0,dueNow:false,label:'Нове'};
}
export function selectPractice(words,index,direction,keyOf,{all=false,limit=words.length,random=Math.random}={}) {
  const scored=words.map(word=>({word,p:progressFor(index,word.id,keyOf(word),direction),tie:random()}));
  const eligible=all ? scored : scored.filter(x=>!x.p.total || x.p.dueNow);
  // Due reviews first, then new words; shuffle within the groups.
  eligible.sort((a,b)=>Number(!a.p.dueNow)-Number(!b.p.dueNow) || a.tie-b.tie);
  return eligible.slice(0,limit).map(x=>x.word);
}
export function reviewAliases(reviews,words,keyOf) {
  const ids=new Set(words.map(w=>w.id));
  const byKey=new Map(words.map(w=>[keyOf(w),w.id]));
  return reviews.map(r=>ids.has(r.word_id) ? r : {...r,word_id:byKey.get(r.word_key) || r.word_id});
}
