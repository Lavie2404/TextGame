const equipment=[['Thanh Phong Kiếm','Huyền phẩm','⚔'],['Hộ Tâm Giáp','Hoàng phẩm','♢']];
const skills=[['Ngự Phong Quyết','Huyền phẩm','〽'],['Tụ Khí Thuật','Phàm phẩm','☯']];
const rarity={ 'Phàm phẩm':0,'Hoàng phẩm':1,'Huyền phẩm':2,'Địa phẩm':3,'Thiên phẩm':4,'Tiên phẩm':5 };
const inputArea=document.querySelector('#inputs'),story=document.querySelector('#story');
function itemHTML([name,grade,icon]){return `<div class="item"><span class="item-icon">${icon}</span><span><b>${name}</b><small class="rarity-${rarity[grade]}">${grade}</small></span></div>`}
function renderItems(){document.querySelector('#equipment-list').innerHTML=equipment.map(itemHTML).join('');document.querySelector('#skills-list').innerHTML=skills.map(itemHTML).join('')}
function addInput(type){const template=document.querySelector(`#${type}-input`);const node=template.content.cloneNode(true);inputArea.append(node);inputArea.lastElementChild.querySelector('textarea').focus()}
document.querySelectorAll('.add-action').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.add-action').forEach(x=>x.classList.remove('active'));btn.classList.add('active');addInput(btn.dataset.type)}));
inputArea.addEventListener('click',e=>{if(e.target.matches('.remove'))e.target.closest('.input-card').remove()});
document.querySelector('#action-tabs').addEventListener('click',e=>{if(e.target.tagName==='BUTTON'){document.querySelectorAll('.action-tabs button').forEach(x=>x.classList.remove('active'));e.target.classList.add('active')}});
function escapeHtml(str){const el=document.createElement('div');el.textContent=str;return el.innerHTML}
const modal=document.querySelector('#modal');document.querySelector('#open-customize').onclick=()=>modal.classList.add('open');document.querySelector('#close-modal').onclick=()=>modal.classList.remove('open');modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.remove('open')});
document.querySelector('#save-custom').onclick=()=>{const name=document.querySelector('#custom-name').value.trim()||'Nhân vật vô danh',level=Math.max(1,+document.querySelector('#custom-level').value||1),realm=getRealmForLevel(level),xp=Math.max(0,Math.min(1000,+document.querySelector('#custom-xp').value||0));document.querySelector('#player-name').textContent=name;document.querySelector('#player-realm').textContent=`${realm||'Chưa có cảnh giới'} · Cấp ${level}`;document.querySelector('#xp-label').textContent=`${xp} / 1000`;document.querySelector('#xp-fill').style.width=`${xp/10}%`;renderRealmPanels(realm,level);modal.classList.remove('open')};
document.querySelector('#create-item').onclick=()=>{const name=document.querySelector('#item-name').value.trim(),type=document.querySelector('#item-type').value,grade=document.querySelector('#item-rarity').value;if(!name)return;const list=type==='Trang bị'?equipment:skills;list.push([name,grade,type==='Trang bị'?'✦':'☯']);renderItems();document.querySelector('#item-name').value=''};
document.querySelector('#add-equipment').onclick=()=>modal.classList.add('open');document.querySelector('#add-skill').onclick=()=>modal.classList.add('open');
const worldRealms=[];const originRealmInput=document.querySelector('#origin-realm');originRealmInput.type='number';originRealmInput.min='1';originRealmInput.placeholder='Ví dụ: 1';originRealmInput.closest('label').childNodes[0].textContent='Cấp độ hiện tại';
document.querySelector('#custom-realm').outerHTML='<input id="custom-realm" readonly placeholder="Tự xác định theo cấp độ" />';
function getRealmForLevel(level){return worldRealms[Math.floor((level-1)/10)]||''}
function renderRealmPanels(current='',level=1){const tags=document.querySelector('#origin-realms');tags.innerHTML=worldRealms.length?worldRealms.map(realm=>`<span class="realm-tag">${escapeHtml(realm)}<button type="button" aria-label="Xóa ${escapeHtml(realm)}" data-realm="${escapeHtml(realm)}">×</button></span>`).join(''):'<p>Chưa có cảnh giới nào. Hãy tự tạo hệ thống tu hành của thế giới này.</p>';document.querySelector('#realm-list').innerHTML=worldRealms.map((realm,index)=>{const from=index*10+1,to=(index+1)*10;return `<li class="${realm===current?'current':''}">${escapeHtml(realm)} <small>cấp ${from}–${to}</small>${realm===current?` · hiện tại: ${level}`:''}</li>`}).join('')||'<li>Chưa thiết lập</li>';document.querySelector('#custom-realm').value=current||''}
function addRealm(names){const realms=names.split(/[,;\n]/).map(name=>name.trim()).filter(Boolean);let added=false;realms.forEach(realm=>{if(!worldRealms.includes(realm)){worldRealms.push(realm);added=true}});if(added){const level=+originRealmInput.value||1;renderRealmPanels(getRealmForLevel(level),level)}return added}
const originWorldInput=document.querySelector('#origin-world');
const worldPresets={
  douluo:{name:'Đấu La Đại Lục',realms:['Hồn Sĩ','Hồn Sư','Đại Hồn Sư','Hồn Tôn','Hồn Tông','Hồn Vương','Hồn Đế','Hồn Thánh','Hồn Đấu La','Phong Hào Đấu La']},
  doupo:{name:'Đấu Phá Thương Khung',realms:['Đấu Chi Khí','Đấu Giả','Đấu Sư','Đại Đấu Sư','Đấu Linh','Đấu Vương','Đấu Hoàng','Đấu Tông','Đấu Tôn','Đấu Thánh','Đấu Đế']}
};
function applyWorldMode(){
  const mode=originWorldInput.value,preset=worldPresets[mode],settingInput=document.querySelector('#origin-setting');
  document.querySelector('#origin-setting-label').textContent=preset?'Thời kỳ, địa điểm hoặc chi tiết muốn bổ sung (không bắt buộc)':'Mô tả thế giới mới';
  settingInput.required=!preset;
  settingInput.placeholder=preset?'Có thể ghi thời kỳ truyện, địa điểm bắt đầu, mối liên hệ với nhân vật/sự kiện chính và điều bạn muốn thay đổi...':'Mô tả quy luật, phe phái, sức mạnh, địa điểm và loại sự kiện bạn muốn trong thế giới này...';
  document.querySelector('.realm-definition > span').textContent=preset?'Các cảnh giới đã nạp theo thế giới; bạn có thể tùy chỉnh':'Hệ thống cảnh giới của thế giới';
  worldRealms.splice(0,worldRealms.length,...(preset?.realms||[]));
  originRealmInput.value='1';
  renderRealmPanels(getRealmForLevel(1),1);
}
originWorldInput.addEventListener('change',applyWorldMode);
const realmAdderInput=document.querySelector('#new-realm');realmAdderInput.maxLength=300;realmAdderInput.placeholder='Nhập các cảnh giới, ngăn cách bằng dấu phẩy';document.querySelector('#add-realm').textContent='Thêm cảnh giới';document.querySelector('.realm-adder').insertAdjacentHTML('afterend','<small class="realm-hint">Ví dụ: Nhất phẩm, Nhị phẩm, Tam phẩm</small>');
document.querySelector('#add-realm').onclick=()=>{const input=document.querySelector('#new-realm');if(addRealm(input.value)){input.value='';input.focus()}};
document.querySelector('#new-realm').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();document.querySelector('#add-realm').click()}});
document.querySelector('#origin-realms').addEventListener('click',event=>{const button=event.target.closest('[data-realm]');if(!button)return;const realm=button.dataset.realm;worldRealms.splice(worldRealms.indexOf(realm),1);const level=+originRealmInput.value||1;renderRealmPanels(getRealmForLevel(level),level)});
renderRealmPanels();renderItems();addInput('narration');
document.querySelector('#origin-form').addEventListener('submit',async event=>{
  event.preventDefault();
  const name=document.querySelector('#origin-name').value.trim(),age=document.querySelector('#origin-age').value,identity=document.querySelector('#origin-identity').value.trim(),level=+originRealmInput.value,realm=getRealmForLevel(level),setting=document.querySelector('#origin-setting').value.trim(),goal=document.querySelector('#origin-goal').value.trim(),allowNsfw=document.querySelector('#allow-nsfw').checked,worldMode=originWorldInput.value,worldName=worldPresets[worldMode]?.name||'Thế giới tự tạo';
  if(!realm){originRealmInput.setCustomValidity('Cấp độ này chưa có cảnh giới tương ứng. Mỗi cảnh giới gồm 10 cấp.');originRealmInput.reportValidity();return}
  originRealmInput.setCustomValidity('');
  const startButton=event.currentTarget.querySelector('.begin-game'),startStatus=document.querySelector('#origin-ai-status'),buttonLabel=startButton.innerHTML;
  startButton.disabled=true;startButton.textContent='Đang viết mở đầu…';startStatus.textContent='Đang gửi hồ sơ và bối cảnh tới Ollama trên máy này.';startStatus.dataset.state='busy';
  try{
    if(typeof window.generateOpeningText!=='function')throw new Error('Không tải được mô-đun AI. Hãy tải lại trang.');
    const opening=await window.generateOpeningText({name,age,identity,level,realm,setting,goal,allowNsfw,worldMode,worldName});
    window.resetChapterMemory?.();
    renderRealmPanels(realm,level);document.querySelector('#player-name').textContent=name;document.querySelector('#player-realm').textContent=`${realm} · Cấp ${level}`;document.querySelector('#custom-name').value=name;document.querySelector('#custom-level').value=level;document.querySelector('#custom-realm').value=realm;document.querySelector('.chapter strong').textContent=`${worldName} · ${identity}`;document.querySelector('.quest-card h3').textContent=goal||'Bắt đầu hành trình';
    story.replaceChildren();
    const chapterLabel=document.createElement('div');chapterLabel.className='chapter-label';
    const leftRule=document.createElement('span'),rightRule=document.createElement('span');chapterLabel.append(leftRule,document.createTextNode('Khai mở thiên mệnh'),rightRule);story.append(chapterLabel);
    opening.split(/\n\s*\n/).map(part=>part.trim()).filter(Boolean).forEach((part,index)=>{const paragraph=document.createElement('p');paragraph.className=index===0?'narration lead':'narration';paragraph.textContent=part;story.append(paragraph)});
    startStatus.textContent='Mở đầu đã được AI viết từ hồ sơ nhân vật và bối cảnh.';startStatus.dataset.state='ready';document.querySelector('#origin-screen').classList.add('done');document.body.classList.remove('origin-active');
  }catch(error){startStatus.textContent=`Chưa bắt đầu được: ${error.message||'không nhận được hồi đáp từ Ollama.'}`;startStatus.dataset.state='error'}
  finally{startButton.disabled=false;startButton.innerHTML=buttonLabel}
});
