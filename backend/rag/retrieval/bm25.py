"""BM25 키워드 검색 (프로토타입 구현).

공식 협업 앱의 BM25 코드는 이 프로젝트에 없어서 새로 구현했습니다. 따라서 이 BM25 결과는
협업안의 'BM25 기준선'(recall@8 0.73 등)과 같은 것이 아닙니다.

토큰화
  - 영문·숫자: 소문자 단어 단위 (IF97, B31A 같은 기호도 하나의 단어로 유지)
  - 한글·한자: 형태소 분석기 없이 글자 2개씩 묶은 바이그램 (한 글자 단어는 그대로)
  - 영어 불용어 몇 개만 제거, 어간 추출 없음

한국어 용어 확장: 공식 앱의 용어 목록이 제공되지 않아 기본값은 '확장 없음'입니다.
  {"과열기": ["superheater"]} 형태의 JSON 파일을 넘기면 BM25 질의에만 영어 단어를 덧붙입니다
  (벡터 검색은 항상 원래 질문을 씁니다).
"""

import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

K1 = 1.5
B = 0.75

_TOKEN = re.compile(r"[a-z0-9]+|[가-힣]+|[一-鿿]+")
_STOP = frozenset(
    "a an and are as at be by for from has have in is it its of on or that the this to was were which with".split()
)


def tokenize(text):
    out = []
    for tok in _TOKEN.findall(text.lower()):
        if tok[0].isascii():
            if tok not in _STOP:
                out.append(tok)
        elif len(tok) == 1:
            out.append(tok)
        else:
            out.extend(tok[i:i + 2] for i in range(len(tok) - 1))
    return out


def load_expansion(path):
    if not path:
        return {}
    p = Path(path)
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def expand_query(query, expansion):
    """용어 목록에 있는 한국어 단어가 질문에 있으면 영어 단어를 덧붙입니다 (BM25 전용)."""
    extra = [en for ko, ens in expansion.items() if ko in query for en in ens]
    return query + (" " + " ".join(extra) if extra else "")


class BM25Index:
    def __init__(self, texts, expansion=None):
        self.expansion = expansion or {}
        self.n = len(texts)
        self.doc_len = np.zeros(self.n, dtype=np.float32)
        postings = defaultdict(list)
        for i, text in enumerate(texts):
            tf = Counter(tokenize(text))
            self.doc_len[i] = sum(tf.values())
            for term, c in tf.items():
                postings[term].append((i, c))
        self.avgdl = float(self.doc_len.mean()) if self.n else 0.0
        self.postings = {}
        self.idf = {}
        for term, plist in postings.items():
            ids = np.fromiter((p[0] for p in plist), dtype=np.int32, count=len(plist))
            tfs = np.fromiter((p[1] for p in plist), dtype=np.float32, count=len(plist))
            self.postings[term] = (ids, tfs)
            df = len(plist)
            self.idf[term] = math.log(1 + (self.n - df + 0.5) / (df + 0.5))

    def scores(self, query):
        q = expand_query(query, self.expansion)
        scores = np.zeros(self.n, dtype=np.float32)
        norm = K1 * (1 - B + B * self.doc_len / self.avgdl) if self.n else None
        for term, qtf in Counter(tokenize(q)).items():
            if term not in self.postings:
                continue
            ids, tfs = self.postings[term]
            scores[ids] += qtf * self.idf[term] * tfs * (K1 + 1) / (tfs + norm[ids])
        return scores

    def search(self, query, k):
        """상위 k 개 (문단 번호, 점수). 점수 0(일치 단어 없음)은 후보에 넣지 않습니다."""
        s = self.scores(query)
        hit = np.flatnonzero(s > 0)
        if not len(hit):
            return []
        top = hit[np.argsort(-s[hit], kind="stable")[:k]]
        return [(int(i), float(s[i])) for i in top]
