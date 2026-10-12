const $=id=>document.getElementById(id);
const S={
  stickers:[],
  examples:[],
  exampleStickerId:null,
  roiExampleId:null,
  roiDrawing:false,
  roiStart:null,
  roiDraft:null,
  roiMode:"sticker",
  roiSticker:null,
  roiPlate:null,
  roiLogo:null,
  inspectionItems:[],
  selectedInspectionIds:new Set()
};

document.addEventListener("DOMContentLoaded",()=>{
  enableSimpleInspectionAdminUi();
  bind();
  checkSession();
});

function enableSimpleInspectionAdminUi(){
  const bar=document.querySelector(".roi-mode-bar");
  const stage=$("exampleRoiStage");

  if(bar && !$("exampleLogoModeBtn")){
    const btn=document.createElement("button");
    btn.id="exampleLogoModeBtn";
    btn.className="btn";
    btn.type="button";
    btn.textContent="③ 후면 차량로고";
    bar.appendChild(btn);
  }

  if(stage && !$("exampleLogoRoiBox")){
    const box=document.createElement("div");
    box.id="exampleLogoRoiBox";
    box.className="selection-box plate-calibration-box hidden";
    stage.insertBefore(box,$("exampleRoiDraftBox"));
  }

  const help=document.querySelector("#exampleRoiModal .help");
  if(help){
    help.textContent=
      "스티커 영역은 실제 스티커보다 사방 10~20% 정도 여유 있게 잡아 주세요. "+
      "후면 예시는 차량 제조사 로고(KIA/현대 등)도 별도로 지정해 주세요. "+
      "번호판은 차량번호 확인용이며 스티커 판정기준에는 사용하지 않습니다.";
  }
}

function bind(){
  $("loginBtn").onclick=login;
  $("password").onkeydown=e=>{if(e.key==="Enter")login()};
  $("logoutBtn").onclick=logout;

  $("uploadStickerBtn").onclick=uploadSticker;
  $("refreshStickerBtn").onclick=loadStickers;
  $("stickerFile").onchange=previewNewSticker;
  $("exampleFiles").onchange=updateExampleFileInfo;

  $("closeExamplesBtn").onclick=closeExamples;
  document.querySelector("[data-close-examples]").onclick=closeExamples;
  $("addExamplesBtn").onclick=addExamples;

  $("closeExampleRoiBtn").onclick=closeExampleRoi;
  $("exampleStickerModeBtn").onclick=()=>setExampleRoiMode("sticker");
  $("examplePlateModeBtn").onclick=()=>setExampleRoiMode("plate");
  if($("exampleLogoModeBtn"))$("exampleLogoModeBtn").onclick=()=>setExampleRoiMode("logo");
  $("resetExampleRoiBtn").onclick=resetExampleRoi;
  $("saveExampleRoiBtn").onclick=saveExampleRoi;
  $("exampleRoiStage").addEventListener("pointerdown",startExampleRoi);
  $("exampleRoiStage").addEventListener("pointermove",moveExampleRoi);
  window.addEventListener("pointerup",endExampleRoi);

  $("saveRulesBtn").onclick=saveRules;
  $("resetRulesBtn").onclick=()=>{
    fillRules(defaultRules());
    updateRuleSummary();
  };

  ["damageNormalMax","damageReplaceMin","shapeSimilarityMin","colorDifferenceMax","useDamage","useShape","useColor"]
    .forEach(id=>$(id).addEventListener("input",updateRuleSummary));

  $("searchBtn").onclick=loadInspections;
  $("selectAllInspections").onchange=toggleSelectAllInspections;
  $("deleteSelectedBtn").onclick=deleteSelectedInspections;

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
      closeExampleRoi();
      closeExamples();
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
    const blob=await prepareMasterImage(file,1600);
    const url=URL.createObjectURL(blob);

    $("stickerPreview").innerHTML=`<img src="${url}" alt="스티커 원본 미리보기">`;
    $("stickerPreview").classList.remove("hidden");
  }catch{
    $("stickerPreview").classList.add("hidden");
  }
}

