// Offline retrieval check for the chat's RAG: runs every question in eval_questions.json through the same search the
// server uses (web-server/lib/retrieve.js on web-server/data/corpus.json) and scores the ranked passages against the
// expected reference ids. No network and no AI calls.
//
// Question fields: id, lang ("en" | "ko"), split ("dev" | "test"), question, expected (ref ids; [] = the library does
// not cover it), evidence ([{ref, page}] where the answer was found), type ("specific" | "general" | "unanswerable").
// Tune on "dev" only; report "test" as the held-out score.
//
// Metrics, per answerable question, then averaged (overall, per language, per split):
//   recall@k  share of the expected references that appear among the top k passages
//   hit@k     1 if at least one expected reference appears in the top k
//   MRR       1 / rank of the first passage from an expected reference (0 if none in the top k)
//   page@k    1 if a passage from an evidence page (same ref and page) appears in the top k
// Unanswerable questions are not scored here (retrieval always returns something); they are listed for checking
// that the chat says the sources do not cover them.
// search() keeps at most two passages per reference, so k passages cover between k/2 and k references.
//
// Run from the project root:  node App/tools/eval_retrieval.mjs [--k 8] [--verbose] [--json out.json]
//                                                               [--questions file.json] [--corpus file.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// [복사본 변경 1] 원본 평가셋 위치를 기준으로 기본 경로를 찾는다 (이 파일은 HRSG/tools/official_eval/ 에 있음)
const official = resolve(here, '../../hrsg_eval_set_v1/App/tools');
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const K = Math.max(1, +opt('k', 8) || 8);
const verbose = args.includes('--verbose');
const qFile = resolve(opt('questions', resolve(official, 'eval_questions.json')));
const cFile = resolve(opt('corpus', resolve(official, '../web-server/data/corpus.json')));

// web-server has no "type": "module"; read retrieve.js as an ES module from a data: URL so Node never has to guess
// [복사본 변경 2] --retriever 로 search(corpus, q, k) 를 내보내는 다른 검색 파일을 쓸 수 있다 (기본: 원본 BM25)
const src = readFileSync(resolve(opt('retriever', resolve(official, '../web-server/lib/retrieve.js'))), 'utf8');
const { search } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));

const corpus = JSON.parse(readFileSync(cFile, 'utf8'));
const questions = JSON.parse(readFileSync(qFile, 'utf8'));

const missing = questions.flatMap(q => q.expected.filter(r => !corpus.refs[r]).map(r => `${q.id}: ${r}`));
if (missing.length) { console.error('Expected ids not in the corpus:\n  ' + missing.join('\n  ')); process.exit(1); }

const rows = questions.map(q => {
  const hits = search(corpus, q.question, K);
  const ranked = hits.map((p, i) => ({ rank: i + 1, ref: p.ref, page: p.page, kind: p.kind }));
  const base = { id: q.id, lang: q.lang, split: q.split || 'dev', question: q.question, expected: q.expected, ranked };
  if (!q.expected.length) return { ...base, answerable: false };
  const want = new Set(q.expected), got = new Set(hits.map(p => p.ref).filter(r => want.has(r)));
  const first = hits.findIndex(p => want.has(p.ref));
  const ev = q.evidence || [];
  const pageHit = ev.length ? (hits.some(p => ev.some(e => e.ref === p.ref && (e.page ?? null) === (p.page ?? null))) ? 1 : 0) : null;
  return { ...base, answerable: true, recall: got.size / want.size, hit: first >= 0 ? 1 : 0, rr: first >= 0 ? 1 / (first + 1) : 0,
    page: pageHit, found: [...got] };
});

const scored = rows.filter(r => r.answerable);
const mean = (xs, f) => xs.length ? xs.reduce((a, x) => a + f(x), 0) / xs.length : 0;
const summary = rs => {
  const withPage = rs.filter(r => r.page !== null);
  return { n: rs.length, recall: mean(rs, r => r.recall), hit: mean(rs, r => r.hit), mrr: mean(rs, r => r.rr), page: withPage.length ? mean(withPage, r => r.page) : null };
};
const groups = { all: summary(scored) };
for (const lang of [...new Set(scored.map(r => r.lang))]) groups[lang] = summary(scored.filter(r => r.lang === lang));
for (const split of [...new Set(scored.map(r => r.split))]) groups[split] = summary(scored.filter(r => r.split === split));

const f = x => x == null ? '  -  ' : x.toFixed(3);
console.log(`corpus: ${Object.keys(corpus.refs).length} references, ${corpus.passages.length} passages; ${rows.length} questions (${scored.length} answerable); k = ${K}\n`);
console.log('id      split recall  RR     found / expected');
for (const r of rows) {
  const head = `${r.id.padEnd(7)} ${r.split.padEnd(5)}`;
  if (!r.answerable) console.log(`${head} (not covered: the chat should say so)   ${r.question.slice(0, 60)}`);
  else console.log(`${head} ${f(r.recall)}   ${f(r.rr)}  ${r.found.length}/${r.expected.length}  ${r.question.slice(0, 60)}`);
  if (verbose) {
    for (const p of r.ranked) console.log(`          ${String(p.rank).padStart(2)}. ${r.expected.includes(p.ref) ? '*' : ' '} ${p.ref}${p.page ? ' p.' + p.page : ''} (${p.kind})`);
    const lost = r.answerable ? r.expected.filter(x => !r.found.includes(x)) : [];
    if (lost.length) console.log(`          missed: ${lost.join(', ')}`);
  }
}
console.log(`\n          n   recall@${K}  hit@${K}   MRR     page@${K}`);
for (const [g, s] of Object.entries(groups)) console.log(`${g.padEnd(6)} ${String(s.n).padStart(4)}   ${f(s.recall)}     ${f(s.hit)}   ${f(s.mrr)}   ${f(s.page)}`);

const out = opt('json');
if (out) writeFileSync(out, JSON.stringify({ k: K, corpus: cFile, summary: groups, questions: rows }, null, 1));
