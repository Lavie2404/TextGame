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
  const TURNS_PER_CHAPTER = 4;
  const MAX_REMEMBERED_CHAPTERS = 5;
  const statusText = {
    idle: 'Chưa kết nối Ollama',
    busy: 'Đang kết nối…',
    ready: 'Ollama đã sẵn sàng',
    writing: 'AI đang viết đoạn dài…',
    error: 'Không kết nối được Ollama'
  };

  function freshChapterState() {
    return { chapterNumber: 1, turns: [], memories: [] };
  }

  function loadChapterState() {
    try {
      const saved = JSON.parse(localStorage.getItem(CHAPTER_MEMORY_KEY) || 'null');
      if (saved && Number.isInteger(saved.chapterNumber) && Array.isArray(saved.turns) && Array.isArray(saved.memories)) {
        return { ...saved, memories: saved.memories.slice(-MAX_REMEMBERED_CHAPTERS) };
      }
    } catch (error) {
      console.warn('Không đọc được bộ nhớ chương đã lưu.', error);
    }
    return freshChapterState();
  }

  let chapterState = loadChapterState();

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
      .map(item => `${item.querySelector('b')?.textContent || ''} (${item.querySelector('.item-grade')?.textContent || ''}; ${item.querySelector('.item-state')?.textContent || 'đang dùng'})`).filter(Boolean);
    const stats = ['#attack', '#defense', '#spirit', '#luck']
      .map((selector, index) => `${['Công kích', 'Phòng ngự', 'Linh lực', 'Khí vận'][index]}: ${document.querySelector(selector)?.textContent?.trim() || 'chưa rõ'}`)
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
      'Danh sách trang bị, kỹ năng và túi đồ hiện tại là nguồn chính xác về sở hữu. Không sử dụng lại món đã bán, vứt bỏ hoặc kỹ năng đã quên chỉ vì chúng xuất hiện trong truyện trước đó.',
      'Chỉ sử dụng trang bị đang mặc và kỹ năng đang dùng. Trang bị đã tháo và kỹ năng đã tắt vẫn được sở hữu nhưng không có hiệu lực; không tự mặc lại hay bật lại thay người chơi.',
      `CHƯƠNG ĐANG KỂ: ${document.querySelector('.chapter span')?.textContent?.trim() || 'CHƯƠNG 01'}.`,
      `MỤC TIÊU HIỆN TẠI: ${document.querySelector('.quest-card h3')?.textContent?.trim() || profile.goal || 'chưa rõ'} — ${document.querySelector('.quest-card p')?.textContent?.trim() || ''}`
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

  function addParagraph(text, className = 'narration') {
    const paragraph = document.createElement('p');
    paragraph.className = className;
    paragraph.textContent = text;
    story.append(paragraph);
  }

  function appendNarrationWithDialogue(text, playerName) {
    const pattern = /<dialogue\s+speaker\s*=\s*(["'])(.*?)\1\s*>([\s\S]*?)<\/dialogue\s*>/gi;
    let cursor = 0;
    let match;
    let foundDialogue = false;
    while ((match = pattern.exec(text))) {
      foundDialogue = true;
      const narration = text.slice(cursor, match.index).replace(/<\/?dialogue\b[^>]*>/gi, '').trim();
      if (narration) addParagraph(narration);
      const speaker = match[2].trim() || 'Không rõ';
      const spokenText = match[3].replace(/<\/?dialogue\b[^>]*>/gi, '').trim();
      if (spokenText) {
        const entry = document.createElement('div');
        entry.className = `story-entry ${speaker === playerName ? 'player' : speaker === 'Chưa rõ người nói' ? 'unattributed' : 'npc'}`;
        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = [...speaker][0] || '•';
        const body = document.createElement('div');
        const name = document.createElement('div');
        name.className = 'speaker';
        name.textContent = speaker;
        const dialogue = document.createElement('dialogue');
        dialogue.textContent = spokenText;
        body.append(name, dialogue);
        entry.append(avatar, body);
        story.append(entry);
      }
      cursor = pattern.lastIndex;
    }
    const trailing = text.slice(cursor).replace(/<\/?dialogue\b[^>]*>/gi, '').trim();
    if (trailing) addParagraph(trailing);
    if (!foundDialogue) addParagraph(text.replace(/<\/?dialogue\b[^>]*>/gi, '').trim());
  }

  // Local Ollama models sometimes ignore the XML contract and return quoted
  // dialogue inline. Convert those quoted utterances into the same contract
  // before rendering or saving the turn, so both prompt history and UI agree.
  function normalizeQuotedDialogue(text, playerName) {
    const quotePattern = /<dialogue\b[^>]*>[\s\S]*?<\/dialogue\s*>|“([^”]+)”|"([^"]+)"|「([^」]+)」/gi;
    const soundOnly = /^(?:phịch|bịch|thịch|bụp|bộp|rầm|ầm|choang|keng|cạch|xoẹt|vút|vù|vù vù|rắc|lộp bộp|ầm ầm|thịch thịch)[.!…]*$/iu;
    text = text.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u{20000}-\u{2FA1F}\u{30000}-\u{323AF}]/gu, '');
    const attribution = '(?:nói|hỏi|đáp|trả lời|thì thầm|kêu lên|quát|gọi|lên tiếng|cất tiếng|lẩm bẩm|reo lên|thốt lên)';
    const name = '[\\p{Lu}][\\p{L}]+(?:[ \\t]+[\\p{Lu}][\\p{L}]+){0,3}';
    const pronoun = '(?:Cậu ấy|Anh ấy|Nàng ấy|Hắn|Cậu|Anh|Nàng|Chàng|Ngươi|Bạn|Nhân vật chính)';
    const modifiers = '(?:\\s+(?:khẽ|nhẹ nhàng|trầm giọng|vội|lạnh lùng|lớn tiếng|chậm rãi|mỉm cười))*';
    const invalidNames = /^(?:Lời|Lời nói|Tiếng|Giọng|Người đối diện|Không rõ|Chưa rõ người nói|NPC|Người lạ|Cô gái|Chàng trai|Người đàn ông|Người phụ nữ)$/iu;
    function requireSpeaker(speaker) {
      if (!speaker || invalidNames.test(speaker)) throw new Error('AI chưa ghi rõ tên người nói. Hãy thử lại để tạo lời thoại có tên nhân vật đầy đủ.');
      return speaker;
    }
    function inferSpeaker(before, after) {
      // Only an attribution directly beside this utterance can identify its speaker.
      const afterMatch = after.match(new RegExp(`^[\\s,.;:!?…—–-]*(${pronoun}|${name})${modifiers}\\s+${attribution}(?=$|[^\\p{L}])`, 'u'));
      const beforeMatch = before.match(new RegExp(`(${pronoun}|${name})${modifiers}\\s+${attribution}\\s*[:：,]?\\s*$`, 'u'));
      const subject = afterMatch?.[1] || beforeMatch?.[1];
      if (!subject || invalidNames.test(subject)) return '';
      if (/^(?:Ngươi|Bạn|Nhân vật chính)$/u.test(subject)) return playerName;
      if (!new RegExp(`^${pronoun}$`, 'u').test(subject)) return subject;
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
    while ((match = quotePattern.exec(text))) {
      output += text.slice(cursor, match.index);
      if (match[0].toLowerCase().startsWith('<dialogue')) {
        const content = match[0].replace(/^<dialogue\b[^>]*>/i, '').replace(/<\/dialogue\s*>$/i, '').trim();
        const declared = match[0].match(/speaker\s*=\s*(["'])(.*?)\1/i)?.[2]?.trim() || '';
        if (soundOnly.test(content)) output += content;
        else if (!declared || invalidNames.test(declared) || new RegExp(`^${pronoun}$`, 'u').test(declared)) {
          const resolved = requireSpeaker(inferSpeaker(text.slice(Math.max(0, match.index - 1200), match.index), text.slice(quotePattern.lastIndex, quotePattern.lastIndex + 180)));
          output += `<dialogue speaker="${resolved}">${content}</dialogue>`;
        } else output += match[0];
        cursor = quotePattern.lastIndex;
        continue;
      }
      const spokenText = match[1] ?? match[2] ?? match[3] ?? '';
      if (soundOnly.test(spokenText.trim())) {
        output += spokenText.trim();
        cursor = quotePattern.lastIndex;
        continue;
      }
      const before = text.slice(Math.max(0, match.index - 1200), match.index);
      const after = text.slice(quotePattern.lastIndex, Math.min(text.length, quotePattern.lastIndex + 100));
      const speaker = requireSpeaker(inferSpeaker(before, after));
      output += `<dialogue speaker="${speaker}">${spokenText.trim()}</dialogue>`;
      cursor = quotePattern.lastIndex;
    }
    return output + text.slice(cursor);
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

  const namedDialogueRule = 'NPC chỉ được nói khi có tên riêng rõ ràng. Giới thiệu tên NPC trong lời kể trước câu thoại đầu tiên, dùng nhất quán tên đó trong speaker. Không dùng NPC, Chưa rõ người nói, Người lạ, Cô gái, Nàng hoặc chức danh chung làm tên. Với nhân vật hư cấu mới, đặt tên phù hợp thời kỳ và thế giới; với nhân vật đã có tên, giữ nguyên tên. Nếu chưa thể xác định tên, không viết lời thoại cho nhân vật đó. Không gán lời của NPC sang người chơi.';

  function buildSystemPrompt(profile) {
    return [
      'Ngươi là người dẫn truyện tương tác cho game tiên hiệp Vạn Giới Ký. Viết hoàn toàn bằng tiếng Việt tự nhiên, giàu hình ảnh và có nhịp kể cuốn hút; dùng từ cổ phong vừa phải, không dịch sát văn phong tiếng Anh.',
      'Tiếp nối nhất quán bối cảnh và sự kiện đã xảy ra. Dùng hồ sơ thế giới, mục tiêu, chỉ số, trang bị, kỹ năng và đoạn truyện gần nhất làm ngữ cảnh bắt buộc; ưu tiên chi tiết đã được xác lập, không tự đổi tuổi, thân phận, địa điểm, quan hệ, quy tắc sức mạnh hoặc trạng thái tài nguyên. Nếu thiếu thông tin, không khẳng định chi tiết mới như sự thật đã có.',
      'BỘ NHỚ CÁC CHƯƠNG TRƯỚC là dữ kiện liên tục đã được kể. Không tái diễn lại cảnh, hành động, lời thoại hoặc tiết lộ trong đó; chỉ nhắc ngắn nếu cần để nối mạch. Ưu tiên diễn biến mới và giải quyết các việc còn dang dở khi hành động hiện tại dẫn tới.',
      'Trong chương hiện tại, không sao chép lại bất kỳ câu, đoạn văn hay cảnh nào đã xuất hiện trong phần truyện gần đây, kể cả khi thay đổi vài từ. Chỉ nhắc lại dữ kiện cũ khi cần cho mạch truyện; không dựng lại cùng một khung cảnh hoặc hồi tưởng đã kể.',
      'MẠCH TRUYỆN VÀ HỒI ĐÁP TRỰC TIẾP (ƯU TIÊN CAO NHẤT): Đọc HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI và DIỄN BIẾN GẦN ĐÂY trước khi viết. Tiếp tục đúng cảnh, địa điểm, thời điểm, người đang có mặt và việc đang dang dở ở cuối phần gần đây. Nếu người chơi hỏi hoặc nói với một nhân vật, nhân vật đó phải nghe và trả lời đúng trọng tâm ngay trong lượt này; không né câu hỏi, không để người khác trả lời thay nếu không có lý do trong cảnh. Sau câu trả lời, mới kể nét mặt, hành động và hệ quả có quan hệ nhân quả rõ với câu hỏi/hành động ấy. Mỗi đoạn phải nối với đoạn ngay trước bằng hành động, lời đáp, phản ứng hoặc hệ quả; không tự chuyển cảnh, đổi chủ đề, thêm người lạ hay biến cố bất chợt không liên quan. Không bắt buộc tạo bước ngoặt ở mọi lượt; chỉ thêm sự kiện mới khi nó phát sinh hợp lý từ hành động hiện tại hoặc người chơi bật tùy chọn tình tiết bất ngờ. Không tự bịa rằng NPC đã biết điều chưa được tiết lộ.',
      'Mỗi lượt hồi đáp hướng tới khoảng 1.500–2.000 từ tiếng Việt, thường chia thành 12–20 đoạn tự nhiên; chất lượng và mạch truyện quan trọng hơn độ dài. Chuyển hành động người chơi thành văn xuôi theo đúng thứ tự, không bỏ qua bước nào, không chép nguyên văn phần tường thuật; giữ đúng nội dung lời thoại. Mỗi đoạn phải đóng góp diễn biến, phản ứng, thông tin hoặc hệ quả mới gắn với cảnh đang diễn ra. Không lặp lại cùng hành động/hình ảnh/lời thoại; không kéo dài bằng câu rỗng. Bắt đầu ngay tại thời điểm câu chuyện đang dở. Chỉ cho nhân vật chính thực hiện những gì người chơi đã nêu; không tự thêm quyết định, lời thoại hay suy nghĩ mới cho họ.',
      'ĐỊNH DẠNG ĐẦU RA CÓ CẤU TRÚC (BẮT BUỘC, KHÔNG ĐƯỢC BỎ QUA): Bất cứ câu nào một nhân vật nói thành tiếng đều phải nằm trong thẻ <dialogue speaker="Tên nhân vật">Lời nói</dialogue>. Quy tắc này áp dụng cho cả nhân vật chính và mọi NPC. Không viết lời thoại trần trong dấu ngoặc kép, không gắn lời thoại vào giữa đoạn tường thuật. Mẫu đúng: Nàng khựng bước. <dialogue speaker="Diệp Thần">Cô vừa nói gì?</dialogue> Người thiếu nữ siết cuốn sách trong tay. <dialogue speaker="Tống Thúy">Ta nói viên đá này có thể soi thấy quá khứ.</dialogue> Mẫu sai: Nàng hỏi: “Cô vừa nói gì?” Mỗi lượt nói có một thẻ riêng, speaker là tên chính xác người đang nói. Chỉ lời kể, hành động, suy nghĩ và miêu tả để ngoài thẻ. Âm thanh, tiếng động, từ mô phỏng tiếng động như “phịch”, “vù”, “rầm”, “keng” là tường thuật, tuyệt đối không cho vào thẻ thoại. Tuyệt đối không dùng chữ Hán hoặc từ viết bằng chữ Hán; chỉ viết tiếng Việt bằng chữ Quốc ngữ. Trước khi trả lời, tự rà lại và bọc mọi câu thoại còn sót; chỉ xuất truyện, không xuất lời giải thích.',
      adultIntimacyRule(profile),
      worldDirective(profile),
      narrationPerspectiveRule(profile),
      namedDialogueRule,
      'Chỉ xuất phần truyện có thể hiện cho người chơi. Không viết suy nghĩ nội bộ, phân tích, kế hoạch, lời dẫn meta, tiêu đề, đánh số đoạn hay Markdown. Không lặp lại yêu cầu.',
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
                'Giới thiệu ngắn gọn, hợp lý xuất thân của người chơi và tình hình hiện tại: ngươi là ai, vì sao có mặt ở đây, đang ở đâu và đang đối diện việc gì. Dựa sát hồ sơ đã nhập, kết nối thành vài đoạn văn tự nhiên thay vì liệt kê thông tin.',
                'Bối cảnh phải phù hợp thế giới và thời kỳ đã chọn. Không bắt buộc thêm bí ẩn, biến cố hay NPC. Kết ở tình huống hiện tại để người chơi tự chọn hành động tiếp theo.',
                'Gán speaker theo chủ thể thực sự nói trong tình tiết. Lời của nhân vật chính phải dùng đúng tên trong hồ sơ; không dùng nhãn Lời, Lời nói hoặc đại từ làm tên NPC. Suy nghĩ nội tâm giữ trong lời kể, không chuyển thành lời nói của NPC.',
                adultIntimacyRule(profile),
                worldDirective(profile),
                narrationPerspectiveRule(profile),
                namedDialogueRule,
                'ĐỊNH DẠNG BẮT BUỘC: Mọi câu được nhân vật nói ra phải là <dialogue speaker="Tên nhân vật">Lời nói</dialogue>, kể cả thoại của nhân vật chính. Không viết câu thoại trong ngoặc kép ngoài thẻ và không gắn thoại vào đoạn kể. Ví dụ đúng: Mưa quất lên mái ngói. <dialogue speaker="Lâm Tuyết">Huynh nghe thấy tiếng động không?</dialogue> Ví dụ sai: Mưa quất lên mái ngói. “Huynh nghe thấy tiếng động không?” nàng hỏi. Âm thanh như “phịch”, “vù”, “rầm”, “keng” là lời kể, không phải lời thoại. Chỉ viết tiếng Việt bằng chữ Quốc ngữ; tuyệt đối không có chữ Hán hay từ viết bằng chữ Hán. Hãy tự rà soát toàn bộ đầu ra trước khi kết thúc.',
                'Chỉ viết 2–4 đoạn ngắn, khoảng 150–300 từ; có thể ngắn hơn nếu đã giới thiệu đủ xuất thân và tình hình. Không kéo dài cho đủ số từ. Không dùng tiêu đề, danh sách hay Markdown. Không tự quyết định hành động quan trọng thay người chơi.'
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
                'Giới thiệu sơ qua xuất thân và hoàn cảnh hiện tại từ các dữ kiện trên, bằng ngôi thứ hai. Nếu có NPC nói chuyện, giới thiệu tên riêng của NPC trước khi họ nói.'
              ].join('\n')
            }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.85, top_p: 0.92, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: 1200 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const opening = removeRepeatedPassages(normalizeQuotedDialogue(data.message?.content?.trim() || '', profile.name));
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
      'YÊU CẦU LƯỢT NÀY: Tiếp tục liền mạch từ câu cuối cùng trong diễn biến gần đây. Thực hiện đúng hành động người chơi vừa nhập. Nếu đó là câu hỏi, hãy để đúng người được hỏi trả lời chính xác câu hỏi trước khi mở rộng cảnh. Không đưa thêm sự kiện ngoài mạch.'
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
      const answer = removeRepeatedPassages(normalizeQuotedDialogue(data.message?.content?.trim() || '', profile.name), priorStory);
      if (!answer) throw new Error('Model không trả về phần truyện.');

      answer.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
        .forEach(part => appendNarrationWithDialogue(part, profile.name));
      removeDuplicateStoryEntries();
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
})();
