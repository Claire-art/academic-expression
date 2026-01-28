/*
  Academic Expression Learner
  - OCR: Upstage Document Digitization API
  - Analysis: Upstage Chat Completions (OpenAI-compatible)

  Security note:
  - This is a static client-side app. API keys are used in the browser.
  - Do NOT hardcode keys in this repository.
*/

// PDF.js worker setup (provided by CDN script in index.html)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ----------------------------
// State
// ----------------------------
let state = {
  upstageKey: '',
  file: null,
  extractedData: null,
  pdfIndex: null,
  extractionMethod: null,
  currentTab: 'expressions'
};

// ----------------------------
// DOM Elements
// ----------------------------
const upstageKeyInput = document.getElementById('upstage-key');
const upstageStatus = document.getElementById('upstage-status');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const analyzeBtn = document.getElementById('analyze-btn');
const progressContainer = document.getElementById('progress-container');
const errorMessage = document.getElementById('error-message');
const emptyState = document.getElementById('empty-state');
const resultsContainer = document.getElementById('results-container');
const tabContent = document.getElementById('tab-content');

// ----------------------------
// UI wiring
// ----------------------------
upstageKeyInput.addEventListener('input', (e) => {
  state.upstageKey = e.target.value;
  upstageStatus.classList.toggle('active', e.target.value.length > 0);
  updateAnalyzeButton();
});

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('dragover');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === 'application/pdf') {
    handleFile(files[0]);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files.length > 0) {
    handleFile(e.target.files[0]);
  }
});

function handleFile(file) {
  state.file = file;
  uploadZone.classList.add('has-file');
  fileInfo.textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
  updateAnalyzeButton();
}

function updateAnalyzeButton() {
  // Upstage is required for BOTH OCR and LLM analysis.
  const ready = state.upstageKey && state.file;
  analyzeBtn.disabled = !ready;
}

// ----------------------------
// Main flow
// ----------------------------
analyzeBtn.addEventListener('click', async () => {
  if (analyzeBtn.classList.contains('loading')) return;

  analyzeBtn.classList.add('loading');
  analyzeBtn.disabled = true;
  progressContainer.classList.add('show');
  errorMessage.style.display = 'none';

  try {
    // Step 1: OCR extract + page/line indexing helper
    setProgress(1, 'active');
    const extracted = await extractTextFromPDF(state.file);
    const text = extracted.fullText;
    state.pdfIndex = extracted.pdfIndex;
    state.extractionMethod = extracted.method;
    setProgress(1, 'done');

    // Step 2: Upstage LLM analysis
    setProgress(2, 'active');
    const analysis = await extractExpressions(text);
    setProgress(2, 'done');

    // Step 3: Attach citations + enrich verbs/transitions + sentence view
    setProgress(3, 'active');
    state.extractedData = postProcessAnalysis(analysis, state.pdfIndex, text, state.extractionMethod);
    renderResults();
    setProgress(3, 'done');

    emptyState.style.display = 'none';
    resultsContainer.style.display = 'block';
  } catch (error) {
    console.error('Error:', error);
    errorMessage.textContent = `오류: ${error.message}`;
    errorMessage.style.display = 'block';
  } finally {
    analyzeBtn.classList.remove('loading');
    analyzeBtn.disabled = false;
    setTimeout(() => {
      progressContainer.classList.remove('show');
      resetProgress();
    }, 1000);
  }
});

function setProgress(step, status) {
  const stepEl = document.getElementById(`step-${step}`);
  stepEl.classList.remove('active', 'done');
  stepEl.classList.add(status);
}

function resetProgress() {
  [1, 2, 3].forEach((i) => {
    document.getElementById(`step-${i}`).classList.remove('active', 'done');
  });
}

