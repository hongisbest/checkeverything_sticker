const $=id=>document.getElementById(id);

const S={
  stickers:[],
  sticker:null,
  rules:null,
  stream:null,
  photoBlob:null,
  photoImage:null,
  photoUrl:null,
  selection:null,
  drawing:false,
  start:null,
  analysis:null
};

document.addEventListener("DOMContentLoaded",()=>{
  bind();
  restoreProfile();
  loadConfig();
});

function bind(){
  $("startCameraBtn").onclick=startCamera;
  $("captureBtn").onclick=captureVideo;
  $("photoInput").onchange=pickFile;

  $("selectionStage").addEventListener("pointerdown",startSelect);
  $("selectionStage").addEventListener("pointermove",moveSelect);
  window.addEventListener("pointerup",endSelect);

  $("resetSelectionBtn").onclick=resetSelection;
  $("stickerMissingCheck").onchange=toggleMissing;
  $("analyzeBtn").onclick=analyzeSelected;
  $("submitBtn").onclick=submitInspection;

  ["employeeName","employeeId","department","vehicleNo"].forEach(id=>{
    $(id).addEventListener("input",saveProfile);
  });
}

async function loadConfig(){
  try{
    const r=await fetchTimeout("/api/config",{},15000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"설정 조회 실패");

    S.stickers=d.stickers||[];
    S.rules=d.rules||defaultRules();

    $("configStatus").textContent=S.stickers.length?`${S.stickers.length}종 등록`:"미등록";

    $("stickerTabs").innerHTML=S.stickers.map(x=>`
      <button class="sticker-tab" data-id="${x.id}">
        ${esc(x.name)}
      </button>
    `).join("");

    document.querySelectorAll(".sticker-tab").forEach(b=>{
      b.onclick=()=>selectSticker(Number(b.dataset.id));
    });

    if(S.stickers[0]){
      selectSticker(S.stickers[0].id);
    }else{
      $("referenceBox").innerHTML='<div class="empty">관리자가 기준 스티커를 등록해야 합니다.</div>';
    }
  }catch(e){
    $("configStatus").textContent="오류";
    $("referenceBox").innerHTML=`<div class="message error">${esc(e.message)}</div>`;
  }
}

function selectSticker(id){
  S.sticker=S.stickers.find(x=>Number(x.id)===Number(id));
  if(!S.sticker)return;

  document.querySelectorAll(".sticker-tab").forEach(b=>{
    b.classList.toggle("active",Number(b.dataset.id)===Number(id));
  });

  $("referenceBox").innerHTML=`<img src="${S.sticker.image_url}?v=${Date.now()}" alt="${esc(S.sticker.name)}">`;
  $("stickerTitle").textContent=S.sticker.name;
  $("sideHintText").textContent=`권장 위치: ${sideLabel(S.sticker.side_hint)}`;
  $("guideText").textContent=S.sticker.guide_text || "스티커가 선명하게 보이도록 촬영해 주세요.";

  resetAllAfterPhoto();
}

async function startCamera(){
  stopCamera();

  try{
    S.stream=await navigator.mediaDevices.getUserMedia({
      audio:false,
      video:{
        facingMode:{ideal:"environment"},
        width:{ideal:1920},
        height:{ideal:1080}
      }
    });

    $("cameraVideo").srcObject=S.stream;
    await $("cameraVideo").play();

    $("cameraVideo").style.display="block";
    $("cameraPlaceholder").style.display="none";
    $("captureBtn").disabled=false;
    $("cameraStatus").textContent="LIVE";
  }catch(e){
    $("cameraStatus").textContent="카메라 실패";
  }
}

function stopCamera(){
  if(S.stream)S.stream.getTracks().forEach(t=>t.stop());
  S.stream=null;
}

async function captureVideo(){
  const v=$("cameraVideo");
  if(!S.stream||v.readyState<2)return;

  const c=$("captureCanvas");
  c.width=v.videoWidth;
  c.height=v.videoHeight;
  c.getContext("2d").drawImage(v,0,0);

  const blob=await new Promise(resolve=>c.toBlob(resolve,"image/jpeg",.88));
  await preparePhoto(blob);
}

