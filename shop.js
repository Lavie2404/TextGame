// Each successive realm unlocks one rarity tier, capped at Tiên phẩm.
function shopCatalog(level) {
  const realmIndex = Math.floor((level - 1) / 10);
  if (!Number.isSafeInteger(level) || level < 1 || !worldRealms[realmIndex]) return [];
  const grade = Object.keys(rarity)[Math.min(realmIndex, 5)];
  const price = salePrice(grade) * 2;
  return [
    ['equipment', 'Trường Kiếm', '⚔'],
    ['equipment', 'Hộ Thân Giáp', '♢'],
    ['equipment', 'Hành Vân Ngoa', '✦'],
    ['skill', 'Kiếm Pháp', '〽'],
    ['skill', 'Hộ Thể Quyết', '☯'],
    ['skill', 'Bộ Pháp', '✧']
  ].map(([type, baseName, icon], index) => ({
    id: `${realmIndex}-${index}`, type, name: `${worldRealms[realmIndex]} · ${baseName}`,
    grade, icon, price
  }));
}

(() => {
  let category = 'equipment';
  const list = document.querySelector('#shop-list');
  const status = document.querySelector('#shop-status');
  // Read the applied character level, never an unsaved customization field.
  const currentLevel = () => Number(document.querySelector('#player-realm').textContent.match(/Cấp\s+(\d+)/u)?.[1]) || 0;
  const owned = product => (product.type === 'equipment' ? equipment : skills)
    .some(item => item[0] === product.name && item[1] === product.grade);

  function renderShop() {
    const level = currentLevel();
    const catalog = shopCatalog(level);
    document.querySelector('#shop-coins').textContent = inventoryCoins.toLocaleString('vi-VN');
    document.querySelector('#shop-tier').textContent = catalog.length
      ? `${getRealmForLevel(level)} · Hàng ${catalog[0].grade}. Phẩm chất tăng theo thứ tự cảnh giới, tối đa Tiên phẩm.`
      : 'Hãy bắt đầu hành trình với cảnh giới hợp lệ để xem hàng.';
    list.innerHTML = catalog.filter(product => product.type === category).map(product => {
      const alreadyOwned = owned(product);
      const affordable = inventoryCoins >= product.price;
      const label = alreadyOwned ? 'Đã sở hữu' : affordable ? 'Mua' : 'Không đủ tiền';
      return `<article class="shop-product"><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.grade)} · ${product.price.toLocaleString('vi-VN')} đồng</small><button type="button" data-buy="${product.id}" ${alreadyOwned || !affordable ? 'disabled' : ''} aria-label="${label}: ${escapeHtml(product.name)}">${label}</button></article>`;
    }).join('');
    document.querySelectorAll('[data-shop-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shopType === category)));
  }

  document.querySelectorAll('[data-shop-type]').forEach(button => button.addEventListener('click', () => {
    category = button.dataset.shopType;
    renderShop();
  }));
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-buy]');
    if (!button) return;
    const product = shopCatalog(currentLevel()).find(item => item.id === button.dataset.buy);
    if (!product || owned(product) || inventoryCoins < product.price) {
      status.textContent = 'Không thể mua món này. Hãy kiểm tra cảnh giới, túi đồ và số tiền.';
      renderShop();
      return;
    }
    inventoryCoins -= product.price;
    (product.type === 'equipment' ? equipment : skills).push([product.name, product.grade, product.icon, false]);
    renderItems();
    status.textContent = `Đã mua ${product.name} với ${product.price} đồng. Món đã được đưa vào Túi đồ.`;
    status.focus();
  });
  document.addEventListener('inventory-changed', renderShop);
  new MutationObserver(renderShop).observe(document.querySelector('#player-realm'), { childList: true, characterData: true, subtree: true });
  renderShop();
})();