// ----------------------------
// Upstage OCR extraction (required)
// + PDF.js index helper (optional; improves citations when selectable text exists)
// ----------------------------
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();

  // Optional helper index using PDF.js text layer (often empty for scanned PDFs).
  let pdfIndex = null;
  try {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const pages = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();

      const items = (textContent.items || [])
        .map((it) => {
          const str = (it.str || '').replace(/\s+/g, ' ').trim();
          if (!str) return null;
          const transform = it.transform || [];
          const x = Number(transform[4] ?? 0);
          const y = Number(transform[5] ?? 0);
          return { str, x, y };
        })
        .filter(Boolean);

      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

      // Very simple line reconstruction by Y-position.
      const lines = [];
      let current = null;
      const yThreshold = 2.6;
      for (const it of items) {
        if (!current) {
          current = { y: it.y, parts: [it] };
          continue;
        }
        if (Math.abs(it.y - current.y) <= yThreshold) {
          current.parts.push(it);
        } else {
          current.parts.sort((p1, p2) => p1.x - p2.x);
          const lineText = current.parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
          if (lineText) lines.push(lineText);
          current = { y: it.y, parts: [it] };
        }
      }
      if (current) {
        current.parts.sort((p1, p2) => p1.x - p2.x);
        const lineText = current.parts.map((p) => p.str).join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) lines.push(lineText);
      }

      pages.push({ pageNumber, lines });
    }

    const totalChars = pages.reduce((acc, p) => acc + p.lines.join(' ').length, 0);
    if (totalChars >= 200) pdfIndex = pages;
  } catch (e) {
    // This is expected for some PDFs; OCR still works.
    console.warn('PDF.js index build failed (OK for scanned PDFs):', e);
  }

  if (!state.upstageKey) {
    throw new Error('Upstage API Key가 필요합니다.');
  }

  // Required: Upstage OCR
  const formData = new FormData();
  formData.append('document', file);
  formData.append('model', 'ocr');

  const response = await fetch('https://api.upstage.ai/v1/document-digitization', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${state.upstageKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upstage OCR 오류: ${error}`);
  }

  const data = await response.json();
  const text = (data.text || '').trim();
  return { fullText: text, pdfIndex, method: 'upstage-ocr' };
}

// ----------------------------
// Upstage LLM analysis (OpenAI-compatible endpoint)
// Model: solar-pro3
// ----------------------------
async function extractExpressions(text) {
  // Keep prompt size bounded.
  const truncatedText = text.length > 12000
    ? text.substring(0, 12000) + '\n\n[텍스트가 길어 일부만 분석됨]'
    : text;

  // NOTE:
  // - We intentionally keep the model output small to avoid truncation (finish_reason=length).
  // - Verbs/transitions are expanded locally from sentences anyway.
  const buildPrompt = ({ maxPerCategory, maxExampleChars }) => `당신은 학술 논문 작성 전문가입니다. 주어진 논문 텍스트에서 영어 학술 글쓰기에 유용한 "표현"만 추출해주세요.

## 추출 기준
1. **연구 배경 제시** - 관심 증가, 중요성 강조 표현
2. **연구 갭 지적** - 기존 연구 한계, 미해결 문제 표현
3. **연구 목적/가설** - 목표 제시 표현
4. **방법론 설명** - 실험 설계, 데이터 수집, 분석 방법 표현
5. **결과 제시** - 발견, 통계적 유의성 표현
6. **해석/논의** - 의미 부여, 기존 연구와 비교 표현
7. **한계점 인정** - 연구 제한점 인정 표현
8. **향후 연구 제안** - 후속 연구 방향 제안 표현

## 출력 형식
반드시 아래 JSON 형식으로만 출력하세요. 다른 설명은 추가하지 마세요.

{
  "sections": [
    {
      "category": "카테고리명",
      "category_en": "Category Name in English",
      "expressions": [
        {
          "expression": "추출된 표현 (예: Despite extensive research on X, ...)",
          "usage": "사용 상황 설명 (한국어)",
          "example": "논문에서 사용된 실제 문장",
          "difficulty": "basic|intermediate|advanced"
        }
      ]
    }
  ],
  "academic_verbs": [],
  "transition_words": []
}

## 논문 텍스트
${truncatedText}

## 주의사항
- 각 카테고리에서 최소 1개, 최대 ${maxPerCategory}개의 표현을 추출하세요
- 실제 논문에서 사용된 표현만 추출하세요
- 한국어 설명을 포함하여 학습에 도움이 되게 해주세요
- example은 최대 ${maxExampleChars}자 이내로 짧게 유지하세요
- JSON 형식만 출력하고 다른 텍스트는 포함하지 마세요`;

  async function callUpstage(prompt, maxTokens) {
    const response = await fetch('https://api.upstage.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.upstageKey}`
      },
      body: JSON.stringify({
        model: 'solar-pro3',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        max_tokens: maxTokens,
        stream: false
      })
    });
    return response;
  }

  // First try: richer output but still bounded.
  const prompt = buildPrompt({ maxPerCategory: 4, maxExampleChars: 240 });
  let response = await callUpstage(prompt, 1400);

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Upstage LLM 오류: ${error}`);
  }

  let data = await response.json();
  if (data?.error) {
    // Some providers return an error object as JSON even with HTTP 200.
    const msg = typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error));
    throw new Error(`Upstage LLM 오류: ${msg}`);
  }

  const choice0 = data?.choices?.[0];
  const message0 = choice0?.message;
  let content = message0?.content ?? choice0?.text;

  // Some OpenAI-compatible APIs may return structured/array content.
  if (Array.isArray(content)) {
    content = content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        return String(part.text ?? part.content ?? '');
      })
      .join('');
  } else if (content && typeof content === 'object') {
    content = String(content.text ?? content.content ?? '');
  }

  if (typeof content === 'string') content = content.trim();

  // If the provider hit length limits, retry once with a stricter/smaller prompt.
  const finish = choice0?.finish_reason;
  if (!content || finish === 'length') {
    // Retry: smaller per-category output and shorter examples.
    const retryPrompt = buildPrompt({ maxPerCategory: 2, maxExampleChars: 160 });
    response = await callUpstage(retryPrompt, 900);
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Upstage LLM 오류(재시도): ${error}`);
    }
    data = await response.json();
    const retryChoice0 = data?.choices?.[0];
    const retryMessage0 = retryChoice0?.message;
    let retryContent = retryMessage0?.content ?? retryChoice0?.text;
    if (Array.isArray(retryContent)) {
      retryContent = retryContent
        .map((part) => {
          if (!part) return '';
          if (typeof part === 'string') return part;
          return String(part.text ?? part.output_text ?? part.content ?? '');
        })
        .join('');
    } else if (retryContent && typeof retryContent === 'object') {
      retryContent = String(retryContent.text ?? retryContent.output_text ?? retryContent.content ?? '');
    }
    if (typeof retryContent === 'string') retryContent = retryContent.trim();
    content = retryContent;
  }

  if (!content) {
    const id = data?.id ?? 'n/a';
    const finish2 = data?.choices?.[0]?.finish_reason ?? 'n/a';
    const usage = data?.usage ? JSON.stringify(data.usage) : 'n/a';
    throw new Error(
      `모델 응답이 비어있습니다. (id=${id}, finish_reason=${finish2}, usage=${usage})\n` +
      `해결 팁: (1) Upstage API Key 권한/쿼터 확인 (2) PDF가 너무 길면 일부만 분석 (3) 개발자도구 Network에서 /v1/chat/completions 응답 확인`
    );
  }

  function extractJsonString(raw) {
    let s = String(raw || '').trim();
    if (!s) return '';

    // Remove fenced code blocks.
    if (s.includes('```json')) {
      s = s.split('```json')[1].split('```')[0].trim();
    } else if (s.includes('```')) {
      s = s.split('```')[1].split('```')[0].trim();
    }

    // If the model added extra text, try to grab the JSON object region.
    const firstBrace = s.indexOf('{');
    const lastBrace = s.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      s = s.slice(firstBrace, lastBrace + 1).trim();
    }
    return s;
  }

  // Parse JSON from response
  try {
    return JSON.parse(extractJsonString(content));
  } catch (e) {
    // One more strict retry for cases where JSON was truncated or wrapped.
    try {
      const strictPrompt = buildPrompt({ maxPerCategory: 2, maxExampleChars: 140 });
      const strictResp = await callUpstage(strictPrompt, 800);
      if (!strictResp.ok) {
        const error = await strictResp.text();
        throw new Error(`Upstage LLM 오류(파싱 재시도): ${error}`);
      }
      const strictData = await strictResp.json();
      const strictContent = strictData?.choices?.[0]?.message?.content ?? strictData?.choices?.[0]?.text;
      return JSON.parse(extractJsonString(strictContent));
    } catch (e2) {
      console.error('JSON parse error:', e, content);
      throw new Error('응답 파싱 오류. 다시 시도해주세요. (PDF를 일부 페이지로 줄이면 안정적입니다)');
    }
  }
}

