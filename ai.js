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
    const tabs = [...document.querySelectorAll('#action-tabs button')];
    const currentTurn = chapterState.turns.length;
    tabs.forEach((tab, index) => tab.classList.toggle('active', index === currentTurn));
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
      const highlights = [...paragraphs.slice(0, 1), ...paragraphs.slice(-1)];
      return `LƯỢT ${index + 1} — HÀNH ĐỘNG: ${turn.action}\nDIỄN BIẾN ĐÃ KỂ: ${[...new Set(highlights)].join(' ').slice(0, 900)}`;
    }).join('\n\n');
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
      nsfw: document.querySelector('#allow-nsfw')?.checked || false,
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
      .map(item => item.innerText.trim().replace(/\s+/g, ' ')).filter(Boolean);
    const stats = ['#attack', '#defense', '#spirit', '#luck']
      .map((selector, index) => `${['Công kích', 'Phòng ngự', 'Linh lực', 'Khí vận'][index]}: ${document.querySelector(selector)?.textContent?.trim() || 'chưa rõ'}`)
      .join('; ');
    return [
      `HỒ SƠ: ${profile.name}; ${profile.age || 'tuổi chưa rõ'}; thân phận ${profile.identity || 'chưa rõ'}; cảnh giới ${profile.realm || 'chưa rõ'}.`,
      `THẾ GIỚI MUỐN CHƠI: ${profile.worldName || 'Thế giới tự tạo'}.`,
      `MÔ TẢ THẾ GIỚI VÀ MỐC THỜI GIAN: ${profile.setting || 'chưa thiết lập'}`,
      `MỤC TIÊU: ${profile.goal || 'chưa đặt mục tiêu cụ thể'}`,
      `CHỈ SỐ HIỆN TẠI: ${stats}.`,
      `TRANG BỊ ĐANG CÓ: ${readItems('#equipment-list').join('; ') || 'chưa ghi nhận'}.`,
      `KỸ NĂNG ĐANG CÓ: ${readItems('#skills-list').join('; ') || 'chưa ghi nhận'}.`,
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

  function removeRepeatedPassages(text) {
    const kept = [];
    for (const paragraph of text.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)) {
      if (!kept.some(previous => isNearDuplicate(paragraph, previous))) kept.push(paragraph);
    }
    return kept.join('\n\n');
  }

  function buildSystemPrompt(profile, initialScene) {
    return [
      'Ngươi là người dẫn truyện tương tác cho game tiên hiệp Vạn Giới Ký. Viết hoàn toàn bằng tiếng Việt tự nhiên, giàu hình ảnh và có nhịp kể cuốn hút; dùng từ cổ phong vừa phải, không dịch sát văn phong tiếng Anh.',
      'Tiếp nối nhất quán bối cảnh và sự kiện đã xảy ra. Dùng hồ sơ thế giới, mục tiêu, chỉ số, trang bị, kỹ năng và đoạn truyện gần nhất làm ngữ cảnh bắt buộc; ưu tiên chi tiết đã được xác lập, không tự đổi tuổi, thân phận, địa điểm, quan hệ, quy tắc sức mạnh hoặc trạng thái tài nguyên. Nếu thiếu thông tin, không khẳng định chi tiết mới như sự thật đã có.',
      'BỘ NHỚ CÁC CHƯƠNG TRƯỚC là dữ kiện liên tục đã được kể. Không tái diễn lại cảnh, hành động, lời thoại hoặc tiết lộ trong đó; chỉ nhắc ngắn nếu cần để nối mạch. Ưu tiên diễn biến mới và giải quyết các việc còn dang dở khi hành động hiện tại dẫn tới.',
      'Mỗi lượt phải làm thế giới tiến lên. Nếu hành động của người chơi chưa tự tạo ra một bước ngoặt, hãy đưa vào ít nhất một chuyển biến mới phù hợp (tin tức, mưu đồ phe phái, thử thách, cơ duyên hoặc biến cố môi trường); chọn loại khác với những lượt gần đây và không biến mọi chuyển biến thành chiến đấu.',
      'Mỗi lượt hồi đáp hướng tới khoảng 1.500–2.000 từ tiếng Việt, thường chia thành 12–20 đoạn tự nhiên; chất lượng và mạch truyện quan trọng hơn việc cố kéo đủ chữ. HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI là dàn ý những gì đang diễn ra trong lượt này: hãy chuyển toàn bộ hành động thành văn xuôi sống động, đi qua từng bước theo đúng thứ tự, rồi mới kể phản ứng và hậu quả. Không bỏ qua bước nào, không rút gọn thành một câu, không chép nguyên văn phần tường thuật; giữ nguyên ý nghĩa lời thoại cụ thể. Mỗi đoạn phải thêm một hành động, thông tin, cảm xúc của NPC, hệ quả hoặc thay đổi tình thế mới. TUYỆT ĐỐI không kể lại cùng một hành động, hình ảnh, cảm xúc hay lời thoại bằng cách đổi vài từ; không quay lại cảnh đã kể và không dùng câu kết luận lặp để kéo dài. Bắt đầu ngay trong khoảnh khắc hành động diễn ra, không tóm tắt. Chỉ cho nhân vật chính thực hiện những gì người chơi đã nêu; không tự thêm quyết định, lời thoại hay suy nghĩ mới cho họ.',
      adultIntimacyRule(profile),
      worldDirective(profile),
      'Chỉ xuất phần truyện có thể hiện cho người chơi. Không viết suy nghĩ nội bộ, phân tích, kế hoạch, lời dẫn meta, tiêu đề, đánh số đoạn hay Markdown. Không lặp lại yêu cầu.',
      `HỒ SƠ NHÂN VẬT: ${profile.name}${profile.age ? `, ${profile.age} tuổi` : ''}; thân phận: ${profile.identity || 'chưa xác định'}; cảnh giới: ${profile.realm || 'chưa xác định'}.`,
      `BỐI CẢNH THẾ GIỚI: ${profile.setting || 'Thế giới tu tiên với tông môn, cảnh giới, bí cảnh và cơ duyên.'}`,
      `MỤC TIÊU: ${profile.goal || 'Tiếp tục hành trình tu hành theo lựa chọn của người chơi.'}`,
      initialScene ? `MỞ ĐẦU CÂU CHUYỆN:\n${initialScene}` : ''
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
                'Hãy DỰNG MỘT CẢNH ĐANG DIỄN RA, không tóm tắt hồ sơ, không kể tiểu sử và không diễn giải lại các ô thông tin. Mở bằng một khoảnh khắc cụ thể có địa điểm, giác quan và biến động; để thân phận, cảnh giới, mục tiêu hiện ra qua chi tiết, phản ứng của người khác và tình thế của nhân vật.',
                'Tạo một tình huống riêng phù hợp với thế giới người chơi mô tả, gieo một bí ẩn, mối nguy hoặc cơ hội gắn với mục tiêu ban đầu. Kết ở một khoảnh khắc mở để người chơi tự quyết định bước tiếp theo.',
                adultIntimacyRule(profile),
                worldDirective(profile),
                'Viết một cảnh mở màn hoàn chỉnh dài khoảng 1.500–2.000 từ tiếng Việt, thường chia thành 12–20 đoạn văn. Dành đủ dung lượng để cảnh diễn tiến tự nhiên qua hành động, đối thoại, không khí, giác quan, phản ứng của người xung quanh và một tình thế cụ thể; không lặp ý hay kéo dài bằng câu rỗng. Không dùng tiêu đề, lời mở đầu kiểu “Năm nay…”, câu tóm tắt kiểu “mang thân phận…”, danh sách, Markdown, phân tích hay suy nghĩ nội bộ. Không tự quyết định lựa chọn hoặc hành động quan trọng thay nhân vật chính.'
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
                'Dùng các dữ kiện này làm nền để viết cảnh mở màn có hành động và không khí. Tuyệt đối đừng liệt kê hay nhắc lại chúng như một bản tóm tắt.'
              ].join('\n')
            }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.85, top_p: 0.92, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: 6000 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const opening = removeRepeatedPassages(data.message?.content?.trim() || '');
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
    const initialScene = story.innerText.trim().slice(0, 1800);
    const recentStory = story.innerText.trim().slice(-6000);
    const surprise = document.querySelector('#surprise-event').checked;
    const userMessage = [
      `${getWorldContext(profile)}\n\nDIỄN BIẾN GẦN ĐÂY (ưu tiên mạch mới nhất):\n${recentStory}`,
      `BỘ NHỚ TỐI ĐA ${MAX_REMEMBERED_CHAPTERS} CHƯƠNG HOÀN TẤT GẦN NHẤT:\n${formatChapterMemory()}`,
      `CÁC LƯỢT ĐÃ KỂ TRONG CHƯƠNG ${chapterState.chapterNumber} (không kể lại):\n${formatCurrentChapterContext()}`,
      `HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI:\n${action}`,
      surprise ? 'Hãy thêm một tình tiết bất ngờ hợp lý, có dấu hiệu gieo trước và không giải quyết mọi việc quá dễ dàng.' : '',
      'Hãy kể tiếp ngay từ hành động vừa rồi.'
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
            { role: 'system', content: buildSystemPrompt(profile, initialScene) },
            { role: 'user', content: userMessage }
          ],
          think: false,
          stream: false,
          keep_alive: '10m',
          options: { temperature: 0.8, top_p: 0.9, repeat_penalty: 1.18, repeat_last_n: 512, num_predict: 6000 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const answer = removeRepeatedPassages(data.message?.content?.trim() || '');
      if (!answer) throw new Error('Model không trả về phần truyện.');

      answer.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).forEach(part => addParagraph(part));
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
