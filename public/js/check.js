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
  const cropCanvas=cropSelectedCanvas(S.photoImage,S.selection,1100);
  const cropBlob=await canvasBlob(cropCanvas,.92);

  const cropUrl=URL.createObjectURL(cropBlob);
  $("resultCrop").innerHTML=`<img src="${cropUrl}" alt="선택한 스티커 영역">`;

  const current=await blobImage(cropBlob);
  const metrics=compareStickerV2(reference,current);
  const rules=S.rules||defaultRules();

  let status="정상";
  let recommendation="";
  const findings=[];

  // 선택영역이 기준 스티커의 종횡비와 너무 다르면 분석값을 그대로 신뢰하지 않는다.
  const referenceAspect=reference.naturalWidth/Math.max(1,reference.naturalHeight);
  const selectedAspect=
    (S.selection.width*S.photoImage.naturalWidth)/
    Math.max(1,S.selection.height*S.photoImage.naturalHeight);

  const aspectRatioDelta=Math.max(referenceAspect,selectedAspect)/
    Math.max(.0001,Math.min(referenceAspect,selectedAspect));

  if(aspectRatioDelta>1.45){
    status="확인필요";
    findings.push("선택영역 비율이 기준 스티커와 크게 다릅니다. 스티커만 더 타이트하게 다시 지정하는 것을 권장합니다.");
  }

  if(metrics.featureBlocks<8){
    status="확인필요";
    findings.push("비교 가능한 스티커 특징이 충분하지 않습니다. 더 선명한 사진으로 다시 촬영해 주세요.");
  }

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
    findings.push(`형상 유사도 ${metrics.shape}% → 로고·문구·그래픽 변화 확인필요`);
  }

  if(Number(rules.use_color)===1&&metrics.color>Number(rules.color_difference_max)){
    status="확인필요";
    findings.push(`스티커 주요 색상차이 ${metrics.color} → 변색·오염 확인필요`);
  }

  if(metrics.strongMatchCoverage<35&&metrics.damage<Number(rules.damage_replace_min)){
    status="확인필요";
    findings.push("기준 특징의 정합률이 낮습니다. 촬영각도 또는 선택영역을 확인해 주세요.");
  }

  if(!findings.length){
    findings.push("설정된 판정기준에서 뚜렷한 이상징후가 없습니다.");
  }

  let score=r1(clamp(
    metrics.shape*.55+
    (100-metrics.damage)*.40+
    (100-Math.min(100,metrics.color))*.05,
    0,100
  ));

  if(aspectRatioDelta>1.45)score=Math.min(score,75);

  return{
    score,
    status,
    recommendation,
    findings,
    metrics:{
      ...metrics,
      missing:false,
      aspectRatioDelta:r1(aspectRatioDelta)
    }
  };
}

/*
V2 comparison logic
-------------------
1. Both images are normalized to the same working canvas.
2. Reference-image feature blocks are extracted.
3. Each reference block searches for the best corresponding block.
4. High-confidence matches estimate a global affine displacement field
   (translation / small scale / rotation / shear).
5. Every block is compared again near its predicted aligned position.
6. Damage is based only on reference feature blocks that disappear in
   spatially continuous clusters. New tear edges do NOT reduce damage.
7. Shape similarity is the weighted structural match of the original
   reference features, not the total number of edges in each photograph.
*/
function compareStickerV2(reference,current){
  const W=192,H=96;
  const A=featureDescriptor(reference,W,H);
  const B=featureDescriptor(current,W,H);

  const coarse=coarseFeatureMatches(A,B);
  const model=fitAffineDisplacement(coarse);
  const refined=refineFeatureMatches(A,B,coarse,model);

  if(!refined.length){
    return{
      damage:100,
      shape:0,
      color:100,
      strongMatchCoverage:0,
      featureBlocks:0,
      alignmentInliers:0
    };
  }

  let totalWeight=0;
  let weightedShape=0;
  let strongWeight=0;

  for(const r of refined){
    totalWeight+=r.weight;
    weightedShape+=r.weight*r.score;
    if(r.score>=.80)strongWeight+=r.weight;
  }

  const shape=r1(clamp(
    weightedShape/Math.max(.0001,totalWeight)*100,
    0,100
  ));

  const damage=r1(clusteredReferenceLoss(refined));
  const color=r1(foregroundColorDifference(A,B));

  return{
    damage,
    shape,
    color,
    strongMatchCoverage:r1(strongWeight/Math.max(.0001,totalWeight)*100),
    featureBlocks:refined.length,
    alignmentInliers:model.inliers||0
  };
}

