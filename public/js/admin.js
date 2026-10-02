const $=id=>document.getElementById(id);
const S={stickers:[]};

document.addEventListener("DOMContentLoaded",()=>{
  bind();
  checkSession();
});

function bind(){
  $("loginBtn").onclick=login;
  $("password").onkeydown=e=>{if(e.key==="Enter")login()};
  $("logoutBtn").onclick=logout;

  $("uploadStickerBtn").onclick=uploadSticker;
  $("refreshStickerBtn").onclick=loadStickers;
  $("stickerFile").onchange=previewNewSticker;

  $("saveRulesBtn").onclick=saveRules;
  $("resetRulesBtn").onclick=()=>{
    fillRules(defaultRules());
    updateRuleSummary();
  };

  ["damageNormalMax","damageReplaceMin","shapeSimilarityMin","colorDifferenceMax","useDamage","useShape","useColor"]
    .forEach(id=>$(id).addEventListener("input",updateRuleSummary));

  $("searchBtn").onclick=loadInspections;

  document.querySelectorAll("[data-view]").forEach(b=>{
    b.onclick=()=>switchView(b.dataset.view);
  });

  $("closeEditBtn").onclick=closeEdit;
  $("cancelEditBtn").onclick=closeEdit;
  document.querySelector("[data-close-edit]").onclick=closeEdit;
  $("editStickerFile").onchange=previewEditFile;
  $("saveEditBtn").onclick=saveStickerEdit;

  $("closeImageBtn").onclick=closeImage;
  document.querySelector("[data-close-image]").onclick=closeImage;

  window.addEventListener("keydown",e=>{
    if(e.key==="Escape"){
      closeImage();
      closeEdit();
    }
  });
}

async function checkSession(){
  try{
    const r=await fetchTimeout("/api/admin/me",{},12000);
    r.ok?showAdmin():showLogin();
  }catch{
    showLogin();
  }
}

function showLogin(){
  $("loginPanel").classList.remove("hidden");
  $("adminPanel").classList.add("hidden");
}

function showAdmin(){
  $("loginPanel").classList.add("hidden");
  $("adminPanel").classList.remove("hidden");
  switchView("stickers");
}

async function login(){
  try{
    const r=await fetchTimeout("/api/admin/login",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({password:$("password").value})
    },15000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"로그인 실패");

    $("password").value="";
    showAdmin();
  }catch(e){
    msg("loginMessage",e.message,"error");
  }
}

async function logout(){
  try{await fetchTimeout("/api/admin/logout",{method:"POST"},10000)}catch{}
  showLogin();
}

function switchView(v){
  $("stickersView").classList.toggle("hidden",v!=="stickers");
  $("rulesView").classList.toggle("hidden",v!=="rules");
  $("resultsView").classList.toggle("hidden",v!=="results");

  document.querySelectorAll("[data-view]").forEach(b=>{
    b.classList.toggle("primary",b.dataset.view===v);
  });

  if(v==="stickers")loadStickers();
  if(v==="rules")loadRules();
  if(v==="results")loadInspections();
}

async function previewNewSticker(){
  const file=$("stickerFile").files[0];

  if(!file){
    $("stickerPreview").classList.add("hidden");
    return;
  }

  try{
    const blob=await compressImage(file,1600,.9);
    const url=URL.createObjectURL(blob);

    $("stickerPreview").innerHTML=`<img src="${url}" alt="미리보기">`;
    $("stickerPreview").classList.remove("hidden");
  }catch{
    $("stickerPreview").classList.add("hidden");
  }
}

async function uploadSticker(){
  const name=$("stickerName").value.trim();
  const file=$("stickerFile").files[0];

  if(!name||!file){
    msg("uploadStickerMessage","스티커명과 이미지를 입력해 주세요.","error");
    return;
  }

  $("uploadStickerBtn").disabled=true;
  msg("uploadStickerMessage","이미지를 최적화하고 등록 중입니다...","info");

  try{
    const optimized=await compressImage(file,1600,.9);

    const fd=new FormData();
    fd.append("name",name);
    fd.append("side_hint",$("sideHint").value);
    fd.append("guide_text",$("guideTextInput").value.trim());
    fd.append("file",optimized,"sticker-reference.jpg");

    const r=await fetchTimeout("/api/admin/stickers",{
      method:"POST",
      body:fd
    },30000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"등록 실패");

    $("stickerName").value="";
    $("stickerFile").value="";
    $("stickerPreview").innerHTML="";
    $("stickerPreview").classList.add("hidden");

    msg("uploadStickerMessage","등록 완료.","success");
    await loadStickers();
  }catch(e){
    msg("uploadStickerMessage",e.message,"error");
  }finally{
    $("uploadStickerBtn").disabled=false;
  }
}

