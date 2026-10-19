import {checkedReview, MAX_REVIEWS} from './progress.mjs';
// Small REST client; no CDN, build tools, or third-party runtime packages.
import {checkedRow} from './sync.mjs';
import {wordExtras} from './core.mjs';
export class CloudError extends Error {
  constructor(message, status=0, code='') {super(message);this.status=status;this.code=code;}
}
export class SupabaseConnection {
  constructor({url,key,storage,sessionKey,fetcher=globalThis.fetch,locks=globalThis.navigator?.locks}) {
    this.url=url; this.key=key; this.storage=storage; this.sessionKey=sessionKey; this.fetcher=(...args)=>fetcher.call(globalThis,...args); this.locks=locks; this.refreshing=null;
  }
  session() {
    try {
      const s=JSON.parse(this.storage.getItem(this.sessionKey));
      return s && typeof s.access_token === 'string' && typeof s.refresh_token === 'string' && Number.isFinite(s.expires_at) && typeof s.user?.id === 'string' ? s : null;
    } catch {return null;}
  }
  saveSession(value) {
    if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string' || !/^[a-f0-9-]{36}$/i.test(value.user?.id || '')) throw new CloudError('Не вдалося підтвердити обліковий запис.');
    const session={access_token:value.access_token,refresh_token:value.refresh_token,expires_at:Math.floor(Date.now()/1000)+(value.expires_in || 3600),user:{id:value.user.id,email:value.user.email || ''}};
    this.storage.setItem(this.sessionKey,JSON.stringify(session)); return session;
  }
  async raw(path, {method='GET',body,token,prefer}={}) {
    const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await this.fetcher(this.url+path,{method,cache:'no-store',signal:controller.signal,headers:{apikey:this.key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} : {}),...(prefer?{Prefer:prefer}:{})},...(body !== undefined ? {body:JSON.stringify(body)} : {})});
      const text=await response.text(); let value;
      try {value=text?JSON.parse(text):null;} catch {throw new CloudError('Сервіс повернув неочікувану відповідь. Спробуй пізніше.',response.status);}
      if (!response.ok) {
        let message='Не вдалося зв’язатися з хмарою. Слова залишилися на пристрої.';
        if (path.includes('/token') && response.status===400) message='Перевір пошту й пароль. Якщо вхід працював раніше — увійди повторно.';
        else if(response.status===401 && /invalid api key/i.test(value?.message || '')) message='Supabase відхилив публічний ключ. Перевір config.js та відповідність ключа проєкту.';
        else if(response.status===401) message='Потрібен повторний вхід у словник.';
        else if(response.status===403) message='Немає доступу до хмарного словника. Перевір налаштування Supabase.';
        else if(response.status===429) message='Забагато спроб. Зачекай трохи й повтори.';
        else if(response.status===404 || ['42P01','PGRST205'].includes(value?.code)) message=path.includes('vocabulary_reviews') ? 'Потрібна таблиця прогресу: виконай 01-add-progress.sql із комплекту v3.4.0. Відповіді збережено на пристрої.' : 'Хмарну таблицю не знайдено. Перевір, чи створена vocabulary_words.';
        else if(['42703','PGRST204'].includes(value?.code)) message='Потрібно оновити поля Supabase: виконай 01-update-structure.sql із комплекту v3.3.0. Локальні слова збережені.';
        throw new CloudError(message,response.status,value?.code || value?.error_code || '');
      }
      return value;
    } catch(error) {
      if(error instanceof CloudError)throw error;
      const detail=error?.name==='AbortError' ? 'Сервер не відповів за 20 секунд.' : `Причина: ${String(error?.message || 'мережевий запит не виконано').slice(0,140)}`;
      throw new CloudError(`Не вдалося виконати запит до Supabase. Локальні слова залишилися на пристрої. ${detail}`);
    } finally {clearTimeout(timer);}
  }
  async login(email,password) {return this.saveSession(await this.raw('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password}}));}
  async token(force=false, failedToken=null) {
    const run=async()=>{
      const s=this.session();if(!s)throw new CloudError('Увійди, щоб синхронізувати словник.',401);
      if((!force && s.expires_at > Date.now()/1000+60) || (force && failedToken && s.access_token!==failedToken))return s.access_token;
      const value=await this.raw('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:s.refresh_token}});
      // A logout in this tab while a refresh was in flight must stay logged out.
      if(!this.session())throw new CloudError('Сеанс завершено. Увійди повторно.',401);
      return this.saveSession(value).access_token;
    };
    if(this.refreshing)return this.refreshing;
    this.refreshing=this.locks ? this.locks.request(`vocabulary-auth:${this.sessionKey}`,run) : run();
    try{return await this.refreshing;}finally{this.refreshing=null;}
  }
  async request(path, options={}) {
    const token=await this.token();
    try{return await this.raw(path,{...options,token});}
    catch(error){if(error.status!==401)throw error;return this.raw(path,{...options,token:await this.token(true,token)});}
  }
  async list(owner) {
    const rows=[];
    for(let offset=0;offset<100000;offset+=500){
      const q=new URLSearchParams({select:'id,en,uk,example_en,example_uk,note,category,part_of_speech,pattern,deleted,revision',user_id:`eq.${owner}`,order:'id.asc',limit:'500',offset:String(offset)});
      const page=await this.request(`/rest/v1/vocabulary_words?${q}`);
      if(!Array.isArray(page))throw new CloudError('Неочікувана відповідь таблиці слів.');
      rows.push(...page.map(row=>checkedRow(row)));
      if(page.length<500)return rows;
    }
    throw new CloudError('Забагато записів для цієї версії. Локальний словник не змінено.');
  }
  async write(owner, operation) {
    const body={en:operation.desired.en,uk:operation.desired.uk,...wordExtras(operation.desired),deleted:operation.desired.deleted};
    let rows;
    if(operation.revision === null){
      rows=await this.request('/rest/v1/vocabulary_words',{method:'POST',body:{...body,user_id:owner,id:operation.id},prefer:'return=representation'});
    }else{
      const q=new URLSearchParams({user_id:`eq.${owner}`,id:`eq.${operation.id}`,revision:`eq.${operation.revision}`});
      rows=await this.request(`/rest/v1/vocabulary_words?${q}`,{method:'PATCH',body,prefer:'return=representation'});
    }
    if(!Array.isArray(rows)||rows.length!==1)throw new CloudError('Слово щойно змінилося на іншому пристрої. Повторюємо перевірку.',409);
    return checkedRow(rows[0]);
  }
  async listReviews(owner) {
    const rows=[];
    for(let offset=0;offset<=MAX_REVIEWS;offset+=500) {
      const q=new URLSearchParams({select:'id,word_id,word_key,direction,correct,reviewed_at,replaces',user_id:`eq.${owner}`,order:'id.asc',limit:'500',offset:String(offset)});
      const page=await this.request(`/rest/v1/vocabulary_reviews?${q}`);
      if(!Array.isArray(page))throw new CloudError('Неочікувана відповідь таблиці прогресу.');
      rows.push(...page.map(checkedReview));
      if(rows.length>MAX_REVIEWS)throw new CloudError('Історія повторень завелика. Збережи JSON-копію.');
      if(page.length<500)return rows;
    }
  }
  async writeReviews(owner, rows) {
    for(let i=0;i<rows.length;i+=100) {
      const body=rows.slice(i,i+100).map(row=>({...checkedReview(row),user_id:owner}));
      await this.request('/rest/v1/vocabulary_reviews?on_conflict=user_id,id',{
        method:'POST',body,prefer:'resolution=ignore-duplicates,return=minimal'});
    }
  }
  async logout() {
    const s=this.session();this.storage.removeItem(this.sessionKey);
    if(s)try{await this.raw('/auth/v1/logout?scope=local',{method:'POST',token:s.access_token});}catch{/* Local sign-out still succeeds without a network. */}
  }
}
