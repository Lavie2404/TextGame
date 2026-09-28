(() => {
  const OLLAMA_URL = 'http://127.0.0.1:11434';
  const modelInput = document.querySelector('#ai-model');
  const status = document.querySelector('#ai-status');
  const help = document.querySelector('#ai-help');
  const checkButton = document.querySelector('#ai-check');
  const turnButton = document.querySelector('#ai-turn');
  const story = document.querySelector('#story');
  const inputs = document.querySelector('#inputs');
  const statusText = {
    idle: 'Chưa kết nối Ollama',
    busy: 'Đang kết nối…',
    ready: 'Ollama đã sẵn sàng',
    writing: 'AI đang viết đoạn dài…',
    error: 'Không kết nối được Ollama'
  };

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
      nsfw: document.querySelector('#allow-nsfw')?.checked || false
    };
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
      `THẾ GIỚI: ${profile.setting || 'chưa thiết lập'}`,
      `MỤC TIÊU: ${profile.goal || 'chưa đặt mục tiêu cụ thể'}`,
      `CHỈ SỐ HIỆN TẠI: ${stats}.`,
      `TRANG BỊ ĐANG CÓ: ${readItems('#equipment-list').join('; ') || 'chưa ghi nhận'}.`,
      `KỸ NĂNG ĐANG CÓ: ${readItems('#skills-list').join('; ') || 'chưa ghi nhận'}.`,
      `CHƯƠNG / BỐI CẢNH ĐANG HIỂN THỊ: ${document.querySelector('.chapter strong')?.textContent?.trim() || 'chưa rõ'}.`,
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

  function buildSystemPrompt(profile, initialScene) {
    return [
      'Ngươi là người dẫn truyện tương tác cho game tiên hiệp Vạn Giới Ký. Viết hoàn toàn bằng tiếng Việt tự nhiên, giàu hình ảnh và có nhịp kể cuốn hút; dùng từ cổ phong vừa phải, không dịch sát văn phong tiếng Anh.',
      'Tiếp nối nhất quán bối cảnh và sự kiện đã xảy ra. Dùng hồ sơ thế giới, mục tiêu, chỉ số, trang bị, kỹ năng và đoạn truyện gần nhất làm ngữ cảnh bắt buộc; ưu tiên chi tiết đã được xác lập, không tự đổi tuổi, thân phận, địa điểm, quan hệ, quy tắc sức mạnh hoặc trạng thái tài nguyên. Nếu thiếu thông tin, không khẳng định chi tiết mới như sự thật đã có.',
      'Mỗi lượt hồi đáp là một phần truyện dài khoảng 1.500–2.000 từ tiếng Việt, thường chia thành 12–20 đoạn tự nhiên. Phát triển hậu quả trực tiếp, phản ứng của NPC và thế giới, không khí, giác quan, đối thoại và diễn biến hợp lý; cụ thể, giàu chi tiết nhưng không lặp ý hay kéo dài bằng câu rỗng. Mở ngay tại hành động người chơi vừa chọn, không tóm tắt hoặc nhắc lại hành động. Không tự quyết định hành động, suy nghĩ hay lời thoại mới của nhân vật chính thay người chơi.',
      adultIntimacyRule(profile),
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
          options: { temperature: 0.9, top_p: 0.94, repeat_penalty: 1.12, num_predict: 6000 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const opening = data.message?.content?.trim();
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
      `HÀNH ĐỘNG / LỜI THOẠI NGƯỜI CHƠI:\n${action}`,
      surprise ? 'Hãy thêm một tình tiết bất ngờ hợp lý, có dấu hiệu gieo trước và không giải quyết mọi việc quá dễ dàng.' : '',
      'Hãy kể tiếp ngay từ hành động vừa rồi.'
    ].filter(Boolean).join('\n\n');

    turnButton.disabled = true;
    checkButton.disabled = true;
    modelInput.disabled = true;
    turnButton.dataset.originalText = turnButton.textContent;
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
          options: { temperature: 0.85, top_p: 0.92, repeat_penalty: 1.12, num_predict: 6000 }
        })
      }, 600000);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `Ollama trả về HTTP ${response.status}.`);
      const answer = data.message?.content?.trim();
      if (!answer) throw new Error('Model không trả về phần truyện.');

      const name = profile.name;
      addParagraph(`${name}: ${action}`, 'narration player-action');
      answer.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean).forEach(part => addParagraph(part));
      inputs.innerHTML = '';
      document.querySelector('#surprise-event').checked = false;
      setStatus('ready');
      help.textContent = `Đã nhận hồi đáp từ ${model}.`;
      story.scrollTop = story.scrollHeight;
    } catch (error) {
      setStatus('error');
      setHelpForError(error);
      if (error?.message && error.name !== 'TypeError') help.textContent = error.message;
    } finally {
      turnButton.disabled = false;
      checkButton.disabled = false;
      modelInput.disabled = false;
      turnButton.innerHTML = `${turnButton.dataset.originalText || 'AI hồi đáp'} <span>✦</span>`;
    }
  }

  checkButton.addEventListener('click', checkConnection);
  turnButton.addEventListener('click', playAI);
})();
