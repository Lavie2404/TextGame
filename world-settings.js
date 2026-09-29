// World setup files contain the creation form, not the current story progress.
(() => {
  const format = 'van-gioi-ky-world-settings';
  const fields = {
    name: 'origin-name', age: 'origin-age', level: 'origin-realm',
    identity: 'origin-identity', setting: 'origin-setting', goal: 'origin-goal',
    pendingRealms: 'new-realm'
  };
  const form = document.querySelector('#origin-form');
  const controls = document.createElement('div');
  controls.className = 'world-settings-actions';
  controls.innerHTML = '<button type="button" id="save-world-settings">Lưu Thiết Lập</button><button type="button" id="load-world-settings">Tải Thiết Lập</button><input type="file" id="world-settings-file" accept=".json,application/json" hidden aria-label="Chọn file thiết lập thế giới" />';
  const status = document.createElement('p');
  status.className = 'world-settings-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  form.querySelector('.begin-game').before(controls, status);
  const fileInput = controls.querySelector('input');
  const saveButton = controls.querySelector('#save-world-settings');
  const loadButton = controls.querySelector('#load-world-settings');

  function report(message, error = false) {
    status.textContent = message;
    status.dataset.state = error ? 'error' : 'ready';
  }

  function validate(data) {
    if (!data || data.format !== format || data.version !== 1) {
      throw new Error('File không đúng định dạng thiết lập thế giới hoặc phiên bản chưa được hỗ trợ.');
    }
    const settings = data.settings;
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('File thiếu thông tin thiết lập.');
    }
    for (const [key, id] of Object.entries(fields)) {
      const input = document.getElementById(id);
      const value = settings[key];
      if (typeof value !== 'string' || (input.maxLength >= 0 && value.length > input.maxLength)) {
        throw new Error('Thông tin thiết lập bị thiếu hoặc vượt quá độ dài cho phép.');
      }
      if (input.type === 'number' && value !== '' &&
          (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) ||
           Number(value) < Number(input.min) || (input.max && Number(value) > Number(input.max)))) {
        throw new Error('Tuổi hoặc cấp độ trong file không hợp lệ.');
      }
    }
    if (!Array.isArray(settings.realms) ||
        settings.realms.some(realm => typeof realm !== 'string' || !realm.trim() || realm.length > 300) ||
        new Set(settings.realms).size !== settings.realms.length) {
      throw new Error('Danh sách cảnh giới hoặc tùy chọn nội dung không hợp lệ.');
    }
    return settings;
  }

  saveButton.addEventListener('click', () => {
    try {
      const settings = Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, document.getElementById(id).value]));
      settings.realms = [...worldRealms];
      settings.allowNsfw = true;
      const data = { format, version: 1, settings };
      validate(data);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `van-gioi-ky-thiet-lap-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      report('Đã xuất file thiết lập JSON. Bạn có thể tải lại để tiếp tục chỉnh sửa.');
    } catch (error) {
      report(`Không thể lưu: ${error.message}`, true);
    }
  });

  loadButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    loadButton.disabled = saveButton.disabled = true;
    try {
      if (file.size > 1024 * 1024) throw new Error('File thiết lập phải nhỏ hơn hoặc bằng 1 MB.');
      const settings = validate(JSON.parse((await file.text()).replace(/^\uFEFF/, '')));
      // Validate every field before replacing any existing form values.
      for (const [key, id] of Object.entries(fields)) document.getElementById(id).value = settings[key];
      // Mature romance is enabled by default, including for older setup files.
      worldRealms.length = 0;
      settings.realms.forEach(realm => worldRealms.push(realm));
      const level = Number(settings.level) || 1;
      renderRealmPanels(getRealmForLevel(level), level);
      report('Đã tải thiết lập. Bạn có thể chỉnh sửa hoặc bắt đầu hành trình.');
    } catch (error) {
      report(error instanceof SyntaxError ? 'Không thể tải: file JSON không hợp lệ.' : `Không thể tải: ${error.message}`, true);
    } finally {
      fileInput.value = '';
      loadButton.disabled = saveButton.disabled = false;
    }
  });
})();