function updateExampleFileInfo(){
  const files=[...$("exampleFiles").files];
  $("exampleFileInfo").textContent=files.length
    ? `${files.length}장 선택됨 · 첫 번째 사진이 촬영가이드 1번으로 등록됩니다.`
    : "정상부착 예시사진을 1장 이상 선택해 주세요.";
}

async function uploadSticker(){
  const name=$("stickerName").value.trim();
  const file=$("stickerFile").files[0];
  const examples=[...$("exampleFiles").files];

  if(!name||!file||!examples.length){
    msg("uploadStickerMessage","스티커명, 정상 스티커 원본, 정상부착 예시사진을 모두 입력해 주세요.","error");
    return;
  }

  $("uploadStickerBtn").disabled=true;
  msg("uploadStickerMessage","스티커 원본과 정상부착 예시사진을 등록 중입니다...","info");

  try{
    const master=await prepareMasterImage(file,1600);

    const fd=new FormData();
    fd.append("name",name);
    fd.append("side_hint",$("sideHint").value);
    fd.append("guide_text",$("guideTextInput").value.trim());
    fd.append("file",master,master.type==="image/png"?"sticker-master.png":"sticker-master.jpg");

    for(const ex of examples){
      const optimized=await compressImage(ex,1800,.9);
      fd.append("examples",optimized,"normal-example.jpg");
    }

    const r=await fetchTimeout("/api/admin/stickers",{
      method:"POST",
      body:fd
    },45000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"등록 실패");

    $("stickerName").value="";
    $("stickerFile").value="";
    $("exampleFiles").value="";
    $("stickerPreview").innerHTML="";
    $("stickerPreview").classList.add("hidden");
    updateExampleFileInfo();

    msg("uploadStickerMessage",d.message||"등록 완료.","success");
    await loadStickers();

    if(d.id){
      setTimeout(()=>openExamples(d.id),500);
    }
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
              <span class="pill ${Number(x.calibrated_count)>0?"normal":"review"}">예시 ${Number(x.calibrated_count||0)}/${Number(x.example_count||0)} 영역설정</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn small secondary" onclick="openEdit(${x.id})">수정</button>
            <button class="btn small secondary" onclick="openExamples(${x.id})">예시사진 관리</button>
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


window.openExamples=async function(id){
  const sticker=S.stickers.find(x=>Number(x.id)===Number(id));
  S.exampleStickerId=id;
  $("examplesModalTitle").textContent=`${sticker?.name||"스티커"} · 정상부착 예시사진`;
  $("examplesModal").classList.remove("hidden");
  document.body.classList.add("modal-open");
  await loadExamples();
};

function closeExamples(){
  if(!$("examplesModal"))return;
  if(!$("exampleRoiModal").classList.contains("hidden"))return;
  $("examplesModal").classList.add("hidden");
  if($("imageModal").classList.contains("hidden")&&$("editModal").classList.contains("hidden")){
    document.body.classList.remove("modal-open");
  }
}

async function loadExamples(){
  if(!S.exampleStickerId)return;

  $("examplesList").innerHTML='<div class="empty">불러오는 중...</div>';

  try{
    const r=await fetchTimeout(`/api/admin/stickers/${S.exampleStickerId}/examples`,{cache:"no-store"},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"예시사진 조회 실패");

    S.examples=d.items||[];

    $("examplesList").innerHTML=S.examples.length
      ? S.examples.map((x,i)=>`
        <div class="example-row">
          <img src="${x.image_url}?v=${Date.now()}" alt="정상부착 예시">
          <div>
            <strong>예시사진 ${i+1}</strong>
            <div style="margin-top:5px">
              ${x.vehicle_type?`<span class="pill active">${vehicleLabel(x.vehicle_type)}</span>`:'<span class="pill review">차종 미지정</span>'}
              ${x.calibrated?'<span class="pill normal">스티커영역 완료</span>':'<span class="pill review">스티커영역 필요</span>'}
              ${x.plate_calibrated?'<span class="pill normal">번호판 완료</span>':'<span class="pill">번호판 미설정</span>'}
              ${x.logo_calibrated?'<span class="pill normal">후면로고 완료</span>':'<span class="pill">후면로고 미설정</span>'}
            </div>
            <select class="example-vehicle-select" onchange="setExampleVehicle(${x.id},this.value)" style="margin-top:8px">
              <option value="" ${!x.vehicle_type?"selected":""}>차종 선택</option>
              <option value="k3" ${x.vehicle_type==="k3"?"selected":""}>K3</option>
              <option value="avante" ${x.vehicle_type==="avante"?"selected":""}>아반떼</option>
              <option value="ev3" ${x.vehicle_type==="ev3"?"selected":""}>EV3</option>
            </select>
          </div>
          <div class="row-actions">
            <button class="btn small primary" onclick="openExampleRoi(${x.id})">영역설정</button>
            <button class="btn small danger" onclick="deleteExample(${x.id})">삭제</button>
          </div>
        </div>
      `).join("")
      : '<div class="empty">예시사진이 없습니다.</div>';

    const calibrated=S.examples.filter(x=>x.calibrated).length;
    const placed=S.examples.filter(x=>x.calibrated&&x.plate_calibrated).length;
    const vehicleMapped=S.examples.filter(x=>x.vehicle_type).length;
    msg("examplesMessage",`예시 ${S.examples.length}장 · 차종지정 ${vehicleMapped}장 · 스티커영역 ${calibrated}장 · 위치기준 ${placed}장`,"info");
  }catch(e){
    $("examplesList").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

async function addExamples(){
  const files=[...$("addExampleFiles").files];

  if(!files.length){
    msg("examplesMessage","추가할 예시사진을 선택해 주세요.","error");
    return;
  }

  $("addExamplesBtn").disabled=true;
  msg("examplesMessage","예시사진을 추가 중입니다...","info");

  try{
    const fd=new FormData();
    fd.append("vehicle_type",$("addExampleVehicle").value);

    for(const file of files){
      const optimized=await compressImage(file,1800,.9);
      fd.append("files",optimized,"normal-example.jpg");
    }

    const r=await fetchTimeout(`/api/admin/stickers/${S.exampleStickerId}/examples`,{
      method:"POST",
      body:fd
    },45000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"추가 실패");

    $("addExampleFiles").value="";
    await loadExamples();
    await loadStickers();
  }catch(e){
    msg("examplesMessage",e.message,"error");
  }finally{
    $("addExamplesBtn").disabled=false;
  }
}


window.setExampleVehicle=async function(id,vehicleType){
  try{
    const r=await fetchTimeout(`/api/admin/examples/${id}/vehicle`,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({vehicle_type:vehicleType})
    },12000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"차종 저장 실패");

    await loadExamples();
    await loadStickers();
  }catch(e){
    alert(e.message);
    await loadExamples();
  }
};

window.setGuideExample=async function(id){
  try{
    const r=await fetchTimeout(`/api/admin/examples/${id}/guide`,{method:"POST"},12000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"가이드 지정 실패");

    await loadExamples();
  }catch(e){
    alert(e.message);
  }
};

window.deleteExample=async function(id){
  if(!confirm("이 정상부착 예시사진을 삭제할까요?"))return;

  try{
    const r=await fetchTimeout(`/api/admin/examples/${id}`,{method:"DELETE"},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"삭제 실패");

    await loadExamples();
    await loadStickers();
  }catch(e){
    alert(e.message);
  }
};

window.openExampleRoi=function(id){
  const ex=S.examples.find(x=>Number(x.id)===Number(id));
  if(!ex)return;

  S.roiExampleId=id;
  S.roiSticker=ex.calibrated
    ? {x:Number(ex.crop_x),y:Number(ex.crop_y),width:Number(ex.crop_width),height:Number(ex.crop_height)}
    : null;
  S.roiPlate=ex.plate_calibrated
    ? {x:Number(ex.plate_x),y:Number(ex.plate_y),width:Number(ex.plate_width),height:Number(ex.plate_height)}
    : null;
  S.roiLogo=ex.logo_calibrated
    ? {x:Number(ex.logo_x),y:Number(ex.logo_y),width:Number(ex.logo_width),height:Number(ex.logo_height)}
    : null;
  S.roiDraft=null;

  $("exampleRoiImage").src=`${ex.image_url}?v=${Date.now()}`;
  $("exampleRoiModal").classList.remove("hidden");
  $("examplesModal").classList.add("hidden");

  renderStoredExampleRois();
  setExampleRoiMode("sticker");
};

function closeExampleRoi(){
  if(!$("exampleRoiModal"))return;
  if($("exampleRoiModal").classList.contains("hidden"))return;

  $("exampleRoiModal").classList.add("hidden");
  $("examplesModal").classList.remove("hidden");
  S.roiDrawing=false;
  S.roiStart=null;
  S.roiDraft=null;
}

function setExampleRoiMode(mode){
  S.roiMode=["sticker","plate","logo"].includes(mode) ? mode : "sticker";
  S.roiDraft=null;
  $("exampleRoiDraftBox").classList.add("hidden");

  $("exampleStickerModeBtn").classList.toggle("primary",S.roiMode==="sticker");
  $("examplePlateModeBtn").classList.toggle("primary",S.roiMode==="plate");
  if($("exampleLogoModeBtn")){
    $("exampleLogoModeBtn").classList.toggle("primary",S.roiMode==="logo");
  }

  const current=S.roiMode==="plate"
    ? S.roiPlate
    : (S.roiMode==="logo" ? S.roiLogo : S.roiSticker);

  const label=S.roiMode==="plate"
    ? "번호판"
    : (S.roiMode==="logo" ? "차량로고" : "스티커");

  $("saveExampleRoiBtn").disabled=!current;
  $("saveExampleRoiBtn").textContent=`${label} 영역 저장`;

  let text="";
  if(S.roiMode==="sticker"){
    text="실제 스티커 외곽보다 사방 10~20% 정도 여유 있게 지정해 주세요.";
  }else if(S.roiMode==="logo"){
    text="후면 차량의 제조사 로고(KIA/현대 등) 전체를 타이트하게 지정해 주세요.";
  }else{
    text="차량번호 확인용으로 번호판 전체를 타이트하게 지정해 주세요. 스티커 판정에는 사용하지 않습니다.";
  }

  msg("exampleRoiMessage",text,"info");
}

function roiPoint(e){
  const r=$("exampleRoiStage").getBoundingClientRect();

  return{
    x:Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),
    y:Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))
  };
}