function featureDescriptor(img,W,H){
  const c=document.createElement("canvas");
  c.width=W;
  c.height=H;

  const ctx=c.getContext("2d",{willReadFrequently:true});
  ctx.drawImage(img,0,0,W,H);

  const rgba=ctx.getImageData(0,0,W,H).data;
  const gray=new Float32Array(W*H);
  const rgb=new Uint8Array(W*H*3);

  for(let p=0,i=0;p<W*H;p++,i+=4){
    const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
    rgb[p*3]=r;
    rgb[p*3+1]=g;
    rgb[p*3+2]=b;
    gray[p]=.299*r+.587*g+.114*b;
  }

  const bg=estimateBorderColor(rgb,W,H);
  const mask=new Uint8Array(W*H);

  const saturatedPixels=[];
  for(let p=0;p<W*H;p++){
    const r=rgb[p*3],g=rgb[p*3+1],b=rgb[p*3+2];
    const dr=r-bg[0],dg=g-bg[1],db=b-bg[2];
    const distance=Math.sqrt(dr*dr+dg*dg+db*db);

    const max=Math.max(r,g,b);
    const min=Math.min(r,g,b);
    const sat=max===0?0:(max-min)/max;

    if(distance>45)mask[p]=1;

    // Vehicle body colour is mostly excluded by taking chromatic foreground pixels.
    if(distance>45&&sat>.18&&max>35){
      const sum=r+g+b||1;
      saturatedPixels.push([r/sum,g/sum,b/sum]);
    }
  }

  const grad=new Float32Array(W*H);
  let gradValues=[];

  for(let y=1;y<H-1;y++){
    for(let x=1;x<W-1;x++){
      const p=y*W+x;
      const gx=(gray[p+1]-gray[p-1])*.5;
      const gy=(gray[p+W]-gray[p-W])*.5;
      const value=Math.sqrt(gx*gx+gy*gy);
      grad[p]=value;
      gradValues.push(value);
    }
  }

  const scale=percentile(gradValues,.95)||1;
  for(let p=0;p<grad.length;p++){
    grad[p]=clamp(grad[p]/scale,0,1);
  }

  let colorVector=null;
  if(saturatedPixels.length>=10){
    let r=0,g=0,b=0;
    for(const v of saturatedPixels){
      r+=v[0];g+=v[1];b+=v[2];
    }
    colorVector=[
      r/saturatedPixels.length,
      g/saturatedPixels.length,
      b/saturatedPixels.length
    ];
  }

  return{W,H,gray,grad,mask,bg,colorVector};
}

function estimateBorderColor(rgb,W,H){
  const rs=[],gs=[],bs=[];
  const band=4;

  function add(x,y){
    const p=(y*W+x)*3;
    rs.push(rgb[p]);
    gs.push(rgb[p+1]);
    bs.push(rgb[p+2]);
  }

  for(let y=0;y<H;y++){
    for(let x=0;x<W;x++){
      if(x<band||x>=W-band||y<band||y>=H-band)add(x,y);
    }
  }

  return[median(rs),median(gs),median(bs)];
}

function coarseFeatureMatches(A,B){
  const patch=12;
  const stride=8;
  const search=10;
  const records=[];

  for(let y=0;y<=A.H-patch;y+=stride){
    for(let x=0;x<=A.W-patch;x+=stride){
      const info=referencePatchInformation(A,x,y,patch);

      if(info.foregroundFraction<.08&&info.edgeMean<.12)continue;

      const weight=clamp(
        .25+info.foregroundFraction*2.5+info.edgeMean*1.25,
        .25,3
      );

      let bestScore=-1;
      let bestDx=0,bestDy=0;

      for(let dy=-search;dy<=search;dy+=2){
        const yy=y+dy;
        if(yy<0||yy+patch>A.H)continue;

        for(let dx=-search;dx<=search;dx+=2){
          const xx=x+dx;
          if(xx<0||xx+patch>A.W)continue;

          const score=structuralPatchScore(A,B,x,y,xx,yy,patch);

          if(score>bestScore){
            bestScore=score;
            bestDx=dx;
            bestDy=dy;
          }
        }
      }

      records.push({
        x,y,weight,
        score:Math.max(0,bestScore),
        dx:bestDx,
        dy:bestDy,
        stride
      });
    }
  }

  return records;
}

