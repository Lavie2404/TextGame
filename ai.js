(() => {
  const OLLAMA_URL = 'http://127.0.0.1:11434';
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
      `MỤC TIÊU HIỆN TẠI: ${journal.goal || 'chưa rõ'}${journal.step ? ` — bước tiếp theo: ${journal.step}` : ''} (tiến độ ước lượng ${journal.progress}%).`,
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
          options: { temperature: 0.2, top_p: 0.8, num_predict: 220 }
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
          options: { temperature: 0, num_predict: 20 }
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
          options: { temperature: 0.2, top_p: 0.8, repeat_penalty: 1.15, num_predict: 900 }
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

  function getPlayerAction() {
    const cards = [...inputs.querySelectorAll('.input-card')];
    const lines = [];
    cards.forEach(card => {
      const text = card.querySelector('textarea')?.value.trim();
      if (!text) return;
      if (card.classList.contains('dialogue-card')) {
        const speaker = card.querySelector('.dialogue-meta input')?.value.trim() || getProfile().name;
        lines.push(`${speaker} nói: “${text}”`);
      } else {
        lines.push(text);
      }
    });
    return lines.join('\n');
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
    appendEmphasized(paragraph, text);
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
    function inferSpeaker(before, after) {
      before = before.replace(/\*\*/g, '');
      const subject = speechAttribution(before, after);
      if (!subject) return '';
      if (/^(?:Ngươi|Bạn|Nhân vật chính)$/iu.test(subject)) return playerName;
      if (!new RegExp(`^${pronoun}$`, 'iu').test(subject)) return subject;
      // Resolve third-person pronouns to the most recent named character, not
      // to the first name mentioned later in the next sentence.
      const mentions = [...before.matchAll(/[\p{Lu}][\p{L}]+(?:[ \t]+[\p{Lu}][\p{L}]+){1,3}/gu)];
      const lastName = mentions.at(-1);
      const playerAt = playerName ? before.lastIndexOf(playerName) : -1;
      // A third-person pronoun describes an NPC in second-person narration.
      // Do not turn "Nàng" into the player just because their name occurs nearby.
      if (lastName?.[0] === playerName || playerAt > (lastName?.index ?? -1)) return '';
      return lastName?.[0] || '';
    }
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
        if (!subject) { output += match[0]; continue; }
        const speaker = requireSpeaker(inferSpeaker(before, after), subject);
        // The bubble already names the speaker, so drop a bare tag clause
        // ("Lâm Tuyết hỏi." / "Lâm Tuyết khẽ nói:") instead of leaving it dangling.
        const clause = `(?:${anyPronoun}|${name})${modifiers}\\s+${attribution}`;
        output = output.replace(new RegExp(`(^|[.!?…>]\\s+|\\n)${clause}\\s*[:：]\\s*$`, 'u'), '$1');
        const tail = after.match(new RegExp(`^\\s*[,—–-]?\\s*${clause}\\s*[.!…]+(?=\\s|$)`, 'u'));
        output += `<dialogue speaker="${speaker}">${spokenText}</dialogue>`;
        if (tail) dialoguePattern.lastIndex = cursor += tail[0].length;
        else {
          // A clause that goes on after the quote (“...”, ngươi đáp, rồi quay
          // lưng.) becomes its own narration sentence: Ngươi đáp, rồi quay lưng.
          const joint = text.slice(cursor).match(/^\s*[,;—–-]+\s*(?=\p{Ll})/u);
          if (joint) {
            cursor += joint[0].length;
            output += ` ${text[cursor].toLocaleUpperCase('vi')}`;
            dialoguePattern.lastIndex = ++cursor;
          }
        }
        continue;
      }
      const content = match[0].replace(/^<dialogue\b[^>]*>/i, '').replace(/<\/dialogue\s*>$/i, '').trim();
      const declared = match[0].match(/speaker\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() || '';
      if (soundOnly.test(content)) output += content;
      else if (!declared || invalidNames.test(declared) || new RegExp(`^${pronoun}$`, 'iu').test(declared)) {
        const resolved = requireSpeaker(inferSpeaker(text.slice(Math.max(0, match.index - 1200), match.index), text.slice(dialoguePattern.lastIndex, dialoguePattern.lastIndex + 180)), declared);
        output += `<dialogue speaker="${resolved}">${content}</dialogue>`;
      } else { output += match[0];if(declared!==playerName)lastNpc=declared; }
      cursor = dialoguePattern.lastIndex;
    }
    return emphasizeQuotes(output + text.slice(cursor));
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

  const namedDialogueRule = 'NPC chỉ được nói khi có tên riêng rõ ràng. Giới thiệu tên NPC trong lời kể trước câu thoại đầu tiên, dùng nhất quán tên đó trong speaker. Không dùng NPC, Chưa rõ người nói, Người lạ, Cô gái, Nàng hoặc chức danh chung làm tên. Với nhân vật hư cấu mới, đặt tên phù hợp thời kỳ và thế giới; với nhân vật đã có tên, giữ nguyên tên. Nếu NPC chưa có tên, tự sáng tạo ngay một tên cổ trang phù hợp như Lâm Vân Phong hoặc Tô Thanh Dao, giới thiệu tên và dùng nhất quán cho nhân vật đó. Không dừng truyện, không yêu cầu người chơi cung cấp tên. Không gán lời của NPC sang người chơi.';

  const coherentProseRule = 'VIẾT CÓ NGHĨA VÀ ĐÚNG BỐI CẢNH: Mỗi câu phải rõ chủ thể, hành động và đối tượng; lời thoại phải có mục đích phù hợp tình huống. Địa danh, phe phái, chức danh phải nhất quán với thế giới và thời kỳ đã chọn. Không ghép tên tùy tiện thành địa danh hoặc tổ chức như "biên giới Mạnh", "Mạnh Tông" khi chưa được xác lập. Với nhân vật lịch sử, không tự đổi phe phái hoặc vai trò nếu người chơi chưa thiết lập lịch sử thay thế. Nếu chưa đủ dữ kiện, dùng mô tả địa điểm rõ ràng như "bìa rừng phía bắc doanh trại", không bịa tên như một sự thật đã biết. Địa danh hư cấu mới phải được giới thiệu quan hệ với nơi hiện tại và vai trò trong tình huống. Trước khi trả lời, rà lại tên riêng, ý nghĩa câu và sự liên kết giữa lời kể với lời thoại. Trong lời kể có thể dùng **tên nhân vật**, **thân phận**, **cảnh giới** để nhấn mạnh chọn lọc; không bọc cả đoạn hoặc dùng các kiểu Markdown khác.';

  const lootRule = 'CHIẾN LỢI PHẨM (BẮT BUỘC): Sau phần truyện, viết thêm đúng một dòng cuối cùng, tách riêng, theo mẫu "[CHIẾN LỢI PHẨM] tên: số lượng đơn vị; tên: số lượng đơn vị" liệt kê những gì nhân vật người chơi thực sự thu được trong lượt này: vật liệu từ quái vật hay kẻ địch đã hạ, tiền, đồ được tặng hoặc nhặt. Số lượng và tên phải hợp với sự việc vừa kể; ví dụ hạ 2 con sói: "[CHIẾN LỢI PHẨM] thịt sói: 20 cân; da sói: 1 tấm; nanh sói: 3; vuốt sói: 5; thi thể động vật: 1; máu động vật: 5 phần". Thi thể còn nguyên ghi "thi thể động vật" hoặc "thi thể người"; máu hứng được ghi "máu động vật" hoặc "máu người"; độc thảo và oán phù ghi đúng tên đó; tiền ghi "tiền: 30 đồng". Không ghi trang bị, kỹ năng hay tu vi vào dòng này. Lượt không thu được gì thì ghi "[CHIẾN LỢI PHẨM] không". Không viết gì sau dòng này.';

  function buildSystemPrompt(profile) {
    return [
      'Ngươi là người dẫn truyện tương tác cho game tiên hiệp Vạn Giới Ký. Viết hoàn toàn bằng tiếng Việt tự nhiên, giàu hình ảnh và có nhịp kể cuốn hút; dùng từ cổ phong vừa phải, không dịch sát văn phong tiếng Anh.',
      'Tiếp nối nhất quán bối cảnh và sự kiện đã xảy ra. Dùng hồ sơ thế giới, mục tiêu, chỉ số, trang bị, kỹ năng và đoạn truyện gần nhất làm ngữ cảnh bắt buộc; ưu tiên chi tiết đã được xác lập, không tự đổi tuổi, thân phận, địa điểm, quan hệ, quy tắc sức mạnh hoặc trạng thái tài nguyên. Nếu thiếu thông tin, không khẳng định chi tiết mới như sự thật đã có.',
      'BỘ NHỚ CÁC CHƯƠNG TRƯỚC là dữ kiện liên tục đã được kể. Không tái diễn lại cảnh, hành động, lời thoại hoặc tiết lộ trong đó; chỉ nhắc ngắn nếu cần để nối mạch. Ưu tiên diễn biến mới và giải quyết các việc còn dang dở khi hành động hiện tại dẫn tới.',
      'Trong chương hiện tại, không sao chép lại bất kỳ câu, đoạn văn hay cảnh nào đã xuất hiện trong phần truyện gần đây, kể cả khi thay đổi vài từ. Chỉ nhắc lại dữ kiện cũ khi cần cho mạch truyện; không dựng lại cùng một khung cảnh hoặc hồi tưởng đã kể.',
      'MẠCH TRUYỆN VÀ HỒI ĐÁP TRỰC TIẾP (ƯU TIÊN CAO NHẤT): Đọc HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI và DIỄN BIẾN GẦN ĐÂY trước khi viết. Tiếp tục đúng cảnh, địa điểm, thời điểm, người đang có mặt và việc đang dang dở ở cuối phần gần đây. Nếu người chơi hỏi hoặc nói với một nhân vật, nhân vật đó phải nghe và trả lời đúng trọng tâm ngay trong lượt này; không né câu hỏi, không để người khác trả lời thay nếu không có lý do trong cảnh. Sau câu trả lời, mới kể nét mặt, hành động và hệ quả có quan hệ nhân quả rõ với câu hỏi/hành động ấy. Mỗi đoạn phải nối với đoạn ngay trước bằng hành động, lời đáp, phản ứng hoặc hệ quả; không tự chuyển cảnh, đổi chủ đề, thêm người lạ hay biến cố bất chợt không liên quan. Không bắt buộc tạo bước ngoặt ở mọi lượt; chỉ thêm sự kiện mới khi nó phát sinh hợp lý từ hành động hiện tại hoặc người chơi bật tùy chọn tình tiết bất ngờ. Không tự bịa rằng NPC đã biết điều chưa được tiết lộ.',
      'Mỗi lượt hồi đáp hướng tới khoảng 1.500–2.000 từ tiếng Việt, thường chia thành 12–20 đoạn tự nhiên; chất lượng và mạch truyện quan trọng hơn độ dài. Chuyển hành động người chơi thành văn xuôi theo đúng thứ tự, không bỏ qua bước nào, không chép nguyên văn phần tường thuật; giữ đúng nội dung lời thoại. Mỗi đoạn phải đóng góp diễn biến, phản ứng, thông tin hoặc hệ quả mới gắn với cảnh đang diễn ra. Không lặp lại cùng hành động/hình ảnh/lời thoại; không kéo dài bằng câu rỗng. Bắt đầu ngay tại thời điểm câu chuyện đang dở. Chỉ cho nhân vật chính thực hiện những gì người chơi đã nêu; không tự thêm quyết định, lời thoại hay suy nghĩ mới cho họ.',
      'ĐỊNH DẠNG ĐẦU RA CÓ CẤU TRÚC (BẮT BUỘC, KHÔNG ĐƯỢC BỎ QUA): Bất cứ câu nào một nhân vật nói thành tiếng đều phải nằm trong thẻ <dialogue speaker="Tên nhân vật">Lời nói</dialogue>. Quy tắc này áp dụng cho cả nhân vật chính và mọi NPC. Không viết lời thoại trần trong dấu ngoặc kép, không gắn lời thoại vào giữa đoạn tường thuật. Mẫu đúng: Nàng khựng bước. <dialogue speaker="Diệp Thần">Cô vừa nói gì?</dialogue> Người thiếu nữ siết cuốn sách trong tay. <dialogue speaker="Tống Thúy">Ta nói viên đá này có thể soi thấy quá khứ.</dialogue> Mẫu sai: Nàng hỏi: “Cô vừa nói gì?” Mỗi lượt nói có một thẻ riêng, speaker là tên chính xác người đang nói. Chỉ lời kể, hành động, suy nghĩ và miêu tả để ngoài thẻ. Âm thanh, tiếng động, từ mô phỏng tiếng động như “phịch”, “vù”, “rầm”, “keng” là tường thuật, tuyệt đối không cho vào thẻ thoại. Tên gọi, danh xưng, tên cảnh giới hay thuật ngữ được nhắc giữa câu kể (ví dụ: còn gọi là Đấu Tông sơ kỳ) cũng là tường thuật, không cho vào thẻ thoại. Muốn làm nổi bật tên gọi, thuật ngữ hay tiếng động thì viết trong cặp **...** (ví dụ: còn gọi là **Đấu Tông sơ kỳ**), tuyệt đối không dùng dấu ngoặc kép hay ngoặc đơn. Tuyệt đối không dùng chữ Hán hoặc từ viết bằng chữ Hán; chỉ viết tiếng Việt bằng chữ Quốc ngữ. Trước khi trả lời, tự rà lại và bọc mọi câu thoại còn sót; chỉ xuất truyện, không xuất lời giải thích.',
      adultIntimacyRule(profile),
      worldDirective(profile),
      narrationPerspectiveRule(profile),
      namedDialogueRule,
      coherentProseRule,
      lootRule,
      'Chỉ xuất phần truyện có thể hiện cho người chơi. Không viết suy nghĩ nội bộ, phân tích, kế hoạch, lời dẫn meta, tiêu đề, đánh số đoạn; chỉ cho phép **cụm từ** để nhấn mạnh trong lời kể. Không lặp lại yêu cầu.',
      `Gán speaker theo người thực sự nói trong tình tiết. Lời của nhân vật chính phải ghi speaker="${profile.name}"; không dùng Lời, Lời nói hoặc đại từ làm tên NPC. Giữ suy nghĩ nội tâm trong lời kể.`,
      `HỒ SƠ NHÂN VẬT: ${profile.name}${profile.age ? `, ${profile.age} tuổi` : ''}; thân phận: ${profile.identity || 'chưa xác định'}; cảnh giới: ${profile.realm || 'chưa xác định'}.`,
      `BỐI CẢNH THẾ GIỚI: ${profile.setting || 'Thế giới tu tiên với tông môn, cảnh giới, bí cảnh và cơ duyên.'}`,
      `MỤC TIÊU: ${profile.goal || 'Tiếp tục hành trình tu hành theo lựa chọn của người chơi.'}`
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
                `Mục tiêu ban đầu: ${profile.goal || 'Chưa đặt mục tiêu cụ thể.'}`,
                `Cho phép chủ đề tình cảm trưởng thành: ${profile.allowNsfw ? 'có bật, nhưng vẫn phải áp dụng quy tắc tuổi trưởng thành và đồng thuận' : 'không'}.`,
                'Giới thiệu đầy đủ xuất thân và hoàn cảnh hiện tại từ các dữ kiện trên, bằng ngôi thứ hai. Nếu có NPC nói chuyện, giới thiệu tên riêng của NPC trước khi họ nói.'
              ].join('\n')
            }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.85, top_p: 0.92, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: -1 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      // The opening grants nothing; drop a loot line if the model adds one anyway.
      const opening = removeRepeatedPassages(normalizeDialogue(extractLoot(data.message?.content?.trim() || '').text, profile.name));
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
            'fullName: họ và tên đầy đủ. Nếu truyện chỉ gọi bằng chức danh hoặc biệt danh, đặt họ tên hợp thời đại và giữ phần đã biết (ví dụ "Trưởng lão Từ" thì họ Từ).',
            'courtesyName: tên tự, nếu thời đại/thân phận có dùng tên tự; nếu không thì ghi "Không có".',
            'identity: thân phận, chức vụ, phe phái. appearance: ngoại hình, 1–2 câu. personality: tính cách, 1–2 câu.',
            `level: 0 nếu là người thường chưa tu luyện; ngược lại từ 1 đến ${Math.max(worldRealms.length * 10, 1)}, tương xứng với thân phận và sức mạnh truyện đã thể hiện. Hệ thống cảnh giới: ${realms}. Nhân vật chính ${profile.name} đang ở ${profile.realm}. Chỉ số do hệ thống tự tính theo cấp độ, không cần ghi.`,
            npcProfilesContext(),
            `BỘ NHỚ CÁC CHƯƠNG TRƯỚC:\n${formatChapterMemory()}`,
            `DIỄN BIẾN GẦN ĐÂY:\n${formatRecentStoryContext(4000)}`
          ].join('\n\n') }
        ],
        format: NPC_PROFILE_SCHEMA,
        think: false,
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0.4, top_p: 0.85, num_predict: 800 }
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
    const recentStory = formatRecentStoryContext();
    const surprise = document.querySelector('#surprise-event').checked;
    const userMessage = [
      `${getWorldContext(profile)}\n\nDIỄN BIẾN GẦN ĐÂY (ưu tiên mạch mới nhất):\n${recentStory}`,
      `BỘ NHỚ TỐI ĐA ${MAX_REMEMBERED_CHAPTERS} CHƯƠNG HOÀN TẤT GẦN NHẤT:\n${formatChapterMemory()}`,
      `CÁC LƯỢT ĐÃ KỂ TRONG CHƯƠNG ${chapterState.chapterNumber} (không kể lại):\n${formatCurrentChapterContext()}`,
      `HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI:\n${action}`,
      surprise ? 'Hãy thêm một tình tiết bất ngờ hợp lý, có dấu hiệu gieo trước và không giải quyết mọi việc quá dễ dàng.' : '',
      'YÊU CẦU LƯỢT NÀY: Tiếp tục liền mạch từ câu cuối cùng trong diễn biến gần đây. Thực hiện đúng hành động người chơi vừa nhập. Nếu đó là câu hỏi, hãy để đúng người được hỏi trả lời chính xác câu hỏi trước khi mở rộng cảnh. Không đưa thêm sự kiện ngoài mạch. Kết thúc bằng dòng [CHIẾN LỢI PHẨM] theo đúng mẫu.'
    ].filter(Boolean).join('\n\n');

    turnButton.disabled = true;
    checkButton.disabled = true;
    modelInput.disabled = true;
    turnButton.dataset.originalText = 'Thực hiện';
    turnButton.textContent = 'Đang chờ AI…';
    setStatus('writing');
    help.textContent = 'Model đang viết phần truyện dài khoảng 1.500–2.000 từ; có thể mất vài phút, nhất là lần gọi đầu.';

    try {
      const response = await fetchWithTimeout(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: buildSystemPrompt(profile) },
            { role: 'user', content: userMessage }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.65, top_p: 0.85, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: 6000 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      removeDuplicateStoryEntries();
      const priorStory = [
        ...chapterState.turns.map(turn => turn.narrative),
        ...[...story.querySelectorAll('.narration, .story-entry dialogue')].map(node => node.textContent.trim())
      ];
      const loot = extractLoot(data.message?.content?.trim() || '');
      const answer = removeRepeatedPassages(normalizeDialogue(loot.text, profile.name), priorStory);
      if (!answer) throw new Error('Model không trả về phần truyện.');

      answer.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
        .forEach(part => appendNarrationWithDialogue(part, profile.name));
      removeDuplicateStoryEntries();
      completeProgressionTurn();
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