function startExampleRoi(e){
  if(!S.roiExampleId)return;
  e.preventDefault();

  S.roiDrawing=true;
  S.roiStart=roiPoint(e);
  S.roiDraft={x:S.roiStart.x,y:S.roiStart.y,width:0,height:0};

  $("exampleRoiDraftBox").classList.remove("hidden");
  renderExampleDraft();
}

function moveExampleRoi(e){
  if(!S.roiDrawing)return;

  const p=roiPoint(e);

  S.roiDraft={
    x:Math.min(S.roiStart.x,p.x),
    y:Math.min(S.roiStart.y,p.y),
    width:Math.abs(p.x-S.roiStart.x),
    height:Math.abs(p.y-S.roiStart.y)
  };

  renderExampleDraft();
}

function endExampleRoi(){
  if(!S.roiDrawing)return;
  S.roiDrawing=false;

  if(!S.roiDraft||S.roiDraft.width<.02||S.roiDraft.height<.02){
    S.roiDraft=null;
    $("exampleRoiDraftBox").classList.add("hidden");
    return;
  }

  if(S.roiMode==="plate"){
    S.roiPlate={...S.roiDraft};
  }else if(S.roiMode==="logo"){
    S.roiLogo={...S.roiDraft};
  }else{
    S.roiSticker={...S.roiDraft};
  }

  S.roiDraft=null;
  $("exampleRoiDraftBox").classList.add("hidden");
  renderStoredExampleRois();
  $("saveExampleRoiBtn").disabled=false;
}

