const equipment=[['Thanh Phong Kiếm','Huyền phẩm','⚔',true,'weapon'],['Hộ Tâm Giáp','Hoàng phẩm','♢',true,'clothing']];
const skills=[['Ngự Phong Quyết','Huyền phẩm','〽',true,'speed'],['Tụ Khí Thuật','Phàm phẩm','☯',true,'righteous']];
const rarity={ 'Phàm phẩm':0,'Hoàng phẩm':1,'Huyền phẩm':2,'Địa phẩm':3,'Thiên phẩm':4,'Tiên phẩm':5 };
let inventoryCoins=0;
function salePrice(grade,kind='weapon'){return ([10,30,100,300,1000,3000][rarity[grade]]||10)*(itemPriceWeights[kind]||1)}
const inputArea=document.querySelector('#inputs'),story=document.querySelector('#story');
function itemHTML([name,grade,icon,active=true,kind],index,type){
  const action=type==='equipment'?(active?'Tháo':'Mặc'):(active?'Tắt':'Bật');
  const state=type==='equipment'?(active?'Đang mặc':'Đã tháo'):(active?'Đang dùng':'Đã tắt');
  const extraButton=(operation,label)=>`<button type="button" class="bag-action" data-item-type="${type}" data-item-index="${index}" data-operation="${operation}" aria-label="${label} ${escapeHtml(name)}">${label}</button>`;
  const extra=active?'':type==='equipment'?extraButton('sell',`Bán · ${salePrice(grade,kind)} đồng`)+extraButton('discard','Vứt bỏ'):extraButton('forget','Quên');
  return `<div class="item${active?'':' item-inactive'}" data-active="${active}"><span class="item-icon">${escapeHtml(icon)}</span><span class="item-details"><b>${escapeHtml(name)}</b><small class="item-grade rarity-${rarity[grade]}">${escapeHtml(grade)}</small><small class="item-state">${state}</small><small class="item-effect">${escapeHtml(itemDescription([name,grade,icon,active,kind]))}</small></span><span class="item-actions"><button type="button" class="item-toggle" data-item-type="${type}" data-item-index="${index}" aria-label="${action} ${escapeHtml(name)}" aria-pressed="${active}">${action}</button>${active&&(kind?.startsWith("burst")||kind==="escape")?`<button type="button" class="burst-trigger" data-skill-index="${index}">Kích hoạt · 30 linh lực</button>`:""}${extra}</span></div>`;
}
function renderItems(){
  const bag=[];
  for(const [selector,list,type] of [['#equipment-list',equipment,'equipment'],['#skills-list',skills,'skill']]){
    const active=[];
    list.forEach((item,index)=>{(item[3]===false?bag:active).push(itemHTML(item,index,type))});
    document.querySelector(selector).innerHTML=active.join('')||`<p class="inventory-empty">${type==='equipment'?'Chưa mặc trang bị nào.':'Chưa bật kỹ năng nào.'}</p>`;
  }
  document.querySelector('#bag-list').innerHTML=bag.join('')||'<p class="inventory-empty">Túi đồ trống. Trang bị đã tháo và kỹ năng đã tắt sẽ nằm ở đây.</p>';
  document.querySelector('#bag-count').textContent=bag.length;
  document.querySelector('#inventory-coins').textContent=inventoryCoins.toLocaleString('vi-VN');
  renderCharacterStats();
  document.dispatchEvent(new Event('inventory-changed'));
}
document.querySelector('#bag-list').addEventListener('click',event=>{
  if(document.querySelector('#ai-turn').disabled)return;
  const button=event.target.closest('.bag-action');
  if(!button)return;
  const {itemType,operation}=button.dataset;
  const list=itemType==='equipment'?equipment:itemType==='skill'?skills:null;
  const index=Number(button.dataset.itemIndex),item=list?.[index];
  if(!Number.isInteger(index)||!item||item[3]!==false)return;
  if(!(itemType==='equipment'&&['sell','discard'].includes(operation))&&!(itemType==='skill'&&operation==='forget'))return;
  const amount=operation==='sell'?salePrice(item[1],item[4]):0;
  inventoryCoins+=amount;
  list.splice(index,1);
  renderItems();
  const message=operation==='sell'?`Đã bán ${item[0]}, nhận ${amount} đồng.`:operation==='discard'?`Đã vứt bỏ ${item[0]}.`:`Đã quên kỹ năng ${item[0]}.`;
  document.querySelector('#bag-status').textContent=message;
  const next=document.querySelector('#bag-list .item-toggle')||document.querySelector('#bag-status');
  next.focus();
});
for(const selector of ['#equipment-list','#skills-list','#bag-list']){
  document.querySelector(selector).addEventListener('click',event=>{
    const button=event.target.closest('.item-toggle');
    if(!button)return;
    const type=button.dataset.itemType;
    const list=type==='equipment'?equipment:type==='skill'?skills:null;
    if(!list)return;
    const index=Number(button.dataset.itemIndex),item=list[index];
    if(!item)return;
    if(document.querySelector("#ai-turn").disabled)return;
    if(item[3]===false)exclusiveEquip(list,item);else item[3]=false;
    if(item[3]===false&&pendingBurst?.name===item[0])pendingBurst=null;
    renderItems();
    const destination=item[3]?(type==='equipment'?'#equipment-list':'#skills-list'):'#bag-list';
    document.querySelector(destination).querySelector(`[data-item-type="${type}"][data-item-index="${index}"]`).focus();
  });
}
function addInput(type){const template=document.querySelector(`#${type}-input`);const node=template.content.cloneNode(true);inputArea.append(node);inputArea.lastElementChild.querySelector('textarea').focus()}
document.querySelector('#skills-list').addEventListener('click',event=>{
  const button=event.target.closest('.burst-trigger');if(!button||document.querySelector('#ai-turn').disabled)return;
  const item=skills[Number(button.dataset.skillIndex)];
  if(!item||item[3]===false||!(item[4].startsWith('burst')||item[4]==='escape'))return;
  const status=document.querySelector('#bag-status');
  if(pendingBurst){status.textContent='Đã chuẩn bị một bạo phát cho lượt kế tiếp.';return}
  if(baseStats.spirit<30){status.textContent='Cần ít nhất 30 linh lực gốc để kích hoạt.';return}
  baseStats.spirit-=30;pendingBurst={kind:item[4],name:item[0],percent:50+itemRank(item)*10};
  renderItems();status.textContent=`Đã kích hoạt ${item[0]} cho lượt kế tiếp, trả 30 linh lực. Nếu AI lỗi, hiệu lực vẫn được giữ.`;
});
function renderItemKinds(){
  const group=document.querySelector('#item-type').value;
  document.querySelector('#item-kind').innerHTML=Object.entries(itemKinds).filter(([,data])=>data[0]===group).map(([key,data])=>`<option value="${key}">${data[1]}</option>`).join('');
}
document.querySelector('#item-type').addEventListener('change',renderItemKinds);renderItemKinds();
document.querySelectorAll('.add-action').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.add-action').forEach(x=>x.classList.remove('active'));btn.classList.add('active');addInput(btn.dataset.type)}));
inputArea.addEventListener('click',e=>{if(e.target.matches('.remove'))e.target.closest('.input-card').remove()});
function escapeHtml(str){const el=document.createElement('div');el.textContent=str;return el.innerHTML}
const modal=document.querySelector('#modal');document.querySelector('#open-customize').onclick=()=>modal.classList.add('open');document.querySelector('#close-modal').onclick=()=>modal.classList.remove('open');modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});
const settingsModal=document.querySelector('#settings-modal');document.querySelector('#open-settings').onclick=()=>settingsModal.classList.add('open');document.querySelector('#close-settings').onclick=()=>settingsModal.classList.remove('open');settingsModal.addEventListener('click',e=>{if(e.target===settingsModal)settingsModal.classList.remove('open')});
document.querySelector('#save-custom').onclick=()=>{const name=document.querySelector('#custom-name').value.trim()||'Nhân vật vô danh',level=Math.max(1,+document.querySelector('#custom-level').value||1),realm=getRealmForLevel(level),xp=Math.max(0,Math.min(1000,+document.querySelector('#custom-xp').value||0));document.querySelector('#player-name').textContent=name;document.querySelector('#player-realm').textContent=`${realm||'Chưa có cảnh giới'} · Cấp ${level}`;document.querySelector('#xp-label').textContent=`${xp} / 1000`;document.querySelector('#xp-fill').style.width=`${xp/10}%`;renderRealmPanels(realm,level);modal.classList.remove('open')};
document.querySelector('#create-item').onclick=()=>{const name=document.querySelector('#item-name').value.trim(),type=document.querySelector('#item-type').value,grade=document.querySelector('#item-rarity').value;if(!name)return;const list=type==='Trang bị'?equipment:skills;list.push([name,grade,type==='Trang bị'?'✦':'☯',false,document.querySelector('#item-kind').value]);renderItems();document.querySelector('#item-name').value=''};
document.querySelector('#add-equipment').onclick=()=>modal.classList.add('open');document.querySelector('#add-skill').onclick=()=>modal.classList.add('open');
const worldRealms=[];const originRealmInput=document.querySelector('#origin-realm');originRealmInput.type='number';originRealmInput.min='1';originRealmInput.placeholder='Ví dụ: 1';originRealmInput.closest('label').childNodes[0].textContent='Cấp độ hiện tại';
document.querySelector('#custom-realm').outerHTML='<input id="custom-realm" readonly placeholder="Tự xác định theo cấp độ" />';
function getRealmForLevel(level){return worldRealms[Math.floor((level-1)/10)]||''}
function renderRealmPanels(current='',level=1){const tags=document.querySelector('#origin-realms');tags.innerHTML=worldRealms.length?worldRealms.map(realm=>`<span class="realm-tag">${escapeHtml(realm)}<button type="button" aria-label="Xóa ${escapeHtml(realm)}" data-realm="${escapeHtml(realm)}">×</button></span>`).join(''):'<p>Chưa có cảnh giới nào. Hãy tự tạo hệ thống tu hành của thế giới này.</p>';document.querySelector('#realm-list').innerHTML=worldRealms.map((realm,index)=>{const from=index*10+1,to=(index+1)*10;return `<li class="${realm===current?'current':''}">${escapeHtml(realm)} <small>cấp ${from}–${to}</small>${realm===current?` · hiện tại: ${level}`:''}</li>`}).join('')||'<li>Chưa thiết lập</li>';document.querySelector('#custom-realm').value=current||''}
function addRealm(names){const realms=names.split(/[,;\n]/).map(name=>name.trim()).filter(Boolean);let added=false;realms.forEach(realm=>{if(!worldRealms.includes(realm)){worldRealms.push(realm);added=true}});if(added){const level=+originRealmInput.value||1;renderRealmPanels(getRealmForLevel(level),level)}return added}
const realmAdderInput=document.querySelector('#new-realm');realmAdderInput.maxLength=300;realmAdderInput.placeholder='Nhập các cảnh giới, ngăn cách bằng dấu phẩy';document.querySelector('#add-realm').textContent='Thêm cảnh giới';document.querySelector('.realm-adder').insertAdjacentHTML('afterend','<small class="realm-hint">Ví dụ: Nhất phẩm, Nhị phẩm, Tam phẩm</small>');
document.querySelector('#add-realm').onclick=()=>{const input=document.querySelector('#new-realm');if(addRealm(input.value)){input.value='';input.focus()}};
document.querySelector('#new-realm').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();document.querySelector('#add-realm').click()}});
document.querySelector('#origin-realms').addEventListener('click',event=>{const button=event.target.closest('[data-realm]');if(!button)return;const realm=button.dataset.realm;worldRealms.splice(worldRealms.indexOf(realm),1);const level=+originRealmInput.value||1;renderRealmPanels(getRealmForLevel(level),level)});
renderRealmPanels();renderItems();addInput('narration');
document.querySelector('#origin-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const name=document.querySelector('#origin-name').value.trim(),age=document.querySelector('#origin-age').value,identity=document.querySelector('#origin-identity').value.trim(),level=+originRealmInput.value,realm=getRealmForLevel(level),setting=document.querySelector('#origin-setting').value.trim(),goal=document.querySelector('#origin-goal').value.trim(),allowNsfw=true,worldName=setting.split(/[\n;.!?]/)[0].trim().slice(0,36)||'Thế giới tự tạo';
  if(!realm){const startStatus=document.querySelector('#origin-ai-status');startStatus.textContent='Cấp độ này chưa có cảnh giới tương ứng. Mỗi cảnh giới gồm 10 cấp; hãy thêm cảnh giới phù hợp rồi thử lại.';startStatus.dataset.state='error';originRealmInput.focus();return}
  const startButton=event.currentTarget.querySelector('.begin-game'),startStatus=document.querySelector('#origin-ai-status'),buttonLabel=startButton.innerHTML;
  startButton.disabled=true;startButton.textContent='Đang viết mở đầu…';startStatus.textContent='Đang gửi hồ sơ và bối cảnh tới Ollama trên máy này.';startStatus.dataset.state='busy';
  try{
    if(typeof window.generateOpeningText!=='function')throw new Error('Không tải được mô-đun AI. Hãy tải lại trang.');
    const opening=await window.generateOpeningText({name,age,identity,level,realm,setting,goal,allowNsfw,worldName});
    window.resetChapterMemory?.();
    renderRealmPanels(realm,level);document.querySelector('#player-name').textContent=name;document.querySelector('#player-realm').textContent=`${realm} · Cấp ${level}`;document.querySelector('#custom-name').value=name;document.querySelector('#custom-level').value=level;document.querySelector('#custom-realm').value=realm;document.querySelector('.chapter strong').textContent=`${worldName} · ${identity}`;document.querySelector('.quest-card h3').textContent=goal||'Bắt đầu hành trình';
    story.replaceChildren();
    const chapterLabel=document.createElement('div');chapterLabel.className='chapter-label';
    const leftRule=document.createElement('span'),rightRule=document.createElement('span');chapterLabel.append(leftRule,document.createTextNode('Khai mở thiên mệnh'),rightRule);story.append(chapterLabel);
    if(typeof window.renderNarrativeWithDialogue==='function')window.renderNarrativeWithDialogue(opening,name);else opening.split(/\n\s*\n/).map((part,index)=>{const paragraph=document.createElement('p');paragraph.className=index===0?'narration lead':'narration';paragraph.textContent=part;story.append(paragraph)});
    startStatus.textContent='Mở đầu đã được AI viết từ hồ sơ nhân vật và bối cảnh.';startStatus.dataset.state='ready';document.querySelector('#origin-screen').classList.add('done');document.body.classList.remove('origin-active');
  }catch(error){startStatus.textContent=`Chưa bắt đầu được: ${error.message||'không nhận được hồi đáp từ Ollama.'}`;startStatus.dataset.state='error'}
  finally{startButton.disabled=false;startButton.innerHTML=buttonLabel}
});