function referencePatchInformation(A,x,y,patch){
  let fg=0;
  let edge=0;
  let count=0;

  for(let yy=0;yy<patch;yy++){
    for(let xx=0;xx<patch;xx++){
      const p=(y+yy)*A.W+(x+xx);
      fg+=A.mask[p];
      edge+=A.grad[p];
      count++;
    }
  }

  return{
    foregroundFraction:fg/Math.max(1,count),
    edgeMean:edge/Math.max(1,count)
  };
}

function structuralPatchScore(A,B,ax,ay,bx,by,patch){
  let n=0;

  let sa=0,sb=0,saa=0,sbb=0,sab=0;
  let ga=0,gb=0,gaa=0,gbb=0,gab=0;

  for(let yy=0;yy<patch;yy++){
    for(let xx=0;xx<patch;xx++){
      const pa=(ay+yy)*A.W+(ax+xx);
      const pb=(by+yy)*B.W+(bx+xx);

      // Focus the comparison on reference features and their immediate structure.
      if(A.mask[pa]===0&&A.grad[pa]<.10)continue;

      const a=A.gray[pa];
      const b=B.gray[pb];
      const ag=A.grad[pa];
      const bg=B.grad[pb];

      sa+=a;sb+=b;
      saa+=a*a;sbb+=b*b;sab+=a*b;

      ga+=ag;gb+=bg;
      gaa+=ag*ag;gbb+=bg*bg;gab+=ag*bg;

      n++;
    }
  }

  if(n<16)return 0;

  const grayCorr=Math.abs(correlationFromSums(n,sa,sb,saa,sbb,sab));
  const gradCorr=Math.max(0,correlationFromSums(n,ga,gb,gaa,gbb,gab));

  const varA=Math.max(0,saa/n-(sa/n)*(sa/n));
  const varB=Math.max(0,sbb/n-(sb/n)*(sb/n));
  const sdA=Math.sqrt(varA);
  const sdB=Math.sqrt(varB);

  const textureEnergy=
    sdA<1||sdB<1
      ? 0
      : Math.min(sdA/sdB,sdB/sdA);

  return clamp(
    grayCorr*.62+
    gradCorr*.25+
    textureEnergy*.13,
    0,1
  );
}

function correlationFromSums(n,sa,sb,saa,sbb,sab){
  const numerator=n*sab-sa*sb;
  const da=n*saa-sa*sa;
  const db=n*sbb-sb*sb;

  if(da<=1e-8||db<=1e-8)return 0;

  return clamp(
    numerator/Math.sqrt(da*db),
    -1,1
  );
}

function fitAffineDisplacement(records){
  let selected=records.filter(r=>r.score>=.78);

  // Severe damage may leave fewer high-confidence blocks.
  if(selected.length<8){
    selected=records
      .slice()
      .sort((a,b)=>b.score-a.score)
      .slice(0,Math.min(30,records.length));
  }

  if(selected.length<4){
    return{dx:[0,0,0],dy:[0,0,0],inliers:0};
  }

  let model=weightedAffineFit(selected);

  // Robust second pass: discard displacement outliers.
  let inliers=selected.filter(r=>{
    const pdx=model.dx[0]+model.dx[1]*r.x+model.dx[2]*r.y;
    const pdy=model.dy[0]+model.dy[1]*r.x+model.dy[2]*r.y;
    const residual=Math.hypot(pdx-r.dx,pdy-r.dy);
    return residual<=4.5;
  });

  if(inliers.length>=4){
    model=weightedAffineFit(inliers);
  }else{
    inliers=selected;
  }

  return{...model,inliers:inliers.length};
}