function renderExampleDraft(){
  if(!S.roiDraft)return;
  renderExampleBox($("exampleRoiDraftBox"),S.roiDraft);
}

function renderStoredExampleRois(){
  const stickerBox=$("exampleStickerRoiBox");
  const plateBox=$("examplePlateRoiBox");
  const logoBox=$("exampleLogoRoiBox");

  if(S.roiSticker){
    renderExampleBox(stickerBox,S.roiSticker);
    stickerBox.classList.remove("hidden");
  }else{
    stickerBox.classList.add("hidden");
  }

  if(S.roiPlate){
    renderExampleBox(plateBox,S.roiPlate);
    plateBox.classList.remove("hidden");
  }else{
    plateBox.classList.add("hidden");
  }

  if(logoBox){
    if(S.roiLogo){
      renderExampleBox(logoBox,S.roiLogo);
      logoBox.classList.remove("hidden");
    }else{
      logoBox.classList.add("hidden");
    }
  }
}

function renderExampleBox(el,b){
  Object.assign(el.style,{
    left:`${b.x*100}%`,
    top:`${b.y*100}%`,
    width:`${b.width*100}%`,
    height:`${b.height*100}%`
  });
}

function resetExampleRoi(){
  if(S.roiMode==="plate"){
    S.roiPlate=null;
    $("examplePlateRoiBox").classList.add("hidden");
  }else if(S.roiMode==="logo"){
    S.roiLogo=null;
    if($("exampleLogoRoiBox"))$("exampleLogoRoiBox").classList.add("hidden");
  }else{
    S.roiSticker=null;
    $("exampleStickerRoiBox").classList.add("hidden");
  }

  S.roiDraft=null;
  S.roiDrawing=false;
  S.roiStart=null;
  $("exampleRoiDraftBox").classList.add("hidden");
  $("saveExampleRoiBtn").disabled=true;

  const label=S.roiMode==="plate"?"번호판":(S.roiMode==="logo"?"차량로고":"스티커");
  msg("exampleRoiMessage",`${label} 영역을 다시 드래그해 주세요.`,"info");
}