async function pickFile(e){
  const file=e.target.files?.[0];
  if(!file)return;

  try{
    const blob=await compressImage(file,1800,.88);
    await preparePhoto(blob);
  }catch(err){
    alert("사진을 읽지 못했습니다. 다른 사진으로 다시 시도해 주세요.");
  }
}

async function preparePhoto(blob){
  if(!S.sticker){
    alert("먼저 점검할 스티커를 선택해 주세요.");
    return;
  }

  if(S.photoUrl)URL.revokeObjectURL(S.photoUrl);

  S.photoBlob=blob;
  S.photoImage=await blobImage(blob);
  S.photoUrl=URL.createObjectURL(blob);

  $("selectionImage").src=S.photoUrl;
  $("resultPhoto").innerHTML=`<img src="${S.photoUrl}" alt="차량사진">`;

  $("selectionSection").classList.remove("hidden");
  $("analysisSection").classList.add("hidden");

  resetSelection();

  $("selectionSection").scrollIntoView({behavior:"smooth"});
}

function point(e){
  const r=$("selectionStage").getBoundingClientRect();
  return{
    x:clamp((e.clientX-r.left)/r.width,0,1),
    y:clamp((e.clientY-r.top)/r.height,0,1)
  };
}

function startSelect(e){
  if(!S.photoImage||$("stickerMissingCheck").checked)return;

  e.preventDefault();
  S.drawing=true;
  S.start=point(e);
  S.selection={x:S.start.x,y:S.start.y,width:0,height:0};

  $("selectionBox").classList.remove("hidden");
  renderSelection();
}

function moveSelect(e){
  if(!S.drawing||!S.start)return;

  const p=point(e);

  S.selection={
    x:Math.min(S.start.x,p.x),
    y:Math.min(S.start.y,p.y),
    width:Math.abs(p.x-S.start.x),
    height:Math.abs(p.y-S.start.y)
  };

  renderSelection();
}

function endSelect(){
  if(!S.drawing)return;
  S.drawing=false;

  if(!S.selection||S.selection.width<.02||S.selection.height<.02){
    resetSelection();
    return;
  }

  $("selectionStatus").textContent="선택완료";
  $("analyzeBtn").disabled=false;
}

function renderSelection(){
  if(!S.selection)return;

  const s=S.selection;
  Object.assign($("selectionBox").style,{
    left:`${s.x*100}%`,
    top:`${s.y*100}%`,
    width:`${s.width*100}%`,
    height:`${s.height*100}%`
  });
}

function resetSelection(){
  S.selection=null;
  S.drawing=false;
  S.start=null;

  $("selectionBox").classList.add("hidden");
  $("selectionStatus").textContent="영역 선택";
  $("analyzeBtn").disabled=!$("stickerMissingCheck").checked;
}

function toggleMissing(){
  if($("stickerMissingCheck").checked){
    S.selection=null;
    $("selectionBox").classList.add("hidden");
    $("selectionStatus").textContent="스티커 없음";
    $("analyzeBtn").disabled=false;
  }else{
    $("selectionStatus").textContent="영역 선택";
    $("analyzeBtn").disabled=!S.selection;
  }
}

async function analyzeSelected(){
  if(!S.photoBlob||!S.sticker)return;

  const missing=$("stickerMissingCheck").checked;

  if(!missing&&!S.selection){
    alert("스티커 영역을 먼저 드래그해 주세요.");
    return;
  }

  $("analysisSection").classList.remove("hidden");
  $("resultStatus").textContent="분석중";

  try{
    const result=missing
      ? analyzeMissing()
      : await analyzeCrop();

    S.analysis=result;
    renderAnalysis(result);

    $("analysisSection").scrollIntoView({behavior:"smooth"});
  }catch(e){
    console.error(e);
    $("resultStatus").textContent="분석 실패";
    $("findings").innerHTML='<div class="finding">분석 중 오류가 발생했습니다.</div>';
  }
}

