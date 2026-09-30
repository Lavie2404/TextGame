// Schools are categories; each manual has its own name and a school key at [5].
const demonicSchools = {
  blood: {label:'Huyết công',names:['Dẫn Huyết Quyết','Huyết Nguyên Kinh','Huyết Hải Tâm Kinh','Huyền Huyết Đại Pháp','Thiên Huyết Ma Kinh','Vạn Huyết Ma Điển'],materials:['animalBlood','humanBlood'],condition:rank=>`Mỗi lượt cần ${rank} phần máu người hoặc động vật.`,pay:rank=>consumeCultivationBlood(rank)},
  necromancy: {label:'Tử Linh thuật',names:['Dẫn Thi Quyết','U Minh Dịch Linh Kinh','Bạch Cốt Khế Thư','Vong Xuyên Ngự Linh Lục','Cửu U Dịch Hồn Kinh','Vạn Linh Quy Táng Điển'],materials:['animalCorpse','humanCorpse'],condition:rank=>`Cần ít nhất một nô bộc tử linh; dùng thi thể người hoặc động vật để tạo nô bộc. Điều khiển tối đa ${rank*2} nô bộc.`,pay:()=>servants.length>0},
  poison: {label:'Độc công',names:['Thực Độc Quyết','Bích Chướng Tâm Kinh','Ngũ Độc Quy Nguyên','U La Độc Kinh','Thiên Chu Tâm Pháp','Vạn Độc Quy Tông'],materials:['poison'],condition:rank=>`Mỗi lượt hấp thu ${rank} phần độc thảo; thiếu độc thảo không thể tu luyện.`,pay:rank=>consumeMaterial('poison',rank)},
  curse: {label:'Chú oán',names:['Kết Oán Quyết','Hắc Ấn Chú Kinh','U Oán Tỏa Tâm','Cửu Kết Chú Thư','Thiên Oán Linh Văn','Vạn Kiếp Chú Điển'],materials:['talisman'],condition:rank=>`Mỗi lượt cần ${rank} lá oán phù làm vật dẫn.`,pay:rank=>consumeMaterial('talisman',rank)},
  shadow: {label:'Ảnh tu',names:['Ẩn Ảnh Quyết','Vô Đăng Tâm Kinh','Tàng Nguyệt Ảnh Lục','Hắc Dạ Quy Nguyên','Thiên Ảnh Vô Hình','Vĩnh Dạ Tâm Điển'],materials:[],condition:()=> 'Phải nhập thất trong bóng tối: mỗi lượt nhập thất không dùng bạo phát; cần bật chế độ nhập thất.',pay:()=>shadowRetreat&&!pendingBurst}
};
// Demonic materials: key -> [label, shop price, unit]. Blood and corpses have no price: they are never sold and
// only come from loot (see loot.js); the shop's Vật phẩm tab sells the priced ones.
const materialOffers={
  animalBlood:['Máu động vật',null,'phần'],humanBlood:['Máu người',null,'phần'],
  animalCorpse:['Thi thể động vật',null,'thi thể'],humanCorpse:['Thi thể người',null,'thi thể'],
  poison:['Độc thảo',5,'phần'],talisman:['Oán phù',5,'lá']
};
function materialSold(key){return materialOffers[key][1]!==null}
function materialSourceText(key){return materialSold(key)?'mua ở tab Vật phẩm của Cửa hàng hoặc nhận từ chiến lợi phẩm':'chỉ thu được từ chiến lợi phẩm khi hạ quái vật hoặc kẻ địch, không bán ở Cửa hàng'}
const occultMaterials=Object.fromEntries(Object.keys(materialOffers).map(key=>[key,0]));
let servants=[],nextServantId=1,shadowRetreat=false;
function resetDemonicState(){Object.keys(occultMaterials).forEach(key=>occultMaterials[key]=0);servants=[];nextServantId=1;shadowRetreat=false}
function demonicSchool(item){return demonicSchools[item[5]||'blood']}
function activeDemonic(){return skills.find(item=>item[3]!==false&&item[4]==='demonic')}
function consumeMaterial(key,amount){if((occultMaterials[key]||0)<amount)return false;occultMaterials[key]-=amount;return true}
// Blood cultivation spends animal blood first, then human blood.
function consumeCultivationBlood(amount){
  if(occultMaterials.animalBlood+occultMaterials.humanBlood<amount)return false;
  const animal=Math.min(occultMaterials.animalBlood,amount);
  occultMaterials.animalBlood-=animal;occultMaterials.humanBlood-=amount-animal;
  return true;
}
function materialSchoolLabel(key){return Object.values(demonicSchools).filter(school=>school.materials.includes(key)).map(school=>school.label).join(', ')}
function materialDescription(key){return `Nguyên liệu ma đạo · dùng cho ${materialSchoolLabel(key)}; hệ thống tự tiêu hao khi tu luyện`}
function activeNecromancy(){const art=activeDemonic();return art?.[5]==='necromancy'?art:undefined}
function raiseServant(source){
  const art=activeNecromancy();
  if(!art)return 'Hãy bật một tâm pháp Tử Linh thuật trước.';
  if(!['animalCorpse','humanCorpse'].includes(source))return 'Thi thể không hợp lệ.';
  if(servants.length>=itemRank(art)*2)return 'Đã đạt giới hạn điều khiển nô bộc của tâm pháp.';
  if(!consumeMaterial(source,1))return 'Không có thi thể tương ứng.';
  servants.push({id:nextServantId,name:`U Ảnh ${nextServantId++}`,source,job:'rest'});
  return 'Đã tạo nô bộc tử linh. Chọn công việc để sai khiến.';
}
function controlledServants(){const art=activeNecromancy();return art?servants.slice(0,itemRank(art)*2):[]}
function performServantWork(){
  let coins=0,herbs=0;
  controlledServants().forEach(servant=>{if(servant.job==='work')coins+=5;if(servant.job==='gather')herbs++});
  inventoryCoins+=coins;occultMaterials.poison+=herbs;
  return coins||herbs?` Nô bộc mang về ${coins} đồng, ${herbs} phần độc thảo.`:'';
}
const servantJobLabel={rest:'chờ lệnh',work:'làm việc kiếm tiền',gather:'hái độc thảo'};
function occultContext(){
  const art=activeDemonic();
  if(!art)return 'MA ĐẠO: không tu tâm pháp ma đạo; nguyên liệu ma đạo đang có chỉ là vật phẩm trong túi.';
  const school=demonicSchool(art),parts=[`MA ĐẠO: đang tu ${art[0]} (${school.label}).`];
  if(school.materials.length)parts.push(`Nguyên liệu: ${school.materials.map(key=>`${materialOffers[key][0]} ${occultMaterials[key]}`).join(', ')}.`);
  if(art[5]==='shadow')parts.push(`Nhập thất bóng tối: ${shadowRetreat?'bật, không tham gia hành động ngoài thất':'tắt'}.`);
  if(art[5]==='necromancy')parts.push(`Nô bộc đang điều khiển: ${controlledServants().map(s=>`${s.name} (${s.source==='humanCorpse'?'thi thể người':'thi thể động vật'}, ${servantJobLabel[s.job]})`).join('; ')||'không có'}. Nô bộc vượt giới hạn điều khiển thì ngừng làm việc.`);
  parts.push('Không tự tạo nguyên liệu hoặc nô bộc ngoài số liệu này.');
  return parts.join(' ');
}
// The Ma đạo panel appears only while a demonic tâm pháp is active, and shows just that school's controls.
function renderDemonicPanel(){
  const section=document.querySelector('#demonic-section'),panel=document.querySelector('#demonic-panel');if(!section||!panel)return;
  const art=activeDemonic();
  section.hidden=!art;
  if(!art){panel.innerHTML='';return}
  const school=demonicSchool(art),count=key=>`${materialOffers[key][0]}: ${occultMaterials[key]} ${materialOffers[key][2]}`;
  let html=`<p class="inventory-empty"><b>${escapeHtml(art[0])}</b> · ${school.label}. ${school.condition(itemRank(art))}</p>`;
  if(school.materials.length)html+=`<p class="inventory-empty">${school.materials.map(count).join(' · ')}. Nguồn: ${materialSourceText(school.materials[0])}.</p>`;
  if(art[5]==='shadow')html+=`<label><input type="checkbox" id="shadow-retreat" ${shadowRetreat?'checked':''}> Nhập thất bóng tối (không dùng bạo phát)</label>`;
  if(art[5]==='necromancy'){
    const activeIds=new Set(controlledServants().map(s=>s.id));
    html+=`<p class="inventory-empty">Mỗi lượt, nô bộc làm việc mang về 5 đồng hoặc hái 1 phần độc thảo. Đang điều khiển ${activeIds.size}/${itemRank(art)*2}.</p><button type="button" data-raise="animalCorpse" ${occultMaterials.animalCorpse?'':'disabled'}>Tạo nô bộc từ thi thể động vật</button><button type="button" data-raise="humanCorpse" ${occultMaterials.humanCorpse?'':'disabled'}>Tạo nô bộc từ thi thể người</button>`+
      servants.map(s=>`<label>${s.name} · ${s.source==='humanCorpse'?'Người':'Động vật'} · ${activeIds.has(s.id)?'Đang điều khiển':'Ngừng hoạt động'}<select data-servant-job="${s.id}"><option value="rest" ${s.job==='rest'?'selected':''}>Chờ lệnh</option><option value="work" ${s.job==='work'?'selected':''}>Làm việc kiếm tiền</option><option value="gather" ${s.job==='gather'?'selected':''}>Hái độc thảo</option></select></label>`).join('');
  }
  panel.innerHTML=html;
}
