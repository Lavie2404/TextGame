const itemKinds = {
  weapon: ['Trang bị','Vũ khí','Công kích'], clothing: ['Trang bị','Y phục','Phòng ngự'],
  shoes: ['Trang bị','Giày','Tốc độ'], accessory: ['Trang bị','Phụ kiện','Khí vận'], mount: ['Trang bị','Tọa kỵ','Toàn bộ chỉ số'],
  attack: ['Kỹ năng','Công pháp tấn công','Công kích'], defense: ['Kỹ năng','Công pháp phòng thủ','Phòng ngự'],
  speed: ['Kỹ năng','Công pháp tăng tốc độ','Tốc độ'],
  burstAttack: ['Kỹ năng','Bạo phát tăng công','Công kích'], burstDefense: ['Kỹ năng','Bạo phát tăng thủ','Phòng ngự'],
  burstSpeed: ['Kỹ năng','Bạo phát tăng tốc độ','Tốc độ'], escape: ['Kỹ năng','Bạo phát trốn chạy','Trốn chạy'],
  righteous: ['Kỹ năng','Tâm pháp chính đạo','Tu vi'], demonic: ['Kỹ năng','Tâm pháp ma đạo','Tu vi']
};
const namedItems = {
  weapon:['Thanh Phong Kiếm','Xích Diễm Đao','Hàn Nguyệt Thương','Lôi Đình Kích','Thiên Quang Kiếm','Vạn Tượng Kiếm'],
  clothing:['Hộ Tâm Giáp','Thanh Vân Bào','Hàn Sương Giáp','Huyền Lôi Bào','Thiên Hà Y','Vô Cực Tiên Y'],
  shoes:['Khinh Vân Ngoa','Truy Phong Ngoa','Lưu Ảnh Ngoa','Đạp Lôi Ngoa','Ngự Thiên Ngoa','Vượt Hư Ngoa'],
  accessory:['Thanh Ngọc Bội','Phúc Vân Giới','Tinh Huy Châu','Cát Tường Ấn','Thiên Cơ Bội','Vạn Phúc Linh Châu'],
  mount:['Ô Vân Mã','Xích Phong Câu','Ngân Dực Lang','Lôi Vân Hổ','Thiên Thanh Loan','Cửu Tiêu Long'],
  attack:['Phá Thạch Quyền','Liệt Phong Kiếm Quyết','Xích Viêm Chưởng','Lôi Đình Quyết','Thiên Quang Kiếm Kinh','Vạn Tượng Quyền Kinh'],
  defense:['Thiết Bích Công','Kim Chung Quyết','Huyền Giáp Công','Bất Động Sơn Kinh','Thiên Cương Hộ Thể','Vô Cực Kim Thân'],
  speed:['Ngự Phong Quyết','Lưu Vân Bộ','Ảnh Độn Quyết','Đạp Lôi Bộ','Thiên Hành Quyết','Hư Không Du'],
  burstAttack:['Phá Giới Quyền','Xích Tâm Quyết','Nộ Hải Chưởng','Lôi Nộ Quyết','Thiên Hỏa Tế','Phá Thiên Cấm Quyết'],
  burstDefense:['Nhiên Khí Hộ Thể','Tỏa Sơn Quyết','Ngưng Mạch Giáp','Huyền Sơn Cấm','Thiên Môn Bích','Vạn Kiếp Hộ Thân'],
  burstSpeed:['Tật Ảnh Quyết','Nhiên Phong Bộ','Xé Gió Quyết','Lôi Quang Thiểm','Thiên Ảnh Thiểm','Sát Na Vô Tung'],
  escape:['Thoát Ảnh Thuật','Ẩn Phong Độn','Vụ Ảnh Độn','Lôi Quang Độn','Thiên Ngoại Độn','Hư Không Ly'],
  righteous:['Tụ Khí Thuật','Thanh Tâm Kinh','Ngọc Thanh Quyết','Thái Hòa Kinh','Thiên Địa Dưỡng Tâm','Vô Cực Thanh Tâm'],
  demonic:['Nhiên Linh Quyết','Thực Linh Kinh','U Minh Tâm Kinh','Huyền Âm Đại Pháp','Thiên Ma Tâm Kinh','Vạn Kiếp Ma Điển']
};
function itemRank(item){return (rarity[item[1]]??0)+1}
function itemDescription(item){
  const kind=item[4],rank=itemRank(item),label=itemKinds[kind];
  if(!label)return '';
  let effect=`+${rank*10} ${label[2]}`;
  if(kind==='mount')effect=`+${rank*5}% toàn bộ chỉ số chiến đấu`;
  if(['attack','defense','speed'].includes(kind))effect=`+${rank*5}% ${label[2]} khi bật`;
  if(kind.startsWith('burst'))effect=`+${50+rank*10}% ${label[2]} cho lượt AI kế tiếp; tốn 30 linh lực khi kích hoạt; tắt sẽ mất hiệu lực, không hoàn phí`;
  if(kind==='escape')effect=`+${50+rank*10}% tốc độ cho lượt trốn chạy kế tiếp; tốn 30 linh lực; tắt mất hiệu lực, không hoàn phí; không bảo đảm thoát`;
  if(kind==='righteous')effect=`+${rank*20}% tu vi nhận được`;
  if(kind==='demonic')effect=`+${rank*40}% tu vi khi còn ít nhất 10 linh lực; tốn 10 linh lực mỗi lượt thành công, thiếu thì không tăng`;
  return `${label[1]} · ${effect}`;
}
function itemSlot(kind){return ['righteous','demonic'].includes(kind)?'mind':kind}
function exclusiveEquip(list,item){
  list.forEach(other=>{if(other!==item&&itemSlot(other[4])===itemSlot(item[4])){
    other[3]=false;
    if(pendingBurst?.name===other[0])pendingBurst=null;
  }});
  item[3]=true;
}
let baseStats={attack:100,defense:80,speed:50,luck:25,spirit:240};
let pendingBurst=null;
function effectiveStats(){
  const stats={...baseStats};let mountPercent=0;
  const statFor={weapon:'attack',clothing:'defense',shoes:'speed',accessory:'luck'};
  equipment.filter(i=>i[3]!==false).forEach(i=>{if(statFor[i[4]])stats[statFor[i[4]]]+=itemRank(i)*10;if(i[4]==='mount')mountPercent+=itemRank(i)*5});
  skills.filter(i=>i[3]!==false).forEach(i=>{if(['attack','defense','speed'].includes(i[4]))stats[i[4]]*=1+itemRank(i)*.05});
  if(pendingBurst){const key={burstAttack:'attack',burstDefense:'defense',burstSpeed:'speed',escape:'speed'}[pendingBurst.kind];stats[key]*=1+pendingBurst.percent/100}
  for(const key of Object.keys(stats))stats[key]=Math.floor(stats[key]*(1+mountPercent/100));
  return stats;
}
function renderCharacterStats(){
  const stats=effectiveStats();
  Object.entries(stats).forEach(([key,value])=>{const el=document.getElementById(key);if(el)el.textContent=value});
}
function completeProgressionTurn(){
  const mind=skills.find(i=>i[3]!==false&&['righteous','demonic'].includes(i[4]));
  let multiplier=1;
  if(mind?.[4]==='righteous')multiplier+=itemRank(mind)*.2;
  if(mind?.[4]==='demonic'&&baseStats.spirit>=10){baseStats.spirit-=10;multiplier+=itemRank(mind)*.4}
  const gain=Math.floor(20*multiplier);
  let xp=Number(document.querySelector('#custom-xp').value)||0;
  let level=Number(document.querySelector('#player-realm').textContent.match(/Cấp\s+(\d+)/)?.[1])||1;
  xp+=gain;
  while(xp>=1000&&getRealmForLevel(level+1)){xp-=1000;level++}
  xp=Math.min(xp,1000);
  document.querySelector('#custom-xp').value=xp;document.querySelector('#custom-level').value=level;
  document.querySelector('#xp-label').textContent=`${xp} / 1000`;document.querySelector('#xp-fill').style.width=`${xp/10}%`;
  const realm=getRealmForLevel(level);document.querySelector('#player-realm').textContent=`${realm||'Chưa có cảnh giới'} · Cấp ${level}`;renderRealmPanels(realm,level);
  pendingBurst=null;renderItems();
  document.querySelector('#bag-status').textContent=`Lượt hoàn tất: nhận ${gain} tu vi. Linh lực gốc còn ${baseStats.spirit}.`;
}