function analyzeMissing(){
  $("resultCrop").innerHTML='<div class="camera-placeholder"><strong>스티커 없음</strong></div>';

  return{
    score:0,
    status:"확인필요",
    recommendation:"교체 권고",
    findings:[
      "스티커가 확인되지 않음",
      "추정 누락률 100%",
      "교체 권고"
    ],
    metrics:{
      damage:100,
      shape:0,
      color:100,
      missing:true
    }
  };
}

async function analyzeCrop(){
  const reference=await loadImage(S.sticker.image_url);
  const cropCanvas=cropSelectedCanvas(S.photoImage,S.selection,900);
  const cropBlob=await canvasBlob(cropCanvas,.90);

  const cropUrl=URL.createObjectURL(cropBlob);
  $("resultCrop").innerHTML=`<img src="${cropUrl}" alt="선택한 스티커 영역">`;

  const current=await blobImage(cropBlob);
  const metrics=compareSticker(reference,current);
  const rules=S.rules||defaultRules();

  let status="정상";
  let recommendation="";
  const findings=[];

  if(Number(rules.use_damage)===1){
    if(metrics.damage>=Number(rules.damage_replace_min)){
      status="확인필요";
      recommendation="교체 권고";
      findings.push(`추정 누락/손상률 ${metrics.damage}% → 교체 권고`);
    }else if(metrics.damage>Number(rules.damage_normal_max)){
      status="확인필요";
      findings.push(`추정 누락/손상률 ${metrics.damage}% → 확인필요`);
    }
  }

  if(Number(rules.use_shape)===1&&metrics.shape<Number(rules.shape_similarity_min)){
    status="확인필요";
    findings.push(`형상 유사도 ${metrics.shape}% → 형상 변화 확인필요`);
  }

  if(Number(rules.use_color)===1&&metrics.color>Number(rules.color_difference_max)){
    status="확인필요";
    findings.push(`색상차이 ${metrics.color} → 변색·오염 확인필요`);
  }

  if(!findings.length){
    findings.push("설정된 판정기준에서 뚜렷한 이상징후가 없습니다.");
  }

  const score=r1(clamp(
    metrics.shape*.62 +
    (100-metrics.damage)*.28 +
    (100-Math.min(100,metrics.color))*.10,
    0,100
  ));

  return{
    score,
    status,
    recommendation,
    findings,
    metrics:{...metrics,missing:false}
  };
}

function compareSticker(reference,current){
  const size=96;
  const A=descriptor(reference,size);
  const B=descriptor(current,size);

  const best=bestEdgeShift(A.edge,B.edge,size,5);

  const shape=r1(clamp(100-best.error*100,0,100));

  const refEdgeCount=A.edge.reduce((a,v)=>a+(v>.28?1:0),0);
  const curEdgeCount=B.edge.reduce((a,v)=>a+(v>.28?1:0),0);

  const edgeLoss=refEdgeCount>0
    ? clamp((1-curEdgeCount/refEdgeCount)*100,0,100)
    : 0;

  const colorCoverageLoss=A.colorCount>20
    ? clamp((1-B.colorCount/A.colorCount)*100,0,100)
    : 0;

  const damage=r1(clamp(
    edgeLoss*.48 +
    colorCoverageLoss*.27 +
    (100-shape)*.25,
    0,100
  ));

  const color=r1(colorDifference(A,B));

  return{
    damage,
    shape,
    color,
    edgeLoss:r1(edgeLoss),
    colorCoverageLoss:r1(colorCoverageLoss)
  };
}

