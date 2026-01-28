/*
  Academic Expression Learner
  - OCR: Upstage Document Digitization API
  - Core expression analysis: OpenAI Chat Completions (GPT)

  Security note:
  - This is a static client-side app. API keys are used in the browser.
  - Do NOT hardcode keys in this repository.
*/

// PDF.js worker setup (provided by CDN script in index.html)
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ----------------------------
// Model response parsing helpers
// ----------------------------
function stripCodeFences(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('```json')) {
    s = s.split('```json')[1].split('```')[0].trim();
  } else if (s.includes('```')) {
    s = s.split('```')[1].split('```')[0].trim();
  }
  return s;
}

function extractBalancedJsonObject(raw) {
  const s = String(raw || '');
  const start = s.indexOf('{');
  if (start === -1) return '';

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;

    if (depth === 0) {
      return s.slice(start, i + 1).trim();
    }
  }

  return '';
}

function cleanupJsonLikeString(raw) {
  // Remove common JSON-ish issues without trying to be too clever.
  let s = String(raw || '').trim();
  if (!s) return '';
  // Remove trailing commas before } or ]
  s = s.replace(/,\s*([}\]])/g, '$1');

  // Fix missing commas between JSON values (e.g., "..." } "next" or } { )
  s = insertMissingCommasOutsideStrings(s);
  return s;
}

function insertMissingCommasOutsideStrings(input) {
  const s = String(input || '');
  if (!s) return '';

  let out = '';
  let inString = false;
  let escape = false;

  const nextNonWs = (from) => {
    for (let j = from; j < s.length; j++) {
      const ch = s[j];
      if (!/\s/.test(ch)) return { ch, idx: j };
    }
    return { ch: '', idx: s.length };
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += ch;

    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === '\\') {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '}' || ch === ']') {
      const { ch: nxt } = nextNonWs(i + 1);
      if (!nxt) continue;
      // If another value starts immediately, a comma is required.
      if (nxt === '{' || nxt === '[' || nxt === '"') {
        // Avoid duplicating commas if already present.
        const { ch: immediate } = nextNonWs(i + 1);
        if (immediate !== ',') {
          out += ',';
        }
      }
    }
  }

  return out;
}

function parseJsonRobust(raw) {
  const original = String(raw || '').trim();
  if (!original) throw new Error('모델이 빈 응답을 반환했습니다.');

  // 1) Direct parse
  try {
    return JSON.parse(original);
  } catch {
    // continue
  }

  // 2) Strip code fences
  const noFences = stripCodeFences(original);
  if (noFences && noFences !== original) {
    try {
      return JSON.parse(cleanupJsonLikeString(noFences));
    } catch {
      // continue
    }
  }

  // 3) Extract balanced JSON object from within extra text
  const balanced = extractBalancedJsonObject(noFences || original);
  if (balanced) {
    try {
      return JSON.parse(cleanupJsonLikeString(balanced));
    } catch {
      // continue
    }
  }

  const preview = (original.length > 400) ? `${original.slice(0, 400)}…` : original;
  throw new Error(`응답 파싱 오류. 다시 시도해주세요. (미리보기: ${preview})`);
}

// ----------------------------
// State
// ----------------------------
let state = {
  upstageKey: '',
  openaiKey: '',
  file: null,
  extractedData: null,
  pdfIndex: null,
  extractionMethod: null,
  currentTab: 'expressions',
  practice: {
    targetExpression: '',
    draft: '',
    lastFeedback: null
  }
};

// ----------------------------
// DOM Elements
// ----------------------------
const upstageKeyInput = document.getElementById('upstage-key');
const upstageStatus = document.getElementById('upstage-status');
const openaiKeyInput = document.getElementById('openai-key');
const openaiStatus = document.getElementById('openai-status');
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