// ----------------------------
// Local expansion resources (verbs/transitions/phrases)
// - These help produce richer lists even when the LLM misses items.
// ----------------------------
const LOCAL_ACADEMIC_VERBS = {
  "acknowledge": "인정하다",
  "address": "다루다/해결하다",
  "analyze": "분석하다",
  "argue": "주장하다",
  "assess": "평가하다",
  "attribute": "~에 기인하다",
  "characterize": "특징짓다",
  "clarify": "명확히 하다",
  "compare": "비교하다",
  "compute": "계산하다",
  "conclude": "결론내리다",
  "confirm": "확인하다",
  "construct": "구성하다",
  "contrast": "대조하다",
  "contribute": "기여하다",
  "demonstrate": "입증하다",
  "derive": "도출하다",
  "describe": "설명하다",
  "determine": "규명하다",
  "discuss": "논의하다",
  "distinguish": "구별하다",
  "elucidate": "명확히 밝히다",
  "emphasize": "강조하다",
  "establish": "정립하다",
  "estimate": "추정하다",
  "evaluate": "평가하다",
  "examine": "검토하다",
  "explore": "탐구하다",
  "formulate": "정식화하다",
  "highlight": "부각하다",
  "identify": "식별하다",
  "illustrate": "예시하다",
  "imply": "함의하다",
  "indicate": "시사하다",
  "infer": "추론하다",
  "investigate": "조사하다",
  "justify": "정당화하다",
  "maintain": "유지하다/주장하다",
  "measure": "측정하다",
  "motivate": "동기부여하다",
  "observe": "관찰하다",
  "outline": "개요를 제시하다",
  "predict": "예측하다",
  "propose": "제안하다",
  "quantify": "정량화하다",
  "reveal": "밝히다",
  "report": "보고하다",
  "suggest": "제안/시사하다",
  "support": "뒷받침하다",
  "test": "검증하다",
  "theorize": "이론화하다",
  "validate": "타당화하다",
  "verify": "검증하다"
};

