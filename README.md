# 📖 Academic Expression Learner

> 좋은 논문에서 학술 글쓰기 표현을 배워보세요!

논문 PDF를 업로드하면 학술 글쓰기에 유용한 표현들을 자동으로 추출하여 카테고리별로 정리해주는 웹 앱입니다.

## 🌐 Demo

[Live Demo](https://claire-art.github.io/academic-expression/)

## ✨ 주요 기능

- 📄 **PDF 텍스트 추출**: PDF.js로 페이지/줄 단위 텍스트 인덱싱 (필요 시 Upstage OCR로 폴백)
- 🔍 **표현 추출**: OpenAI GPT로 학술 표현 패턴 분석
- 📊 **카테고리 분류**: 연구 배경, 방법론, 결과, 논의 등 섹션별 정리
- 🧾 **인용(페이지/줄)**: 추출된 예문이 논문 몇 페이지/몇 줄인지 자동 추정
- 📝 **문장·숙어 정리**: 논문 문장을 추출하고, 재사용하기 좋은 학술 숙어/표현을 함께 정리
- 📇 **Anki 내보내기**: 플래시카드로 표현 암기
- 📝 **마크다운 내보내기**: 노션/옵시디언에 바로 붙여넣기

## 🚀 GitHub Pages 배포 방법

### 1. Repository 생성
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/academic-expression-learner.git
git push -u origin main
```

### 2. GitHub Pages 활성화
1. Repository의 **Settings** 탭 클릭
2. 왼쪽 메뉴에서 **Pages** 클릭
3. **Source**에서 `Deploy from a branch` 선택
4. **Branch**에서 `main` / `/ (root)` 선택
5. **Save** 클릭

### 3. 배포 완료!
몇 분 후 `https://YOUR_USERNAME.github.io/academic-expression-learner/` 에서 접속 가능

## 🔑 API 키 준비

이 앱은 기본적으로 OpenAI API Key가 필요하며, 스캔 PDF(OCR 필요)일 때만 Upstage API Key가 필요합니다.

### Upstage API Key
1. [Upstage Console](https://console.upstage.ai/) 접속
2. 회원가입 후 API Key 발급
3. Document OCR API 사용 가능 확인

### OpenAI API Key
1. [OpenAI Platform](https://platform.openai.com/) 접속
2. 회원가입 후 API Key 발급
3. GPT-4o-mini 모델 사용 가능 확인

## 🔒 보안 참고사항

- API 키는 브라우저에서만 사용되며 서버에 저장되지 않습니다
- 페이지 새로고침 시 API 키가 초기화됩니다
- 공용 컴퓨터에서 사용 시 브라우저 탭을 닫아주세요

## 🎯 추출 항목

| 카테고리 | 설명 | 예시 |
|---------|------|------|
| 연구 배경 제시 | 관심 증가, 중요성 강조 | "There has been growing interest in..." |
| 연구 갭 지적 | 기존 연구 한계 | "Despite extensive research, little is known about..." |
| 연구 목적 | 목표 제시 | "This study aims to..." |
| 방법론 설명 | 실험 설계, 데이터 수집 | "Data were collected from..." |
| 결과 제시 | 발견, 통계 | "The results revealed that..." |
| 해석/논의 | 의미 부여, 비교 | "This finding is consistent with..." |
| 한계점 인정 | 제한점 | "This study has several limitations..." |
| 학술 동사 | 핵심 동사 | demonstrate, investigate, reveal |
| 연결어 | 전환 표현 | However, Furthermore, Nevertheless |

추가로, 각 예문/문장에 대해 가능한 경우 `p. X, line Y–Z` 형태의 인용 정보를 함께 제공합니다.

## 📁 프로젝트 구조

```
academic-expression-learner/
├── index.html          # 메인 웹 앱 (단일 파일)
└── README.md           # 문서
```

## 🔧 사용된 기술

- **Vanilla JS**: 프레임워크 없이 순수 JavaScript
- **PDF.js**: 브라우저에서 PDF 처리
- **Upstage API**: 문서 OCR
- **OpenAI API**: GPT-4o-mini로 표현 추출

## 📌 사용 팁

1. **좋은 논문 선택**: Nature, Science, 분야 탑 저널 논문이 좋은 표현이 많습니다
2. **여러 논문 분석**: 같은 분야 논문을 여러 개 분석하면 분야 특화 표현을 익힐 수 있습니다
3. **Anki로 암기**: 추출된 표현을 Anki에 넣어 매일 복습하세요
4. **실제 사용**: 논문 작성 시 추출된 표현을 참고하여 자신의 문장으로 변형해보세요

## 📄 라이선스

MIT License