function descriptor(img,size){
  const c=document.createElement("canvas");
  c.width=c.height=size;
  const ctx=c.getContext("2d");

  ctx.fillStyle="#808080";
  ctx.fillRect(0,0,size,size);

  const scale=Math.min(size/img.naturalWidth,size/img.naturalHeight);
  const w=img.naturalWidth*scale;
  const h=img.naturalHeight*scale;

  ctx.drawImage(img,(size-w)/2,(size-h)/2,w,h);

  const data=ctx.getImageData(0,0,size,size).data;

  const gray=new Float32Array(size*size);
  let colorCount=0;
  let sr=0,sg=0,sb=0;

  for(let i=0,p=0;i<data.length;i+=4,p++){
    const r=data[i],g=data[i+1],b=data[i+2];
    gray[p]=(0.299*r+0.587*g+0.114*b)/255;

    const max=Math.max(r,g,b),min=Math.min(r,g,b);
    const sat=max===0?0:(max-min)/max;

    if(sat>.22&&max>45){
      colorCount++;
      sr+=r;sg+=g;sb+=b;
    }
  }

  // normalize brightness
  const mean=gray.reduce((a,v)=>a+v,0)/gray.length;
  let variance=0;
  for(const v of gray)variance+=(v-mean)*(v-mean);
  const sd=Math.sqrt(variance/gray.length)||1;

  const norm=new Float32Array(gray.length);
  for(let i=0;i<gray.length;i++)norm[i]=clamp((gray[i]-mean)/(sd*3)+.5,0,1);

  // edge magnitude
  const edge=new Float32Array(size*size);
  let maxEdge=.0001;

  for(let y=1;y<size-1;y++){
    for(let x=1;x<size-1;x++){
      const p=y*size+x;
      const gx=norm[p+1]-norm[p-1];
      const gy=norm[p+size]-norm[p-size];
      const g=Math.sqrt(gx*gx+gy*gy);
      edge[p]=g;
      if(g>maxEdge)maxEdge=g;
    }
  }

  for(let i=0;i<edge.length;i++)edge[i]=clamp(edge[i]/maxEdge,0,1);

  return{
    edge,
    colorCount,
    colorRGB:colorCount>0?[sr/colorCount,sg/colorCount,sb/colorCount]:[128,128,128]
  };
}

function bestEdgeShift(A,B,size,maxShift){
  let best=Infinity,bestDx=0,bestDy=0;

  for(let dy=-maxShift;dy<=maxShift;dy+=2){
    for(let dx=-maxShift;dx<=maxShift;dx+=2){
      let sum=0,count=0;

      for(let y=maxShift;y<size-maxShift;y++){
        const by=y+dy;
        if(by<0||by>=size)continue;

        for(let x=maxShift;x<size-maxShift;x++){
          const bx=x+dx;
          if(bx<0||bx>=size)continue;

          sum+=Math.abs(A[y*size+x]-B[by*size+bx]);
          count++;
        }
      }

      const error=sum/(count||1);

      if(error<best){
        best=error;
        bestDx=dx;
        bestDy=dy;
      }
    }
  }

  return{error:best,dx:bestDx,dy:bestDy};
}

function colorDifference(A,B){
  const a=A.colorRGB,b=B.colorRGB;
  const d=Math.sqrt(
    (a[0]-b[0])**2 +
    (a[1]-b[1])**2 +
    (a[2]-b[2])**2
  );

  return clamp(d/4.42,0,100);
}

function cropSelectedCanvas(img,s,maxSide){
  const sx=s.x*img.naturalWidth;
  const sy=s.y*img.naturalHeight;
  const sw=s.width*img.naturalWidth;
  const sh=s.height*img.naturalHeight;

  const scale=Math.min(1,maxSide/Math.max(sw,sh));

  const c=document.createElement("canvas");
  c.width=Math.max(1,Math.round(sw*scale));
  c.height=Math.max(1,Math.round(sh*scale));

  c.getContext("2d").drawImage(img,sx,sy,sw,sh,0,0,c.width,c.height);

  return c;
}

function renderAnalysis(a){
  $("resultStatus").textContent=a.recommendation?`${a.status} · ${a.recommendation}`:a.status;
  $("resultStatus").className=`badge ${a.status==="정상"?"pill normal":"pill review"}`;

  $("scoreValue").textContent=a.score;
  $("damageValue").textContent=`${a.metrics.damage}%`;
  $("shapeValue").textContent=`${a.metrics.shape}%`;
  $("colorValue").textContent=a.metrics.color;

  $("findings").innerHTML=a.findings.map(x=>`
    <div class="finding ${a.status==="정상"?"ok":""}">
      ${esc(x)}
    </div>
  `).join("");
}