const LOCAL_TRANSITIONS = {
  "however": "그러나/반면에(대조)",
  "nevertheless": "그럼에도 불구하고(역접)",
  "nonetheless": "그럼에도 불구하고(역접)",
  "therefore": "그러므로(결과)",
  "thus": "따라서(결과)",
  "consequently": "결과적으로(결과)",
  "moreover": "게다가(추가)",
  "furthermore": "더욱이(추가)",
  "in addition": "추가로(추가)",
  "additionally": "추가로(추가)",
  "for example": "예를 들어(예시)",
  "for instance": "예컨대(예시)",
  "in contrast": "대조적으로(대조)",
  "by contrast": "대조적으로(대조)",
  "on the other hand": "다른 한편으로(대조)",
  "in particular": "특히(강조)",
  "notably": "주목할 점은(강조)",
  "in summary": "요약하면(요약)",
  "overall": "전반적으로(요약)",
  "in conclusion": "결론적으로(결론)",
  "as a result": "그 결과(결과)",
  "as such": "따라서/그런 이유로(결과)",
  "meanwhile": "한편(전환)",
  "in turn": "그 결과/차례로(연쇄)",
  "in other words": "즉(재진술)",
  "that is": "즉(재진술)",
  "similarly": "유사하게(비교)",
  "likewise": "마찬가지로(비교)",
  "specifically": "구체적으로(구체화)",
  "in fact": "사실(강조)",
  "indeed": "실제로(강조)",
  "alternatively": "대안적으로(대안)"
};

