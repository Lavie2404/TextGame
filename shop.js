const SHOP_SLOTS_PER_TYPE = 4;
// Every item kind (and every demonic school) the shop can roll, split by shop tab.
function shopPool() {
  const pool = {equipment:[],skill:[]};
  Object.entries(itemKinds).forEach(([kind,data])=>{
    if (kind === 'demonic') Object.keys(demonicSchools).forEach(school=>pool.skill.push({kind,school}));
    else pool[data[0]==='Trang bị'?'equipment':'skill'].push({kind});
  });
  return pool;
}
function pickRandom(list,count){
  const copy=[...list];
  for(let i=copy.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[copy[i],copy[j]]=[copy[j],copy[i]]}
  return copy.slice(0,count);
}
// Each tab independently has this chance per refresh to offer one item a grade above the realm's grade.
const SHOP_UPGRADE_CHANCE = 0.01;
function worldTopTier(){return gradeTierForRealm(Math.max(worldRealms.length-1,0))}
// Any grade up to the realm's grade can appear; each grade is twice as likely as the one below it.
function rollGradeTier(maxTier){
  let roll=Math.random()*(2**(maxTier+1)-1);
  for(let tier=0;tier<maxTier;tier++){roll-=2**tier;if(roll<0)return tier}
  return maxTier;
}
const rollsUpgrade = tier => tier < worldTopTier() && Math.random() < SHOP_UPGRADE_CHANCE;
// Rolled once per chapter at the player's current level; equipment and skills are sold at that level.
function rollShopStock(level){
  const realmIndex=Math.floor((level-1)/10);
  if(!Number.isSafeInteger(level)||level<1||!worldRealms[realmIndex])return null;
  const tier=gradeTierForRealm(realmIndex),pool=shopPool();
  const slots=category=>{
    const picked=pickRandom(pool[category],SHOP_SLOTS_PER_TYPE).map(entry=>({...entry,tier:rollGradeTier(tier)}));
    if(rollsUpgrade(tier))picked[Math.floor(Math.random()*picked.length)].tier=tier+1;
    return picked;
  };
  // Consumables are always in stock and can be bought repeatedly: Bình máu at the realm's grade, plus the demonic materials that are for sale (blood and corpses only drop as loot).
  const items=[{kind:'potion',tier}];
  if(rollsUpgrade(tier))items.push({kind:'potion',tier:tier+1});
  Object.keys(materialOffers).filter(materialSold).forEach(material=>items.push({kind:'material',material}));
  return {id:`${Date.now()}${Math.random()}`,level,tier,equipment:slots('equipment'),skill:slots('skill'),item:items};
}
function shopCatalog(stock) {
  if (!stock) return [];
  const grades = Object.keys(rarity);
  return ['equipment','skill','item'].flatMap(type => stock[type].map(({kind,school,tier,material},index) => {
    if (kind === 'material') {
      const [name, price, unit] = materialOffers[material];
      return {id:`${stock.id}-${type}-${index}`,type,kind,material,name,grade:`Nguyên liệu · ${unit}`,icon:'☗',price};
    }
    const product = {
      id:`${stock.id}-${type}-${index}`,type,kind,school,grade:grades[tier],rare:tier>stock.tier,
      level:stock.level,
      name:kind==='potion'?'Bình máu':school?demonicSchools[school].names[tier]:namedItems[kind][tier],
      icon:type==='equipment'?'✦':type==='skill'?'☯':'⚱'
    };
    return {...product,price:itemPrice([product.name,product.grade,product.icon,false,kind,school,product.level])*2};
  }));
}