async function submitInspection(){
  if(!S.photoBlob||!S.analysis){
    setSubmitMessage("분석을 먼저 완료해 주세요.","error");
    return;
  }

  const name=$("employeeName").value.trim();
  const vehicle=$("vehicleNo").value.trim();

  if(!name||!vehicle){
    setSubmitMessage("성명과 차량번호를 입력해 주세요.","error");
    return;
  }

  const missing=$("stickerMissingCheck").checked;
  const s=S.selection||{x:0,y:0,width:1,height:1};

  const meta={
    employee_name:name,
    employee_id:$("employeeId").value.trim(),
    department:$("department").value.trim(),
    vehicle_no:vehicle,
    sticker_id:S.sticker.id,
    crop_x:s.x,
    crop_y:s.y,
    crop_width:s.width,
    crop_height:s.height,
    sticker_missing:missing,
    score:S.analysis.score,
    status:S.analysis.status,
    findings:S.analysis.findings,
    metrics:S.analysis.metrics
  };

  const fd=new FormData();
  fd.append("meta",JSON.stringify(meta));
  fd.append("file",S.photoBlob,"inspection.jpg");

  $("submitBtn").disabled=true;
  setSubmitMessage("저장 중입니다...","info");

  try{
    const r=await fetchTimeout("/api/inspection",{method:"POST",body:fd},30000);
    const d=await r.json();

    if(!r.ok)throw new Error(d.error||"저장 실패");

    setSubmitMessage(`제출 완료 · 접수번호 #${d.id}`,"success");
  }catch(e){
    setSubmitMessage(`${e.message} 다시 시도해 주세요.`,"error");
  }finally{
    $("submitBtn").disabled=false;
  }
}

function resetAllAfterPhoto(){
  $("selectionSection").classList.add("hidden");
  $("analysisSection").classList.add("hidden");
  S.photoBlob=null;
  S.photoImage=null;
  S.selection=null;
  S.analysis=null;
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

function sideLabel(v){
  return({
    both:"좌·우 측면 공통",
    driver:"운전석 측면",
    passenger:"조수석 측면",
    rear:"후면",
    front:"전면"
  })[v]||v;
}

function setSubmitMessage(t,c){
  $("submitMessage").textContent=t;
  $("submitMessage").className=`message ${c}`;
}

async function compressImage(file,maxSide,quality){
  const img=await blobImage(file);
  const scale=Math.min(1,maxSide/Math.max(img.naturalWidth,img.naturalHeight));

  const c=document.createElement("canvas");
  c.width=Math.round(img.naturalWidth*scale);
  c.height=Math.round(img.naturalHeight*scale);

  c.getContext("2d").drawImage(img,0,0,c.width,c.height);

  return canvasBlob(c,quality);
}

function canvasBlob(canvas,quality){
  return new Promise((resolve,reject)=>{
    canvas.toBlob(
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
      reject(new Error("이미지 로드 실패"));
    };

    img.src=u;
  });
}

function loadImage(url){
  return new Promise((resolve,reject)=>{
    const img=new Image();

    img.onload=()=>resolve(img);
    img.onerror=()=>reject(new Error("기준 스티커 로드 실패"));
    img.src=`${url}?v=${Date.now()}`;
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

function saveProfile(){
  localStorage.setItem("sticker_compare_profile",JSON.stringify({
    employeeName:$("employeeName").value,
    employeeId:$("employeeId").value,
    department:$("department").value,
    vehicleNo:$("vehicleNo").value
  }));
}

function restoreProfile(){
  try{
    const p=JSON.parse(localStorage.getItem("sticker_compare_profile")||"{}");

    Object.keys(p).forEach(k=>{
      if($(k))$(k).value=p[k]||"";
    });
  }catch{}
}

function mean(a){return a.reduce((x,y)=>x+y,0)/(a.length||1)}
function clamp(v,a,b){return Math.min(b,Math.max(a,v))}
function r1(v){return Math.round(v*10)/10}
function esc(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]))}