const LOCAL_ACADEMIC_PHRASES = [
  { phrase: "it is worth noting that", usage: "주목할 점을 덧붙일 때" },
  { phrase: "to the best of our knowledge", usage: "선행연구 대비 새로움을 주장할 때" },
  { phrase: "in line with", usage: "기존 결과/이론과 일치함을 말할 때" },
  { phrase: "with respect to", usage: "특정 관점/대상에 대해 말할 때" },
  { phrase: "in the context of", usage: "어떤 맥락에서 논의할 때" },
  { phrase: "as shown in", usage: "그림/표/결과를 참조할 때" },
  { phrase: "taken together", usage: "여러 결과를 종합할 때" },
  { phrase: "in terms of", usage: "~의 측면에서 비교/평가할 때" },
  { phrase: "on the basis of", usage: "근거를 제시할 때" },
  { phrase: "in accordance with", usage: "규칙/절차/기준에 따라" },
  { phrase: "as opposed to", usage: "~와 대비하여" },
  { phrase: "in contrast to", usage: "~와 대조하여" },
  { phrase: "consistent with", usage: "~와 일관됨을 말할 때" },
  { phrase: "contrary to", usage: "~와 반대로" },
  { phrase: "to this end", usage: "이 목적을 위해" },
  { phrase: "in order to", usage: "목적을 표현할 때" },
  { phrase: "as a means of", usage: "수단을 표현할 때" },
  { phrase: "in light of", usage: "~을 고려할 때" },
  { phrase: "with the aim of", usage: "목표를 표현할 때" },
  { phrase: "from the perspective of", usage: "관점 전환" }
];

// ----------------------------
// Citation matching + sentence extraction helpers
// ----------------------------
function normalizeForSearch(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\u00ad/g, '') // soft hyphen
    .replace(/\s+/g, ' ')
    .replace(/[“”„‟]/g, '"')
    .replace(/[’‘‛]/g, "'")
    .replace(/[^a-z0-9\s'"\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildPageSearchIndex(pdfIndex) {
  if (!pdfIndex?.length) return null;
  return pdfIndex.map((p) => {
    const normalizedLines = p.lines.map((l) => normalizeForSearch(l));
    const joined = normalizedLines.join(' ');
    const lineStarts = [];
    let offset = 0;
    for (let i = 0; i < normalizedLines.length; i++) {
      lineStarts.push(offset);
      offset += normalizedLines[i].length + 1;
    }
    return { pageNumber: p.pageNumber, normalizedLines, joined, lineStarts };
  });
}

function locateLineByOffset(lineStarts, offset) {
  if (!lineStarts?.length) return 0;
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (lineStarts[mid] <= offset) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.max(0, Math.min(lineStarts.length - 1, hi));
}

function betterCitation(a, b) {
  if (!b) return a;
  if (!a) return b;
  if (b.confidence !== a.confidence) return b.confidence > a.confidence ? b : a;
  if (b.page !== a.page) return b.page < a.page ? b : a;
  if (b.lineStart !== a.lineStart) return b.lineStart < a.lineStart ? b : a;
  return a;
}

function findCitationForSnippet(snippet, pageIndex) {
  if (!snippet || !pageIndex?.length) return null;
  const needle = normalizeForSearch(snippet);
  if (!needle || needle.length < 20) return null;

  let best = null;
  for (const page of pageIndex) {
    const pos = page.joined.indexOf(needle);
    if (pos !== -1) {
      const lineStart = locateLineByOffset(page.lineStarts, pos) + 1;
      const lineEnd = locateLineByOffset(page.lineStarts, pos + needle.length) + 1;
      return { page: page.pageNumber, lineStart, lineEnd, confidence: 1.0 };
    }

    const shortNeedle = needle.slice(0, Math.min(60, needle.length));
    const pos2 = shortNeedle.length >= 25 ? page.joined.indexOf(shortNeedle) : -1;
    if (pos2 !== -1) {
      const lineStart = locateLineByOffset(page.lineStarts, pos2) + 1;
      const lineEnd = locateLineByOffset(page.lineStarts, pos2 + shortNeedle.length) + 1;
      best = betterCitation(best, { page: page.pageNumber, lineStart, lineEnd, confidence: 0.6 });
    }
  }

  return best;
}

function extractSentences(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return [];

  // Use Intl.Segmenter when available.
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const seg = new Intl.Segmenter('en', { granularity: 'sentence' });
    const out = [];
    for (const part of seg.segment(raw)) {
      const s = String(part.segment).replace(/\s+/g, ' ').trim();
      if (s.length >= 25) out.push(s);
    }
    return out;
  }

  // Basic fallback.
  return raw
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25);
}