openaiKeyInput?.addEventListener('input', (e) => {
  state.openaiKey = e.target.value;
  openaiStatus?.classList.toggle('active', e.target.value.length > 0);
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
  // Upstage is required for OCR; OpenAI is required for expression extraction.
  const ready = state.upstageKey && state.openaiKey && state.file;
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

    // Step 2: GPT analysis (core expressions)
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
// OpenAI GPT analysis (core expressions)
// ----------------------------
async function extractExpressions(text) {
  if (!state.openaiKey) {
    throw new Error('OpenAI API Key가 필요합니다.');
  }

  const truncatedText = text.length > 14000
    ? text.substring(0, 14000) + '\n\n[텍스트가 길어 일부만 분석됨]'
    : text;

  const promptFull = `당신은 학술 논문 작성 전문가이자 영어 글쓰기 튜터입니다. 주어진 논문 텍스트에서 영어 학술 글쓰기에 유용한 표현들을 추출하고, 학습자가 실제로 활용할 수 있도록 설명을 덧붙여주세요.

중요: 내부적으로는 단계적으로 충분히 생각하되(Chain-of-Thought), 출력에는 사고 과정을 절대 포함하지 말고 **최종 JSON만** 출력하세요.

## 추출 기준
1. **연구 배경 제시** - 관심 증가, 중요성 강조 표현
2. **연구 갭 지적** - 기존 연구 한계, 미해결 문제 표현
3. **연구 목적/가설** - 목표 제시 표현
4. **방법론 설명** - 실험 설계, 데이터 수집, 분석 방법 표현
5. **결과 제시** - 발견, 통계적 유의성 표현
6. **해석/논의** - 의미 부여, 기존 연구와 비교 표현
7. **한계점 인정** - 연구 제한점 인정 표현
8. **향후 연구 제안** - 후속 연구 방향 제안 표현
9. **연결어/전환 표현** - However, Furthermore, Nevertheless 등
10. **학술 동사** - demonstrate, investigate, reveal, indicate 등

## 출력 형식
반드시 아래 JSON 형식으로만 출력하세요. 다른 설명은 추가하지 마세요.

{
  "sections": [
    {
      "category": "카테고리명",
      "category_en": "Category Name in English",
      "purpose": "이 카테고리가 어떤 문단/상황에서 쓰이는지 (한국어)",
      "why_this_matters": "왜 이 카테고리 표현을 굳이 추출/학습해야 하는지 (한국어)",
      "how_to_apply": "실전 글쓰기에서 어떻게 활용/변형하면 좋은지 (한국어, 팁/주의점)",
      "expressions": [
        {
          "expression": "추출된 표현 (예: Despite extensive research on X, ...)",
          "usage": "사용 상황 설명 (한국어)",
          "why_important": "중요성/효과 (왜 좋은지) (한국어)",
          "how_to_use": "내 글에서 어떻게 써먹는지(템플릿/변형/주의) (한국어)",
          "example": "논문에서 사용된 실제 문장",
          "difficulty": "basic|intermediate|advanced"
        }
      ]
    }
  ],
  "academic_verbs": [
    {
      "verb": "동사",
      "meaning": "의미 (한국어)",
      "example": "예문"
    }
  ],
  "transition_words": [
    {
      "word": "연결어",
      "usage": "사용 상황",
      "example": "예문"
    }
  ]
}

## 논문 텍스트
${truncatedText}

## 주의사항
- 각 카테고리에서 최소 2개, 최대 5개의 표현을 추출하세요
- 실제 논문에서 사용된 표현만 추출하세요
- 한국어 설명을 포함하여 학습에 도움이 되게 해주세요
- 표현/팁은 과장하지 말고, 논문 문체(톤/완곡함/범위 제한)에 맞게 안내하세요
- JSON 형식만 출력하고 다른 텍스트는 포함하지 마세요`;

  // Compact retry prompt to avoid truncation.
  const promptCompact = `당신은 학술 논문 작성 전문가이자 영어 글쓰기 튜터입니다.

중요: 내부적으로는 단계적으로 충분히 생각하되(Chain-of-Thought), 출력에는 사고 과정을 절대 포함하지 말고 **최종 JSON만** 출력하세요.

요청: 아래 논문 텍스트에서 영어 학술 글쓰기에 유용한 표현들을 JSON으로 추출하세요.

제약(중요):
- 섹션은 최대 6개
- 섹션당 표현은 1~3개
- 예문(example)은 짧게(가능하면 1문장) 유지
- JSON 외 텍스트 금지

출력 스키마는 아래와 동일합니다:
{
  "sections": [
    {
      "category": "카테고리명",
      "category_en": "Category Name in English",
      "purpose": "이 카테고리가 어떤 문단/상황에서 쓰이는지 (한국어)",
      "why_this_matters": "왜 이 카테고리 표현을 굳이 추출/학습해야 하는지 (한국어)",
      "how_to_apply": "실전 글쓰기에서 어떻게 활용/변형하면 좋은지 (한국어, 팁/주의점)",
      "expressions": [
        {
          "expression": "표현",
          "usage": "사용 상황(한국어)",
          "why_important": "중요성(한국어)",
          "how_to_use": "활용 팁(한국어)",
          "example": "짧은 예문(논문에서 발췌)",
          "difficulty": "basic|intermediate|advanced"
        }
      ]
    }
  ],
  "academic_verbs": [{"verb":"","meaning":"","example":""}],
  "transition_words": [{"word":"","usage":"","example":""}]
}

논문 텍스트:
${truncatedText}`;

  async function callOpenAI(promptText, maxTokens) {
    const body = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: promptText }],
      temperature: 0.3,
      max_tokens: maxTokens
    };

    // If the model supports JSON-only mode, it tends to be more reliable.
    body.response_format = { type: 'json_object' };

    let response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${state.openaiKey}`
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errText = await response.text();
      // If response_format is rejected, retry without it.
      if (String(errText).toLowerCase().includes('response_format')) {
        delete body.response_format;
        response = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${state.openaiKey}`
          },
          body: JSON.stringify(body)
        });
      } else {
        throw new Error(`OpenAI API 오류: ${errText}`);
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`OpenAI API 오류: ${errText}`);
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    const finish = data?.choices?.[0]?.finish_reason ?? 'n/a';
    const usage = data?.usage ? JSON.stringify(data.usage) : 'n/a';
    const id = data?.id ?? 'n/a';

    if (!content) {
      throw new Error(`OpenAI 모델 응답이 비어있습니다. (id=${id}, finish_reason=${finish}, usage=${usage})`);
    }

    return { content, finish, usage, id };
  }

  async function repairJsonWithModel(broken) {
    const snippet = String(broken || '').slice(0, 12000);
    const repairPrompt = `당신은 JSON 포맷터입니다.

아래 텍스트는 모델이 생성한 JSON이지만, 구두점/쉼표/따옴표/중괄호가 일부 깨져 파싱이 실패합니다.

요청:
- 아래 내용을 바탕으로, 의미를 유지하면서 **유효한 JSON**으로 복구하세요.
- 출력은 반드시 JSON 하나만. 코드블록/설명 금지.
- 스키마는 다음을 따르세요:
{
  "sections": [
    {
      "category": "",
      "category_en": "",
      "purpose": "",
      "why_this_matters": "",
      "how_to_apply": "",
      "expressions": [
        {
          "expression": "",
          "usage": "",
          "why_important": "",
          "how_to_use": "",
          "example": "",
          "difficulty": "basic|intermediate|advanced"
        }
      ]
    }
  ],
  "academic_verbs": [{"verb":"","meaning":"","example":""}],
  "transition_words": [{"word":"","usage":"","example":""}]
}

복구 대상 텍스트:
"""
${snippet}
"""`;

    const { content } = await callOpenAI(repairPrompt, 1400);
    return parseJsonRobust(content);
  }

  // Attempt 1: full prompt
  const r1 = await callOpenAI(promptFull, 3000);
  try {
    return parseJsonRobust(r1.content);
  } catch (e1) {
    console.error('JSON parse error (attempt 1):', e1);
    if (String(r1.finish).toLowerCase() === 'length') {
      // Attempt 2: compact prompt if the response was likely truncated.
      const r2 = await callOpenAI(promptCompact, 2200);
      try {
        return parseJsonRobust(r2.content);
      } catch (e2) {
        console.error('JSON parse error (attempt 2):', e2);
        // Attempt 3: repair from last output
        try {
          return await repairJsonWithModel(r2.content);
        } catch (e3) {
          console.error('JSON repair failed:', e3);
          throw new Error(`응답 파싱 오류. 다시 시도해주세요. (finish_reason=${r2.finish}, usage=${r2.usage})`);
        }
      }
    }

    // Not truncated: try a repair pass.
    try {
      return await repairJsonWithModel(r1.content);
    } catch (e3) {
      console.error('JSON repair failed:', e3);
      throw new Error(`응답 파싱 오류. 다시 시도해주세요. (finish_reason=${r1.finish}, usage=${r1.usage})`);
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

  // Idiom/phrase-only learning view.
  const sentences = extractSentences(fullText).slice(0, 250);
  const phraseMap = new Map();

  for (const s of sentences) {
    const phrases = findPhrasesInSentence(s);
    if (!phrases.length) continue;
    const citation = findCitationForSnippet(s, pageIndex);

    for (const p of phrases) {
      const key = normalizeForSearch(p.phrase);
      if (!key) continue;
      if (!phraseMap.has(key)) {
        phraseMap.set(key, {
          phrase: p.phrase,
          usage: p.usage,
          count: 0,
          examples: [],
          recommended: false
        });
      }
      const entry = phraseMap.get(key);
      entry.count += 1;
      if (entry.examples.length < 2) {
        entry.examples.push({ sentence: s, citation });
      }
    }
  }

  const items = [...phraseMap.values()].sort((a, b) => (b.count - a.count) || a.phrase.localeCompare(b.phrase));

  // If detected idioms are too few, recommend additional items.
  const targetTotal = 10;
  const shouldRecommend = items.length < 5;
  const seen = new Set(items.map((d) => normalizeForSearch(d.phrase)));

  if (shouldRecommend) {
    for (const item of LOCAL_ACADEMIC_PHRASES) {
      if (items.length >= targetTotal) break;
      const k = normalizeForSearch(item.phrase);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      items.push({
        phrase: item.phrase,
        usage: item.usage,
        count: 0,
        examples: [],
        recommended: true
      });
    }
  }

  out.idiom_insights = {
    method,
    message: shouldRecommend ? '몇가지 더 추천해줄게요!' : '',
    note: pageIndex
      ? '숙어/표현이 나온 문장에 한해 인용(p/line)을 자동 추정했습니다. PDF 레이아웃에 따라 줄 번호는 약간 어긋날 수 있습니다.'
      : '스캔 PDF는 줄/페이지 인용을 자동으로 추정하기 어렵습니다. (가능하면 텍스트가 포함된 PDF로도 함께 처리하면 정확도가 올라갑니다)'
    ,
    items
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
      const purpose = (section.purpose || '').trim();
      const why = (section.why_this_matters || '').trim();
      const how = (section.how_to_apply || '').trim();
      html += `
        <div class="category" style="animation-delay: ${index * 0.1}s">
          <div class="category-header">
            <span class="category-name">${escapeHtml(section.category)}</span>
            <span class="category-name-en">${escapeHtml(section.category_en)}</span>
          </div>
          ${(purpose || why || how) ? `
            <div style="margin: -0.5rem 0 1.25rem; color: var(--muted); font-size: 0.9rem;">
              ${purpose ? `<div><strong>사용 상황:</strong> ${escapeHtml(purpose)}</div>` : ''}
              ${why ? `<div style="margin-top: 0.35rem;"><strong>왜 중요한가:</strong> ${escapeHtml(why)}</div>` : ''}
              ${how ? `<div style="margin-top: 0.35rem;"><strong>활용법:</strong> ${escapeHtml(how)}</div>` : ''}
            </div>
          ` : ''}
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
                  <dd>${escapeHtml(expr.usage || '')}</dd>
                  ${(expr.why_important || '').trim() ? `
                    <dt>중요성</dt>
                    <dd>${escapeHtml(expr.why_important)}</dd>
                  ` : ''}
                  ${(expr.how_to_use || '').trim() ? `
                    <dt>활용 팁</dt>
                    <dd>${escapeHtml(expr.how_to_use)}</dd>
                  ` : ''}
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
  } else if (tab === 'idioms') {
    const items = data.idiom_insights?.items || [];
    const note = data.idiom_insights?.note || '';
    const message = (data.idiom_insights?.message || '').trim();

    const messageHtml = message
      ? `<div class="card" style="padding: 1rem 1.25rem; margin-bottom: 1rem; border-left: 3px solid var(--accent);">${escapeHtml(message)}</div>`
      : '';

    html = `
      ${messageHtml}
      <div style="margin-bottom: 1rem; color: var(--muted); font-size: 0.9rem;">${escapeHtml(note)}</div>
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 28%">숙어/표현</th>
            <th style="width: 32%">사용 상황</th>
            <th>예문(인용)</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it) => {
            const badge = it.recommended
              ? `<span style="margin-left: 0.5rem; font-size: 0.7rem; color: var(--warning); border: 1px solid var(--border); padding: 0.1rem 0.4rem; border-radius: 999px;">추천</span>`
              : '';

            const examplesHtml = (it.examples || []).length
              ? it.examples.map((ex) => {
                  const cite = ex.citation
                    ? `p. ${ex.citation.page}, line ${ex.citation.lineStart}${ex.citation.lineEnd && ex.citation.lineEnd !== ex.citation.lineStart ? `–${ex.citation.lineEnd}` : ''}`
                    : '-';
                  return `<div style="margin-bottom: 0.5rem;"><em>${escapeHtml(ex.sentence)}</em><div style="color: var(--muted); font-size: 0.8rem; margin-top: 0.15rem;">${escapeHtml(cite)}</div></div>`;
                }).join('')
              : '<span style="color: var(--muted);">(이 논문에서 발견된 예문 없음 — 아래 표현으로 직접 문장을 만들어보세요)</span>';

            return `
              <tr>
                <td><strong>${escapeHtml(it.phrase)}</strong>${badge}</td>
                <td>${escapeHtml(it.usage || '')}</td>
                <td>${examplesHtml}</td>
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
  } else if (tab === 'practice') {
    const all = getAllExpressionsForPractice(data);
    const options = all.length
      ? all.map((e) => {
          const label = `${e.expression} — ${e.category}`;
          return `<option value="${escapeHtml(e.expression)}">${escapeHtml(label)}</option>`;
        }).join('')
      : '';

    html = `
      <div class="card" style="padding: 1.25rem;">
        <div style="color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem;">
          추출된 표현을 실제 문단에 적용해보고, 피드백을 받아보세요. (출력은 최종 피드백만 제공되며 사고 과정은 공개하지 않습니다)
        </div>

        <label for="practice-target">연습할 표현 선택</label>
        <select id="practice-target" style="width:100%; padding:0.875rem 1rem; border:1px solid var(--border); background: var(--paper); font-family: 'JetBrains Mono', monospace; font-size: 0.85rem; margin-bottom: 1rem;">
          <option value="">(자동 선택: 랜덤/상위 표현 활용)</option>
          ${options}
        </select>

        <label for="practice-draft">내 문단(영어) 입력</label>
        <textarea id="practice-draft" rows="8" placeholder="Write your paragraph here..." style="width:100%; padding:0.875rem 1rem; border:1px solid var(--border); background: var(--paper); font-family: 'Noto Sans KR', sans-serif; font-size: 0.95rem; margin-bottom: 1rem; resize: vertical;"></textarea>

        <button class="analyze-btn" id="practice-feedback-btn" style="width:auto; padding: 0.75rem 1.25rem;">피드백 받기</button>

        <div id="practice-output" style="margin-top: 1rem;"></div>
      </div>
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

  if (tab === 'practice') {
    wirePracticeTab();
  }
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
      const why = (expr.why_important || '').trim();
      const how = (expr.how_to_use || '').trim();
      const front = `${expr.expression}\n\n💡 ${expr.usage || ''}${why ? `\n\n⭐ ${why}` : ''}${how ? `\n\n🧠 ${how}` : ''}`;
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
    if ((section.purpose || '').trim()) md += `- **사용 상황**: ${section.purpose}\n`;
    if ((section.why_this_matters || '').trim()) md += `- **왜 중요한가**: ${section.why_this_matters}\n`;
    if ((section.how_to_apply || '').trim()) md += `- **활용법**: ${section.how_to_apply}\n`;
    if ((section.purpose || section.why_this_matters || section.how_to_apply || '').trim()) md += `\n`;
    (section.expressions || []).forEach((expr) => {
      const emoji = { basic: '🟢', intermediate: '🟡', advanced: '🔴' }[expr.difficulty] || '⚪';
      md += `### ${emoji} \`${expr.expression}\`\n`;
      md += `- **사용 상황**: ${expr.usage || ''}\n`;
      if ((expr.why_important || '').trim()) md += `- **중요성**: ${expr.why_important}\n`;
      if ((expr.how_to_use || '').trim()) md += `- **활용 팁**: ${expr.how_to_use}\n`;
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

// ----------------------------
// Writing practice helpers
// ----------------------------
function getAllExpressionsForPractice(data) {
  const out = [];
  (data?.sections || []).forEach((section) => {
    (section.expressions || []).forEach((expr) => {
      const text = String(expr.expression || '').trim();
      if (!text) return;
      out.push({
        expression: text,
        category: section.category || '',
        usage: expr.usage || '',
        why_important: expr.why_important || '',
        how_to_use: expr.how_to_use || ''
      });
    });
  });
  return out;
}

function wirePracticeTab() {
  const btn = document.getElementById('practice-feedback-btn');
  const targetEl = document.getElementById('practice-target');
  const draftEl = document.getElementById('practice-draft');
  const outEl = document.getElementById('practice-output');

  if (!btn || !draftEl || !outEl) return;

  // Avoid stacking multiple listeners if the user re-enters the tab.
  if (btn.dataset.wired === '1') return;
  btn.dataset.wired = '1';

  btn.addEventListener('click', async () => {
    try {
      if (!state.openaiKey) throw new Error('OpenAI API Key가 필요합니다.');
      if (!state.extractedData) throw new Error('먼저 PDF 분석을 완료해주세요.');

      const draft = String(draftEl.value || '').trim();
      if (draft.length < 40) throw new Error('문단이 너무 짧습니다. (최소 40자 이상 권장)');

      const targetExpression = String(targetEl?.value || '').trim();
      btn.classList.add('loading');
      btn.disabled = true;
      outEl.innerHTML = `<div style="color: var(--muted);">피드백 생성 중...</div>`;

      const feedback = await getWritingFeedback(draft, targetExpression, state.extractedData);
      state.practice.lastFeedback = feedback;

      const score = feedback?.score || {};
      const strengths = Array.isArray(feedback?.strengths) ? feedback.strengths : [];
      const improvements = Array.isArray(feedback?.improvements) ? feedback.improvements : [];

      outEl.innerHTML = `
        <div class="card" style="padding: 1.25rem; margin-top: 1rem;">
          <div style="display:flex; gap: 0.75rem; flex-wrap: wrap; margin-bottom: 0.75rem;">
            <div style="font-size:0.85rem; color: var(--muted);">Score</div>
            <div style="font-size:0.85rem;">Clarity: <strong>${escapeHtml(score.clarity ?? '-')}/10</strong></div>
            <div style="font-size:0.85rem;">Academic tone: <strong>${escapeHtml(score.academic_tone ?? '-')}/10</strong></div>
            <div style="font-size:0.85rem;">Grammar: <strong>${escapeHtml(score.grammar ?? '-')}/10</strong></div>
          </div>

          ${(feedback?.expression_usage?.target_expression || '').trim() ? `
            <div style="margin-bottom: 1rem; color: var(--muted); font-size: 0.9rem;">
              <strong>목표 표현:</strong> ${escapeHtml(feedback.expression_usage.target_expression)}
              <span style="margin-left: 0.5rem;">(${feedback.expression_usage.used ? '사용됨' : '미사용'})</span>
              ${(feedback?.expression_usage?.tips || '').trim() ? `<div style="margin-top: 0.35rem;">${escapeHtml(feedback.expression_usage.tips)}</div>` : ''}
            </div>
          ` : ''}

          ${(feedback?.overall_feedback || '').trim() ? `
            <div style="margin-bottom: 1rem;">
              <div style="font-weight: 600; margin-bottom: 0.35rem;">총평</div>
              <div style="color: var(--ink);">${escapeHtml(feedback.overall_feedback)}</div>
            </div>
          ` : ''}

          ${(strengths.length) ? `
            <div style="margin-bottom: 1rem;">
              <div style="font-weight: 600; margin-bottom: 0.35rem;">좋았던 점</div>
              <ul style="padding-left: 1.25rem;">
                ${strengths.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${(improvements.length) ? `
            <div style="margin-bottom: 1rem;">
              <div style="font-weight: 600; margin-bottom: 0.35rem;">개선 제안</div>
              <ul style="padding-left: 1.25rem;">
                ${improvements.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}
              </ul>
            </div>
          ` : ''}

          ${(feedback?.rewrite_suggestion || '').trim() ? `
            <div style="margin-bottom: 0.25rem; font-weight: 600;">개선된 문단 예시</div>
            <div style="white-space: pre-wrap; background: var(--paper); border: 1px solid var(--border); padding: 0.875rem 1rem;">${escapeHtml(feedback.rewrite_suggestion)}</div>
          ` : ''}
        </div>
      `;
    } catch (e) {
      outEl.innerHTML = `<div style="color: #b00020;">오류: ${escapeHtml(e.message || String(e))}</div>`;
    } finally {
      btn.classList.remove('loading');
      btn.disabled = false;
    }
  });
}

async function getWritingFeedback(draft, targetExpression, extractedData) {
  const all = getAllExpressionsForPractice(extractedData);
  const suggestions = all.slice(0, 12);
  const suggestedText = suggestions.map((e) => `- ${e.expression} (카테고리: ${e.category})`).join('\n');

  const prompt = `당신은 academic writing tutor입니다.

중요: 내부적으로는 단계적으로 충분히 생각하되(Chain-of-Thought), 출력에는 사고 과정을 절대 포함하지 말고 **최종 JSON만** 출력하세요.

목표:
- 학습자의 영작 문단을 학술적 톤/명확성/문법 관점에서 피드백
- 가능하면 아래 표현(또는 유사 템플릿)을 자연스럽게 사용하도록 유도

추천 표현 목록:
${suggestedText}

사용자가 선택한 목표 표현(비어있으면 임의 선택/혼합):
${targetExpression || '(선택 없음)'}

사용자 문단:
"""
${draft}
"""

출력 JSON 스키마:
{
  "overall_feedback": "총평 (한국어)",
  "strengths": ["좋았던 점"],
  "improvements": ["개선 제안"],
  "rewrite_suggestion": "가능하면 1문단으로 더 학술적으로 다듬은 버전(영어)",
  "score": {"clarity": 1, "academic_tone": 1, "grammar": 1},
  "expression_usage": {
    "target_expression": "목표 표현",
    "used": true,
    "tips": "목표 표현을 자연스럽게 넣는 팁 (한국어)"
  }
}

주의:
- 점수는 1~10 정수
- 너무 공격적으로 고치지 말고 원문 의미를 유지
- JSON 외 텍스트 금지`;

  const body = {
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.4,
    max_tokens: 1200,
    response_format: { type: 'json_object' }
  };

  let resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${state.openaiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text();
    if (String(errText).toLowerCase().includes('response_format')) {
      delete body.response_format;
      resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${state.openaiKey}`
        },
        body: JSON.stringify(body)
      });
    } else {
      throw new Error(`OpenAI API 오류: ${errText}`);
    }
  }

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`OpenAI API 오류: ${errText}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) {
    const id = data?.id ?? 'n/a';
    const finish = data?.choices?.[0]?.finish_reason ?? 'n/a';
    throw new Error(`OpenAI 모델 응답이 비어있습니다. (id=${id}, finish_reason=${finish})`);
  }

  return parseJsonRobust(content);
}