async function saveExampleRoi(){
  if(!S.roiExampleId)return;

  const region=S.roiMode==="plate"
    ? S.roiPlate
    : (S.roiMode==="logo" ? S.roiLogo : S.roiSticker);
  if(!region)return;

  const label=S.roiMode==="plate"?"번호판":(S.roiMode==="logo"?"차량로고":"스티커");

  $("saveExampleRoiBtn").disabled=true;
  msg("exampleRoiMessage",`${label} 영역을 저장 중입니다...`,"info");

  try{
    const r=await fetchTimeout(`/api/admin/examples/${S.roiExampleId}/roi`,{
      method:"PATCH",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({
        kind:S.roiMode,
        ...region
      })
    },12000);

    const d=await r.json();
    if(!r.ok)throw new Error(d.error||"영역 저장 실패");

    msg("exampleRoiMessage",`${label} 영역 저장 완료`,"success");
    await loadExamples();
    await loadStickers();
  }catch(e){
    msg("exampleRoiMessage",e.message,"error");
  }finally{
    $("saveExampleRoiBtn").disabled=false;
  }
}
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
    const blob=await prepareMasterImage(file,1600);
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
      const optimized=await prepareMasterImage(file,1600);
      fd.append("file",optimized,optimized.type==="image/png"?"sticker-edit.png":"sticker-edit.jpg");
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
    shape_similarity_min:72,
    design_similarity_min:82,
    placement_similarity_min:55,
    rear_geometry_min:62,
    rear_size_difference_max:18,
    color_difference_max:35,
    use_damage:1,
    use_shape:1,
    use_design:1,
    use_placement:1,
    use_rear_geometry:1,
    use_color:0
  };
}