(() => {
  let category = 'equipment';
  const list = document.querySelector('#shop-list');
  const status = document.querySelector('#shop-status');
  // Read the applied character level, never an unsaved customization field.
  // null until a journey has started; a mortal at level 0 shops like a level 1 character.
  const currentLevel = () => { const level = document.querySelector('#player-realm').textContent.match(/Cấp\s+(\d+)/u)?.[1]; return level === undefined ? null : Math.max(1, Number(level)); };
  const owned = product => product.type !== 'item' && (product.type === 'equipment' ? equipment : skills)
    .some(item => item[0] === product.name && item[1] === product.grade && item[6] === product.level);
  const asItem = product => [product.name,product.grade,product.icon,false,product.kind,product.school,product.level];
  const describe = product => product.kind === 'material' ? materialDescription(product.material) : product.type === 'item' ? potionDescription(asItem(product)) : itemDescription(asItem(product));
  const currentChapter = () => Number(document.querySelector('.chapter span')?.textContent.match(/\d+/)?.[0]) || 1;
  let stockChapter = null, stock = null;
  const catalogNow = () => {
    if (!stock || currentChapter() !== stockChapter) {
      const rolled = rollShopStock(currentLevel());
      if (rolled) { stock = rolled; stockChapter = currentChapter(); }
    }
    return shopCatalog(stock);
  };
  // A new journey restarts at chapter 1, so the chapter number alone cannot signal it.
  window.rerollShopStock = () => { stock = null; renderShop(); };

  function renderShop() {
    const catalog = catalogNow();
    document.querySelector('#shop-coins').textContent = inventoryCoins.toLocaleString('vi-VN');
    document.querySelector('#shop-tier').textContent = stock
      ? `Hàng làm mới mỗi chương, trang bị và kỹ năng theo cấp ${stock.level}. Phẩm từ Phàm phẩm tới ${Object.keys(rarity)[stock.tier]}; hiếm khi có phẩm cao hơn.`
      : 'Hãy bắt đầu hành trình với cảnh giới hợp lệ để xem hàng.';
    list.innerHTML = catalog.filter(product => product.type === category).map(product => {
      const alreadyOwned = owned(product);
      const affordable = inventoryCoins >= product.price;
      const label = alreadyOwned ? 'Đã sở hữu' : affordable ? 'Mua' : 'Không đủ tiền';
      return `<article class="shop-product${product.rare ? ' shop-rare' : ''}"><b>${escapeHtml(product.name)}${product.rare ? ' <span class="rare-tag">Hiếm</span>' : ''}</b><small>${escapeHtml(product.grade)}${product.level ? ` · Cấp ${product.level}` : ''} · ${product.price.toLocaleString('vi-VN')} đồng</small><small>${escapeHtml(describe(product))}</small><button type="button" data-buy="${product.id}" ${alreadyOwned || !affordable ? 'disabled' : ''} aria-label="${label}: ${escapeHtml(product.name)}">${label}</button></article>`;
    }).join('');
    document.querySelectorAll('[data-shop-type]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.shopType === category)));
  }

  document.querySelectorAll('[data-shop-type]').forEach(button => button.addEventListener('click', () => {
    category = button.dataset.shopType;
    renderShop();
  }));
  list.addEventListener('click', event => {
    if(document.querySelector('#ai-turn').disabled)return;
    const button = event.target.closest('[data-buy]');
    if (!button) return;
    const product = catalogNow().find(item => item.id === button.dataset.buy);
    if (!product || owned(product) || inventoryCoins < product.price) {
      status.textContent = 'Không thể mua món này. Hãy kiểm tra cảnh giới, túi đồ và số tiền.';
      renderShop();
      return;
    }
    inventoryCoins -= product.price;
    if (product.kind === 'material') occultMaterials[product.material]++;
    else if (product.type === 'item') { const key = potionKey(product.grade, product.level); potions[key] = (potions[key] || 0) + 1; }
    else (product.type === 'equipment' ? equipment : skills).push([product.name, product.grade, product.icon, false,product.kind,product.school,product.level]);
    renderItems();
    status.textContent = product.kind === 'material'
      ? `Đã mua 1 ${materialOffers[product.material][2]} ${product.name} với ${product.price} đồng. Xem ở mục Vật phẩm.`
      : product.type === 'item'
        ? `Đã mua ${product.name} ${product.grade} với ${product.price} đồng. Xem ở mục Vật phẩm.`
        : `Đã mua ${product.name} với ${product.price} đồng. Món đã được đưa vào Túi đồ.`;
    status.focus();
  });
  document.addEventListener('inventory-changed', renderShop);
  new MutationObserver(renderShop).observe(document.querySelector('#player-realm'), { childList: true, characterData: true, subtree: true });
  new MutationObserver(renderShop).observe(document.querySelector('.chapter span'), { childList: true, characterData: true, subtree: true });
  renderShop();
})();
