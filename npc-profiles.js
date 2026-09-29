// NPC profiles are generated once per journey by Ollama (see generateNpcProfile in ai.js) and then kept fixed.
const NPC_PROFILE_SCHEMA = {
  type:'object',
  properties:{
    fullName:{type:'string'},courtesyName:{type:'string'},identity:{type:'string'},appearance:{type:'string'},personality:{type:'string'},
    level:{type:'integer'}
  },
  required:['fullName','courtesyName','identity','appearance','personality','level']
};
const npcProfiles = new Map(), pendingNpcProfiles = new Map();
function resetNpcProfiles(){npcProfiles.clear();pendingNpcProfiles.clear()}
function maxWorldLevel(){return worldRealms.length*10}
function npcRealmLabel(level){return level<1?'Chưa tu luyện':getRealmForLevel(level)||'Chưa rõ'}
// Stats follow the same rolling rules as the player (rollCharacterStats in item-rules.js).
function normalizeNpcProfile(raw,speaker){
  const text=(value,fallback,limit=240)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,limit)||fallback;
  const level=Math.min(Math.max(0,Math.round(Number(raw.level))||0),Math.max(maxWorldLevel(),1));
  const stats=rollCharacterStats(level);
  return {
    speaker,fullName:text(raw.fullName,speaker,60),courtesyName:text(raw.courtesyName,'Không có',40),
    identity:text(raw.identity,'Chưa rõ'),appearance:text(raw.appearance,'Chưa rõ',400),personality:text(raw.personality,'Chưa rõ',400),
    level,realm:npcRealmLabel(level),stats
  };
}
// Compact line per known NPC, fed back into story prompts so later turns stay consistent.
function npcProfilesContext(limit=10){
  const known=[...npcProfiles.values()].slice(-limit);
  if(!known.length)return 'HỒ SƠ NPC ĐÃ XÁC LẬP: chưa có.';
  return `HỒ SƠ NPC ĐÃ XÁC LẬP (giữ đúng, không mâu thuẫn): ${known.map(p=>`${p.speaker} = ${p.fullName}, tự ${p.courtesyName}; ${p.identity}; ${p.realm}${p.level?` cấp ${p.level}`:''}; tính cách: ${p.personality}; ${Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`${label} ${p.stats[key]}`).join(', ')}`).join(' | ')}`;
}

(() => {
  const modal=document.querySelector('#npc-modal'),body=document.querySelector('#npc-profile-body'),title=document.querySelector('#npc-profile-title');
  let shownSpeaker='';
  const close=()=>{modal.classList.remove('open');shownSpeaker=''};
  document.querySelector('#close-npc-modal').onclick=close;
  modal.addEventListener('click',event=>{if(event.target===modal)close()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&modal.classList.contains('open'))close()});

  function renderProfile(profile){
    title.textContent=profile.fullName;
    const row=(label,value)=>`<div><dt>${label}</dt><dd>${escapeHtml(String(value))}</dd></div>`;
    body.innerHTML=`<dl class="npc-profile">${row('Họ và tên',profile.fullName)}${row('Tự',profile.courtesyName)}${row('Thân phận',profile.identity)}${row('Ngoại hình',profile.appearance)}${row('Tính cách',profile.personality)}${row('Cảnh giới',profile.realm)}${row('Cấp độ',profile.level||'—')}</dl>`+
      `<div class="npc-stats">${Object.entries(CHARACTER_STAT_LABELS).map(([key,label])=>`<div><span>${label}</span><b>${profile.stats[key].toLocaleString('vi-VN')}</b></div>`).join('')}</div>`;
  }
  function renderMessage(message,retry=false){
    body.innerHTML=`<p class="modal-intro" role="status">${escapeHtml(message)}</p>${retry?'<button type="button" class="create-item" id="npc-retry">Thử lại</button>':''}`;
    document.querySelector('#npc-retry')?.addEventListener('click',()=>openNpcProfile(shownSpeaker));
  }
  async function openNpcProfile(speaker){
    shownSpeaker=speaker;modal.classList.add('open');title.textContent=speaker;
    if(npcProfiles.has(speaker))return renderProfile(npcProfiles.get(speaker));
    renderMessage('Ollama đang lập hồ sơ từ những gì truyện đã kể về nhân vật này… Nếu AI đang viết lượt truyện, yêu cầu sẽ chờ tới lượt.');
    try{
      if(typeof window.generateNpcProfile!=='function')throw new Error('Không tải được mô-đun AI. Hãy tải lại trang.');
      if(!pendingNpcProfiles.has(speaker))pendingNpcProfiles.set(speaker,window.generateNpcProfile(speaker).finally(()=>pendingNpcProfiles.delete(speaker)));
      const profile=normalizeNpcProfile(await pendingNpcProfiles.get(speaker),speaker);
      npcProfiles.set(speaker,profile);
      if(shownSpeaker===speaker)renderProfile(profile);
    }catch(error){
      if(shownSpeaker===speaker)renderMessage(`Chưa lập được hồ sơ: ${error.message||'Ollama không phản hồi.'}`,true);
    }
  }
  document.querySelector('#story').addEventListener('click',event=>{
    const avatar=event.target.closest('.story-entry.npc .avatar');
    const speaker=avatar?.closest('.story-entry').querySelector('.speaker')?.firstChild?.textContent.trim();
    if(speaker)openNpcProfile(speaker);
  });
})();
