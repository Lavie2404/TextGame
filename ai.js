(() => {
  const OLLAMA_URL = 'http://127.0.0.1:11434';
  // One context size for every call: Ollama reloads the model whenever num_ctx changes between requests.
  // 8192 keeps the full rule set, chapter history and NPC profiles in view; its KV cache (~1.3 GB for a 14B
  // model) still fits beside the weights on a 12 GB GPU.
  const OLLAMA_NUM_CTX = 8192;
  const modelInput = document.querySelector('#ai-model');
  const status = document.querySelector('#ai-status');
  const help = document.querySelector('#ai-help');
  const checkButton = document.querySelector('#ai-check');
  const turnButton = document.querySelector('#ai-turn');
  const story = document.querySelector('#story');
  const inputs = document.querySelector('#inputs');
  const CHAPTER_MEMORY_KEY = 'van-gioi-ky.chapter-memory.v1';
  const MAX_REMEMBERED_CHAPTERS = 5;
  const statusText = {
    idle: 'Chưa kết nối Ollama',
    busy: 'Đang kết nối…',
    ready: 'Ollama đã sẵn sàng',
    writing: 'AI đang viết đoạn dài…',
    error: 'Không kết nối được Ollama'
  };

  // Nhật ký hành trình hiện trên cột phải: mục tiêu dài hạn (đặt lúc khai mở), bước tiếp theo
  // và % tiến độ do AI ước lượng sau mỗi lượt, cùng các ký ức ngắn gần nhất.
  const MAX_JOURNAL_NOTES = 6;
  function freshJournal(goal = '') {
    return { goal, step: '', progress: 0, notes: [] };
  }

  function normalizeJournal(journal, fallbackGoal = '') {
    const source = journal && typeof journal === 'object' ? journal : {};
    return {
      goal: typeof source.goal === 'string' ? source.goal : fallbackGoal,
      step: typeof source.step === 'string' ? source.step : '',
      progress: Number.isFinite(source.progress) ? Math.max(0, Math.min(100, Math.round(source.progress))) : 0,
      notes: Array.isArray(source.notes)
        ? source.notes.filter(note => note && typeof note.text === 'string').slice(-MAX_JOURNAL_NOTES)
        : []
    };
  }

  function freshChapterState() {
    return { chapterNumber: 1, turns: [], memories: [], journal: freshJournal() };
  }

  function loadChapterState() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAPTER_MEMORY_KEY) || 'null');
      if (saved && Number.isInteger(saved.chapterNumber) && Array.isArray(saved.turns) && Array.isArray(saved.memories)) {
        return { ...saved, memories: saved.memories.slice(-MAX_REMEMBERED_CHAPTERS), journal: normalizeJournal(saved.journal) };
      }
    } catch (error) {
      console.warn('Không đọc được bộ nhớ chương đã lưu.', error);
    }
    return freshChapterState();
  }

  let chapterState = loadChapterState();

  function renderJourney() {
    const journal = chapterState.journal;
    const title = document.querySelector('#quest-title');
    const step = document.querySelector('#quest-step');
    const fill = document.querySelector('#quest-fill');
    const percent = document.querySelector('#quest-percent');
    const list = document.querySelector('#memory-list');
    if (title) title.textContent = journal.goal || 'Chưa đặt mục tiêu';
    if (step) step.textContent = journal.step || (journal.goal ? 'Hành trình vừa bắt đầu; bước tiếp theo sẽ được ghi sau lượt đầu tiên.' : 'Bắt đầu hành trình để hệ thống ghi lại bước tiếp theo sau mỗi lượt.');
    if (fill) fill.style.width = `${journal.progress}%`;
    if (percent) percent.textContent = `${journal.progress}%`;
    if (list) {
      list.replaceChildren(...(journal.notes.length ? journal.notes : [{ text: 'Chưa có ký ức nào. Mỗi lượt chơi sẽ ghi lại một dòng.' }])
        .slice().reverse().map(note => {
          const paragraph = document.createElement('p');
          paragraph.textContent = `• ${note.text}`;
          if (note.chapter) paragraph.title = `Chương ${note.chapter}, lượt ${note.turn}`;
          return paragraph;
        }));
    }
  }

  // Ký ức dự phòng khi AI không trả lời: lấy câu đầu của hành động người chơi.
  function fallbackJournalNote(action) {
    const sentence = action.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s/)[0] || '';
    return sentence.length > 120 ? `${sentence.slice(0, 117).trimEnd()}…` : sentence;
  }

  function pushJournalNote(text) {
    const clean = (text || '').replace(/\s+/g, ' ').trim().replace(/^[•\-–]\s*/, '');
    if (!clean) return;
    const notes = chapterState.journal.notes;
    if (notes.length && notes[notes.length - 1].text === clean) return;
    notes.push({ chapter: chapterState.chapterNumber, turn: chapterState.turns.length + 1, text: clean });
    chapterState.journal.notes = notes.slice(-MAX_JOURNAL_NOTES);
  }

  function formatJournalContext() {
    const journal = chapterState.journal;
    return [
      `MỤC TIÊU HIỆN TẠI (thầm kín, chỉ để định hướng tình tiết, không được nói ra trong truyện): ${journal.goal || 'chưa rõ'}${journal.step ? ` — bước tiếp theo: ${journal.step}` : ''} (tiến độ ước lượng ${journal.progress}%).`,
      `KÝ ỨC GẦN ĐÂY (mới nhất ở cuối): ${journal.notes.length ? journal.notes.map(note => note.text).join(' | ') : 'chưa có'}.`
    ].join('\n');
  }

  // Một lời gọi ngắn (JSON) sau mỗi lượt: rút ra 1 dòng ký ức, bước tiếp theo và % tiến độ.
  // Lỗi hay hết giờ thì không chặn lượt chơi: ghi ký ức dự phòng từ hành động người chơi.
  async function updateJourney(model, action, narrative) {
    const journal = chapterState.journal;
    help.textContent = 'Đang ghi nhật ký hành trình…';
    let update = null;
    try {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Ngươi là thư ký ghi nhật ký hành trình cho game truyện. Chỉ trả về JSON đúng lược đồ, viết tiếng Việt, không văn chương. memory: MỘT câu tối đa 25 từ ghi sự việc quan trọng nhất vừa xảy ra trong lượt (ai, làm gì, kết quả), gọi nhân vật người chơi bằng "ngươi". step: MỘT câu tối đa 25 từ nêu việc cụ thể cần làm tiếp để tiến gần mục tiêu dài hạn, dựa trên tình huống cuối lượt. progress: số nguyên 0–100 ước lượng mức hoàn thành mục tiêu dài hạn tính đến hết lượt này; chỉ tăng khi có bước tiến thật, có thể giảm nếu thụt lùi; mục tiêu chưa bắt đầu là 0, đã hoàn tất là 100. Chỉ dùng dữ kiện trong tư liệu, không suy diễn.' },
            { role: 'user', content: [
              `MỤC TIÊU DÀI HẠN: ${journal.goal || 'chưa đặt mục tiêu cụ thể'}`,
              `BƯỚC TIẾP THEO ĐANG GHI: ${journal.step || 'chưa có'}`,
              `TIẾN ĐỘ ĐANG GHI: ${journal.progress}%`,
              `KÝ ỨC GẦN ĐÂY: ${journal.notes.map(note => note.text).join(' | ') || 'chưa có'}`,
              `HÀNH ĐỘNG NGƯỜI CHƠI LƯỢT NÀY:\n${action}`,
              `DIỄN BIẾN VỪA KỂ:\n${narrative.length > 6000 ? `${narrative.slice(0, 3000)}\n[...]\n${narrative.slice(-3000)}` : narrative}`
            ].join('\n\n') }
          ],
          format: {
            type: 'object',
            properties: { memory: { type: 'string' }, step: { type: 'string' }, progress: { type: 'integer' } },
            required: ['memory', 'step', 'progress']
          },
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.2, top_p: 0.8, num_predict: 220 }
        })
      }, 120000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const content = data.message?.content || '';
      update = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || content);
    } catch (error) {
      console.warn('Không ghi được nhật ký hành trình bằng AI; dùng bản dự phòng.', error);
    }
    const memory = typeof update?.memory === 'string' && update.memory.trim() ? update.memory : fallbackJournalNote(action);
    pushJournalNote(memory);
    if (typeof update?.step === 'string' && update.step.trim()) journal.step = update.step.replace(/\s+/g, ' ').trim();
    if (Number.isFinite(update?.progress)) journal.progress = Math.max(0, Math.min(100, Math.round(update.progress)));
    saveChapterState();
    renderJourney();
  }

  window.setJourneyGoal = goal => {
    chapterState.journal = freshJournal((goal || '').trim() || 'Bắt đầu hành trình');
    saveChapterState();
    renderJourney();
  };

  function saveChapterState() {
    try {
      localStorage.setItem(CHAPTER_MEMORY_KEY, JSON.stringify(chapterState));
    } catch (error) {
      console.warn('Không lưu được bộ nhớ chương.', error);
    }
  }

  function updateChapterProgress() {
    const chapterLabel = document.querySelector('.chapter span');
    if (chapterLabel) chapterLabel.textContent = `CHƯƠNG ${String(chapterState.chapterNumber).padStart(2, '0')}`;
  }

  window.resetChapterMemory = () => {
    chapterState = freshChapterState();
    saveChapterState();
    updateChapterProgress();
    renderJourney();
  };

  function formatChapterMemory() {
    if (!chapterState.memories.length) return 'Chưa có chương hoàn tất nào trong bộ nhớ.';
    return chapterState.memories.slice(-MAX_REMEMBERED_CHAPTERS)
      .map(chapter => `CHƯƠNG ${String(chapter.number).padStart(2, '0')}: ${chapter.summary}`)
      .join('\n\n');
  }

  function formatCurrentChapterContext() {
    if (!chapterState.turns.length) return 'Chưa có lượt nào khác trong chương hiện tại.';
    return chapterState.turns.map((turn, index) => {
      const paragraphs = turn.narrative.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
      const latestTurn = index === chapterState.turns.length - 1;
      const excerpts = latestTurn
        ? [turn.narrative.slice(-3200)]
        : [...paragraphs.slice(0, 1).map(value => value.slice(0, 300)), ...paragraphs.slice(-1).map(value => value.slice(-500))];
      return `LƯỢT ${index + 1} — HÀNH ĐỘNG NGƯỜI CHƠI: ${turn.action}\nDIỄN BIẾN VÀ KẾT QUẢ ĐÃ XẢY RA: ${[...new Set(excerpts)].join('\n')}`;
    }).join('\n\n');
  }

  function formatRecentStoryContext(maxCharacters = 5600) {
    const entries = [...story.children]
      .filter(node => node.matches('.narration, .story-entry'))
      .map(node => {
        if (node.matches('.story-entry')) {
          const speaker = node.querySelector('.speaker')?.textContent.trim() || 'Nhân vật';
          const line = node.querySelector('dialogue')?.textContent.trim() || '';
          return line ? `${speaker} nói: ${line}` : '';
        }
        return node.textContent.trim();
      }).filter(Boolean);
    const recent = [];
    let length = 0;
    for (const entry of entries.reverse()) {
      const excerpt = entry.length > 1000 ? entry.slice(-1000) : entry;
      if (length + excerpt.length > maxCharacters && recent.length) break;
      recent.push(excerpt);
      length += excerpt.length;
    }
    return recent.reverse().join('\n\n') || story.innerText.trim().slice(-maxCharacters);
  }

  function fallbackChapterSummary(turns) {
    return turns.map((turn, index) => {
      const paragraphs = turn.narrative.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
      const highlights = [...paragraphs.slice(0, 2), ...paragraphs.slice(-2)];
      return `Lượt ${index + 1} — Hành động: ${turn.action.slice(0, 280)}. Diễn biến: ${[...new Set(highlights)].join(' ')} `;
    }).join('\n').slice(0, 3600);
  }

  function chapterSourceForSummary(turn) {
    if (turn.narrative.length <= 5000) return turn.narrative;
    return `${turn.narrative.slice(0, 2500)}\n[Đã lược bớt phần giữa; xem diễn biến cuối lượt bên dưới.]\n${turn.narrative.slice(-2500)}`;
  }

  // Decides whether the closing chapter contained combat (which blocks end-of-chapter HP recovery).
  // Falls back to a keyword check when Ollama is unavailable or answers badly.
  const COMBAT_WORDS = /giao tranh|giao chiến|chiến đấu|đánh nhau|tấn công|chém|đâm|xuất chiêu|trúng chiêu|thọ thương|bị thương|hộc máu|phục kích|truy sát|ẩu đả|quyết đấu/iu;
  async function detectChapterCombat(model, turns, summary) {
    const source = turns.map((turn, index) => `LƯỢT ${index + 1}\nHÀNH ĐỘNG: ${turn.action}\nDIỄN BIẾN: ${chapterSourceForSummary(turn)}`).join('\n\n');
    try {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Ngươi phân loại một chương truyện. Trả về JSON {"combat": true|false}. combat là true chỉ khi nhân vật chính thực sự tham gia giao tranh, đánh nhau hoặc bị tấn công trong chương; tranh cãi, đe dọa hay chỉ nhắc tới trận đánh thì là false.' },
            { role: 'user', content: `${summary ? `TÓM LƯỢC CHƯƠNG:\n${summary}\n\n` : ''}TƯ LIỆU CHƯƠNG:\n${source}` }
          ],
          format: { type: 'object', properties: { combat: { type: 'boolean' } }, required: ['combat'] },
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0, num_predict: 20 }
        })
      }, 180000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const combat = JSON.parse(data.message?.content || '{}').combat;
      if (typeof combat === 'boolean') return combat;
    } catch (error) {
      console.warn('Dùng từ khóa để xác định giao tranh trong chương.', error);
    }
    return COMBAT_WORDS.test(turns.map(turn => `${turn.action}\n${turn.narrative}`).join('\n'));
  }

  async function closeCurrentChapter(model) {
    const closingChapter = { number: chapterState.chapterNumber, turns: chapterState.turns };
    const previousMemory = formatChapterMemory();
    let summary = '';
    setStatus('writing', 'Đang lưu trí nhớ chương…');
    help.textContent = `Ollama đang tóm lược chương ${closingChapter.number} để giữ mạch truyện cho các chương sau.`;
    try {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Ngươi là biên tập viên ghi nhớ liên tục cho game truyện. Tóm lược CHỈ những sự kiện đã xảy ra trong tư liệu, không suy diễn, không thêm chi tiết. Ghi ngắn gọn bằng tiếng Việt (200–300 từ), tập trung vào địa điểm và thời điểm hiện tại, hành động/quyết định đã hoàn tất, kết quả và tài nguyên thay đổi, NPC cùng thái độ/quan hệ, thông tin hoặc lời hứa đã tiết lộ, bí ẩn và việc còn dang dở. Phân biệt rõ dữ kiện chắc chắn với điều nhân vật chưa biết. Không viết văn chương, không lặp lại diễn biến.' },
            { role: 'user', content: `TÓM LƯỢC CÁC CHƯƠNG TRƯỚC ĐỂ ĐỐI CHIẾU:\n${previousMemory}\n\nCHƯƠNG ${closingChapter.number} CẦN GHI NHỚ:\n${closingChapter.turns.map((turn, index) => `LƯỢT ${index + 1}\nHÀNH ĐỘNG NGƯỜI CHƠI: ${turn.action}\nDIỄN BIẾN ĐÃ KỂ: ${chapterSourceForSummary(turn)}`).join('\n\n')}` }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.2, top_p: 0.8, repeat_penalty: 1.15, num_predict: 900 }
        })
      }, 180000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      summary = data.message?.content?.trim() || '';
    } catch (error) {
      console.warn('Dùng bản ghi rút gọn dự phòng cho chương.', error);
    }

    const hadCombat = await detectChapterCombat(model, closingChapter.turns, summary);
    awardChapterCultivation().forEach(appendTurnReport);
    appendTurnReport(applyChapterRecovery(hadCombat));
    chapterState.memories.push({ number: closingChapter.number, summary: (summary || fallbackChapterSummary(closingChapter.turns)).slice(0, 4000) });
    chapterState.memories = chapterState.memories.slice(-MAX_REMEMBERED_CHAPTERS);
    chapterState.chapterNumber++;
    chapterState.turns = [];
    saveChapterState();
    updateChapterProgress();
    setStatus('ready');
    help.textContent = `Đã lưu trí nhớ chương ${closingChapter.number}; AI mang theo tối đa ${MAX_REMEMBERED_CHAPTERS} chương gần nhất.`;
  }

  async function recordTurn(action, narrative, model) {
    chapterState.turns.push({ action, narrative });
    saveChapterState();
    if (chapterState.turns.length >= TURNS_PER_CHAPTER) {
      await closeCurrentChapter(model);
      return true;
    } else {
      updateChapterProgress();
      return false;
    }
  }

  function setStatus(state, message = statusText[state]) {
    status.dataset.state = state;
    status.textContent = message;
  }

  function getProfileValue(selector) {
    return document.querySelector(selector)?.value?.trim() || '';
  }

  function getProfile() {
    return {
      name: document.querySelector('#player-name')?.textContent || getProfileValue('#origin-name') || 'Nhân vật chính',
      age: getProfileValue('#origin-age'),
      identity: getProfileValue('#origin-identity'),
      setting: getProfileValue('#origin-setting'),
      goal: getProfileValue('#origin-goal'),
      realm: document.querySelector('#player-realm')?.textContent || getProfileValue('#origin-realm'),
      nsfw: true,
      worldName: getProfileValue('#origin-setting').split(/[\n;.!?]/)[0].slice(0, 80) || 'Thế giới tự tạo'
    };
  }

  function worldDirective(profile) {
    return `THẾ GIỚI NGƯỜI CHƠI MUỐN TRẢI NGHIỆM: ${profile.setting || 'chưa mô tả'}. Đây có thể là một bộ truyện/tiểu thuyết nổi tiếng, một giai đoạn lịch sử hoặc một thế giới hoàn toàn mới. Nếu nhận ra tác phẩm, hãy dùng đúng hệ thống sức mạnh, phe phái, địa lý, nhân vật và mốc truyện phù hợp với mô tả; nếu là lịch sử, tôn trọng thời đại, địa danh, thiết chế và sự kiện đã biết, không đưa yếu tố hiện đại sai thời kỳ. Phần nhập của người chơi quyết định thời điểm, địa điểm và các thay đổi so với nguyên tác. Nếu không nhận biết chắc hoặc thiếu dữ kiện, đừng bịa chi tiết canon/lịch sử như sự thật; hãy tạo tuyến nhân vật và sự kiện phụ hợp lý trong khung đã nêu. Nếu là thế giới tự tạo, coi các quy tắc người chơi mô tả là luật nền, suy ra nhất quán phe phái, tài nguyên, sức mạnh, hiểm họa và cơ hội. Trong mọi kiểu thế giới, mỗi lượt cần có diễn biến mới phù hợp hành động và bối cảnh; không trộn cơ chế từ tác phẩm/thời đại khác, không viết lại nguyên tác, và không tước quyền lựa chọn của nhân vật người chơi.`;
  }

  // The player's input cards, in the order they were written: narration or a line of dialogue.
  function getPlayerEntries() {
    return [...inputs.querySelectorAll('.input-card')].flatMap(card => {
      const text = card.querySelector('textarea')?.value.trim();
      if (!text) return [];
      if (!card.classList.contains('dialogue-card')) return [{ type: 'narration', text }];
      return [{ type: 'dialogue', speaker: card.querySelector('.dialogue-meta input')?.value.trim() || getProfile().name, text }];
    });
  }

  function getPlayerAction() {
    return getPlayerEntries()
      .map(entry => entry.type === 'dialogue' ? `${entry.speaker} nói: “${entry.text}”` : entry.text)
      .join('\n');
  }

  // The model retells what the player wrote, polished but complete. This checks that nothing was
  // dropped: a dialogue line must reappear with most of its words in some speech bubble, and a
  // narration card must leave most of its content words somewhere in the answer.
  const contentWords = text => new Set(text.toLocaleLowerCase('vi').replace(/<[^>]*>|\*\*/g, ' ').match(/[\p{L}\p{N}]+/gu)?.filter(word => word.length > 1) || []);
  function missingPlayerEntries(answer, entries) {
    const bubbles = [...answer.matchAll(/<dialogue\b[^>]*>([\s\S]*?)<\/dialogue\s*>/gi)].map(match => contentWords(match[1]));
    const whole = contentWords(answer);
    const coverage = (words, pool) => words.size ? [...words].filter(word => pool.has(word)).length / words.size : 1;
    return entries.filter(entry => {
      const words = contentWords(entry.text);
      return entry.type === 'dialogue'
        ? !bubbles.some(bubble => coverage(words, bubble) >= 0.6)
        : coverage(words, whole) < 0.5;
    });
  }
  const describeEntry = entry => entry.type === 'dialogue' ? `lời thoại của ${entry.speaker}: “${entry.text}”` : `tường thuật: “${entry.text}”`;
  function entryToStory(entry) {
    return entry.type === 'dialogue' ? `<dialogue speaker="${entry.speaker.replace(/"/g, '')}">${entry.text}</dialogue>` : entry.text;
  }

  function getWorldContext(profile) {
    const readItems = selector => [...document.querySelectorAll(`${selector} .item`)]
      .map(item => `${item.querySelector('b')?.textContent || ''} (${item.querySelector('.item-grade')?.textContent || ''}; ${(item.querySelector('.item-state')?.textContent || 'đang dùng') + '; ' + (item.querySelector('.item-effect')?.textContent || '')})`).filter(Boolean);
    const stats = Object.entries(CHARACTER_STAT_LABELS)
      .map(([key, label]) => `${key === 'health' ? 'Máu (hiện tại / tối đa)' : label}: ${document.getElementById(key)?.textContent?.trim() || 'chưa rõ'}`)
      .join('; ');
    return [
      `HỒ SƠ: ${profile.name}; ${profile.age || 'tuổi chưa rõ'}; thân phận ${profile.identity || 'chưa rõ'}; cảnh giới ${profile.realm || 'chưa rõ'}.`,
      `THẾ GIỚI MUỐN CHƠI: ${profile.worldName || 'Thế giới tự tạo'}.`,
      `MÔ TẢ THẾ GIỚI VÀ MỐC THỜI GIAN: ${profile.setting || 'chưa thiết lập'}`,
      `MỤC TIÊU: ${profile.goal || 'chưa đặt mục tiêu cụ thể'}`,
      `CHỈ SỐ HIỆN TẠI: ${stats}.`,
      `TRANG BỊ ĐANG MẶC: ${readItems('#equipment-list').join('; ') || 'không có'}.`,
      `KỸ NĂNG ĐANG DÙNG: ${readItems('#skills-list').join('; ') || 'không có'}.`,
      `TÚI ĐỒ (chưa sử dụng): ${readItems('#bag-list').join('; ') || 'trống'}.`,
      `TIỀN HIỆN CÓ: ${document.querySelector('#inventory-coins')?.textContent || '0'} đồng.`,
      occultContext(),
      npcProfilesContext(),
      `BẠO PHÁT LƯỢT NÀY: ${pendingBurst ? `${pendingBurst.name}: ${burstEffectText(pendingBurst.bonus, pendingBurst.kind)}; chỉ có hiệu lực lượt này. ${burstCostText(pendingBurst.kind)}.` : 'Không kích hoạt. Không tự dùng công pháp bạo phát.'}`,
      `DI CHỨNG BẠO PHÁT: ${burstFatigue ? `đang chịu ${burstFatigue.cost} sau ${burstFatigue.name}: ${CHARACTER_STAT_LABELS[burstFatigue.stat]} giảm ${FATIGUE_PERCENT}% (chỉ số hiển thị đã trừ), không thể bạo phát; hãy thể hiện di chứng này trong lượt.` : 'không.'}`,
      `VẬT PHẨM: ${[
        ...Object.entries(potions).filter(([, count]) => count > 0).map(([key, count]) => { const potion = potionFromKey(key); return `Bình máu ${potion[1]} cấp ${itemLevel(potion)} ×${count} (hồi ${potionHeal(potion)} máu)`; }),
        ...Object.entries(occultMaterials).filter(([, count]) => count > 0).map(([key, count]) => `${materialOffers[key][0]} ×${count} ${materialOffers[key][2]}`),
        lootSummary()
      ].filter(Boolean).join('; ') || 'không có'}. Bình máu do người chơi tự dùng bằng nút; nguyên liệu do hệ thống tiêu hao; chiến lợi phẩm chỉ được dùng, tặng hay đổi khi hành động của người chơi nêu ra.`,
      'Chỉ số hiển thị đã cộng hiệu ứng trang bị và kỹ năng; không cộng hai lần. Công pháp trốn chạy chỉ hỗ trợ thoát thân khi được kích hoạt, không bảo đảm thành công. Tu vi được hệ thống cộng một lần khi hết chương: 2,5% tu vi cần để lên cấp cộng phần của tâm pháp đang dùng (ma đạo chỉ góp ở lượt đủ điều kiện); hệ thống tự tính tu vi và chi phí, không tự bịa thay đổi số liệu.',
      'Danh sách trang bị, kỹ năng và túi đồ hiện tại là nguồn chính xác về sở hữu. Không sử dụng lại món đã bán, vứt bỏ hoặc kỹ năng đã quên chỉ vì chúng xuất hiện trong truyện trước đó.',
      'Chỉ sử dụng trang bị đang mặc và kỹ năng đang dùng. Trang bị đã tháo và kỹ năng đã tắt vẫn được sở hữu nhưng không có hiệu lực; không tự mặc lại hay bật lại thay người chơi.',
      `CHƯƠNG ĐANG KỂ: ${document.querySelector('.chapter span')?.textContent?.trim() || 'CHƯƠNG 01'}.`,
      formatJournalContext()
    ].join('\n');
  }

  function adultIntimacyRule(profile) {
    if (!(profile.nsfw || profile.allowNsfw)) return 'Nội dung tình cảm giữ ở mức phù hợp lứa tuổi, không miêu tả tình dục.';
    const age = Number.parseInt(profile.age, 10);
    if (!Number.isFinite(age) || age < 18) return 'CẤM nội dung tình dục hoặc gợi dục: nhân vật chính chưa đủ 18 tuổi hoặc tuổi không xác định. Chỉ kể tình bạn, tình cảm trong sáng và phi tình dục.';
    return 'Có thể khai thác tình cảm và sự thân mật trưởng thành ở mức gợi cảm, không đồ họa khi mạch truyện phù hợp. Chỉ giữa các nhân vật được xác định rõ đều từ 18 tuổi trở lên, có sự đồng thuận rõ ràng và có thể rút lại; không tình dục hóa người chưa thành niên hoặc người không rõ tuổi, không ép buộc, bạo lực tình dục hay quan hệ quyền lực thiếu đồng thuận. Nếu tuổi hoặc sự đồng thuận chưa rõ, giữ nội dung phi tình dục.';
  }

  function setHelpForError(error) {
    const remotePage = location.protocol === 'https:' && !['localhost', '127.0.0.1'].includes(location.hostname);
    const detail = error?.name === 'AbortError' ? 'Ollama chưa phản hồi kịp thời.' : 'Ollama chưa chạy hoặc trình duyệt chưa được phép kết nối tới máy cục bộ.';
    help.textContent = remotePage
      ? `${detail} Với GitHub Pages, đặt biến môi trường Windows OLLAMA_ORIGINS=https://lavie2404.github.io, rồi thoát và mở lại Ollama. Chỉ cho phép đúng origin này; không dùng dấu *.`
      : `${detail} Mở Ollama rồi thử kiểm tra lại.`;
  }

  async function fetchWithTimeout(url, options, timeoutMs = 120000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async function checkConnection() {
    setStatus('busy');
    checkButton.disabled = true;
    help.textContent = 'Đang kiểm tra máy chủ Ollama trên máy này…';
    try {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/tags`, { method: 'GET' }, 7000);
      if (!response.ok) throw new Error(`Ollama trả về HTTP ${response.status}.`);
      const data = await response.json();
      const modelName = modelInput.value.trim();
      const available = (data.models || []).some(model => model.name === modelName || model.name?.startsWith(`${modelName.split(':')[0]}:`));
      if (!available) {
        setStatus('error', 'Ollama đang chạy, nhưng chưa thấy model này');
        help.textContent = `Kiểm tra tên model. Có thể tải model bằng: ollama pull ${modelName}`;
        return false;
      }
      setStatus('ready');
      help.textContent = `Đã kết nối ${modelName}. Yêu cầu AI được gửi tới Ollama local.`;
      return true;
    } catch (error) {
      setStatus('error');
      setHelpForError(error);
      return false;
    } finally {
      checkButton.disabled = false;
    }
  }

  function appendEmphasized(parent, text) {
    const emphasis = /\*\*([^*\n]+)\*\*/g;
    let cursor = 0;
    for (const match of text.matchAll(emphasis)) {
      parent.append(document.createTextNode(text.slice(cursor, match.index)));
      const strong = document.createElement('strong');
      strong.className = 'story-emphasis';
      strong.textContent = match[1];
      parent.append(strong);
      cursor = match.index + match[0].length;
    }
    parent.append(document.createTextNode(text.slice(cursor)));
  }

  function addParagraph(text, className = 'narration') {
    const paragraph = document.createElement('p');
    paragraph.className = className;
    // A paragraph never starts in lower case, even when it continues a sentence cut by a speech bubble.
    appendEmphasized(paragraph, text.replace(/^((?:\*\*|\s)*)(\p{Ll})/u, (whole, lead, letter) => lead + letter.toLocaleUpperCase('vi')));
    story.append(paragraph);
  }

  // The story highlights names and terms with **...**, never with quote marks.
  // Tag markup is skipped so speaker="..." attributes stay intact.
  function emphasizeQuotes(text) {
    const quoted = /“([^”\n]+)”|"([^"\n]+)"|‘([^’\n]+)’|「([^」\n]+)」|(?<![\p{L}\p{N}])'([^'\n]+)'(?![\p{L}\p{N}])/gu;
    return text.split(/(<[^>]*>)/).map(part => part.startsWith('<') ? part : part.replace(quoted, (...groups) => {
      const inner = groups.slice(1, 6).find(value => value !== undefined).replace(/\*\*/g, '').trim();
      return inner ? `**${inner}**` : '';
    })).join('');
  }

  function appendNarrationWithDialogue(text, playerName) {
    const pattern = /<dialogue\s+speaker\s*=\s*(["'])(.*?)\1\s*>([\s\S]*?)<\/dialogue\s*>/gi;
    text = emphasizeQuotes(text);
    let cursor = 0;
    let match;

    while ((match = pattern.exec(text))) {

      const narration = text.slice(cursor, match.index).replace(/<\/?dialogue\b[^>]*>/gi, '').trim();
      if (narration) addParagraph(narration);
      const speaker = match[2].trim() || 'Không rõ';
      const spokenText = match[3].replace(/<\/?dialogue\b[^>]*>/gi, '').trim();
      if (spokenText) {
        const entry = document.createElement('div');
        const role = speaker === playerName ? 'player' : speaker === 'Chưa rõ người nói' ? 'unattributed' : 'npc';
        entry.className = `story-entry ${role}`;
        const avatar = document.createElement(role === 'npc' ? 'button' : 'div');
        avatar.className = 'avatar';
        if (role === 'npc') {
          avatar.type = 'button';
          avatar.setAttribute('aria-label', `Xem thông tin ${speaker}`);
          avatar.title = `Xem thông tin ${speaker}`;
        }
        avatar.textContent = [...speaker][0] || '•';
        const body = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'speaker';
        name.textContent = speaker;
        const dialogue = document.createElement('dialogue');
        appendEmphasized(dialogue, spokenText);
        body.append(name, dialogue);
        entry.append(avatar, body);
        story.append(entry);
      }
      cursor = pattern.lastIndex;
    }
    const trailing = text.slice(cursor).replace(/<\/?dialogue\b[^>]*>/gi, '').trim();
    if (trailing) addParagraph(trailing);
  }

  // Who a capitalised name refers to, judged by the word right before it: "nàng Lữ Thanh Tuyền" is a woman,
  // "kinh thành Gia Cát" is a place. Used to resolve "nàng hỏi" to the right speaker and to bold character names.
  const NAME_MARKERS = {
    female: ['nàng', 'cô nương', 'cô gái', 'thiếu nữ', 'tiểu thư', 'phu nhân', 'cô', 'bà', 'chị', 'sư muội', 'sư tỷ', 'công chúa', 'nữ hiệp', 'nha hoàn', 'mỹ nhân'],
    male: ['hắn', 'chàng', 'gã', 'lão', 'ông', 'cậu', 'công tử', 'thiếu niên', 'tướng quân', 'sư huynh', 'sư đệ', 'đại hiệp', 'tráng sĩ', 'thừa tướng'],
    person: ['tên là', 'tên gọi là', 'gọi là', 'tự xưng là', 'tự xưng', 'người tên', 'kẻ tên', 'trưởng lão', 'sư phụ', 'đạo hữu', 'tiền bối', 'huynh', 'muội'],
    place: ['kinh thành', 'thành', 'núi', 'sông', 'huyện', 'quận', 'châu', 'làng', 'thôn', 'trấn', 'phủ', 'nước', 'đất', 'vùng', 'miền', 'cõi', 'đảo', 'hồ', 'rừng', 'cung', 'điện', 'lầu', 'quán', 'chùa', 'ải', 'bến', 'doanh trại', 'thung lũng', 'đại lục', 'đế quốc', 'vương quốc', 'tông môn', 'môn phái']
  };
  const markerKind = new Map(Object.entries(NAME_MARKERS).flatMap(([kind, words]) => words.map(word => [word, kind])));
  const markerBefore = new RegExp(`(?:^|[^\\p{L}])(${[...markerKind.keys()].sort((a, b) => b.length - a.length).join('|')})\\s+$`, 'iu');
  // Every multi-word capitalised name in the text with the kind its marker gives it ('' when there is none).
  function nameMentions(text) {
    const mentions = [];
    for (const match of text.matchAll(/[\p{Lu}][\p{L}]+(?:[ \t]+[\p{Lu}][\p{L}]+){1,3}/gu)) {
      let name = match[0], lead = text.slice(Math.max(0, match.index - 24), match.index);
      // A sentence that opens with the marker capitalises it too: "Nàng Lữ Thanh Tuyền".
      const tokens = name.split(/[ \t]+/), first = tokens[0].toLocaleLowerCase('vi');
      if (tokens.length > 2 && markerKind.has(first)) { lead = `${first} `; name = tokens.slice(1).join(' '); }
      mentions.push({ name, index: match.index, kind: markerKind.get(lead.match(markerBefore)?.[1].toLocaleLowerCase('vi')) || '' });
    }
    return mentions;
  }
  // A name is a place when some mention marks it as one and none marks it as a person.
  function placeNames(mentions) {
    const kinds = new Map();
    mentions.forEach(({ name, kind }) => kinds.set(name, (kinds.get(name) || new Set()).add(kind)));
    return new Set([...kinds].filter(([, seen]) => seen.has('place') && !['female', 'male', 'person'].some(kind => seen.has(kind))).map(([name]) => name));
  }
  // Character names in narration are shown in **bold**. The model is asked to do it; this catches what it misses:
  // speakers, known NPCs, the player, and names introduced with a person marker. Dialogue text is left alone.
  function emphasizeNames(text, playerName) {
    const plain = text.replace(/<[^>]*>/g, ' ').replace(/\*\*/g, '');
    const mentions = nameMentions(plain), places = placeNames(mentions);
    const names = new Set([
      playerName,
      ...[...text.matchAll(/speaker\s*=\s*(["'])(.*?)\1/gi)].map(match => match[2].trim()),
      ...[...story.querySelectorAll('.story-entry .speaker')].map(node => node.firstChild?.textContent.trim()),
      ...[...npcProfiles.values()].flatMap(profile => [profile.speaker, profile.fullName]),
      ...mentions.filter(mention => ['female', 'male', 'person'].includes(mention.kind)).map(mention => mention.name)
    ].filter(name => name && name.length > 1 && !places.has(name) && !/^(?:Chưa rõ người nói|Không rõ|NPC)$/iu.test(name)));
    if (!names.size) return text;
    const escaped = [...names].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped.join('|')})(?![\\p{L}\\p{N}])`, 'gu');
    return text.split(/(<dialogue\b[^>]*>[\s\S]*?<\/dialogue\s*>)/i).map(part => /^<dialogue\b/i.test(part) ? part
      : part.split(/(\*\*[^*\n]+\*\*|<[^>]*>)/).map(piece => /^(\*\*|<)/.test(piece) ? piece : piece.replace(pattern, '**$1**')).join('')).join('');
  }
  // Narration that carries on after a speech bubble starts a new paragraph, so it starts with a capital:
  // </dialogue> nàng hỏi, giọng run run. → Nàng hỏi, giọng run run.
  function capitalizeAfterDialogue(text) {
    return text.replace(/(<\/dialogue\s*>)[ \t]*[,;—–-]*[ \t]*(\p{Ll})/gu, (whole, tag, letter) => `${tag} ${letter.toLocaleUpperCase('vi')}`);
  }

  // Only <dialogue> tags are speech when rendering. Resolve missing or vague
  // speakers on those tags, and repair utterances the model left in quotes
  // despite the contract, before rendering or saving the turn, so prompt
  // history and UI agree. A quote only counts as speech when a speaker and a
  // speech verb sit right beside it (“...” Lâm Tuyết hỏi.); any other quote,
  // such as a title named mid-sentence, stays narration.
  function normalizeDialogue(text, playerName) {
    const dialoguePattern = /<dialogue\b[^>]*>[\s\S]*?<\/dialogue\s*>|“([^”]+)”|"([^"]+)"|「([^」]+)」|‘([^’]+)’/gi;
    const soundOnly = /^(?:phịch|bịch|thịch|bụp|bộp|rầm|ầm|choang|keng|cạch|xoẹt|vút|vù|vù vù|rắc|lộp bộp|ầm ầm|thịch thịch)[.!…]*$/iu;
    text = text.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}\u{30000}-\u{323AF}]/gu, '');
    const attribution = '(?:nói|hỏi|đáp|trả lời|thì thầm|kêu lên|quát|gọi|lên tiếng|cất tiếng|lẩm bẩm|reo lên|thốt lên)';
    const name = '[\\p{Lu}][\\p{L}]+(?:[ \\t]+[\\p{Lu}][\\p{L}]+){0,3}';
    const pronoun = '(?:Cậu ấy|Anh ấy|Nàng ấy|Hắn|Cậu|Anh|Nàng|Chàng|Ngươi|Bạn|Nhân vật chính)';
    // Narration continues a quote in lower case: “...” nàng hỏi.
    const anyPronoun = `(?:${pronoun.slice(3, -1)}|${pronoun.slice(3, -1).toLocaleLowerCase('vi')})`;
    const modifiers = '(?:\\s+(?:khẽ|nhẹ nhàng|trầm giọng|vội|lạnh lùng|lớn tiếng|chậm rãi|mỉm cười))*';
    const invalidNames = /^(?:Lời|Lời nói|Tiếng|Giọng|Người đối diện|Không rõ|Chưa rõ người nói|NPC|Người lạ|Cô gái|Chàng trai|Người đàn ông|Người phụ nữ)$/iu;
    const generatedNames = new Map();
    const usedNames = new Set([playerName, ...[...text.matchAll(/speaker\s*=\s*["']([^"']+)["']/gi)].map(match=>match[1])]);
    let lastNpc = '';
    function requireSpeaker(speaker, hint = '') {
      if (speaker && !invalidNames.test(speaker)) {
        if(speaker!==playerName)lastNpc=speaker;
        return speaker;
      }
      if (/^(?:ngươi|bạn|nhân vật chính)$/iu.test(hint)) return playerName;
      const key = /nàng|cô gái|phụ nữ/iu.test(hint) ? 'female' : /hắn|chàng|cậu|anh|đàn ông/iu.test(hint) ? 'male' : hint.toLocaleLowerCase('vi') || 'unidentified';
      if (!hint && lastNpc) return lastNpc;
      if (!generatedNames.has(key)) {
        const surnames = ['Lâm','Tống','Thẩm','Tô','Lục','Liễu','Hàn','Mộ'];
        const given = key==='female' ? ['Thanh Dao','Nguyệt Ninh','Vân Chi','Nhược Lan'] : ['Vân Phong','Tử An','Cảnh Hành','Mặc Hiên'];
        let index=generatedNames.size, candidate;
        do {
          candidate=`${surnames[index%surnames.length]} ${given[Math.floor(index/surnames.length)%given.length]}`;
          if(index>=surnames.length*given.length)candidate+=' '+ 'An'.repeat(Math.floor(index/(surnames.length*given.length)));
          index++;
        } while(usedNames.has(candidate) || text.includes(candidate));
        generatedNames.set(key,candidate);usedNames.add(candidate);
      }
      lastNpc=generatedNames.get(key);
      return lastNpc;
    }
    // Only an attribution directly beside an utterance can identify its speaker.
    function speechAttribution(before, after) {
      before = before.replace(/\*\*/g, '');
      after = after.replace(/\*\*/g, '');
      const afterMatch = after.match(new RegExp(`^[\\s,.;:!?…—–-]*(${anyPronoun}|${name})${modifiers}\\s+${attribution}(?=$|[^\\p{L}])`, 'u'));
      const beforeMatch = before.match(new RegExp(`(${anyPronoun}|${name})${modifiers}\\s+${attribution}\\s*[:：,]?\\s*$`, 'u'));
      const subject = afterMatch?.[1] || beforeMatch?.[1] || '';
      return invalidNames.test(subject) ? '' : subject;
    }
    // A pronoun keeps pointing at whoever it last resolved to in this turn.
    const pronounTargets = new Map();
    const pronounKey = value => value.toLocaleLowerCase('vi').replace(/\s+ấy$/u, '');
    // Resolve a subject (name or pronoun) to a character name, '' when unsure.
    function resolveSubject(subject, before) {
      if (!subject || invalidNames.test(subject)) return '';
      if (/^(?:Ngươi|Bạn|Nhân vật chính)$/iu.test(subject)) return playerName;
      if (!new RegExp(`^${pronoun}$`, 'iu').test(subject)) return subject;
      const key = pronounKey(subject);
      const person = recentPerson(before.replace(/\*\*/g, ''), /nàng/iu.test(subject) ? 'female' : 'male') || pronounTargets.get(key) || '';
      if (person) pronounTargets.set(key, person);
      return person;
    }
    function inferSpeaker(before, after) {
      return resolveSubject(speechAttribution(before, after), before);
    }
    // A quote with no speech verb beside it is still speech when it reads as a
    // sentence: ends like one, runs long, or addresses someone (ta, ngươi…).
    const addressing = /(?:^|[^\p{L}])(?:ta|ngươi|ngài|huynh|muội|các hạ|tại hạ|lão phu|chúng ta|bọn ta|các ngươi)(?=$|[^\p{L}])/iu;
    const looksLikeUtterance = value => /^\p{Lu}/u.test(value) && (/[.!?…]$/u.test(value) || value.split(/\s+/).length >= 7 || addressing.test(value));
    let lastSpeaker = '';
    let lastSpeakerEnd = -1;
    // Who an unattributed utterance belongs to: the subject of the sentence
    // just before it, else whoever spoke last in this paragraph.
    function impliedSpeaker(before, matchIndex) {
      const lead = before.replace(/\*\*/g, '').replace(/<[^>]*>|[“”"「」‘’']/g, ' ').trimEnd();
      const sentence = lead.split(/(?<=[.!?…:：])\s*/u).map(part => part.trim()).filter(Boolean).at(-1) || '';
      const subject = sentence.match(new RegExp(`^(${anyPronoun}|[\\p{Lu}][\\p{L}]+(?:[ \\t]+[\\p{Lu}][\\p{L}]+){1,3})(?=$|[^\\p{L}])`, 'u'))?.[1] || '';
      const resolved = resolveSubject(subject, before);
      if (resolved) return resolved;
      if (lastSpeaker && !/\n/.test(text.slice(lastSpeakerEnd, matchIndex))) return lastSpeaker;
      return requireSpeaker('', subject);
    }
    function emitDialogue(speaker, content, end) {
      lastSpeaker = speaker;
      lastSpeakerEnd = end;
      if (speaker !== playerName) lastNpc = speaker;
      output += `<dialogue speaker="${speaker}">${content.replace(/[\s,;]+$/u, '')}</dialogue>`;
    }
    // Resolve a third-person pronoun to the most recent named character before the utterance, never a place
    // ("kinh thành Gia Cát") and never the player, who is "ngươi" in second-person narration. A character
    // introduced with a matching marker ("nàng Lữ Thanh Tuyền" for "nàng hỏi") wins over a more recent bare name.
    // Names inside a relational phrase ("con gái của X", "dưới quyền X") only
    // describe someone else, so a pronoun never resolves to them.
    const relational = /(?:của|dưới quyền|dưới trướng|thuộc|theo|theo lệnh|phe|nhà|quân|họ|cùng với|cùng|với|bên cạnh|bên|cho|về|từ)\s*$/iu;
    function recentPerson(before, gender = '') {
      const mentions = nameMentions(before), places = placeNames(mentions);
      const people = mentions.filter(mention => mention.name !== playerName && !places.has(mention.name)
        && !relational.test(before.slice(Math.max(0, mention.index - 24), mention.index)));
      const opposite = gender ? (gender === 'female' ? 'male' : 'female') : '';
      const genderOf = name => people.find(mention => mention.name === name && ['female', 'male'].includes(mention.kind))?.kind || '';
      const matching = gender ? people.filter(mention => genderOf(mention.name) === gender) : [];
      return (matching.at(-1) || people.filter(mention => genderOf(mention.name) !== opposite).at(-1))?.name || '';
    }
    // Untagged speech by the paragraph: a line introduced by "Cảnh Phong chậm rãi cất tiếng:" or a
    // paragraph the model set in **bold** that speaks in the first person (ta, lão phu, cháu…) becomes a
    // dialogue tag; stray ** left over from such paragraphs is cleaned up.
    const firstPerson = /(?:^|[^\p{L}])(?:ta|tại hạ|lão phu|lão nạp|bần đạo|bổn \p{L}+|chúng ta|bọn ta|thuộc hạ|tiểu nhân|cháu|thiếp|đệ|muội|tỷ|huynh)(?=$|[^\p{L}])/iu;
    const leadIn = new RegExp(`(${anyPronoun}|${name})[^.!?\\n]{0,40}?\\s${attribution}[^.!?\\n]{0,20}[:：]\\s*$`, 'u');
    const bareLeadIn = new RegExp(`^(?:${anyPronoun}|${name})[^.!?\\n]{0,40}?\\s${attribution}[^.!?\\n]{0,20}[:：]\\s*$`, 'u');
    const unbold = value => {
      value = value.replace(/^\*\*\s*/, '').replace(/\s*\*\*$/, '');
      return (value.match(/\*\*/g) || []).length % 2 ? value.replace(/\*\*(?![\s\S]*\*\*)/, '') : value;
    };
    const paragraphs = text.split(/\n\s*\n/);
    let consumed = 0;
    text = paragraphs.map((paragraph, index) => {
      const start = consumed;
      consumed += paragraph.length + 2;
      const trimmed = paragraph.trim();
      if (!trimmed || /<dialogue\b/i.test(trimmed) || /^[“"「‘]/.test(trimmed)) return paragraph;
      const previous = paragraphs[index - 1]?.trim() || '';
      const introduced = leadIn.test(previous) && !/<dialogue\b/i.test(previous);
      const marks = (trimmed.match(/\*\*/g) || []).length;
      // Bold as a whole (**…**) or with one unpaired ** at either end: emphasis gone wrong, not a bold name.
      const bold = /^\*\*(?:(?!\*\*)[\s\S])+\*\*$/.test(trimmed) || (marks % 2 === 1 && /^\*\*|\*\*$/.test(trimmed));
      const content = unbold(trimmed);
      if (!introduced && !(bold && firstPerson.test(content))) return marks % 2 ? content : paragraph;
      const before = text.slice(Math.max(0, start - 1200), start);
      const speaker = introduced
        ? requireSpeaker(resolveSubject(previous.match(leadIn)[1], before), previous.match(leadIn)[1])
        : impliedSpeaker(before, start);
      return `<dialogue speaker="${speaker}">${content}</dialogue>`;
    }).map((paragraph, index, all) => {
      // The bubble names the speaker, so a paragraph that is only the lead-in clause goes away.
      const next = all[index + 1]?.trim() || '';
      return /^<dialogue\b/i.test(next) && bareLeadIn.test(paragraph.trim()) ? '' : paragraph;
    }).filter(paragraph => paragraph !== '').join('\n\n');
    let output = '';
    let cursor = 0;
    let match;
    while ((match = dialoguePattern.exec(text))) {
      output += text.slice(cursor, match.index);
      if (!match[0].startsWith('<')) {
        const spokenText = (match[1] ?? match[2] ?? match[3] ?? match[4] ?? '').trim();
        const before = text.slice(Math.max(0, match.index - 1200), match.index);
        const after = text.slice(dialoguePattern.lastIndex, dialoguePattern.lastIndex + 180);
        const subject = soundOnly.test(spokenText) ? '' : speechAttribution(before, after);
        cursor = dialoguePattern.lastIndex;
        if (!subject) {
          if (soundOnly.test(spokenText) || !looksLikeUtterance(spokenText)) { output += match[0]; continue; }
          emitDialogue(impliedSpeaker(before, match.index), spokenText, cursor);
          continue;
        }
        const speaker = requireSpeaker(inferSpeaker(before, after), subject);
        // The bubble already names the speaker, so drop a bare tag clause
        // ("Lâm Tuyết hỏi." / "Lâm Tuyết khẽ nói:") instead of leaving it dangling.
        const clause = `(?:${anyPronoun}|${name})${modifiers}\\s+${attribution}`;
        output = output.replace(new RegExp(`(^|[.!?…>]\\s+|\\n)${clause}\\s*[:：]\\s*$`, 'u'), '$1');
        const tail = after.match(new RegExp(`^\\s*[,—–-]?\\s*${clause}\\s*[.!…]+(?=\\s|$)`, 'u'));
        emitDialogue(speaker, spokenText, cursor);
        // A clause that goes on after the quote (“...”, ngươi đáp, rồi quay lưng.) is
        // capitalised into its own sentence later by capitalizeAfterDialogue.
        if (tail) dialoguePattern.lastIndex = cursor += tail[0].length;
        continue;
      }
      const content = match[0].replace(/^<dialogue\b[^>]*>/i, '').replace(/<\/dialogue\s*>$/i, '').trim();
      const declared = match[0].match(/speaker\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() || '';
      if (soundOnly.test(content)) output += content;
      else if (!declared || invalidNames.test(declared) || new RegExp(`^${pronoun}$`, 'iu').test(declared)) {
        const before = text.slice(Math.max(0, match.index - 1200), match.index);
        const inferred = inferSpeaker(before, text.slice(dialoguePattern.lastIndex, dialoguePattern.lastIndex + 180)) || (declared ? '' : impliedSpeaker(before, match.index));
        emitDialogue(requireSpeaker(inferred, declared), content, dialoguePattern.lastIndex);
      } else {
        // The model sometimes tags a place it has just mentioned as the speaker ("kinh thành Gia Cát" →
        // speaker="Gia Cát"); give the line to whoever the narration beside it points at instead.
        const before = text.slice(Math.max(0, match.index - 1200), match.index).replace(/\*\*/g, '');
        const person = declared !== playerName && placeNames(nameMentions(before)).has(declared)
          ? inferSpeaker(before, text.slice(dialoguePattern.lastIndex, dialoguePattern.lastIndex + 180)) || recentPerson(before)
          : '';
        const speaker = person || declared;
        if (person) emitDialogue(speaker, content, dialoguePattern.lastIndex);
        else { output += match[0]; lastSpeaker = speaker; lastSpeakerEnd = dialoguePattern.lastIndex; if (speaker !== playerName) lastNpc = speaker; }
      }
      cursor = dialoguePattern.lastIndex;
    }
    return emphasizeNames(capitalizeAfterDialogue(emphasizeQuotes(output + text.slice(cursor))), playerName);
  }

  window.renderNarrativeWithDialogue = (text, playerName) => {
    text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
      .forEach(part => appendNarrationWithDialogue(part, playerName));
    removeDuplicateStoryEntries();
  };

  function textNgrams(text) {
    const words = text.toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .match(/[a-z0-9]+/g) || [];
    const grams = new Set();
    for (let i = 0; i < words.length - 2; i++) grams.add(words.slice(i, i + 3).join(' '));
    return { words: words.length, grams };
  }

  function isNearDuplicate(left, right) {
    const a = textNgrams(left);
    const b = textNgrams(right);
    if (Math.min(a.words, b.words) < 24 || !a.grams.size || !b.grams.size) return false;
    let shared = 0;
    for (const gram of a.grams) if (b.grams.has(gram)) shared++;
    return shared / Math.min(a.grams.size, b.grams.size) >= 0.88 ||
      shared / (a.grams.size + b.grams.size - shared) >= 0.76;
  }

  function removeRepeatedPassages(text, priorText = '') {
    const seenSentences = new Set();
    const sentenceKey = value => value.toLocaleLowerCase('vi').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/<[^>]*>/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
    const priorParagraphs = (Array.isArray(priorText) ? priorText : [priorText])
      .flatMap(value => (value || '').split(/\n+/).map(part => part.trim()).filter(Boolean));
    const output = [];
    const seedSentences = priorParagraphs.flatMap(paragraph => paragraph.split(/(?<=[.!?…])\s+(?=[\p{Lu}"“「])/u));
    for (const sentence of seedSentences) seenSentences.add(sentenceKey(sentence));
    for (const paragraph of text.split(/\n+/).map(part => part.trim()).filter(Boolean)) {
      const sentences = paragraph.split(/(?<=[.!?…])\s+(?=[\p{Lu}"“「])/u);
      const uniqueSentences = sentences.filter(sentence => {
        const key = sentenceKey(sentence);
        if (!key || seenSentences.has(key)) return false;
        seenSentences.add(key);
        return true;
      });
      const candidate = uniqueSentences.join(' ').trim();
      if (!candidate) continue;
      if (![...priorParagraphs, ...output].some(previous => isNearDuplicate(candidate, previous))) output.push(candidate);
    }
    return output.join('\n\n');
  }

  function removeDuplicateStoryEntries() {
    const kept = [];
    for (const node of [...story.querySelectorAll('.narration, .story-entry')]) {
      const text = node.textContent.trim();
      if (!text) continue;
      if (kept.some(previous => isNearDuplicate(text, previous))) node.remove();
      else kept.push(text);
    }
  }

  function narrationPerspectiveRule(profile) {
    return `NGÔI KỂ THỐNG NHẤT: Toàn bộ lời dẫn truyện dùng ngôi thứ hai, gọi nhân vật người chơi là "ngươi". Nhân vật người chơi là ${profile.name}. Khi kể hành động, cảm giác, vị trí hoặc sở hữu của nhân vật này, dùng "ngươi", "của ngươi", "trước mặt ngươi"; không gọi bằng tên riêng hoặc "hắn", "cậu ấy", "anh ấy", "cậu ta", "chàng" và không chuyển sang "tôi", "ta" hay "bạn" trong lời dẫn. Ví dụ: "Ngươi đứng bên cầu. Hơi thở của ngươi chậm lại. Người đàn ông nhìn thẳng vào ngươi." NPC vẫn được kể bằng tên hoặc đại từ phù hợp. Chỉ áp dụng quy tắc này cho lời dẫn: lời thoại giữ cách xưng hô tự nhiên của người nói, thuộc tính speaker vẫn dùng tên thật (${profile.name} cho người chơi). Không thay tên NPC hay lời thoại bằng "ngươi". Dù lịch sử truyện, bản tóm tắt hoặc hành động nhập vào dùng ngôi khác, phần truyện mới vẫn phải dùng ngôi thứ hai. Trước khi trả lời, rà lại ngôi kể trong mọi đoạn tường thuật.`;
  }

  const namedDialogueRule = 'NPC chỉ được nói khi có tên riêng rõ ràng. Giới thiệu tên NPC trong lời kể trước câu thoại đầu tiên, dùng nhất quán tên đó trong speaker. Không dùng NPC, Chưa rõ người nói, Người lạ, Cô gái, Nàng hoặc chức danh chung làm tên. Với nhân vật hư cấu mới, đặt tên phù hợp thời kỳ và thế giới; với nhân vật đã có tên, giữ nguyên tên. Nếu NPC chưa có tên, tự sáng tạo ngay một tên cổ trang phù hợp như Lâm Vân Phong hoặc Tô Thanh Dao, giới thiệu tên và dùng nhất quán cho nhân vật đó. Không dừng truyện, không yêu cầu người chơi cung cấp tên. Không gán lời của NPC sang người chơi. Mọi tên xuất hiện trong các ví dụ của bản hướng dẫn này (Lâm Tuyết, Tống Thúy, Lâm Vân Phong, Tô Thanh Dao…) chỉ là minh họa cách viết, TUYỆT ĐỐI không dùng làm tên nhân vật trong truyện. Tên và giới tính của speaker phải khớp với nhân vật vừa được kể là đang nói: một người đàn ông mặc giáp vừa bước tới thì người nói phải là tên nam của chính người đó, không phải một cái tên nữ hay tên ở đâu khác.';

  function addressRule(profile) {
    return `XƯNG HÔ TRONG LỜI THOẠI NHẤT QUÁN: Mỗi người nói chọn đúng một cặp xưng hô hợp với quan hệ, tuổi tác và địa vị so với người nghe, rồi giữ nguyên cặp đó trong cả câu thoại và các lượt sau: ta–ngươi (ngang hàng hoặc bề trên nói với bề dưới), tại hạ–các hạ (lịch sự giữa người lạ), huynh–đệ, tỷ–muội, lão phu–tiểu tử, cháu–ông/bác, con–cha/mẹ, thiếp–chàng, thuộc hạ–chủ công. Hai vế của cặp phải khớp vai: đã xưng "cháu", "con", "thuộc hạ" thì gọi người nghe là "ông", "bác", "cha", "chủ công", không gọi là "ngươi"; đã gọi người nghe là "ngươi" thì xưng "ta", "lão phu", "bổn tọa", không xưng "cháu" hay "con". Mẫu sai: "Cháu ở đây đợi ngươi suốt cả ngày." Mẫu đúng: "Ta ở đây đợi ngươi suốt cả ngày." hoặc "Cháu ở đây đợi bác suốt cả ngày." Từ dùng để gọi người đối diện phải là cách gọi có thật trong tiếng Việt cổ trang, hợp tuổi và vai: gọi người trẻ hơn thì tiểu tử, tiểu huynh đệ, tiểu cô nương, công tử, cậu bé, nhóc con, cháu; gọi ngang hàng thì huynh đài, các hạ, đạo hữu, cô nương, huynh, đệ; gọi người trên thì tiền bối, lão nhân gia, đại nhân, tướng quân, sư phụ, trưởng lão. "Chàng" chỉ dành cho nữ gọi nam khi đã thân thiết hay có tình ý (đi với "thiếp"); nam gọi nam, người lạ gọi nhau hay nữ mới gặp nam đều không dùng "chàng", mà dùng công tử, huynh đài, các hạ, tiểu tử, ngươi tùy vai. Tương tự "nàng" trong lời thoại chỉ dành cho nam gọi nữ đã thân thiết; người lạ gọi cô nương, tiểu thư, phu nhân. Tuyệt đối không bịa ra cách gọi dịch máy móc như "chú trẻ", "người trẻ", "bạn trẻ", "anh bạn", "quý ông", "quý cô". Khi gọi tên người khác trong thoại, viết đúng từng chữ tên đã xác lập; tên nhân vật người chơi là ${profile.name}, không viết thành dạng khác. Trước khi trả lời, rà lại từng câu thoại xem xưng hô có đổi vai giữa chừng không.`;
  }

  const combatRule = 'GIAO CHIẾN PHẢI KỂ RÕ TỪNG ĐƯỜNG: Khi có đánh nhau, không được tóm tắt kiểu "trận chiến bắt đầu" hay "hai người giao đấu một hồi". Kể theo từng hiệp, mỗi hiệp gồm đủ bốn ý: (1) ai ra tay, bằng chiêu gì (gọi tên chiêu thức hoặc tả rõ động tác, vũ khí, hướng đánh; nhân vật chính chỉ dùng kỹ năng và trang bị đang có, người thường chưa tu luyện thì chỉ có quyền cước, binh khí thường); (2) chiêu đó nhắm vào đâu và uy lực ra sao; (3) đối thủ ứng phó thế nào: né tránh, đỡ đòn, phản công hay chịu đòn, và vì sao; (4) kết quả thật: trúng hay hụt, bị thương ở đâu, nặng nhẹ, mất thế hay giữ thế. Khi lượt này có KỊCH BẢN GIAO CHIẾN do hệ thống tính sẵn thì số đòn, thứ tự ra đòn, mức thương tích và kết cục phải theo đúng kịch bản, không thêm bớt; không có kịch bản (đánh thú hoang, lính vô danh) thì ít nhất 3 hiệp và chênh lệch cấp độ, chỉ số phải thể hiện trong kết quả từng hiệp. Không bao giờ ghi con số chỉ số, máu hay phần trăm vào truyện. Kết thúc đoạn giao chiến phải nêu rõ trạng thái hai bên: còn đứng được không, thương tích, ai thắng thế, trận đánh đã kết thúc hay còn tiếp diễn. Nếu người chơi chỉ mới khơi mào hoặc nhận lời đánh, hãy kể hiệp đầu tiên ngay trong lượt này thay vì dừng ở lời hẹn.';

  const hiddenGoalRule = 'MỤC TIÊU LÀ ĐỘNG CƠ THẦM KÍN, KHÔNG BAO GIỜ NÓI RA: MỤC TIÊU và BƯỚC TIẾP THEO chỉ là định hướng cho người dẫn truyện để sắp xếp tình tiết; chúng tồn tại trong đầu nhân vật chính, không tồn tại trong thế giới truyện. Tuyệt đối không nhắc nguyên văn hay diễn đạt lại mục tiêu trong lời kể, trong lời thoại của nhân vật chính hay của bất kỳ NPC nào; không để nhân vật chính tuyên bố, tâm sự, nói bóng gió hay tự nhủ thành tiếng về mục tiêu; NPC không biết và không được đoán ra mục tiêu trừ khi chính hành động người chơi nhập vào đã nói ra. Hãy thể hiện mục tiêu bằng việc làm: nhân vật chính âm thầm chọn nơi đến, người làm quen, câu hỏi đặt ra, ân tình gây dựng, mỗi lượt tiến thêm một bước nhỏ và kín đáo. Mẫu sai: "Ta tới đây để dựng hậu cung mỹ nhân." Mẫu đúng: nhân vật chính hỏi thăm nàng về gia cảnh, giúp nàng một việc nhỏ, ghi nhớ nơi nàng ở. Những mục tiêu tai tiếng hay nguy hiểm nếu bị nói ra phải mang hậu quả thật: bị khinh ghét, tố cáo, truy bắt.';

  const coherentProseRule = 'VIẾT CÓ NGHĨA VÀ ĐÚNG BỐI CẢNH: Mỗi câu phải rõ chủ thể, hành động và đối tượng; lời thoại phải có mục đích phù hợp tình huống. Địa danh, phe phái, chức danh phải nhất quán với thế giới và thời kỳ đã chọn. Không ghép tên tùy tiện thành địa danh hoặc tổ chức như "biên giới Mạnh", "Mạnh Tông" khi chưa được xác lập. Với nhân vật lịch sử, không tự đổi phe phái hoặc vai trò nếu người chơi chưa thiết lập lịch sử thay thế. Nếu chưa đủ dữ kiện, dùng mô tả địa điểm rõ ràng như "bìa rừng phía bắc doanh trại", không bịa tên như một sự thật đã biết. Địa danh hư cấu mới phải được giới thiệu quan hệ với nơi hiện tại và vai trò trong tình huống. Trước khi trả lời, rà lại tên riêng, ý nghĩa câu và sự liên kết giữa lời kể với lời thoại. Trong lời kể, mọi tên nhân vật đều viết trong cặp **...** mỗi lần xuất hiện (ví dụ: **Lâm Tuyết** khẽ gật đầu); có thể dùng thêm **thân phận**, **cảnh giới** để nhấn mạnh chọn lọc; không bọc cả đoạn hoặc dùng các kiểu Markdown khác. Người nói trong thẻ thoại phải là chính nhân vật vừa được kể là đang nói, không lấy địa danh hay tên người khác vừa nhắc tới làm speaker.';

  const hanVietRule = 'TÊN RIÊNG PHẢI LÀ ÂM HÁN VIỆT: Mọi tên người, địa danh, tông môn, chức danh, công pháp và thuật ngữ gốc Trung Hoa đều viết bằng âm Hán Việt có dấu tiếng Việt, không viết bính âm (pinyin) và không kèm chữ Hán. Đúng: Tào Tháo, Lưu Bị, Gia Cát Lượng, Hứa Xương. Sai: Cao Cao, Liu Bei, Zhuge Liang, Xuchang, hoặc tên mang dấu thanh bính âm như Wáng Hào, Zhāng Wěi. Các tên này chỉ minh họa cách viết, không tự đưa vào truyện. Điều này áp dụng cho cả thuộc tính speaker trong thẻ thoại và mọi tên trong lời kể. Nếu bối cảnh là tác phẩm hay lịch sử Trung Hoa, dùng đúng tên Hán Việt quen thuộc với độc giả Việt Nam; nhân vật hư cấu mới cũng đặt tên Hán Việt. Trước khi trả lời, rà lại mọi tên riêng và sửa hết dạng bính âm.';

  // Output guard for the rule above: small local models still slip into pinyin now and then, so names that look
  // like pinyin are sent to one short Ollama call for their Hán Việt reading and replaced before rendering.
  // Answers are cached per name (a name mapped to itself means "not pinyin", e.g. a Western name).
  const nameFixes = new Map();
  function looksLikePinyin(token) {
    const lower = token.toLocaleLowerCase('vi').normalize('NFD');
    if (/[\u0304\u030c\u0308]/.test(lower)) return true; // macron, caron, diaeresis: pinyin only
    if (/[\u0302\u0306\u031b\u0303\u0309\u0323]|đ/.test(lower)) return false; // â ă ơ ư, ngã, hỏi, nặng, đ: Vietnamese only
    const plain = lower.replace(/[\u0300\u0301]/g, '');
    return /[wzjf]/.test(plain) || /^(sh|zh|q(?!u)|y[aeiou])/.test(plain)
      || /(ing|eng|ei|ou|uo|iao|iong|iang|ian|[iu]e)$/.test(plain) || /(?<!q)uang?$/.test(plain)
      || /[aeiouy][^aeiouy]+[aeiouy]/.test(plain); // two syllables in one word (Xuchang, Luoyang)
  }
  // Toneless pinyin such as "Cao Cao" or "Liu Bei" is built from valid Vietnamese syllables, so the only tell is a
  // multi-word name without a single diacritic; the repair call keeps real Vietnamese names like "Minh Anh" as they are.
  function looksLikeTonelessName(tokens) {
    return tokens.length >= 2 && tokens.every(token => /^[A-Za-z]+$/.test(token));
  }
  function findPinyinNames(text, playerName) {
    const visible = text.replace(/<dialogue\s+speaker\s*=\s*(["'])(.*?)\1\s*>/gi, ' $2. ').replace(/<[^>]*>/g, ' ');
    const names = new Set();
    for (const match of visible.matchAll(/\p{Lu}[\p{L}\p{M}]*(?:[ \t]+\p{Lu}[\p{L}\p{M}]*){0,3}/gu)) {
      // Keep only the run of tokens around a pinyin-looking one that carry no Vietnamese-only marks.
      const tokens = match[0].split(/[ \t]+/);
      const vietnameseOnly = token => /[\u0302\u0306\u031b\u0303\u0309\u0323]|đ/i.test(token.normalize('NFD'));
      let run = [];
      const flush = () => { if (run.some(looksLikePinyin) || looksLikeTonelessName(run)) names.add(run.join(' ')); run = []; };
      tokens.forEach(token => { if (vietnameseOnly(token)) flush(); else run.push(token); });
      flush();
    }
    return [...names].filter(name => !playerName.includes(name));
  }
  async function fixPinyinNames(text, model, profile) {
    const found = findPinyinNames(text, profile.name);
    // "Zhang Wei" and "Zhāng Wěi" are one name: cache by the toneless spelling and ask about the most marked variant.
    const nameKey = name => name.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('vi');
    const variants = new Map();
    found.filter(name => !nameFixes.has(nameKey(name))).forEach(name => {
      const best = variants.get(nameKey(name));
      if (!best || name.normalize('NFD').length > best.normalize('NFD').length) variants.set(nameKey(name), name);
    });
    const unknown = [...variants.values()];
    if (unknown.length) {
      help.textContent = 'Đang chuyển tên viết bằng bính âm sang âm Hán Việt…';
      try {
        const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Ngươi chuyển tên riêng viết bằng bính âm Trung Quốc sang âm Hán Việt có dấu tiếng Việt. Trả về JSON {"names":[{"from":"…","to":"…"}]} cho đủ mọi mục được hỏi, giữ nguyên chữ trong from. Ví dụ: Wáng Hào → Vương Hạo; Cao Cao → Tào Tháo; Zhang Wei → Trương Vĩ; Xuchang → Hứa Xương; Liu Bei → Lưu Bị. Nếu mục không phải tên Trung Hoa viết bính âm (tên phương Tây, từ tiếng Việt thông thường, tên đã là Hán Việt) thì to ghi y hệt from.' },
              { role: 'user', content: `BỐI CẢNH: ${(profile.setting || profile.worldName || '').slice(0, 300)}\nCÁC MỤC CẦN XÉT:\n${unknown.map(name => `- ${name}`).join('\n')}` }
            ],
            format: { type: 'object', properties: { names: { type: 'array', items: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } }, required: ['from', 'to'] } } }, required: ['names'] },
            think: false,
            stream: false,
            keep_alive: '10m',
            options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0, num_predict: 60 + unknown.length * 40 }
          })
        }, 120000);
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
        const answers = JSON.parse(data.message?.content || '{}').names || [];
        answers.forEach((entry, index) => {
          const from = unknown.includes(entry.from) ? entry.from : answers.length === unknown.length ? unknown[index] : '';
          const to = String(entry.to || '').replace(/[<>"]/g, '').trim();
          // Accept "unchanged" (not pinyin after all) or a reading that no longer looks like pinyin.
          if (from && to && (to === from || !to.split(/\s+/).some(looksLikePinyin))) nameFixes.set(nameKey(from), to === from ? null : to);
        });
      } catch (error) {
        console.warn('Không chuyển được tên bính âm; giữ nguyên tên trong lượt này.', error);
      }
    }
    // A cached null means "checked, not pinyin": leave every spelling of that name alone.
    return found.filter(name => nameFixes.get(nameKey(name)))
      .sort((a, b) => b.length - a.length)
      .reduce((result, name) => result.split(name).join(nameFixes.get(nameKey(name))), text);
  }

  // Blood and whole corpses are gathered only by the demonic school that cultivates with them (see lootCollects in loot.js).
  function lootRule() {
    const school = activeDemonic()?.[5] || '';
    const special = school === 'blood'
      ? 'Nhân vật đang tu Huyết công nên có lấy máu: mỗi con thú hoặc kẻ địch bị hạ ghi thêm "máu động vật" hoặc "máu người" theo số phần hợp lý (thú nhỏ 1–2 phần, thú lớn hoặc người 3–5 phần), ví dụ "máu động vật: 4 phần". Máu không mua được ở đâu, chỉ có từ những lần hạ địch như vậy. Không ghi thi thể: nhân vật không thu thập xác.'
      : school === 'necromancy'
        ? 'Nhân vật đang tu Tử Linh thuật nên có thu xác: mỗi con thú hoặc kẻ địch bị hạ mà xác còn nguyên ghi thêm 1 "thi thể động vật" hoặc "thi thể người", ví dụ "thi thể động vật: 2". Thi thể không mua được ở đâu, chỉ có từ những lần hạ địch như vậy. Không ghi máu: nhân vật không thu thập máu.'
        : 'Không ghi máu hay thi thể nguyên vẹn vào dòng này: nhân vật không tu pháp môn cần chúng nên không thu thập.';
    return [
      'CHIẾN LỢI PHẨM: Chỉ khi trong lượt này nhân vật người chơi đã HẠ GỤC xong yêu thú, động vật hoặc kẻ địch (trận đánh đã kết thúc, đối thủ chết, bị bắt hoặc bỏ chạy) thì sau phần truyện mới viết thêm đúng một dòng cuối cùng, tách riêng, theo mẫu "[CHIẾN LỢI PHẨM] tên: số lượng đơn vị; tên: số lượng đơn vị" liệt kê những gì có thể thu từ kẻ vừa bị hạ; tên và số lượng phải hợp với sự việc vừa kể. Trận đánh chưa bắt đầu, mới khơi mào, đang diễn ra hoặc lượt không có giao chiến thì TUYỆT ĐỐI KHÔNG viết dòng này, cũng không viết "[CHIẾN LỢI PHẨM] không".',
      'Yêu thú và động vật bị hạ luôn cho thịt, da, nanh, vuốt, sừng, lông… của chính loài đó; ví dụ hạ 2 con sói: "[CHIẾN LỢI PHẨM] thịt sói: 20 cân; da sói: 2 tấm; nanh sói: 4; vuốt sói: 8". Người bị hạ không cho thịt, da hay nanh; với người chỉ ghi tiền hoặc vật họ mang theo.',
      'Tiền, độc thảo, oán phù và mọi vật phẩm khác chỉ là thứ có thể rơi: hợp lý thì cứ ghi vào dòng này (tiền ghi "tiền: 30 đồng"), hệ thống sẽ tung tỷ lệ để quyết định có rơi thật hay không. Số lượng ghi trong dòng này là mức tối đa có thể thu; hệ thống tự tung số thực nhận. Vì vậy trong lời kể không viết rằng nhân vật đã lấy được tiền hay vật phẩm từ kẻ vừa bị hạ, cũng không nêu con số chiến lợi phẩm cụ thể.',
      special,
      'Thứ chắc chắn nhận vì được tặng, trả công hoặc mua trong truyện thì ghi ở một dòng riêng ngay phía trên: "[NHẬN ĐƯỢC] tên: số lượng đơn vị"; không có thì bỏ dòng đó.',
      'Không ghi trang bị, kỹ năng hay tu vi. Không viết gì sau dòng [CHIẾN LỢI PHẨM].'
    ].join(' ');
  }

  function buildSystemPrompt(profile) {
    return [
      'Ngươi là người dẫn truyện tương tác cho game tiên hiệp Vạn Giới Ký. Viết hoàn toàn bằng tiếng Việt tự nhiên, giàu hình ảnh và có nhịp kể cuốn hút; dùng từ cổ phong vừa phải, không dịch sát văn phong tiếng Anh.',
      'Tiếp nối nhất quán bối cảnh và sự kiện đã xảy ra. Dùng hồ sơ thế giới, mục tiêu, chỉ số, trang bị, kỹ năng và đoạn truyện gần nhất làm ngữ cảnh bắt buộc; ưu tiên chi tiết đã được xác lập, không tự đổi tuổi, thân phận, địa điểm, quan hệ, quy tắc sức mạnh hoặc trạng thái tài nguyên. Nếu thiếu thông tin, không khẳng định chi tiết mới như sự thật đã có.',
      'BỘ NHỚ CÁC CHƯƠNG TRƯỚC là dữ kiện liên tục đã được kể. Không tái diễn lại cảnh, hành động, lời thoại hoặc tiết lộ trong đó; chỉ nhắc ngắn nếu cần để nối mạch. Ưu tiên diễn biến mới và giải quyết các việc còn dang dở khi hành động hiện tại dẫn tới.',
      'Trong chương hiện tại, không sao chép lại bất kỳ câu, đoạn văn hay cảnh nào đã xuất hiện trong phần truyện gần đây, kể cả khi thay đổi vài từ. Chỉ nhắc lại dữ kiện cũ khi cần cho mạch truyện; không dựng lại cùng một khung cảnh hoặc hồi tưởng đã kể.',
      'MẠCH TRUYỆN VÀ HỒI ĐÁP TRỰC TIẾP (ƯU TIÊN CAO NHẤT): Đọc HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI và DIỄN BIẾN GẦN ĐÂY trước khi viết. Tiếp tục đúng cảnh, địa điểm, thời điểm, người đang có mặt và việc đang dang dở ở cuối phần gần đây. Nếu người chơi hỏi hoặc nói với một nhân vật, nhân vật đó phải nghe và trả lời đúng trọng tâm ngay trong lượt này; không né câu hỏi, không để người khác trả lời thay nếu không có lý do trong cảnh. Sau câu trả lời, mới kể nét mặt, hành động và hệ quả có quan hệ nhân quả rõ với câu hỏi/hành động ấy. Mỗi đoạn phải nối với đoạn ngay trước bằng hành động, lời đáp, phản ứng hoặc hệ quả; không tự chuyển cảnh, đổi chủ đề, thêm người lạ hay biến cố bất chợt không liên quan. Không bắt buộc tạo bước ngoặt ở mọi lượt; chỉ thêm sự kiện mới khi nó phát sinh hợp lý từ hành động hiện tại hoặc người chơi bật tùy chọn tình tiết bất ngờ. Không tự bịa rằng NPC đã biết điều chưa được tiết lộ.',
      'Mỗi lượt hồi đáp hướng tới khoảng 1.500–2.000 từ tiếng Việt, thường chia thành 12–20 đoạn tự nhiên; chất lượng và mạch truyện quan trọng hơn độ dài. Kể lại toàn bộ hành động và lời thoại người chơi theo đúng thứ tự, không bỏ sót bước nào, câu nào: tường thuật được viết lại cho giàu hình ảnh, lời thoại được trau chuốt câu chữ nhưng giữ nguyên nội dung và ý; chỉ được thêm, không được cắt. Sau đó mới viết phản ứng và hệ quả. Mỗi đoạn phải đóng góp diễn biến, phản ứng, thông tin hoặc hệ quả mới gắn với cảnh đang diễn ra. Không lặp lại cùng hành động/hình ảnh/lời thoại; không kéo dài bằng câu rỗng. Bắt đầu ngay tại thời điểm câu chuyện đang dở. Chỉ cho nhân vật chính thực hiện những gì người chơi đã nêu; không tự thêm quyết định, lời thoại hay suy nghĩ mới cho họ.',
      'ĐỊNH DẠNG ĐẦU RA CÓ CẤU TRÚC (BẮT BUỘC, KHÔNG ĐƯỢC BỎ QUA): Bất cứ câu nào một nhân vật nói thành tiếng đều phải nằm trong thẻ <dialogue speaker="Tên nhân vật">Lời nói</dialogue>. Quy tắc này áp dụng cho cả nhân vật chính và mọi NPC. Không viết lời thoại trần trong dấu ngoặc kép, không gắn lời thoại vào giữa đoạn tường thuật. Mẫu đúng: Nàng khựng bước. <dialogue speaker="Diệp Thần">Cô vừa nói gì?</dialogue> Người thiếu nữ siết cuốn sách trong tay. <dialogue speaker="Tống Thúy">Ta nói viên đá này có thể soi thấy quá khứ.</dialogue> Mẫu sai: Nàng hỏi: “Cô vừa nói gì?” Mỗi lượt nói có một thẻ riêng, speaker là tên chính xác người đang nói. Chỉ lời kể, hành động, suy nghĩ và miêu tả để ngoài thẻ. Âm thanh, tiếng động, từ mô phỏng tiếng động như “phịch”, “vù”, “rầm”, “keng” là tường thuật, tuyệt đối không cho vào thẻ thoại. Tên gọi, danh xưng, tên cảnh giới hay thuật ngữ được nhắc giữa câu kể (ví dụ: còn gọi là Đấu Tông sơ kỳ) cũng là tường thuật, không cho vào thẻ thoại. Muốn làm nổi bật tên gọi, thuật ngữ hay tiếng động thì viết trong cặp **...** (ví dụ: còn gọi là **Đấu Tông sơ kỳ**), tuyệt đối không dùng dấu ngoặc kép hay ngoặc đơn. Tuyệt đối không dùng chữ Hán hoặc từ viết bằng chữ Hán; chỉ viết tiếng Việt bằng chữ Quốc ngữ. Trước khi trả lời, tự rà lại và bọc mọi câu thoại còn sót; chỉ xuất truyện, không xuất lời giải thích.',
      adultIntimacyRule(profile),
      worldDirective(profile),
      narrationPerspectiveRule(profile),
      namedDialogueRule,
      addressRule(profile),
      hiddenGoalRule,
      combatRule,
      hanVietRule,
      coherentProseRule,
      lootRule(),
      'Chỉ xuất phần truyện có thể hiện cho người chơi. Không viết suy nghĩ nội bộ, phân tích, kế hoạch, lời dẫn meta, tiêu đề, đánh số đoạn; chỉ cho phép **cụm từ** để nhấn mạnh trong lời kể. Không lặp lại yêu cầu.',
      `Gán speaker theo người thực sự nói trong tình tiết. Lời của nhân vật chính phải ghi speaker="${profile.name}"; không dùng Lời, Lời nói hoặc đại từ làm tên NPC. Giữ suy nghĩ nội tâm trong lời kể.`,
      `HỒ SƠ NHÂN VẬT: ${profile.name}${profile.age ? `, ${profile.age} tuổi` : ''}; thân phận: ${profile.identity || 'chưa xác định'}; cảnh giới: ${profile.realm || 'chưa xác định'}.`,
      `BỐI CẢNH THẾ GIỚI: ${profile.setting || 'Thế giới tu tiên với tông môn, cảnh giới, bí cảnh và cơ duyên.'}`,
      `MỤC TIÊU (thầm kín, không được nói ra trong truyện): ${profile.goal || 'Tiếp tục hành trình tu hành theo lựa chọn của người chơi.'}`
    ].filter(Boolean).join('\n\n');
  }

  async function generateOpeningText(profile) {
    const model = modelInput.value.trim();
    if (!model) throw new Error('Hãy nhập tên model Ollama ở phần Người dẫn truyện AI.');
    setStatus('writing', 'AI đang dựng cảnh mở đầu…');
    help.textContent = `Đang yêu cầu ${model} viết cảnh mở đầu từ hồ sơ nhân vật và bối cảnh.`;
    try {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'system',
              content: [
                'Ngươi là tác giả mở màn cho game tiên hiệp tương tác Vạn Giới Ký. Hãy kể bằng tiếng Việt tự nhiên, giàu hình ảnh, câu văn có nhịp điệu và cổ phong vừa phải.',
                'Giới thiệu đầy đủ, hợp lý xuất thân của người chơi và tình hình hiện tại: ngươi là ai, có thân phận và hoàn cảnh ra sao, vì sao có mặt ở đây, đang ở đâu và đang đối diện việc gì. Dựa sát hồ sơ đã nhập, kết nối thành văn xuôi tự nhiên thay vì liệt kê thông tin.',
                'Bối cảnh phải phù hợp thế giới và thời kỳ đã chọn. Không bắt buộc thêm bí ẩn, biến cố hay NPC. Kết ở tình huống hiện tại để người chơi tự chọn hành động tiếp theo.',
                'Gán speaker theo chủ thể thực sự nói trong tình tiết. Lời của nhân vật chính phải dùng đúng tên trong hồ sơ; không dùng nhãn Lời, Lời nói hoặc đại từ làm tên NPC. Suy nghĩ nội tâm giữ trong lời kể, không chuyển thành lời nói của NPC.',
                adultIntimacyRule(profile),
                worldDirective(profile),
                narrationPerspectiveRule(profile),
                namedDialogueRule,
                addressRule(profile),
                hiddenGoalRule,
                combatRule,
                hanVietRule,
                coherentProseRule,
                'ĐỊNH DẠNG BẮT BUỘC: Mọi câu được nhân vật nói ra phải là <dialogue speaker="Tên nhân vật">Lời nói</dialogue>, kể cả thoại của nhân vật chính. Không viết câu thoại trong ngoặc kép ngoài thẻ và không gắn thoại vào đoạn kể. Ví dụ đúng: Mưa quất lên mái ngói. <dialogue speaker="Lâm Tuyết">Huynh nghe thấy tiếng động không?</dialogue> Ví dụ sai: Mưa quất lên mái ngói. “Huynh nghe thấy tiếng động không?” nàng hỏi. Âm thanh như “phịch”, “vù”, “rầm”, “keng” là lời kể, không phải lời thoại; tên gọi, danh xưng hay thuật ngữ nhắc giữa câu kể cũng vậy. Muốn làm nổi bật chúng thì viết trong cặp **...** (ví dụ: **Đấu Tông sơ kỳ**), không dùng dấu ngoặc kép hay ngoặc đơn. Chỉ viết tiếng Việt bằng chữ Quốc ngữ; tuyệt đối không có chữ Hán hay từ viết bằng chữ Hán. Hãy tự rà soát toàn bộ đầu ra trước khi kết thúc.',
                'Không ấn định số đoạn hoặc số từ cho phần mở đầu. Viết đủ để người chơi hiểu xuất thân và tình hình hiện tại, rồi dừng ở điểm có thể lựa chọn hành động. Không lặp ý hoặc kéo dài để đạt độ dài nào đó. Không dùng tiêu đề, danh sách hoặc Markdown ngoài **cụm từ** nhấn mạnh trong lời kể. Không tự quyết định hành động quan trọng thay người chơi.'
              ].join('\n\n')
            },
            {
              role: 'user',
              content: [
                `Tên nhân vật: ${profile.name}.`,
                `Tuổi: ${profile.age}.`,
                `Thân phận: ${profile.identity}.`,
                `Cảnh giới bắt đầu: ${profile.realm}, cấp ${profile.level}.`,
                `Bối cảnh thế giới: ${profile.setting}.`,
                `Mục tiêu ban đầu (thầm kín, không được nói ra trong truyện): ${profile.goal || 'Chưa đặt mục tiêu cụ thể.'}`,
                `Cho phép chủ đề tình cảm trưởng thành: ${profile.allowNsfw ? 'có bật, nhưng vẫn phải áp dụng quy tắc tuổi trưởng thành và đồng thuận' : 'không'}.`,
                'Giới thiệu đầy đủ xuất thân và hoàn cảnh hiện tại từ các dữ kiện trên, bằng ngôi thứ hai. Nếu có NPC nói chuyện, giới thiệu tên riêng của NPC trước khi họ nói.'
              ].join('\n')
            }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.85, top_p: 0.92, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: -1 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      // The opening grants nothing; drop a loot line if the model adds one anyway.
      const openingText = await fixPinyinNames(extractLoot(data.message?.content?.trim() || '').text, model, profile);
      const opening = removeRepeatedPassages(normalizeDialogue(openingText, profile.name));
      if (!opening) throw new Error('Model không trả về đoạn mở đầu.');
      setStatus('ready');
      help.textContent = `Đã tạo cảnh mở đầu bằng ${model}.`;
      return opening;
    } catch (error) {
      setStatus('error');
      setHelpForError(error);
      if (error?.name === 'TypeError' && location.protocol === 'https:') {
        throw new Error('Không kết nối được Ollama trên máy này. Kiểm tra Ollama đang chạy và đã cho phép origin https://lavie2404.github.io.');
      }
      throw error;
    }
  }

  window.generateOpeningText = generateOpeningText;

  // Builds one NPC profile from what the story has already shown; npc-profiles.js validates and caches it.
  window.generateNpcProfile = async speaker => {
    const model = modelInput.value.trim();
    if (!model) throw new Error('Hãy nhập tên model Ollama trong Thiết lập.');
    const profile = getProfile();
    const realms = worldRealms.map((realm, index) => `${realm}: cấp ${index * 10 + 1}–${index * 10 + 10}`).join('; ') || 'chưa thiết lập';
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Ngươi lập hồ sơ nhân vật cho game truyện. Chỉ trả về JSON đúng lược đồ, viết tiếng Việt. Bám sát mọi dữ kiện truyện đã kể về nhân vật (tên, chức vụ, lời nói, hành động, quan hệ); phần truyện chưa nói thì suy ra hợp lý theo thế giới, thời kỳ và thân phận, không mâu thuẫn với truyện và với các hồ sơ đã lập.' },
          { role: 'user', content: [
            `THẾ GIỚI: ${profile.setting || profile.worldName}`,
            `NHÂN VẬT CẦN LẬP HỒ SƠ: "${speaker}" (tên hiển thị trong truyện).`,
            'fullName: họ và tên đầy đủ bằng âm Hán Việt có dấu (Vương Hạo, không viết Wáng Hào hay Wang Hao). Nếu truyện chỉ gọi bằng chức danh hoặc biệt danh, đặt họ tên hợp thời đại và giữ phần đã biết (ví dụ "Trưởng lão Từ" thì họ Từ). Nếu tên hiển thị trong truyện đang ở dạng bính âm, hãy chuyển sang Hán Việt.',
            'courtesyName: tên tự, nếu thời đại/thân phận có dùng tên tự; nếu không thì ghi "Không có".',
            'identity: thân phận, chức vụ, phe phái. appearance: ngoại hình, 1–2 câu. personality: tính cách, 1–2 câu.',
            `level: 0 nếu là người thường chưa tu luyện; ngược lại từ 1 đến ${npcLevelCap()} (không được cao hơn nhân vật chính quá ${NPC_LEVEL_LEAD} cấp), tương xứng với thân phận và sức mạnh truyện đã thể hiện. Hệ thống cảnh giới: ${realms}. Nhân vật chính ${profile.name} đang ở ${profile.realm}. Chỉ số do hệ thống tự tính theo cấp độ, không cần ghi.`,
            npcProfilesContext(),
            `BỘ NHỚ CÁC CHƯƠNG TRƯỚC:\n${formatChapterMemory()}`,
            `DIỄN BIẾN GẦN ĐÂY:\n${formatRecentStoryContext(4000)}`
          ].join('\n\n') }
        ],
        format: NPC_PROFILE_SCHEMA,
        think: false,
        stream: false,
        keep_alive: '10m',
        options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.4, top_p: 0.85, num_predict: 800 }
      })
    }, 180000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
    const content = data.message?.content || '';
    try {
      return JSON.parse(content);
    } catch {
      const json = content.match(/\{[\s\S]*\}/)?.[0];
      if (!json) throw new Error('Model không trả về hồ sơ hợp lệ.');
      return JSON.parse(json);
    }
  };

  // A kind name for a beast, built from what the story shows of it: Tật Phong Lang for a wind-fast wolf,
  // Bích Lân Xà for a jade-scaled snake. Also the trait and the signature move that trait gives.
  window.generateBeastName = async (foe, recentStory) => {
    const model = modelInput.value.trim();
    if (!model) throw new Error('Hãy nhập tên model Ollama trong Thiết lập.');
    const profile = getProfile();
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Ngươi đặt tên cho yêu thú trong game truyện cổ trang. Chỉ trả về JSON đúng lược đồ, viết tiếng Việt bằng âm Hán Việt có dấu, không chữ Hán, không giải thích.' },
          { role: 'user', content: [
            `THẾ GIỚI: ${profile.setting || profile.worldName}`,
            `YÊU THÚ: truyện gọi là "${foe.opponent}", loài ${foe.species}${foe.transformed ? ', đã hóa hình thành người' : ''}.`,
            'name: tên loài theo đặc tính nổi bật nhất mà truyện đã tả, 3 chữ Hán Việt, chữ cuối là loài (Lang, Xà, Hổ, Mã, Điêu, Long, Hầu, Ngưu, Thử…), hai chữ đầu chỉ đúng đặc điểm bằng từ Hán Việt: màu sắc (Bích, Xích, Bạch, Hắc, Kim, Thanh, Tử), bộ phận (Lân = vảy, Giác = sừng, Dực = cánh, Trảo = vuốt, Nha = nanh), tốc độ/gió (Tật Phong), nguyên tố (Viêm, Lôi, Băng, Thủy), huyết mạch (Long, Phượng). Ví dụ: rắn vảy xanh biếc → Bích Lân Xà; sói nhanh như gió → Tật Phong Lang; ngựa trắng có sừng rồng → Bạch Long Mã; hổ lửa đỏ → Xích Viêm Hổ. Nếu truyện đã gọi nó bằng một tên kiểu này thì giữ nguyên.',
            'trait: đặc tính ấy, một cụm ngắn (ví dụ: vảy xanh biếc, phun sương độc).',
            'signatureMove: TÊN CHIÊU đặc trưng sinh ra từ đặc tính, là tên công pháp bằng Hán Việt 2–4 chữ, viết hoa mỗi chữ, thường lấy lại chữ trong tên loài; KHÔNG viết câu mô tả. Ví dụ: Bích Lân Xà → Bích Lân Độc Vụ; Tật Phong Lang → Phong Nhận; Bạch Long Mã → Long Giác Lôi Xung; Xích Viêm Hổ → Viêm Trảo. Yêu thú tầm thường không có đặc tính thì để rỗng.',
            'signatureEffect: chính chiêu đó làm gì, một câu ngắn để người kể tả được, viết riêng cho con thú này theo đặc tính của nó, không chép lại ví dụ (mẫu, với Bích Lân Độc Vụ: phun màn sương độc màu ngọc bích bao trùm đối thủ).',
            `DIỄN BIẾN GẦN ĐÂY:\n${recentStory}`
          ].join('\n\n') }
        ],
        format: { type: 'object', properties: { name: { type: 'string' }, trait: { type: 'string' }, signatureMove: { type: 'string' }, signatureEffect: { type: 'string' } }, required: ['name', 'trait', 'signatureMove', 'signatureEffect'] },
        think: false,
        stream: false,
        keep_alive: '10m',
        options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.6, top_p: 0.9, num_predict: 120 }
      })
    }, 120000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
    const parsed = JSON.parse(data.message?.content?.match(/\{[\s\S]*\}/)?.[0] || '{}');
    return { name: String(parsed.name || '').replace(/\s+/g, ' ').trim(), trait: String(parsed.trait || '').trim(), signatureMove: String(parsed.signatureMove || '').trim(), signatureEffect: String(parsed.signatureEffect || '').trim() };
  };

  // A courtesy name (tên tự) for an NPC whose profile has none, fitting the world and the person.
  window.generateNpcCourtesyName = async npc => {
    const model = modelInput.value.trim();
    if (!model) throw new Error('Hãy nhập tên model Ollama trong Thiết lập.');
    const profile = getProfile();
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Ngươi đặt tên tự (biểu tự) cho nhân vật trong game truyện cổ trang. Chỉ trả về JSON đúng lược đồ, viết tiếng Việt bằng âm Hán Việt có dấu, không chữ Hán, không giải thích.' },
          { role: 'user', content: [
            `THẾ GIỚI: ${profile.setting || profile.worldName}`,
            `NHÂN VẬT: ${npc.fullName}; thân phận: ${npc.identity}; tính cách: ${npc.personality}.`,
            'courtesyName: tên tự gồm 2 chữ Hán Việt, hợp thời đại, liên hệ ý nghĩa với tên thật hoặc tính cách theo lối đặt tên tự cổ (ví dụ Gia Cát Lượng tự Khổng Minh, Triệu Vân tự Tử Long). Không trùng tên thật, không trùng tên tự của nhân vật khác.',
            npcProfilesContext()
          ].join('\n\n') }
        ],
        format: { type: 'object', properties: { courtesyName: { type: 'string' } }, required: ['courtesyName'] },
        think: false,
        stream: false,
        keep_alive: '10m',
        options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.7, top_p: 0.9, num_predict: 60 }
      })
    }, 120000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
    const content = data.message?.content || '';
    const name = String((JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] || '{}').courtesyName || '')).replace(/\s+/g, ' ').trim();
    if (!name || /^(?:không có|không)$/iu.test(name)) throw new Error('Model không trả về tên tự.');
    return name;
  };

  // Does this action start (or carry on) a fight between the player and one named character? The model
  // only classifies; the fight itself is then resolved by the numbers in combat.js.
  async function detectCombatIntent(model, action, recentStory) {
    const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'Ngươi phân loại hành động trong game truyện. Trả về JSON {"combat": true|false, "opponent": "tên", "kind": "person"|"beast", "species": "loài", "transformed": true|false, "threat": "yếu"|"ngang"|"mạnh"}. combat là true chỉ khi hành động người chơi vừa nhập khiến nhân vật chính thật sự giao đấu với MỘT đối thủ cụ thể ngay lượt này (ra tay, nhận lời tỷ thí, bị tấn công và đánh trả): một nhân vật có tên, hoặc một con yêu thú/dã thú cụ thể trong cảnh. Lời khiêu khích, đe dọa, bàn bạc, hẹn đánh sau hay chạy trốn không phải combat. opponent: với người là đúng tên như truyện gọi; với thú là cách truyện gọi nó (ví dụ "con sói xám", "Hắc Lang Vương"). kind: "person" nếu là người, "beast" nếu là yêu thú hay dã thú. species: loài của thú (sói, hổ, rắn, khỉ, chim ưng, rồng…), rỗng với người. transformed: true chỉ khi yêu thú đã hóa hình thành dạng người. threat: sức mạnh của thú so với nhân vật chính theo những gì truyện tả: "yếu", "ngang" hoặc "mạnh"; với người để "ngang". Không giao đấu thì combat false và các trường còn lại rỗng.' },
          { role: 'user', content: `DIỄN BIẾN GẦN ĐÂY:\n${recentStory.slice(-2500)}\n\nHÀNH ĐỘNG NGƯỜI CHƠI:\n${action}` }
        ],
        format: { type: 'object', properties: { combat: { type: 'boolean' }, opponent: { type: 'string' }, kind: { type: 'string', enum: ['person', 'beast', ''] }, species: { type: 'string' }, transformed: { type: 'boolean' }, threat: { type: 'string', enum: ['yếu', 'ngang', 'mạnh', ''] } }, required: ['combat', 'opponent', 'kind', 'species', 'transformed', 'threat'] },
        think: false,
        stream: false,
        keep_alive: '10m',
        options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0, num_predict: 80 }
      })
    }, 60000);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
    const parsed = JSON.parse(data.message?.content?.match(/\{[\s\S]*\}/)?.[0] || '{}');
    const opponent = String(parsed.opponent || '').replace(/\*\*/g, '').trim();
    if (parsed.combat !== true || !opponent || opponent === getProfile().name) return null;
    return { opponent, beast: parsed.kind === 'beast', species: String(parsed.species || '').trim() || 'thú', transformed: parsed.transformed === true, threat: parsed.threat || 'ngang' };
  }

  // Resolve a duel by the numbers and hand back the script for the model plus the outcome to apply.
  async function prepareCombat(foe, profile) {
    const { opponent } = foe;
    if (foe.beast && !npcProfiles.has(opponent)) {
      const known = findBeastProfile(opponent, foe.species);
      if (known) foe.opponent = opponent = known.speaker;
    }
    if (!npcProfiles.has(opponent)) {
      help.textContent = `Đang lập hồ sơ và chỉ số cho ${opponent} trước trận đánh…`;
      if (foe.beast) {
        const named = await window.generateBeastName(foe, formatRecentStoryContext(2500)).catch(() => ({}));
        const beast = makeBeastProfile(opponent, foe.species, foe.transformed, foe.threat, named);
        foe.opponent = opponent = beast.speaker;
        npcProfiles.set(opponent, beast);
      } else {
        if (!pendingNpcProfiles.has(opponent)) pendingNpcProfiles.set(opponent, window.generateNpcProfile(opponent).finally(() => pendingNpcProfiles.delete(opponent)));
        npcProfiles.set(opponent, normalizeNpcProfile(await pendingNpcProfiles.get(opponent), opponent));
      }
    }
    const npc = npcProfiles.get(opponent);
    const npcStats = npcEffectiveStats(npc);
    npc.health = Math.min(npc.health ?? npcStats.health, npcStats.health);
    const stats = effectiveStats();
    const result = simulateCombat(
      { name: profile.name, attack: stats.attack, defense: stats.defense, speed: stats.speed, maxHealth: maxHealth(), health: healthNow() },
      { name: opponent, attack: npcStats.attack, defense: npcStats.defense, speed: npcStats.speed, maxHealth: npcStats.health, health: npc.health }
    );
    // What each side fights with, so every blow in the story can be named after a real technique or weapon.
    const active = list => list.filter(item => item[3] !== false);
    const arms = (name, gear, techniques) => `${name}: vũ khí/trang bị ${npcItemNames(gear)}; chiêu thức ${npcItemNames(techniques)}`;
    const loadout = [
      arms(profile.name, active(equipment).filter(item => item[4] !== 'mount'), active(skills).filter(item => ['attack', 'defense', 'speed', 'burstAttack', 'burstDefense', 'burstSpeed'].includes(item[4]))),
      npc.beast && !npc.transformed
        ? `${opponent}: yêu thú loài ${npc.species} chưa hóa hình${npc.trait ? ` (đặc tính: ${npc.trait})` : ''}; trong truyện gọi nó là ${opponent}; không dùng vũ khí hay công pháp, chỉ đánh bằng bản năng loài: ${npc.naturalAttacks.join(', ')}`
        : arms(opponent, npc.equipment || [], npc.skills || [])
    ].join('\n');
    return { npc, result, script: `${combatScript(result)}\nVŨ KHÍ VÀ CHIÊU THỨC HAI BÊN (mỗi đòn phải gọi tên chiêu thức, vũ khí hoặc đòn bản năng của bên ra đòn; người không có kỹ năng thì dùng quyền cước, binh khí thường; thú chưa hóa hình chỉ dùng đòn bản năng của loài):\n${loadout}` };
  }

  function applyCombatOutcome(combat) {
    const { npc, result } = combat;
    const lost = healthNow() - result.player.health;
    // A beaten player is left at 1 HP, not dead: the story goes on.
    currentHealth = Math.max(1, result.player.health);
    npc.health = result.enemy.health;
    renderItems();
    const who = result.outcome === 'draw' ? 'bất phân thắng bại' : result.outcome === 'both' ? 'cả hai cùng gục' : `${result.winner} thắng`;
    return `Giao chiến với ${npc.speaker}: ${result.strikes.length} đòn, ${who}. Ngươi mất ${lost.toLocaleString('vi-VN')} máu (${healthNow().toLocaleString('vi-VN')} / ${maxHealth().toLocaleString('vi-VN')}); ${npc.speaker} còn ${npc.health.toLocaleString('vi-VN')} / ${npcEffectiveStats(npc).health.toLocaleString('vi-VN')} máu.`;
  }

  async function playAI() {
    const action = getPlayerAction();
    if (!action) {
      const firstTextarea = inputs.querySelector('textarea');
      firstTextarea?.focus();
      if (firstTextarea) firstTextarea.placeholder = 'Nhập hành động hoặc lời thoại của nhân vật trước khi gọi AI…';
      return;
    }

    const model = modelInput.value.trim();
    if (!model) {
      setStatus('error', 'Hãy nhập tên model Ollama');
      modelInput.focus();
      return;
    }

    const profile = getProfile();
    const entries = getPlayerEntries();
    const recentStory = formatRecentStoryContext();
    const surprise = document.querySelector('#surprise-event').checked;
    let combat = null;
    const buildUserMessage = () => [
      `${getWorldContext(profile)}\n\nDIỄN BIẾN GẦN ĐÂY (ưu tiên mạch mới nhất):\n${recentStory}`,
      `BỘ NHỚ TỐI ĐA ${MAX_REMEMBERED_CHAPTERS} CHƯƠNG HOÀN TẤT GẦN NHẤT:\n${formatChapterMemory()}`,
      `CÁC LƯỢT ĐÃ KỂ TRONG CHƯƠNG ${chapterState.chapterNumber} (không kể lại):\n${formatCurrentChapterContext()}`,
      `HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI (bắt buộc kể lại đầy đủ, đúng thứ tự, ngay đầu lượt):\n${action}`,
      surprise ? 'Hãy thêm một tình tiết bất ngờ hợp lý, có dấu hiệu gieo trước và không giải quyết mọi việc quá dễ dàng.' : '',
      combat ? `KỊCH BẢN GIAO CHIẾN GIỮA ${profile.name} VÀ ${combat.npc.speaker} (hệ thống đã tính xong theo chỉ số; BẮT BUỘC kể đúng số đòn, đúng thứ tự ai ra đòn, đúng mức thương tích và đúng kết cục; không được thêm bớt đòn, không đổi người thắng; tuyệt đối không ghi con số, phần trăm hay tên chỉ số vào truyện — chỉ miêu tả chiêu thức, động tác, cách né đỡ, vết thương và hơi thở của hai bên):\n${combat.script}` : '',
      'YÊU CẦU LƯỢT NÀY: Tiếp tục liền mạch từ câu cuối cùng trong diễn biến gần đây. Mở đầu bằng việc kể lại toàn bộ hành động và lời thoại người chơi vừa nhập: tường thuật được viết lại cho giàu hình ảnh và hợp ngữ cảnh, lời thoại được trau chuốt câu chữ nhưng giữ nguyên ý, không bỏ sót câu nào, đặt trong thẻ <dialogue speaker="..."> đúng người nói. Chỉ sau đó mới viết phản ứng, lời đáp và hệ quả. Nếu đó là câu hỏi, hãy để đúng người được hỏi trả lời chính xác câu hỏi trước khi mở rộng cảnh. Không đưa thêm sự kiện ngoài mạch. Chỉ kết thúc bằng dòng [CHIẾN LỢI PHẨM] nếu trong lượt này đã hạ gục xong kẻ địch; nếu không thì không có dòng đó.'
    ].filter(Boolean).join('\n\n');
    let userMessage = '';

    turnButton.disabled = true;
    checkButton.disabled = true;
    modelInput.disabled = true;
    turnButton.dataset.originalText = 'Thực hiện';
    turnButton.textContent = 'Đang chờ AI…';
    setStatus('writing');
    help.textContent = 'Model đang viết phần truyện dài khoảng 1.500–2.000 từ; có thể mất vài phút, nhất là lần gọi đầu.';

    const requestTurn = async extraMessages => {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildSystemPrompt(profile) },
            { role: 'user', content: userMessage },
            ...extraMessages
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { num_ctx: OLLAMA_NUM_CTX, temperature: 0.65, top_p: 0.85, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: 6000 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      return data.message?.content?.trim() || '';
    };

    try {
      help.textContent = 'Đang xét xem lượt này có giao chiến không…';
      const foe = await detectCombatIntent(model, action, recentStory).catch(() => null);
      if (foe) combat = await prepareCombat(foe, profile);
      help.textContent = combat
        ? `Trận đấu với ${combat.npc.speaker} đã được tính xong (${combat.result.strikes.length} đòn); model đang viết lại diễn biến…`
        : 'Model đang viết phần truyện dài khoảng 1.500–2.000 từ; có thể mất vài phút, nhất là lần gọi đầu.';
      userMessage = buildUserMessage();
      let raw = await requestTurn([]);
      // The model must retell everything the player wrote. If it dropped a line, ask once more
      // naming what is missing; if it still drops it, put the player's own words in front.
      let missing = missingPlayerEntries(raw, entries);
      if (missing.length) {
        help.textContent = 'Model bỏ sót phần người chơi nhập; đang yêu cầu viết lại…';
        const retry = await requestTurn([
          { role: 'assistant', content: raw },
          { role: 'user', content: `Phần truyện trên đã BỎ SÓT ${missing.map(describeEntry).join('; ')}. Viết lại toàn bộ lượt này từ đầu, kể lại đầy đủ mọi hành động và lời thoại người chơi theo đúng thứ tự (có thể trau chuốt câu chữ, không được bỏ ý hay bỏ câu), rồi mới đến phản ứng và hệ quả. Giữ nguyên định dạng thẻ <dialogue>; dòng [CHIẾN LỢI PHẨM] chỉ có khi đã hạ gục xong kẻ địch.` }
        ]);
        const stillMissing = missingPlayerEntries(retry, entries);
        if (stillMissing.length <= missing.length) { raw = retry; missing = stillMissing; }
        if (missing.length) raw = `${missing.map(entryToStory).join('\n\n')}\n\n${raw}`;
      }
      removeDuplicateStoryEntries();
      const priorStory = [
        ...chapterState.turns.map(turn => turn.narrative),
        ...[...story.querySelectorAll('.narration, .story-entry dialogue')].map(node => node.textContent.trim())
      ];
      const loot = extractLoot(raw);
      const answer = removeRepeatedPassages(normalizeDialogue(await fixPinyinNames(loot.text, model, profile), profile.name), priorStory);
      if (!answer) throw new Error('Model không trả về phần truyện.');

      answer.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
        .forEach(part => appendNarrationWithDialogue(part, profile.name));
      removeDuplicateStoryEntries();
      completeProgressionTurn();
      if (combat) appendTurnReport(applyCombatOutcome(combat));
      applyLoot(loot.entries).forEach(appendTurnReport);
      await updateJourney(model, action, answer);
      const chapterClosed = await recordTurn(action, answer, model);
      inputs.innerHTML = '';
      document.querySelector('#surprise-event').checked = false;
      if (!chapterClosed) {
        setStatus('ready');
        help.textContent = `Đã nhận hồi đáp từ ${model}. Lượt ${chapterState.turns.length}/${TURNS_PER_CHAPTER} của chương ${chapterState.chapterNumber}; đang giữ trí nhớ ${chapterState.memories.length} chương trước.`;
      }
      story.scrollTop = story.scrollHeight;
    } catch (error) {
      setStatus('error');
      setHelpForError(error);
      if (error?.message && error.name !== 'TypeError') help.textContent = error.message;
    } finally {
      turnButton.disabled = false;
      checkButton.disabled = false;
      modelInput.disabled = false;
      turnButton.innerHTML = `${turnButton.dataset.originalText || 'Thực hiện'} <span>✦</span>`;
    }
  }

  checkButton.addEventListener('click', checkConnection);
  turnButton.addEventListener('click', playAI);
  renderJourney();
})();
