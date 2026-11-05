// 채점 복사본(eval_retrieval_dev.mjs --retriever)이 불러 쓰는 검색 함수.
// 미리 계산한 결합 순위(공식 passage 배열 인덱스 목록)를 읽어, retrieve.js 와 같은 cap()(같은 참고문헌 최대 2개, k 개)을 적용해 돌려준다.
// 순위 파일 위치는 환경변수 RAG_RANKING. 파일에는 passage 마다 ref·page·kind 가 함께 저장되어 있어 공식 corpus 와 대조한다.
// 순위 파일에 없는 질문이면 대체 결과를 만들지 않고 오류를 낸다.
import { readFileSync } from 'node:fs';

const file = process.env.RAG_RANKING;
if (!file) throw new Error('RAG_RANKING 환경변수(결합 순위 파일)가 필요합니다');
const data = JSON.parse(readFileSync(file, 'utf8'));
let checked = false;

function verify(corpus) {
  if (corpus.passages.length !== data.passages.length) throw new Error('passage 수가 순위 파일과 다릅니다');
  corpus.passages.forEach((p, i) => {
    const k = data.passages[i];
    if (p.ref !== k.ref || (p.page ?? null) !== (k.page ?? null) || p.kind !== k.kind) throw new Error(`passage ${i} 의 ref/page/kind 가 다릅니다`);
  });
  checked = true;
}

export function search(corpus, q, k) {
  if (!checked) verify(corpus);
  const order = data.rankings[q];
  if (!order) throw new Error('순위 파일에 없는 질문: ' + q.slice(0, 40));
  // retrieve.js 의 cap 과 같은 규칙
  const per = new Map(), out = [];
  for (const i of order) {
    const p = corpus.passages[i], n = per.get(p.ref) || 0;
    if (n >= 2) continue;
    per.set(p.ref, n + 1); out.push(p);
    if (out.length >= k) break;
  }
  return out;
}