function weightedAffineFit(records){
  const M=[
    [0,0,0],
    [0,0,0],
    [0,0,0]
  ];

  const vx=[0,0,0];
  const vy=[0,0,0];

  for(const r of records){
    const z=[1,r.x,r.y];
    const w=r.weight*Math.max(.15,r.score);

    for(let i=0;i<3;i++){
      vx[i]+=w*z[i]*r.dx;
      vy[i]+=w*z[i]*r.dy;

      for(let j=0;j<3;j++){
        M[i][j]+=w*z[i]*z[j];
      }
    }
  }

  for(let i=0;i<3;i++)M[i][i]+=1e-6;

  return{
    dx:solve3(M,vx),
    dy:solve3(M,vy)
  };
}

function solve3(matrix,vector){
  const a=matrix.map((row,i)=>[...row,vector[i]]);

  for(let col=0;col<3;col++){
    let pivot=col;

    for(let row=col+1;row<3;row++){
      if(Math.abs(a[row][col])>Math.abs(a[pivot][col]))pivot=row;
    }

    if(Math.abs(a[pivot][col])<1e-10)return[0,0,0];

    [a[col],a[pivot]]=[a[pivot],a[col]];

    const div=a[col][col];
    for(let j=col;j<4;j++)a[col][j]/=div;

    for(let row=0;row<3;row++){
      if(row===col)continue;

      const factor=a[row][col];
      for(let j=col;j<4;j++){
        a[row][j]-=factor*a[col][j];
      }
    }
  }

  return[a[0][3],a[1][3],a[2][3]];
}

function refineFeatureMatches(A,B,records,model){
  const patch=12;
  const local=3;
  const refined=[];

  for(const r of records){
    const pdx=model.dx[0]+model.dx[1]*r.x+model.dx[2]*r.y;
    const pdy=model.dy[0]+model.dy[1]*r.x+model.dy[2]*r.y;

    let best=0;

    for(let ddy=-local;ddy<=local;ddy++){
      const yy=Math.round(r.y+pdy+ddy);
      if(yy<0||yy+patch>B.H)continue;

      for(let ddx=-local;ddx<=local;ddx++){
        const xx=Math.round(r.x+pdx+ddx);
        if(xx<0||xx+patch>B.W)continue;

        const score=structuralPatchScore(
          A,B,
          r.x,r.y,
          xx,yy,
          patch
        );

        if(score>best)best=score;
      }
    }

    refined.push({
      x:r.x,
      y:r.y,
      weight:r.weight,
      score:best,
      stride:r.stride
    });
  }

  return refined;
}

function clusteredReferenceLoss(records){
  const weakThreshold=.80;
  const veryWeakThreshold=.58;

  const map=new Map();

  for(const r of records){
    map.set(`${r.x},${r.y}`,r);
  }

  let total=0;
  let lost=0;

  for(const r of records){
    total+=r.weight;

    if(r.score>=weakThreshold)continue;

    let contribution=0;

    if(r.score<veryWeakThreshold){
      contribution=1;
    }else{
      let weakNeighbours=0;
      const s=r.stride;

      for(const dy of[-s,0,s]){
        for(const dx of[-s,0,s]){
          if(dx===0&&dy===0)continue;

          const n=map.get(`${r.x+dx},${r.y+dy}`);

          if(n&&n.score<weakThreshold){
            weakNeighbours++;
          }
        }
      }

      // Continuous damaged regions count fully.
      // Isolated mismatches are mostly caused by angle / reflection / crop noise.
      contribution=weakNeighbours>=2?1:.20;
    }

    lost+=r.weight*contribution;
  }

  return clamp(
    lost/Math.max(.0001,total)*100,
    0,100
  );
}

function foregroundColorDifference(A,B){
  if(!A.colorVector||!B.colorVector)return 0;

  const a=A.colorVector;
  const b=B.colorVector;

  const distance=Math.sqrt(
    (a[0]-b[0])**2+
    (a[1]-b[1])**2+
    (a[2]-b[2])**2
  );

  return clamp(distance*180,0,100);
}

function percentile(values,q){
  if(!values.length)return 0;

  const a=values.slice().sort((x,y)=>x-y);
  const pos=(a.length-1)*q;
  const lo=Math.floor(pos);
  const hi=Math.ceil(pos);

  if(lo===hi)return a[lo];

  const t=pos-lo;
  return a[lo]*(1-t)+a[hi]*t;
}

function median(values){
  if(!values.length)return 0;
  const a=values.slice().sort((x,y)=>x-y);
  const mid=Math.floor(a.length/2);
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2;
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
