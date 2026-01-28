# Academic Expression Learner

좋은 논문(PDF)에서 “바로 써먹을 수 있는” 학술 글쓰기 표현을 뽑아, 카테고리별로 정리하고(＋문장/숙어/동사/연결어), 가능한 경우 **몇 페이지·몇 줄에서 나온 표현인지**까지 함께 보여주는 정적 웹앱입니다.

라이브: https://claire-art.github.io/academic-expression/

## 이 페이지는 이런 분께 좋아요

- 영어 논문을 쓸 때 문장 톤이 어색한 연구자/대학원생
- 방법/결과/논의에서 자주 쓰는 “학술 표현 템플릿”이 필요한 분
- 논문에서 좋은 문장을 뽑아서 Anki/노션으로 공부하고 싶은 분

## 어떻게 쓰나요

1. 페이지를 열고 Upstage API Key를 입력합니다.
2. 논문 PDF를 업로드합니다.
3. `분석 시작`을 누르면
	- Upstage OCR로 텍스트를 추출하고
	- Upstage LLM( `solar-pro3` )로 학술 표현을 구조화해서 뽑아줍니다.
4. 결과 탭(카테고리/문장·숙어/동사/연결어)을 확인하고, Anki/Markdown으로 내보냅니다.

## 주요 기능

- Upstage OCR 기반 PDF 텍스트 추출(스캔 PDF 포함)
- 카테고리별 학술 표현(예문/사용 상황/난이도)
- 문장·숙어 정리(학습용으로 한 번 더 보기 좋게)
- 학술 동사/연결어(로컬 확장 포함)
- 인용 정보 자동 추정: `p. X, line Y–Z` (가능한 범위에서)
- 내보내기: Anki 탭 구분 텍스트 / Markdown

## API 키 준비 (Upstage만 필요)

- Upstage Console: https://console.upstage.ai/
- 이 앱은 브라우저에서 Upstage API를 직접 호출합니다.

## 보안/개인정보 참고

- 이 앱은 **정적 사이트**입니다. API 키를 서버에 저장하지 않지만, **브라우저에 입력된 키로 Upstage API를 호출**합니다.
- 공용 PC에서는 사용 후 탭을 닫고, 키 재사용을 피해주세요.
- 민감한 문서를 다룰 때는 Upstage 정책/보안 요건을 확인하세요.

## 인용(페이지/줄) 정확도에 대해

- PDF가 “선택 가능한 텍스트”를 포함하면(스캔이 아닌 경우) 페이지/줄 추정이 더 정확해집니다.
- 스캔 PDF는 OCR 텍스트만으로 줄 번호를 완벽히 복원하기 어려워, 인용은 **추정값**입니다.

## 프로젝트 구조

```
academic-expression-learner/
├── index.html
├── styles.css
├── app.js
└── README.md
```

## 사용한 기술

- Vanilla JS
- PDF.js (페이지/줄 인덱싱 보조)
- Upstage Document Digitization (OCR)
- Upstage OpenAI-compatible Chat Completions (model: `solar-pro3`)