function fillRules(r){
  $("damageNormalMax").value=Number(r.damage_normal_max??10);
  $("damageReplaceMin").value=Number(r.damage_replace_min??30);
  $("shapeSimilarityMin").value=Number(r.shape_similarity_min??72);
  $("designSimilarityMin").value=Number(r.design_similarity_min??82);
  $("placementSimilarityMin").value=Number(r.placement_similarity_min??55);
  $("rearGeometryMin").value=Number(r.rear_geometry_min??62);
  $("rearSizeDifferenceMax").value=Number(r.rear_size_difference_max??18);
  $("colorDifferenceMax").value=Number(r.color_difference_max??35);

  $("useDamage").checked=Number(r.use_damage??1)===1;
  $("useShape").checked=Number(r.use_shape??1)===1;
  $("useDesign").checked=Number(r.use_design??1)===1;
  $("usePlacement").checked=Number(r.use_placement??1)===1;
  $("useRearGeometry").checked=Number(r.use_rear_geometry??1)===1;
  $("useColor").checked=false;
}

function collectRules(){
  return{
    damage_normal_max:Number($("damageNormalMax").value),
    damage_replace_min:Number($("damageReplaceMin").value),
    shape_similarity_min:Number($("shapeSimilarityMin").value),
    design_similarity_min:Number($("designSimilarityMin").value),
    placement_similarity_min:Number($("placementSimilarityMin").value),
    rear_geometry_min:Number($("rearGeometryMin").value),
    rear_size_difference_max:Number($("rearSizeDifferenceMax").value),
    color_difference_max:Number($("colorDifferenceMax").value),
    use_damage:$("useDamage").checked,
    use_shape:$("useShape").checked,
    use_design:$("useDesign").checked,
    use_placement:$("usePlacement").checked,
    use_rear_geometry:$("useRearGeometry").checked,
    use_color:false
  };
}

