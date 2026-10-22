// Sentence exercises have separate feedback and never change review scores.
export function randomSentenceGap(random=Math.random) {return 3+Math.floor(Math.min(.999999,Math.max(0,random()))*4);}
export function shouldOfferSentence(quiz) {
  return Boolean(quiz?.sentenceEnabled && quiz.checked &&
    (quiz.answers.length>=quiz.nextSentenceAt || quiz.index===quiz.words.length-1));
}
export function checkedSentenceResult(value) {
  if(!value || !['correct','needs_work','uncertain'].includes(value.verdict) ||
    ['target_used','grammar_correct','meaning_correct'].some(k=>typeof value[k]!=='boolean') ||
    typeof value.corrected_sentence!=='string' || value.corrected_sentence.length>1200 ||
    typeof value.explanation_uk!=='string' || !value.explanation_uk || value.explanation_uk.length>1800 ||
    typeof value.natural_alternative!=='string' || value.natural_alternative.length>1200 ||
    !Array.isArray(value.issues_uk) || value.issues_uk.length>3 || value.issues_uk.some(x=>typeof x!=='string' || x.length>600))
    throw new Error('Не вдалося прочитати перевірку речення. Можеш повторити або пропустити.');
  return {verdict:value.verdict,target_used:value.target_used,grammar_correct:value.grammar_correct,meaning_correct:value.meaning_correct,
    corrected_sentence:value.corrected_sentence,explanation_uk:value.explanation_uk,issues_uk:[...value.issues_uk],natural_alternative:value.natural_alternative};
}
export async function requestSentenceCheck(connection,{word,sentence,requestId}) {
  const response=await connection.request('/functions/v1/check-sentence',{method:'POST',body:{request_id:requestId,
    word_id:word.id,en:word.en,uk:word.uk,sentence}});
  return checkedSentenceResult(response?.result);
}