function findPhrasesInSentence(sentence) {
  const norm = normalizeForSearch(sentence);
  const hits = [];
  for (const item of LOCAL_ACADEMIC_PHRASES) {
    const p = normalizeForSearch(item.phrase);
    if (p && norm.includes(p)) {
      hits.push({ phrase: item.phrase, usage: item.usage });
    }
  }
  return hits;
}

function extractLocalVerbsAndTransitionsFromSentences(sentences) {
  const verbCounts = new Map();
  const verbExample = new Map();
  const transitionCounts = new Map();
  const transitionExample = new Map();

  const verbSet = new Set(Object.keys(LOCAL_ACADEMIC_VERBS));
  const transitionKeys = Object.keys(LOCAL_TRANSITIONS);

  for (const s of sentences) {
    const norm = normalizeForSearch(s);
    const tokens = norm.split(' ').filter(Boolean);

    for (const t of tokens) {
      if (verbSet.has(t)) {
        verbCounts.set(t, (verbCounts.get(t) || 0) + 1);
        if (!verbExample.has(t)) verbExample.set(t, s);
      }
    }

    for (const key of transitionKeys) {
      const k = normalizeForSearch(key);
      if (k && norm.includes(k)) {
        transitionCounts.set(key, (transitionCounts.get(key) || 0) + 1);
        if (!transitionExample.has(key)) transitionExample.set(key, s);
      }
    }
  }

  const verbs = [...verbCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([verb, count]) => ({
      verb,
      meaning: LOCAL_ACADEMIC_VERBS[verb] || '',
      example: verbExample.get(verb) || '',
      count
    }));

  const transitions = [...transitionCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([word, count]) => ({
      word,
      usage: LOCAL_TRANSITIONS[word] || '',
      example: transitionExample.get(word) || '',
      count
    }));

  return { verbs, transitions };
}

function mergeDeduped(primary, extra, keyFn) {
  const out = [];
  const seen = new Set();

  for (const item of (primary || [])) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }

  for (const item of (extra || [])) {
    const k = keyFn(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }

  return out;
}

function postProcessAnalysis(data, pdfIndex, fullText, method) {
  const out = JSON.parse(JSON.stringify(data || {}));
  const pageIndex = buildPageSearchIndex(pdfIndex);

  // Attach citations for extracted expressions, based on their example sentence.
  if (out.sections?.length) {
    out.sections.forEach((section) => {
      (section.expressions || []).forEach((expr) => {
        const citation = findCitationForSnippet(expr.example || expr.expression, pageIndex);
        if (citation) expr.citation = citation;
      });
    });
  }

  // Sentence-based learning view.
  const sentences = extractSentences(fullText).slice(0, 250);
  const sentenceInsights = sentences.map((s) => {
    const citation = findCitationForSnippet(s, pageIndex);
    const phrases = findPhrasesInSentence(s);
    return { sentence: s, citation, phrases };
  });

  out.sentence_insights = {
    method,
    note: pageIndex
      ? '문장별로 페이지/줄을 자동 추정했습니다. PDF 레이아웃에 따라 줄 번호는 약간 어긋날 수 있습니다.'
      : '스캔 PDF는 줄/페이지 인용을 자동으로 추정하기 어렵습니다. (가능하면 텍스트가 포함된 PDF로도 함께 처리하면 정확도가 올라갑니다)'
    ,
    items: sentenceInsights
  };

  // Expand verbs/transitions locally for richer coverage.
  const local = extractLocalVerbsAndTransitionsFromSentences(sentences);
  out.academic_verbs = mergeDeduped(out.academic_verbs, local.verbs, (v) => (v.verb || '').toLowerCase());
  out.transition_words = mergeDeduped(out.transition_words, local.transitions, (t) => (t.word || '').toLowerCase());

  return out;
}