async function loadStickers(){
  $("stickerList").innerHTML='<div class="empty">불러오는 중...</div>';

  try{
    const r=await fetchTimeout("/api/admin/stickers",{cache:"no-store"},15000);
    const d=await r.json();

    if(r.status===401)return showLogin();
    if(!r.ok)throw new Error(d.error||"조회 실패");

    S.stickers=d.items||[];

    $("stickerList").innerHTML=S.stickers.length
      ? S.stickers.map(x=>`
        <div class="sticker-row">
          <img src="/api/sticker/${x.id}/image?v=${Date.now()}" alt="">
          <div>
            <strong>${esc(x.name)}</strong>
            <div class="muted" style="font-size:12px;margin-top:4px">
              ${sideLabel(x.side_hint)} · v${x.version} · 사용 ${Number(x.usage_count||0)}건
            </div>
            <div style="margin-top:5px">
              ${Number(x.is_active)===1?'<span class="pill active">활성</span>':''}
              ${Number(x.version_count)>1?`<span class="pill">버전 ${x.version_count}개</span>`:''}
            </div>
          </div>
          <div class="row-actions">
            <button class="btn small secondary" onclick="openEdit(${x.id})">수정</button>
            <button class="btn small" onclick="activateSticker(${x.id})" ${Number(x.is_active)===1?"disabled":""}>활성화</button>
            <button class="btn small danger" onclick="deleteSticker(${x.id})">삭제</button>
          </div>
        </div>
      `).join("")
      : '<div class="empty">등록된 스티커가 없습니다.</div>';

  }catch(e){
    $("stickerList").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

window.activateSticker=async id=>{
  try{
    const r=await fetchTimeout(`/api/admin/stickers/${id}/activate`,{method:"POST"},12000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"활성화 실패");

    loadStickers();
  }catch(e){
    alert(e.message);
  }
};

window.deleteSticker=async id=>{
  if(!confirm("이 스티커 기준을 삭제할까요? 점검결과와 연결된 버전은 삭제되지 않습니다."))return;

  try{
    const r=await fetchTimeout(`/api/admin/stickers/${id}`,{method:"DELETE"},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"삭제 실패");

    loadStickers();
  }catch(e){
    alert(e.message);
  }
};

window.openEdit=function(id){
  const item=S.stickers.find(x=>Number(x.id)===Number(id));
  if(!item)return;

  $("editStickerId").value=item.id;
  $("editStickerName").value=item.name||"";
  $("editSideHint").value=item.side_hint||"both";
  $("editGuideText").value=item.guide_text||"";
  $("editStickerFile").value="";

  $("editCurrentPreview").innerHTML=`<img src="/api/sticker/${item.id}/image?v=${Date.now()}" alt="현재 이미지">`;
  $("editNewPreview").innerHTML="";
  $("editNewPreview").classList.add("hidden");

  msg("editMessage","이미지를 변경하지 않으면 이름·가이드만 수정됩니다.","info");

  $("editModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
};

function closeEdit(){
  if(!$("editModal"))return;
  $("editModal").classList.add("hidden");
  document.body.classList.remove("modal-open");
}

async function previewEditFile(){
  const file=$("editStickerFile").files[0];

  if(!file){
    $("editNewPreview").innerHTML="";
    $("editNewPreview").classList.add("hidden");
    return;
  }

  try{
    const blob=await compressImage(file,1600,.9);
    const url=URL.createObjectURL(blob);

    $("editNewPreview").innerHTML=`<img src="${url}" alt="새 이미지">`;
    $("editNewPreview").classList.remove("hidden");
  }catch(e){
    msg("editMessage","새 이미지를 읽지 못했습니다.","error");
  }
}

async function saveStickerEdit(){
  const id=Number($("editStickerId").value);
  const name=$("editStickerName").value.trim();

  if(!id||!name){
    msg("editMessage","스티커명을 입력해 주세요.","error");
    return;
  }

  $("saveEditBtn").disabled=true;
  msg("editMessage","수정내용을 저장 중입니다...","info");

  try{
    const fd=new FormData();
    fd.append("name",name);
    fd.append("side_hint",$("editSideHint").value);
    fd.append("guide_text",$("editGuideText").value.trim());

    const file=$("editStickerFile").files[0];

    if(file){
      const optimized=await compressImage(file,1600,.9);
      fd.append("file",optimized,"sticker-edit.jpg");
    }

    const r=await fetchTimeout(`/api/admin/stickers/${id}`,{
      method:"PATCH",
      body:fd
    },30000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"수정 실패");

    msg("editMessage",d.message||"수정 완료","success");
    await loadStickers();

    setTimeout(closeEdit,600);
  }catch(e){
    msg("editMessage",e.message,"error");
  }finally{
    $("saveEditBtn").disabled=false;
  }
}

function defaultRules(){
  return{
    damage_normal_max:10,
    damage_replace_min:30,
    shape_similarity_min:70,
    color_difference_max:35,
    use_damage:1,
    use_shape:1,
    use_color:1
  };
}

function fillRules(r){
  $("damageNormalMax").value=Number(r.damage_normal_max??10);
  $("damageReplaceMin").value=Number(r.damage_replace_min??30);
  $("shapeSimilarityMin").value=Number(r.shape_similarity_min??70);
  $("colorDifferenceMax").value=Number(r.color_difference_max??35);

  $("useDamage").checked=Number(r.use_damage??1)===1;
  $("useShape").checked=Number(r.use_shape??1)===1;
  $("useColor").checked=Number(r.use_color??1)===1;
}

function collectRules(){
  return{
    damage_normal_max:Number($("damageNormalMax").value),
    damage_replace_min:Number($("damageReplaceMin").value),
    shape_similarity_min:Number($("shapeSimilarityMin").value),
    color_difference_max:Number($("colorDifferenceMax").value),
    use_damage:$("useDamage").checked,
    use_shape:$("useShape").checked,
    use_color:$("useColor").checked
  };
}

function updateRuleSummary(){
  const r=collectRules();
  const parts=[];

  if(r.use_damage){
    parts.push(`손상률 ${r.damage_normal_max}% 이하 정상 / ${r.damage_replace_min}% 이상 교체권고`);
  }

  if(r.use_shape){
    parts.push(`형상 유사도 ${r.shape_similarity_min}% 미만 확인필요`);
  }

  if(r.use_color){
    parts.push(`색상차이 ${r.color_difference_max} 초과 확인필요`);
  }

  $("ruleSummary").innerHTML=parts.length
    ? parts.map(x=>`<div>• ${esc(x)}</div>`).join("")
    : "자동판정 항목이 모두 꺼져 있습니다.";
}

async function loadRules(){
  msg("rulesMessage","판정기준을 불러오는 중입니다.","info");

  try{
    const r=await fetchTimeout("/api/admin/rules",{cache:"no-store"},12000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"조회 실패");

    fillRules(d.rules||defaultRules());
    updateRuleSummary();

    $("rulesUpdatedAt").textContent=d.rules?.updated_at
      ? `최근 저장 ${d.rules.updated_at}`
      : "기본값";

    msg("rulesMessage","저장된 판정기준을 불러왔습니다.","success");
  }catch(e){
    fillRules(defaultRules());
    updateRuleSummary();
    msg("rulesMessage",e.message,"error");
  }
}

async function saveRules(){
  const rules=collectRules();

  if(![
    rules.damage_normal_max,
    rules.damage_replace_min,
    rules.shape_similarity_min,
    rules.color_difference_max
  ].every(Number.isFinite)){
    msg("rulesMessage","모든 숫자를 입력해 주세요.","error");
    return;
  }

  if(rules.damage_replace_min<=rules.damage_normal_max){
    msg("rulesMessage","교체권고 손상률은 정상 허용 손상률보다 크게 설정해 주세요.","error");
    return;
  }

  $("saveRulesBtn").disabled=true;
  msg("rulesMessage","저장 중입니다...","info");

  try{
    const r=await fetchTimeout("/api/admin/rules",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(rules)
    },12000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"저장 실패");

    fillRules(d.rules);
    updateRuleSummary();

    $("rulesUpdatedAt").textContent=d.rules?.updated_at
      ? `최근 저장 ${d.rules.updated_at}`
      : "저장완료";

    msg("rulesMessage","저장 완료. 신규 점검부터 적용됩니다.","success");
  }catch(e){
    msg("rulesMessage",e.message,"error");
  }finally{
    $("saveRulesBtn").disabled=false;
  }
}

async function loadInspections(){
  $("inspectionList").innerHTML='<div class="empty">불러오는 중...</div>';

  const q=new URLSearchParams();

  if($("resultSearch").value.trim())q.set("q",$("resultSearch").value.trim());
  if($("statusFilter").value)q.set("status",$("statusFilter").value);
  if($("stateFilter").value)q.set("admin_state",$("stateFilter").value);

  try{
    const r=await fetchTimeout(`/api/admin/inspections?${q}`,{cache:"no-store"},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"조회 실패");

    const items=d.items||[];

    $("countAll").textContent=items.length;
    $("countNormal").textContent=items.filter(x=>x.status==="정상").length;
    $("countReview").textContent=items.filter(x=>x.status==="확인필요").length;
    $("countAction").textContent=items.filter(x=>x.admin_state==="개선요청").length;

    $("inspectionList").innerHTML=items.length
      ? items.map(x=>{
          let findings=[];
          try{findings=JSON.parse(x.findings_json||"[]")}catch{}

          let metrics={};
          try{metrics=JSON.parse(x.metrics_json||"{}")}catch{}

          return`
            <div class="inspection-row">
              <div class="inspection-main">
                <img
                  src="/api/admin/inspections/${x.id}/image"
                  alt="점검사진"
                  onclick="openImage('/api/admin/inspections/${x.id}/image')"
                >
                <div class="inspection-meta">
                  <strong>${esc(x.vehicle_no)} · ${esc(x.employee_name)}</strong>
                  <span>${esc(x.department||"-")} · ${esc(x.sticker_name||"-")} v${esc(x.sticker_version||"-")}</span>
                  <span>점수 ${Number(x.score).toFixed(1)} · <b>${esc(x.status)}</b></span>
                  <span>추정 손상률 ${Number(metrics.damage??0).toFixed(1)}% · 형상 ${Number(metrics.shape??0).toFixed(1)}%</span>
                  <span>${esc(findings.join(" / "))}</span>
                  <span class="muted">${esc(x.created_at)}</span>
                </div>
              </div>

              <div class="detail-actions">
                <select id="state-${x.id}">
                  ${["미확인","확인완료","개선요청","조치완료"].map(v=>`
                    <option ${x.admin_state===v?"selected":""}>${v}</option>
                  `).join("")}
                </select>

                <textarea id="note-${x.id}" placeholder="관리자 메모">${esc(x.admin_note||"")}</textarea>
                <button class="btn small primary" onclick="saveInspection(${x.id})">저장</button>
              </div>
            </div>
          `;
        }).join("")
      : '<div class="empty">점검결과가 없습니다.</div>';

  }catch(e){
    $("inspectionList").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

window.saveInspection=async id=>{
  try{
    const r=await fetchTimeout(`/api/admin/inspections/${id}`,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        admin_state:$(`state-${id}`).value,
        admin_note:$(`note-${id}`).value
      })
    },12000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"저장 실패");

    loadInspections();
  }catch(e){
    alert(e.message);
  }
};

window.openImage=function(src){
  $("imageModalImg").src=src;
  $("imageModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
};

function closeImage(){
  if(!$("imageModal"))return;
  $("imageModal").classList.add("hidden");
  $("imageModalImg").src="";
  document.body.classList.remove("modal-open");
}

async function compressImage(file,maxSide,quality){
  const img=await blobImage(file);
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));

  const c=document.createElement("canvas");
  c.width=Math.round(img.naturalWidth*scale);
  c.height=Math.round(img.naturalHeight*scale);

  c.getContext("2d").drawImage(img,0,0,c.width,c.height);

  return new Promise((resolve,reject)=>{
    c.toBlob(
      b=>b?resolve(b):reject(new Error("이미지 변환 실패")),
      "image/jpeg",
      quality
    );
  });
}

function blobImage(blob){
  return new Promise((resolve,reject)=>{
    const u=URL.createObjectURL(blob);
    const img=new Image();

    img.onload=()=>{
      URL.revokeObjectURL(u);
      resolve(img);
    };

    img.onerror=()=>{
      URL.revokeObjectURL(u);
      reject(new Error("이미지를 읽지 못했습니다."));
    };

    img.src=u;
  });
}

function fetchTimeout(url,opts={},ms=20000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),ms);

  return fetch(url,{...opts,signal:controller.signal})
    .catch(e=>{
      if(e.name==="AbortError")throw new Error("서버 응답시간을 초과했습니다.");
      throw e;
    })
    .finally(()=>clearTimeout(timer));
}

function sideLabel(v){
  return({
    both:"좌·우 측면 공통",
    driver:"운전석 측면",
    passenger:"조수석 측면",
    rear:"후면",
    front:"전면"
  })[v]||v;
}

function msg(id,t,c){
  $(id).textContent=t;
  $(id).className=`message ${c}`;
}

function esc(v){
  return String(v??"").replace(/[&<>"']/g,c=>({
    "&":"&amp;",
    "<":"&lt;",
    ">":"&gt;",
    '"':"&quot;",
    "'":"&#039;"
  }[c]));
}
