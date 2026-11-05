// 공식 BM25(retrieve.js, KO_TERMS 포함)의 cap() 적용 전 순위를 dev 질문마다 저장한다.
// 원본 retrieve.js 를 고치지 않는다: passage 마다 서로 다른 임시 ref("#0", "#1", ...)를 붙인 corpus 사본을 넘기면
// BM25 점수(본문만 사용)는 그대로이고 cap()(같은 ref 최대 2개)만 걸리지 않는다. 결과의 배열 인덱스 = 공식 passage 인덱스.
// 검증: 이 순위에 원본과 같은 cap 을 적용한 상위 8개가 원본 search() 결과와 문항마다 같은지 확인한다.
// 시간: 색인을 만든 뒤(첫 질의로 예열) 질문마다 원본 search() 한 번의 처리 시간을 잰다.
// 실행 (HRSG 폴더에서): node tools/official_eval/bm25_candidates.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RETRIEVE = 'hrsg_eval_set_v1/App/web-server/lib/retrieve.js';
const CORPUS = 'hrsg_eval_set_v1/App/web-server/data/corpus.json';
// --questions / --out 으로 다른 질문 파일을 쓸 수 있다 (기본: dev 사본). test 는 확정 설정 실행(run_test_locked.py)에서만 쓴다.
const argv = process.argv.slice(2), arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const DEV = arg('questions', '.cache/official/eval_questions.dev.json');
const OUT = arg('out', '.cache/official/bm25_candidates.dev.json');
const MAX_CANDIDATES = 200;

const sha = f => createHash('sha256').update(readFileSync(f)).digest('hex');
const src = readFileSync(RETRIEVE, 'utf8');
// 모듈 안의 색인 캐시(index)가 섞이지 않도록 용도마다 따로 불러온다
const load = tag => import('data:text/javascript;base64,' + Buffer.from(src + `\n// ${tag}`).toString('base64'));
const raw = await load('uncapped');
const orig = await load('original');

const corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
const questions = JSON.parse(readFileSync(DEV, 'utf8'));
const unique = { refs: corpus.refs, passages: corpus.passages.map((p, i) => ({ ...p, ref: '#' + i })) };
const N = corpus.passages.length;

// retrieve.js 와 같은 cap: 같은 ref 최대 2개, k 개까지
const cap = (idx, k) => { const per = new Map(), out = []; for (const i of idx) { const r = corpus.passages[i].ref, n = per.get(r) || 0; if (n >= 2) continue; per.set(r, n + 1); out.push(i); if (out.length >= k) break; } return out; };

raw.search(unique, 'warm up', N);
orig.search(corpus, 'warm up', 8);
let mismatch = 0;
const rows = questions.map(q => {
  const ranked = raw.search(unique, q.question, N, { scores: true }).map(p => ({ i: +p.ref.slice(1), s: p.score }));
  const t0 = process.hrtime.bigint();
  const official = orig.search(corpus, q.question, 8);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const mine = cap(ranked.map(x => x.i), 8).map(i => corpus.passages[i]);
  if (mine.length !== official.length || mine.some((p, j) => p !== official[j])) mismatch++;
  return { id: q.id, question: q.question, query_ms: ms, n_scored: ranked.length, ranking: ranked.slice(0, MAX_CANDIDATES) };
});
if (mismatch) { console.error(`원본 search() 와 다른 문항 ${mismatch}개 — 중단`); process.exit(1); }

const out = { retrieve_sha256: sha(RETRIEVE), corpus_sha256: sha(CORPUS), dev_sha256: sha(DEV), passages: N,
  note: 'ranking = cap 적용 전 BM25 순위(배열 인덱스 i, 점수 s), 상위 ' + MAX_CANDIDATES + '개까지. query_ms = 원본 search() 1회 시간(색인 예열 후)',
  questions: rows };
writeFileSync(OUT, JSON.stringify(out));
const ms = rows.map(r => r.query_ms).sort((a, b) => a - b);
console.log(`${rows.length}문항: 원본 search() 상위 8개와 모두 일치. BM25 질의당 중앙값 ${ms[ms.length >> 1].toFixed(2)} ms. 저장 ${OUT}`);