// ----------------------------
// Rendering
// ----------------------------
function renderResults() {
  renderTab(state.currentTab);
}

function renderTab(tab) {
  state.currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });

  const data = state.extractedData;
  if (!data) return;

  let html = '';

  if (tab === 'expressions') {
    (data.sections || []).forEach((section, index) => {
      html += `
        <div class="category" style="animation-delay: ${index * 0.1}s">
          <div class="category-header">
            <span class="category-name">${escapeHtml(section.category)}</span>
            <span class="category-name-en">${escapeHtml(section.category_en)}</span>
          </div>
          ${(section.expressions || []).map((expr) => {
            const cite = expr.citation
              ? `p. ${expr.citation.page}, line ${expr.citation.lineStart}${expr.citation.lineEnd && expr.citation.lineEnd !== expr.citation.lineStart ? `–${expr.citation.lineEnd}` : ''}`
              : null;
            return `
              <div class="expression">
                <div class="expression-header">
                  <span class="difficulty ${escapeHtml(expr.difficulty)}">${escapeHtml(expr.difficulty)}</span>
                  <span class="expression-text">${escapeHtml(expr.expression)}</span>
                </div>
                <dl class="expression-meta">
                  <dt>사용 상황</dt>
                  <dd>${escapeHtml(expr.usage)}</dd>
                  <dt>예문</dt>
                  <dd><em>${escapeHtml(expr.example)}</em></dd>
                  <dt>인용</dt>
                  <dd>${cite ? escapeHtml(cite) : '<em>자동 인용을 찾지 못했습니다</em>'}</dd>
                </dl>
              </div>
            `;
          }).join('')}
        </div>
      `;
    });
  } else if (tab === 'sentences') {
    const items = data.sentence_insights?.items || [];
    const note = data.sentence_insights?.note || '';

    html = `
      <div style="margin-bottom: 1rem; color: var(--muted); font-size: 0.9rem;">${escapeHtml(note)}</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 18%">인용</th>
            <th>문장</th>
            <th style="width: 30%">추천 숙어/표현</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it) => {
            const cite = it.citation
              ? `p. ${it.citation.page}, line ${it.citation.lineStart}${it.citation.lineEnd && it.citation.lineEnd !== it.citation.lineStart ? `–${it.citation.lineEnd}` : ''}`
              : '-';

            const phrases = (it.phrases || []).length
              ? (it.phrases || []).map((p) => `
                  <div>
                    <strong>${escapeHtml(p.phrase)}</strong><br>
                    <span style="color: var(--muted);">${escapeHtml(p.usage)}</span>
                  </div>
                `).join('<hr style="border:0;border-top:1px solid var(--border);margin:0.5rem 0;">')
              : '<span style="color: var(--muted);">(감지된 숙어 없음)</span>';

            return `
              <tr>
                <td>${escapeHtml(cite)}</td>
                <td>${escapeHtml(it.sentence)}</td>
                <td>${phrases}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  } else if (tab === 'verbs') {
    html = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 20%">동사</th>
            <th style="width: 30%">의미</th>
            <th>예문</th>
          </tr>
        </thead>
        <tbody>
          ${(data.academic_verbs || []).map((verb) => `
            <tr>
              <td><span class="verb-name">${escapeHtml(verb.verb)}</span></td>
              <td>${escapeHtml(verb.meaning)}</td>
              <td><em>${escapeHtml(verb.example)}</em></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else if (tab === 'transitions') {
    html = `
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 20%">연결어</th>
            <th style="width: 30%">사용 상황</th>
            <th>예문</th>
          </tr>
        </thead>
        <tbody>
          ${(data.transition_words || []).map((tw) => `
            <tr>
              <td><span class="verb-name">${escapeHtml(tw.word)}</span></td>
              <td>${escapeHtml(tw.usage)}</td>
              <td><em>${escapeHtml(tw.example)}</em></td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  tabContent.innerHTML = html;
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    renderTab(tab.dataset.tab);
  });
});

// ----------------------------
// Export: Anki + Markdown
// ----------------------------
document.getElementById('export-anki').addEventListener('click', () => {
  if (!state.extractedData) return;

  const data = state.extractedData;
  const rows = [];

  (data.sections || []).forEach((section) => {
    (section.expressions || []).forEach((expr) => {
      const front = `${expr.expression}\n\n💡 ${expr.usage}`;
      const cite = expr.citation
        ? `\n\n📍 인용: p. ${expr.citation.page}, line ${expr.citation.lineStart}${expr.citation.lineEnd && expr.citation.lineEnd !== expr.citation.lineStart ? `–${expr.citation.lineEnd}` : ''}`
        : '';
      const back = `📝 예문:\n${expr.example}\n\n📂 카테고리: ${section.category}${cite}`;
      rows.push(`${front}\t${back}`);
    });
  });

  (data.academic_verbs || []).forEach((verb) => {
    const front = `🔤 Academic Verb: ${verb.verb}\n\n의미는?`;
    const back = `✅ ${verb.meaning}\n\n📝 예문: ${verb.example}`;
    rows.push(`${front}\t${back}`);
  });

  (data.transition_words || []).forEach((tw) => {
    const front = `🔗 Transition: ${tw.word}\n\n언제 사용?`;
    const back = `✅ ${tw.usage}\n\n📝 예문: ${tw.example}`;
    rows.push(`${front}\t${back}`);
  });

  downloadFile(rows.join('\n'), 'academic_expressions_anki.txt', 'text/plain');
});

document.getElementById('export-md').addEventListener('click', () => {
  if (!state.extractedData) return;

  const data = state.extractedData;
  let md = `# 📖 Academic Expression Learner 결과\n\n`;
  md += `> 논문 PDF에서 자동 추출된 학술 표현/동사/연결어를 정리한 문서입니다.\n\n---\n\n`;
  md += `## 난이도 범례\n- 🟢 Basic: 기본 표현\n- 🟡 Intermediate: 중급 표현\n- 🔴 Advanced: 고급 표현\n\n---\n\n`;

  (data.sections || []).forEach((section) => {
    md += `## 📌 ${section.category}\n*${section.category_en}*\n\n`;
    (section.expressions || []).forEach((expr) => {
      const emoji = { basic: '🟢', intermediate: '🟡', advanced: '🔴' }[expr.difficulty] || '⚪';
      md += `### ${emoji} \`${expr.expression}\`\n`;
      md += `- **사용 상황**: ${expr.usage}\n`;
      md += `- **예문**: _${expr.example}_\n`;
      if (expr.citation) {
        md += `- **인용**: p. ${expr.citation.page}, line ${expr.citation.lineStart}${expr.citation.lineEnd && expr.citation.lineEnd !== expr.citation.lineStart ? `–${expr.citation.lineEnd}` : ''}\n`;
      }
      md += `\n`;
    });
  });

  if (data.academic_verbs?.length) {
    md += `---\n\n## 📚 학술 동사 모음\n\n`;
    md += `| 동사 | 의미 | 예문 |\n|:-----|:-----|:-----|\n`;
    data.academic_verbs.forEach((v) => {
      md += `| **${v.verb}** | ${v.meaning} | ${v.example} |\n`;
    });
    md += `\n`;
  }

  if (data.transition_words?.length) {
    md += `---\n\n## 🔗 연결어/전환 표현\n\n`;
    md += `| 표현 | 사용 상황 | 예문 |\n|:-----|:---------|:-----|\n`;
    data.transition_words.forEach((tw) => {
      md += `| **${tw.word}** | ${tw.usage} | ${tw.example} |\n`;
    });
  }

  downloadFile(md, 'academic_expressions.md', 'text/markdown');
});

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
