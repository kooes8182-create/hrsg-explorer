// 공식 eval_questions.json 에서 dev 문항만 뽑아 .cache/official/eval_questions.dev.json 사본을 만든다.
// 원본은 읽기만 하고, SHA256 이 README v1 값과 다르면 중단한다.
// 실행 (HRSG 폴더에서): node tools/official_eval/make_dev_set.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const SRC = 'hrsg_eval_set_v1/App/tools/eval_questions.json';
const SHA = '7a4744dab9255454f7e8f4926327faa0a7eacf8851377016dc005ce3d7393d25';
const buf = readFileSync(SRC);
const sha = createHash('sha256').update(buf).digest('hex');
if (sha !== SHA) throw new Error(`원본 평가셋 해시가 README v1 값과 다릅니다: ${sha}`);
const dev = JSON.parse(buf).filter(q => q.split === 'dev');
mkdirSync('.cache/official', { recursive: true });
writeFileSync('.cache/official/eval_questions.dev.json', JSON.stringify(dev, null, 1));
const meta = { source: SRC, source_sha256: sha, filter: 'split === "dev"', count: dev.length,
  answerable: dev.filter(q => q.expected.length).length, unique_question_text: new Set(dev.map(q => q.question)).size };
writeFileSync('.cache/official/eval_questions.dev.meta.json', JSON.stringify(meta, null, 1));
console.log(meta);