function updateRuleSummary(){
  const r=collectRules();
  const parts=[];

  if(r.use_damage){
    parts.push(`손상률 ${r.damage_normal_max}% 이하 정상 / ${r.damage_replace_min}% 이상 교체권고`);
  }

  if(r.use_shape){
    parts.push(`구조 보존율 ${r.shape_similarity_min}% 미만 확인필요`);
  }

  if(r.use_design){
    parts.push(`디자인 동일성 차종별 정상예시 기준 (예시 미설정 시 ${r.design_similarity_min}% 사용)`);
  }

  if(r.use_placement){
    parts.push(`측면 부착위치 유사도 ${r.placement_similarity_min}% 미만 확인필요`);
  }

  if(r.use_rear_geometry){
    parts.push(`후면 기준유사도 ${r.rear_geometry_min}% 미만 또는 크기차이 ${r.rear_size_difference_max}% 초과 확인필요`);
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
    rules.design_similarity_min,
    rules.placement_similarity_min,
    rules.rear_geometry_min,
    rules.rear_size_difference_max,
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
  clearInspectionSelection();

  const q=new URLSearchParams();

  if($("resultSearch").value.trim())q.set("q",$("resultSearch").value.trim());
  if($("statusFilter").value)q.set("status",$("statusFilter").value);
  if($("stateFilter").value)q.set("admin_state",$("stateFilter").value);

  try{
    const r=await fetchTimeout(`/api/admin/inspections?${q}`,{cache:"no-store"},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"조회 실패");

    const items=d.items||[];
    S.inspectionItems=items;

    $("countAll").textContent=items.length;
    $("countNormal").textContent=items.filter(x=>x.status==="정상").length;
    $("countReview").textContent=items.filter(x=>x.status==="확인필요").length;
    $("countInvalid").textContent=items.filter(x=>x.status==="판정불가").length;
    $("countAction").textContent=items.filter(x=>x.admin_state==="개선요청").length;

    $("inspectionList").innerHTML=items.length
      ? items.map(x=>{
          let findings=[];
          try{findings=JSON.parse(x.findings_json||"[]")}catch{}

          let metrics={};
          try{metrics=JSON.parse(x.metrics_json||"{}")}catch{}

          return`
            <div class="inspection-row" data-inspection-id="${x.id}">
              <div class="inspection-select-cell">
                <input
                  class="inspection-checkbox"
                  type="checkbox"
                  value="${x.id}"
                  aria-label="점검결과 ${x.id} 선택"
                  onchange="toggleInspectionSelection(${x.id},this.checked)"
                >
              </div>

              <div class="inspection-main">
                <img
                  src="/api/admin/inspections/${x.id}/image"
                  alt="점검사진"
                  onclick="openImage('/api/admin/inspections/${x.id}/image')"
                >
                <div class="inspection-meta">
                  <strong>${esc(x.vehicle_no)} · ${esc(x.employee_name)}</strong>
                  <span>${esc(x.department||"-")} · ${esc(x.sticker_name||"-")} v${esc(x.sticker_version||"-")}</span>
                  <span>차종 ${vehicleLabel(metrics.vehicleType||"")||"미기록"}</span>
                  <span>점수 ${Number(x.score).toFixed(1)} · <b>${esc(x.status)}</b></span>
                  <span>${x.status==="분석대기"
                    ? "자동분석 대기 중 · 사진 저장 완료"
                    : (metrics.simpleInspectionV25===true
                        ? `스티커 ${metrics.stickerDetected===true?"검출":"미검출"} · 추정 훼손 ${Number(metrics.damage??0).toFixed(1)}%${metrics.sideHint==="rear"
                            ? ` · 로고기준 ${metrics.rearLogoRight===true?"오른쪽":(metrics.rearLogoRight===false?"위치이상":"확인필요")} · 규격차이 ${Number(metrics.rearSizeDifference??0).toFixed(1)}%`
                            : ""}`
                        : `기존 분석 · 손상 ${Number(metrics.damage??0).toFixed(1)}% · 검출신뢰 ${Number(metrics.confidence??0).toFixed(1)}%`)}</span>
                  ${metrics.simpleInspectionV25===true
                    ? ""
                    : `<span>${metrics.sideHint==="rear" && Number.isFinite(Number(metrics.rearGeometrySimilarity))
                        ? `후면 기준 유사도 ${Number(metrics.rearGeometrySimilarity).toFixed(1)}%`
                        : (metrics.placementSimilarity!==null &&
                           metrics.placementSimilarity!==undefined &&
                           Number.isFinite(Number(metrics.placementSimilarity))
                            ? `부착위치 유사도 ${Number(metrics.placementSimilarity).toFixed(1)}%`
                            : "부착위치 기준 미설정")}</span>`}
                  ${metrics.stickerRoiMode==="auto-from-plate"
                    ? '<span>스티커 영역: 번호판 기준 자동탐색</span>'
                    : ""}
                  <span>${metrics.plateConfirmed===true
                    ? `번호판 확인 ✓ · 노출점수 ${Number(metrics.plateVisibilityScore??0).toFixed(1)}`
                    : "번호판 확인정보 없음"}</span>
                  <span>${metrics.plateManualMatch===true
                    ? `입력 차량번호 대조 ✓${metrics.plateOcrMatched===true ? " · 자동판독 일치" : " · 사용자 육안확인"}`
                    : "입력 차량번호 대조정보 없음"}</span>
                  <span>${metrics.userAnalysisHidden===true
                    ? "직원 화면에는 자동판정 결과 미노출 · 관리자 전용 결과"
                    : "기존 점검결과"}</span>
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

    updateInspectionSelectionUI();

  }catch(e){
    S.inspectionItems=[];
    clearInspectionSelection();
    $("inspectionList").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

window.toggleInspectionSelection=function(id,checked){
  const n=Number(id);

  if(checked){
    S.selectedInspectionIds.add(n);
  }else{
    S.selectedInspectionIds.delete(n);
  }

  updateInspectionSelectionUI();
};

function toggleSelectAllInspections(){
  const checked=$("selectAllInspections").checked;
  const ids=S.inspectionItems.map(x=>Number(x.id));

  if(checked){
    ids.forEach(id=>S.selectedInspectionIds.add(id));
  }else{
    ids.forEach(id=>S.selectedInspectionIds.delete(id));
  }

  document.querySelectorAll(".inspection-checkbox").forEach(cb=>{
    cb.checked=checked;
  });

  updateInspectionSelectionUI();
}

function clearInspectionSelection(){
  S.selectedInspectionIds.clear();

  if($("selectAllInspections")){
    $("selectAllInspections").checked=false;
    $("selectAllInspections").indeterminate=false;
  }

  updateInspectionSelectionUI();
}

function updateInspectionSelectionUI(){
  const selectedCount=S.selectedInspectionIds.size;
  const total=S.inspectionItems.length;

  $("selectedCountText").textContent=`선택 ${selectedCount}건`;
  $("deleteSelectedBtn").textContent=`선택 삭제 (${selectedCount})`;
  $("deleteSelectedBtn").disabled=selectedCount===0;

  const selectAll=$("selectAllInspections");

  if(total===0){
    selectAll.checked=false;
    selectAll.indeterminate=false;
    selectAll.disabled=true;
  }else{
    selectAll.disabled=false;
    selectAll.checked=selectedCount===total;
    selectAll.indeterminate=selectedCount>0&&selectedCount<total;
  }

  document.querySelectorAll(".inspection-checkbox").forEach(cb=>{
    cb.checked=S.selectedInspectionIds.has(Number(cb.value));
  });
}

async function deleteSelectedInspections(){
  const ids=[...S.selectedInspectionIds];

  if(!ids.length){
    alert("삭제할 점검결과를 먼저 선택해 주세요.");
    return;
  }

  const confirmed=confirm(
    `선택한 ${ids.length}건의 점검결과와 업로드 사진이 함께 삭제됩니다.\n\n`+
    `삭제 후에는 복구할 수 없습니다.\n정말 삭제하시겠습니까?`
  );

  if(!confirmed)return;

  $("deleteSelectedBtn").disabled=true;
  $("deleteSelectedBtn").textContent="삭제 중...";

  try{
    const r=await fetchTimeout("/api/admin/inspections/bulk-delete",{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({ids})
    },30000);

    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"삭제 실패");

    let text=`${Number(d.deleted||0)}건을 삭제했습니다.`;

    if(Number(d.image_delete_failed||0)>0){
      text+=`\n점검기록은 삭제되었지만 사진 ${d.image_delete_failed}건의 저장소 정리에 실패했습니다.`;
    }

    alert(text);
    await loadInspections();

  }catch(e){
    alert(`삭제하지 못했습니다.\n${e.message}`);
    updateInspectionSelectionUI();
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


async function prepareMasterImage(file,maxSide){
  const img=await blobImage(file);
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));

  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(img.naturalWidth*scale));
  c.height=Math.max(1,Math.round(img.naturalHeight*scale));

  c.getContext("2d").drawImage(img,0,0,c.width,c.height);

  if(file.type==="image/png"){
    return new Promise((resolve,reject)=>{
      c.toBlob(
        b=>b?resolve(b):reject(new Error("PNG 변환 실패")),
        "image/png"
      );
    });
  }

  return new Promise((resolve,reject)=>{
    c.toBlob(
      b=>b?resolve(b):reject(new Error("이미지 변환 실패")),
      "image/jpeg",
      .92
    );
  });
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

function rearSideLabel(side){
  return({
    left:"왼쪽",
    right:"오른쪽",
    center:"중앙"
  })[side]||"미확인";
}

function vehicleLabel(v){
  return({
    k3:"K3",
    avante:"아반떼",
    ev3:"EV3"
  })[v]||"";
}

function sideLabel(v){
  return({
    both:"좌·우 측면 공통",
    driver:"운전석",
    passenger:"조수석",
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
