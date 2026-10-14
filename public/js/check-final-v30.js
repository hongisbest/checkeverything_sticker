(() => {
  "use strict";

  const FINAL_ENGINE="final-presence-v7-color-structure-first";
  const PLATE_HANGUL=
    "가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호";

  let ocrWorkerPromise=null;

  // ==========================================================
  // 1) FINAL STICKER ANALYSIS
  // ==========================================================
  //
  // 최종판정에 사용하는 항목은 아래뿐입니다.
  // - 공통: 스티커 존재 / 미검출
  // - 후면: 존재한 스티커의 좌우 위치
  // - 판정불가: 분석모듈/기준정보/위치판정 불확실
  //
  // 손상률, 구조보존율, 디자인 점수, 크기차이, 임의제작은
  // 최종판정에 사용하지 않습니다.

  window.analyzeSnapshotAgainstMasterAndExamples=async function(snapshot,examples){
    const vehicleExamples=(examples||[]).filter(x=>
      x?.calibrated && x?.vehicle_type===snapshot?.vehicleType
    );

    const candidateExamples=vehicleExamples.length
      ? vehicleExamples
      : (examples||[]).filter(x=>x?.calibrated);

    if(!candidateExamples.length){
      return finalUnavailable(
        "동일 차종 정상예시의 스티커 기준영역을 불러오지 못했습니다."
      );
    }

    try{
      const firstExample=candidateExamples[0]||null;
      const firstBroadBox=firstExample
        ? buildBroadStickerSearchBox(snapshot,firstExample)
        : broadFallbackFromPlate(
            snapshot?.plateSelection,
            snapshot?.sticker?.side_hint
          );

      const colorPresence=detectColorStructurePresence(
        snapshot.photoImage,
        firstBroadBox,
        snapshot?.sticker
      );

      // 색상+최소구조가 명확하면 무거운 ORB를 돌리지 않습니다.
      if(colorPresence.pass){
        let rearPosition={
          position:"not-applicable",
          method:"color-structure",
          value:null
        };

        if(snapshot.sticker.side_hint==="rear"){
          const cvReady=await waitForOpenCv(8000);

          if(!cvReady){
            return finalUnavailable(
              "후면 위치 확인을 위한 영상 분석모듈을 불러오지 못했습니다."
            );
          }

          const referenceImage=await loadImage(firstExample.image_url);
          rearPosition=await determineRearSide(
            snapshot,
            firstExample,
            referenceImage,
            colorPresence.center
          );
        }

        const metrics={
          finalPresenceV1:true,
          finalPresenceV2:true,
          finalPresenceV3:true,
          finalPresenceV7:true,
          analysisEngine:FINAL_ENGINE,
          vehicleType:snapshot.vehicleType,
          sideHint:snapshot.sticker.side_hint,
          stickerDetected:true,
          missing:false,
          presenceMethod:"color-structure",
          presenceColorFamily:colorPresence.family,
          presenceColorScore:round1(colorPresence.score*100),
          presenceUsedBroadRoi:true,
          presenceBroadSearchBox:firstBroadBox||null,
          detectedStickerBox:colorPresence.box||null,
          detectedStickerCenter:colorPresence.center||null,
          presenceReferenceAttempts:0,
          presenceAnalysisTimedOut:false,
          rearPosition:rearPosition.position,
          rearPositionMethod:rearPosition.method,
          rearPositionValue:Number.isFinite(rearPosition.value)
            ? round1(rearPosition.value)
            : null,
          simpleInspectionV25:true,
          damage:0,
          confidence:round1(colorPresence.score*100),
          rearLogoRight:rearPosition.position==="right",
          rearSizeDifference:null
        };

        if(snapshot.sticker.side_hint==="rear"){
          if(rearPosition.position==="left"){
            return{
              crop:null,
              analysis:{
                score:40,
                status:"확인필요",
                recommendation:"부착위치 확인",
                findings:[
                  "스티커 존재 확인 · 후면 좌우 위치 이상 → 정상 위치와 반대쪽에 부착된 것으로 판단됩니다."
                ],
                metrics
              }
            };
          }

          if(rearPosition.position!=="right"){
            return{
              crop:null,
              analysis:{
                score:30,
                status:"판정불가",
                recommendation:"관리자 확인",
                findings:[
                  "스티커 존재는 확인되었으나 후면 좌우 위치를 안정적으로 확정하지 못했습니다."
                ],
                metrics
              }
            };
          }
        }

        return{
          crop:null,
          analysis:{
            score:100,
            status:"정상",
            recommendation:"",
            findings:[
              "스티커 검출 → 색상과 최소 구조조건으로 스티커 존재가 확인되었습니다."
            ],
            metrics
          }
        };
      }

      const cvReady=await waitForOpenCv(10000);

      if(!cvReady){
        return finalUnavailable(
          "영상 분석모듈을 불러오지 못해 자동판정을 확정하지 않았습니다."
        );
      }
      let best=null;
      let attemptedExamples=0;
      const analysisStarted=performance.now();

      // 동일 차종 정상예시는 순차 시도하되, 존재가 확인되면 즉시 종료합니다.
      // 한 장의 예시 각도에만 종속되지 않도록 가장 강한 정합 결과를 사용합니다.
      for(const example of candidateExamples){
        let referenceImage=null;

        // 느린 단말에서도 분석이 끝없이 늘어지지 않도록 전체 분석시간을 제한합니다.
        if(best && performance.now()-analysisStarted>15000){
          best.presence.analysisTimedOut=true;
          break;
        }

        try{
          attemptedExamples++;
          referenceImage=await loadImage(example.image_url);

          const referenceStickerBox={
            x:Number(example.crop_x),
            y:Number(example.crop_y),
            width:Number(example.crop_width),
            height:Number(example.crop_height)
          };

          if(!validBox(referenceStickerBox))continue;

          const referenceSticker=cropBoxCanvas(
            referenceImage,
            referenceStickerBox,
            1200
          );

          const broadSearchBox=buildBroadStickerSearchBox(
            snapshot,
            example
          );

          const presence=await orbLocateObject(
            referenceSticker,
            snapshot.photoImage,
            broadSearchBox
          );

          const rank=
            (presence.pass ? 100000 : 0)+
            Number(presence.inliers||0)*120+
            Number(presence.goodMatches||0)*8-
            Math.min(999,Number(presence.topMeanDistance||999))*2;

          if(!best || rank>best.rank){
            best={example,referenceImage,presence,rank};
          }

          // 존재판정이 목적이므로 정상 검출 시 나머지 정상예시를 추가 분석하지 않습니다.
          if(presence.pass){
            break;
          }
        }catch(error){
          console.warn("normal example matching failed",error);
        }
      }

      if(!best){
        return finalUnavailable(
          "정상예시 스티커 기준영역을 이용한 분석을 수행하지 못했습니다."
        );
      }

      const {example,referenceImage,presence}=best;

      const metrics={
        finalPresenceV1:true,
        finalPresenceV2:true,
        finalPresenceV3:true,
        analysisEngine:FINAL_ENGINE,
        vehicleType:snapshot.vehicleType,
        sideHint:snapshot.sticker.side_hint,
        stickerDetected:presence.pass===true,
        missing:presence.pass!==true,
        presenceInliers:presence.inliers,
        presenceGoodMatches:presence.goodMatches,
        presenceInlierRatio:round1((presence.inlierRatio||0)*100),
        presenceTopMeanDistance:round1(presence.topMeanDistance),
        presenceReferenceKeypoints:presence.referenceKeypoints,
        presencePhotoKeypoints:presence.photoKeypoints,
        presenceSearchMaxSide:presence.searchMaxSide||null,
        presenceGeometryValid:presence.geometryValid===true,
        presenceGeometryScore:round1((presence.geometryScore||0)*100),
        presencePreprocessMode:presence.preprocessMode||null,
        presenceSearchStage:presence.searchStage||null,
        presenceMethod:"orb-fallback",
        presenceUsedBroadRoi:presence.usedBroadRoi===true,
        presenceBroadSearchBox:presence.broadSearchBox||null,
        detectedStickerBox:presence.projectedStickerBox||null,
        presenceReferenceAttempts:attemptedExamples,
        presenceAnalysisTimedOut:presence.analysisTimedOut===true,
        detectedStickerCenter:presence.center||null,
        rearPosition:"not-applicable",
        rearPositionMethod:null,
        rearPositionValue:null,

        // 구버전 관리자 화면 호환용. 최종판정에는 사용하지 않음.
        simpleInspectionV25:true,
        damage:0,
        confidence:round1(presence.confidence),
        rearLogoRight:null,
        rearSizeDifference:null
      };

      if(!presence.pass){
        return{
          crop:null,
          analysis:{
            score:0,
            status:"확인필요",
            recommendation:"미부착 여부 확인",
            findings:[
              "스티커 미검출 → 색상·최소구조 확인과 ORB 보조분석 모두에서 스티커 존재를 확인하지 못했습니다."
            ],
            metrics
          }
        };
      }

      if(snapshot.sticker.side_hint!=="rear"){
        return{
          crop:null,
          analysis:{
            score:100,
            status:"정상",
            recommendation:"",
            findings:[
              "스티커 검출 → 색상·최소구조 또는 ORB 보조분석에서 스티커 존재가 확인되었습니다."
            ],
            metrics:{
              ...metrics,
              missing:false
            }
          }
        };
      }

      const rear=await determineRearSide(
        snapshot,
        example,
        referenceImage,
        presence.center
      );

      metrics.rearPosition=rear.position;
      metrics.rearPositionMethod=rear.method;
      metrics.rearPositionValue=Number.isFinite(rear.value)
        ? round1(rear.value)
        : null;
      metrics.rearLogoRight=rear.position==="right";

      if(rear.position==="left"){
        return{
          crop:null,
          analysis:{
            score:40,
            status:"확인필요",
            recommendation:"부착위치 확인",
            findings:[
              "스티커 검출 · 후면 좌우 위치 이상 → 정상예시와 반대쪽에 부착된 것으로 판단됩니다."
            ],
            metrics
          }
        };
      }

      if(rear.position!=="right"){
        return{
          crop:null,
          analysis:{
            score:30,
            status:"판정불가",
            recommendation:"관리자 확인",
            findings:[
              "스티커는 검출되었으나 후면 좌우 위치를 안정적으로 확정하지 못했습니다."
            ],
            metrics
          }
        };
      }

      return{
        crop:null,
        analysis:{
          score:100,
          status:"정상",
          recommendation:"",
          findings:[
            "스티커 검출 · 후면 좌우 위치 정상 → 정상예시와 같은 방향에 부착되어 있습니다."
          ],
          metrics
        }
      };

    }catch(error){
      console.error("FINAL analysis failed",error);

      return finalUnavailable(
        "자동판정 중 오류가 발생해 정상으로 확정하지 않았습니다."
      );
    }
  };


  function expectedStickerFamily(sticker){
    const name=String(sticker?.name||sticker?.title||"").toLowerCase();
    const hint=String(sticker?.side_hint||"").toLowerCase();

    if(
      name.includes("운전") ||
      hint.includes("driver") ||
      hint==="left" ||
      hint.includes("driver_side")
    ){
      return"bgf-green";
    }

    if(
      name.includes("조수") ||
      name.includes("후면") ||
      hint==="rear" ||
      hint.includes("passenger") ||
      hint==="right"
    ){
      return"nice-cu";
    }

    // 모르는 면에서는 색상만으로 정상 확정하지 않고 ORB fallback으로 넘깁니다.
    return"unknown";
  }

  function detectColorStructurePresence(photoImage,broadBox,sticker){
    const family=expectedStickerFamily(sticker);

    if(family==="unknown"||!validBox(broadBox)){
      return{
        pass:false,
        family,
        score:0,
        center:null,
        box:null
      };
    }

    const search=buildSearchImage(photoImage,broadBox,900);
    const source=search.image;
    const sw=Number(source.naturalWidth||source.width||0);
    const sh=Number(source.naturalHeight||source.height||0);

    if(!sw||!sh){
      return{pass:false,family,score:0,center:null,box:null};
    }

    const targetW=Math.min(420,sw);
    const scale=targetW/sw;
    const targetH=Math.max(1,Math.round(sh*scale));
    const c=document.createElement("canvas");
    c.width=targetW;
    c.height=targetH;

    const ctx=c.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(source,0,0,targetW,targetH);

    const data=ctx.getImageData(0,0,targetW,targetH).data;
    const green=new Uint8Array(targetW*targetH);
    const purple=new Uint8Array(targetW*targetH);

    for(let i=0,p=0;i<data.length;i+=4,p++){
      const r=data[i];
      const g=data[i+1];
      const b=data[i+2];
      const max=Math.max(r,g,b);
      const min=Math.min(r,g,b);
      const sat=max?((max-min)/max):0;

      // BGF/말풍선 계열: 조명차를 고려하되 G가 분명히 우세한 픽셀만.
      if(
        g>=58 &&
        sat>=.16 &&
        g-r>=10 &&
        g-b>=5
      ){
        green[p]=1;
      }

      // CU 보라색: B/R가 G보다 분명히 높은 영역.
      if(
        b>=62 &&
        r>=48 &&
        sat>=.16 &&
        b-g>=14 &&
        r-g>=5
      ){
        purple[p]=1;
      }
    }

    const gi=buildIntegralMask(green,targetW,targetH);
    const pi=buildIntegralMask(purple,targetW,targetH);
    const widths=[.14,.20,.27,.35,.44];
    const heights=[.08,.11,.15,.20,.26];

    let best=null;

    for(const wf of widths){
      for(const hf of heights){
        const ww=Math.max(10,Math.round(targetW*wf));
        const hh=Math.max(8,Math.round(targetH*hf));
        const stepX=Math.max(4,Math.round(ww*.20));
        const stepY=Math.max(4,Math.round(hh*.24));

        for(let y=0;y+hh<=targetH;y+=stepY){
          for(let x=0;x+ww<=targetW;x+=stepX){
            const cx=(x+ww/2)/targetW;
            const cy=(y+hh/2)/targetH;

            // 넓은 ROI의 가장자리 배경간판은 우선 제외.
            if(cx<.10||cx>.90||cy<.10||cy>.90)continue;

            const area=ww*hh;
            const gCount=rectIntegralSum(gi,targetW+1,x,y,ww,hh);
            const pCount=rectIntegralSum(pi,targetW+1,x,y,ww,hh);
            const gRatio=gCount/area;
            const pRatio=pCount/area;

            let score=0;
            let pass=false;

            if(family==="bgf-green"){
              // 글자형 스티커는 픽셀 점유율이 낮으므로 '가로로 퍼져 있음'을 추가 확인.
              const thirds=[
                rectIntegralSum(gi,targetW+1,x,y,Math.floor(ww/3),hh),
                rectIntegralSum(gi,targetW+1,x+Math.floor(ww/3),y,Math.floor(ww/3),hh),
                rectIntegralSum(
                  gi,targetW+1,
                  x+Math.floor(ww*2/3),y,
                  ww-Math.floor(ww*2/3),hh
                )
              ];
              const activeThirds=thirds.filter(v=>v>=Math.max(3,area*.004)).length;

              score=
                clamp(gRatio/.055,0,1)*.62+
                clamp(activeThirds/3,0,1)*.25+
                (1-Math.min(1,Math.hypot(cx-.5,cy-.5)/.72))*.13;

              pass=
                gCount>=24 &&
                gRatio>=.018 &&
                activeThirds>=2 &&
                ww/hh>=1.25 &&
                score>=.60;
            }else{
              if(
                gCount>=12 &&
                pCount>=18 &&
                gRatio>=.007 &&
                pRatio>=.012
              ){
                const centroids=colorCentroidsInWindow(
                  green,purple,targetW,targetH,x,y,ww,hh
                );

                const aligned=
                  centroids.green &&
                  centroids.purple &&
                  Math.abs(centroids.green[1]-centroids.purple[1])<=hh*.42;

                const order=
                  centroids.green &&
                  centroids.purple &&
                  centroids.purple[0]>centroids.green[0]-ww*.12;

                const separation=centroids.green&&centroids.purple
                  ? Math.abs(centroids.purple[0]-centroids.green[0])/ww
                  : 0;

                score=
                  clamp(gRatio/.035,0,1)*.25+
                  clamp(pRatio/.055,0,1)*.37+
                  (aligned?.20:0)+
                  (order?.10:0)+
                  clamp(separation/.22,0,1)*.08;

                pass=
                  aligned &&
                  order &&
                  score>=.61;
              }
            }

            if(!pass)continue;

            if(!best||score>best.score){
              best={x,y,width:ww,height:hh,score};
            }
          }
        }
      }
    }

    if(!best){
      return{pass:false,family,score:0,center:null,box:null};
    }

    const localBox={
      x:best.x/targetW,
      y:best.y/targetH,
      width:best.width/targetW,
      height:best.height/targetH
    };

    const mapped=mapSearchBoxToPhoto(
      localBox,
      search,
      photoImage
    );

    const iw=Number(photoImage.naturalWidth||photoImage.width||1);
    const ih=Number(photoImage.naturalHeight||photoImage.height||1);
    const center=mapped
      ?[
          (mapped.x+mapped.width/2)*iw,
          (mapped.y+mapped.height/2)*ih
        ]
      :null;

    return{
      pass:true,
      family,
      score:best.score,
      center,
      box:mapped
    };
  }

  function buildIntegralMask(mask,w,h){
    const out=new Uint32Array((w+1)*(h+1));

    for(let y=1;y<=h;y++){
      let row=0;

      for(let x=1;x<=w;x++){
        row+=mask[(y-1)*w+(x-1)];
        out[y*(w+1)+x]=out[(y-1)*(w+1)+x]+row;
      }
    }

    return out;
  }

  function rectIntegralSum(integral,stride,x,y,w,h){
    const x2=x+w;
    const y2=y+h;

    return(
      integral[y2*stride+x2]-
      integral[y*stride+x2]-
      integral[y2*stride+x]+
      integral[y*stride+x]
    );
  }

  function colorCentroidsInWindow(green,purple,W,H,x,y,w,h){
    let gx=0,gy=0,gc=0;
    let px=0,py=0,pc=0;

    for(let yy=y;yy<y+h&&yy<H;yy++){
      const row=yy*W;

      for(let xx=x;xx<x+w&&xx<W;xx++){
        const i=row+xx;

        if(green[i]){
          gx+=xx;
          gy+=yy;
          gc++;
        }

        if(purple[i]){
          px+=xx;
          py+=yy;
          pc++;
        }
      }
    }

    return{
      green:gc?[gx/gc,gy/gc]:null,
      purple:pc?[px/pc,py/pc]:null
    };
  }


  async function orbLocateObject(referenceCanvas,photoImage,broadSearchBox=null){
    // 원칙:
    // 1) 번호판은 스티커 위치를 '정밀 고정'하는 용도가 아니라,
    //    차량 주변의 넓은 후보영역을 만드는 보조 기준으로만 사용합니다.
    // 2) 후보영역에서 먼저 존재를 찾고, 실패하면 전체사진 저비용 fallback을 수행합니다.
    // 3) 스티커 존재가 확인되면 즉시 종료합니다.

    const stages=[
      {maxSide:1400,mode:"raw",features:2400,refMax:620},
      {maxSide:1800,mode:"raw",features:3200,refMax:680},
      {maxSide:1800,mode:"clahe",features:3600,refMax:680},
      {maxSide:2200,mode:"raw",features:4200,refMax:740}
    ];

    const started=performance.now();
    let best=null;

    const targets=[];

    if(validBox(broadSearchBox)){
      targets.push({
        imageInfo:buildSearchImage(photoImage,broadSearchBox,2600),
        usedBroadRoi:true,
        broadSearchBox
      });
    }

    // 번호판 기반 후보영역이 어긋나는 예외를 대비해 전체사진 fallback은 반드시 남깁니다.
    targets.push({
      imageInfo:{
        image:photoImage,
        offsetX:0,
        offsetY:0,
        sourceScale:1
      },
      usedBroadRoi:false,
      broadSearchBox:broadSearchBox||null
    });

    for(let targetIndex=0;targetIndex<targets.length;targetIndex++){
      const target=targets[targetIndex];

      // ROI에서는 충분히 단계적으로 보고,
      // 전체사진 fallback은 속도 때문에 앞 2단계까지만 봅니다.
      const stageLimit=target.usedBroadRoi ? stages.length : 2;

      for(let i=0;i<stageLimit;i++){
        const stage=stages[i];

        const result=orbLocateObjectAtScale(
          referenceCanvas,
          target.imageInfo.image,
          stage.maxSide,
          stage.mode,
          stage.features,
          stage.refMax
        );

        result.searchStage=i+1;
        result.usedBroadRoi=target.usedBroadRoi;
        result.broadSearchBox=target.broadSearchBox||null;

        if(result.center){
          result.center=[
            target.imageInfo.offsetX+
              result.center[0]/Math.max(.0001,target.imageInfo.sourceScale),
            target.imageInfo.offsetY+
              result.center[1]/Math.max(.0001,target.imageInfo.sourceScale)
          ];
        }

        if(result.projectedStickerBox){
          result.projectedStickerBox=mapSearchBoxToPhoto(
            result.projectedStickerBox,
            target.imageInfo,
            photoImage
          );
        }

        const rank=
          (result.pass ? 100000 : 0)+
          Number(result.inliers||0)*150+
          Number(result.goodMatches||0)*10+
          Number(result.geometryScore||0)*1200-
          Math.min(999,Number(result.topMeanDistance||999))*2;

        if(!best || rank>best.rank){
          best={...result,rank};
        }

        if(result.pass){
          return result;
        }

        if(performance.now()-started>8500){
          if(best)best.analysisTimedOut=true;
          break;
        }

        await new Promise(resolve=>setTimeout(resolve,0));
      }

      if(performance.now()-started>8500)break;
    }

    if(best){
      delete best.rank;
      return best;
    }

    return{
      pass:false,
      inliers:0,
      goodMatches:0,
      inlierRatio:0,
      topMeanDistance:999,
      referenceKeypoints:0,
      photoKeypoints:0,
      confidence:0,
      center:null,
      geometryValid:false,
      geometryScore:0,
      preprocessMode:null,
      searchStage:null,
      analysisTimedOut:false,
      searchMaxSide:null,
      usedBroadRoi:false,
      broadSearchBox:broadSearchBox||null
    };
  }

  function buildBroadStickerSearchBox(snapshot,example){
    const p=snapshot?.plateSelection;

    if(!validBox(p))return null;

    const refPlate={
      x:Number(example?.plate_x),
      y:Number(example?.plate_y),
      width:Number(example?.plate_width),
      height:Number(example?.plate_height)
    };

    const refSticker={
      x:Number(example?.crop_x),
      y:Number(example?.crop_y),
      width:Number(example?.crop_width),
      height:Number(example?.crop_height)
    };

    if(!example?.plate_calibrated || !validBox(refPlate) || !validBox(refSticker)){
      return broadFallbackFromPlate(p,snapshot?.sticker?.side_hint);
    }

    const pCx=Number(p.x)+Number(p.width)/2;
    const pCy=Number(p.y)+Number(p.height)/2;
    const rpCx=refPlate.x+refPlate.width/2;
    const rpCy=refPlate.y+refPlate.height/2;
    const rsCx=refSticker.x+refSticker.width/2;
    const rsCy=refSticker.y+refSticker.height/2;

    const sx=Number(p.width)/Math.max(.0001,refPlate.width);
    const sy=Number(p.height)/Math.max(.0001,refPlate.height);

    // 원근차이가 큰 측면사진에서 한 축의 배율이 튀는 것을 방지합니다.
    const scale=clamp(Math.sqrt(Math.max(.02,sx*sy)),.35,3.5);

    const predictedCx=pCx+(rsCx-rpCx)*scale;
    const predictedCy=pCy+(rsCy-rpCy)*scale;
    const predictedW=Math.max(.02,refSticker.width*scale);
    const predictedH=Math.max(.015,refSticker.height*scale);

    const rear=snapshot?.sticker?.side_hint==="rear";

    // 절대 타이트하게 잡지 않습니다.
    // 측면은 위치 편차가 크므로 화면의 절반 가까이를 탐색 대상으로 둡니다.
    const width=clamp(
      Math.max(predictedW*(rear?3.4:4.6),rear?.34:.48),
      rear?.34:.48,
      rear?.62:.78
    );

    const height=clamp(
      Math.max(predictedH*(rear?3.6:5.0),rear?.30:.42),
      rear?.30:.42,
      rear?.58:.74
    );

    return clampBox({
      x:predictedCx-width/2,
      y:predictedCy-height/2,
      width,
      height
    });
  }

  function broadFallbackFromPlate(plate,sideHint){
    if(!validBox(plate))return null;

    const cx=Number(plate.x)+Number(plate.width)/2;
    const cy=Number(plate.y)+Number(plate.height)/2;
    const rear=sideHint==="rear";

    return clampBox({
      x:cx-(rear?.42:.50),
      y:cy-(rear?.28:.34),
      width:rear?.72:.92,
      height:rear?.56:.68
    });
  }

  function buildSearchImage(photoImage,box,maxSide=2600){
    const iw=Number(photoImage.naturalWidth||photoImage.width||0);
    const ih=Number(photoImage.naturalHeight||photoImage.height||0);

    if(!iw||!ih||!validBox(box)){
      return{
        image:photoImage,
        offsetX:0,
        offsetY:0,
        sourceScale:1
      };
    }

    const sx=Math.max(0,Math.round(Number(box.x)*iw));
    const sy=Math.max(0,Math.round(Number(box.y)*ih));
    const sw=Math.max(1,Math.round(Number(box.width)*iw));
    const sh=Math.max(1,Math.round(Number(box.height)*ih));
    const scale=Math.min(1,maxSide/Math.max(sw,sh));

    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(sw*scale));
    c.height=Math.max(1,Math.round(sh*scale));

    c.getContext("2d").drawImage(
      photoImage,
      sx,sy,sw,sh,
      0,0,c.width,c.height
    );

    return{
      image:c,
      offsetX:sx,
      offsetY:sy,
      sourceScale:scale
    };
  }

  function mapSearchBoxToPhoto(box,imageInfo,photoImage){
    if(!box)return null;

    const fullW=Number(photoImage.naturalWidth||photoImage.width||1);
    const fullH=Number(photoImage.naturalHeight||photoImage.height||1);
    const img= imageInfo.image;
    const localW=Number(img.naturalWidth||img.width||1);
    const localH=Number(img.naturalHeight||img.height||1);

    const localPx={
      x:Number(box.x)*localW,
      y:Number(box.y)*localH,
      width:Number(box.width)*localW,
      height:Number(box.height)*localH
    };

    return clampBox({
      x:(imageInfo.offsetX+localPx.x/Math.max(.0001,imageInfo.sourceScale))/fullW,
      y:(imageInfo.offsetY+localPx.y/Math.max(.0001,imageInfo.sourceScale))/fullH,
      width:(localPx.width/Math.max(.0001,imageInfo.sourceScale))/fullW,
      height:(localPx.height/Math.max(.0001,imageInfo.sourceScale))/fullH
    });
  }

  function orbLocateObjectAtScale(referenceCanvas,photoImage,targetMaxSide,preprocessMode="raw",maxFeatures=4000,referenceMaxSide=700){
    const photo=fitImageToTargetMaxSide(photoImage,targetMaxSide);
    const ref=fitCanvasMaxSide(referenceCanvas,referenceMaxSide);

    let src=null,dst=null,g1=null,g2=null;
    let mask1=null,mask2=null,kp1=null,kp2=null;
    let des1=null,des2=null,orb=null,matcher=null,matches=null;
    let srcPts=null,dstPts=null,homography=null,hMask=null;

    try{
      src=cv.imread(ref.canvas);
      dst=cv.imread(photo.canvas);
      g1=new cv.Mat();
      g2=new cv.Mat();

      cv.cvtColor(src,g1,cv.COLOR_RGBA2GRAY);
      cv.cvtColor(dst,g2,cv.COLOR_RGBA2GRAY);

      if(preprocessMode==="clahe"){
        applyClaheInPlace(g1);
        applyClaheInPlace(g2);
      }

      mask1=new cv.Mat();
      mask2=new cv.Mat();
      kp1=new cv.KeyPointVector();
      kp2=new cv.KeyPointVector();
      des1=new cv.Mat();
      des2=new cv.Mat();

      // 존재 여부가 핵심이므로 작은 글자형 스티커에서도 특징점을 최대한 확보합니다.
      orb=new cv.ORB(Math.max(1800,Number(maxFeatures)||4000));
      orb.detectAndCompute(g1,mask1,kp1,des1);
      orb.detectAndCompute(g2,mask2,kp2,des2);

      const referenceKeypoints=kp1.size();
      const photoKeypoints=kp2.size();

      // BGF리테일처럼 단색 글자형 스티커는 기준영역 자체의 특징점이 적을 수 있습니다.
      if(
        referenceKeypoints<6 ||
        photoKeypoints<30 ||
        des1.empty() ||
        des2.empty()
      ){
        return{
          pass:false,
          inliers:0,
          goodMatches:0,
          inlierRatio:0,
          topMeanDistance:999,
          referenceKeypoints,
          photoKeypoints,
          confidence:0,
          center:null,
          geometryValid:false,
          geometryScore:0,
          preprocessMode,
          searchStage:null,
          analysisTimedOut:false,
          searchMaxSide:targetMaxSide
        };
      }

      matcher=new cv.BFMatcher(cv.NORM_HAMMING,true);
      matches=new cv.DMatchVector();
      matcher.match(des1,des2,matches);

      const all=[];
      const good=[];

      for(let i=0;i<matches.size();i++){
        const m=matches.get(i);
        const d=Number(m.distance);

        if(!Number.isFinite(d))continue;

        const item={
          distance:d,
          queryIdx:Number(m.queryIdx),
          trainIdx:Number(m.trainIdx)
        };

        all.push(item);

        // 디자인 정밀도보다 실제 존재를 우선하므로 후보 폭을 넓히고
        // 아래 RANSAC + 투영형상 검증으로 오탐을 다시 걸러냅니다.
        if(d<78)good.push(item);
      }

      all.sort((a,b)=>a.distance-b.distance);

      const top=all.slice(0,Math.min(30,all.length));
      const topMeanDistance=top.length
        ? top.reduce((s,x)=>s+x.distance,0)/top.length
        : 999;

      if(good.length<4){
        return{
          pass:false,
          inliers:0,
          goodMatches:good.length,
          inlierRatio:0,
          topMeanDistance,
          referenceKeypoints,
          photoKeypoints,
          confidence:0,
          center:null,
          geometryValid:false,
          geometryScore:0,
          preprocessMode,
          searchStage:null,
          analysisTimedOut:false,
          searchMaxSide:targetMaxSide
        };
      }

      const srcArr=[];
      const dstArr=[];

      for(const m of good){
        const a=kp1.get(m.queryIdx).pt;
        const b=kp2.get(m.trainIdx).pt;

        srcArr.push(Number(a.x),Number(a.y));
        dstArr.push(Number(b.x),Number(b.y));
      }

      srcPts=cv.matFromArray(
        good.length,1,cv.CV_32FC2,srcArr
      );
      dstPts=cv.matFromArray(
        good.length,1,cv.CV_32FC2,dstArr
      );

      hMask=new cv.Mat();
      homography=cv.findHomography(
        srcPts,
        dstPts,
        cv.RANSAC,
        6,
        hMask
      );

      const inlierPoints=[];
      let inliers=0;

      if(homography && !homography.empty() && hMask && !hMask.empty()){
        for(let i=0;i<good.length;i++){
          const isInlier=Number(hMask.data[i]||0)>0;
          if(!isInlier)continue;

          inliers++;

          const p=kp2.get(good[i].trainIdx).pt;
          inlierPoints.push([
            Number(p.x)/photo.scale,
            Number(p.y)/photo.scale
          ]);
        }
      }

      const inlierRatio=inliers/Math.max(1,good.length);

      const H=mat3x3Values(homography);
      const projected=H
        ? projectReferenceCorners(
            H,
            ref.canvas.width,
            ref.canvas.height,
            photo.canvas.width,
            photo.canvas.height,
            photo.scale
          )
        : null;

      const geometryValid=Boolean(projected?.valid);

      const center=geometryValid
        ? projected.center
        : (inlierPoints.length
            ? [
                median(inlierPoints.map(x=>x[0])),
                median(inlierPoints.map(x=>x[1]))
              ]
            : null);

      const geometryScore=Number(projected?.geometryScore||0);

      // 매우 강한 특징점 일치는 그대로 정상 인정합니다.
      const strictPass=
        inliers>=8 &&
        topMeanDistance<=42.0 &&
        Boolean(center);

      // 원근/촬영거리 변화가 있는 사진.
      const perspectivePass=
        inliers>=7 &&
        good.length>=8 &&
        inlierRatio>=.16 &&
        topMeanDistance<=58.0 &&
        geometryValid &&
        geometryScore>=.38 &&
        Boolean(center);

      // 현장 보정 핵심:
      // 디자인의 세부 일치보다 "동일한 평면 객체가 실제 위치에 존재하는가"를 우선합니다.
      // 특징점 수가 적은 BGF리테일 글자형 스티커도, RANSAC 투영형상이 안정적이면 존재로 인정합니다.
      const presencePass=
        inliers>=5 &&
        good.length>=6 &&
        inlierRatio>=.10 &&
        topMeanDistance<=70.0 &&
        geometryValid &&
        geometryScore>=.52 &&
        Boolean(center);

      const pass=strictPass||perspectivePass||presencePass;

      const confidence=pass
        ? clamp(
            (Math.min(16,inliers)/16)*42+
            clamp(inlierRatio/.35,0,1)*20+
            clamp(geometryScore/.85,0,1)*28+
            clamp((74-topMeanDistance)/34,0,1)*10,
            0,100
          )
        : 0;

      return{
        pass,
        inliers,
        goodMatches:good.length,
        inlierRatio,
        topMeanDistance,
        referenceKeypoints,
        photoKeypoints,
        confidence,
        center,
        geometryValid,
        geometryScore,
        projectedStickerBox:projected?.box||null,
        preprocessMode,
        searchStage:null,
        analysisTimedOut:false,
        searchMaxSide:targetMaxSide
      };

    }finally{
      for(const obj of [
        hMask,homography,dstPts,srcPts,matches,matcher,orb,
        des2,des1,kp2,kp1,mask2,mask1,g2,g1,dst,src
      ]){
        try{obj?.delete?.();}catch{}
      }
    }
  }

  function projectReferenceCorners(H,refW,refH,photoW,photoH,photoScale){
    if(!H||H.length<9)return null;

    const map=(x,y)=>{
      const d=H[6]*x+H[7]*y+H[8];
      if(!Number.isFinite(d)||Math.abs(d)<1e-8)return null;

      const px=(H[0]*x+H[1]*y+H[2])/d;
      const py=(H[3]*x+H[4]*y+H[5])/d;

      if(!Number.isFinite(px)||!Number.isFinite(py))return null;
      return[px,py];
    };

    const pts=[
      map(0,0),
      map(refW,0),
      map(refW,refH),
      map(0,refH)
    ];

    if(pts.some(x=>!x))return null;

    const xs=pts.map(p=>p[0]);
    const ys=pts.map(p=>p[1]);
    const minX=Math.min(...xs);
    const maxX=Math.max(...xs);
    const minY=Math.min(...ys);
    const maxY=Math.max(...ys);
    const w=maxX-minX;
    const h=maxY-minY;

    if(w<10||h<6)return null;

    const bboxArea=(w*h)/Math.max(1,photoW*photoH);
    const ratio=w/Math.max(1,h);

    const polygonArea=Math.abs(
      pts.reduce((sum,p,i)=>{
        const q=pts[(i+1)%pts.length];
        return sum + p[0]*q[1]-q[0]*p[1];
      },0)
    )/2;

    const polygonFill=polygonArea/Math.max(1,w*h);

    const cross=[];
    for(let i=0;i<4;i++){
      const a=pts[i];
      const b=pts[(i+1)%4];
      const c=pts[(i+2)%4];
      cross.push(
        (b[0]-a[0])*(c[1]-b[1])-
        (b[1]-a[1])*(c[0]-b[0])
      );
    }

    const sameSign=
      cross.every(v=>v>0) ||
      cross.every(v=>v<0);

    const marginX=photoW*.15;
    const marginY=photoH*.15;
    const mostlyInside=
      minX>=-marginX &&
      minY>=-marginY &&
      maxX<=photoW+marginX &&
      maxY<=photoH+marginY;

    const areaScore=
      bboxArea>=.00005 && bboxArea<=.20
        ? 1
        : (bboxArea>=.00002 && bboxArea<=.28 ? .45 : 0);

    const ratioScore=
      ratio>=.35 && ratio<=10
        ? 1
        : (ratio>=.22 && ratio<=14 ? .45 : 0);

    const fillScore=clamp((polygonFill-.18)/.42,0,1);
    const convexScore=sameSign?1:0;
    const insideScore=mostlyInside?1:0;

    const geometryScore=
      areaScore*.20+
      ratioScore*.18+
      fillScore*.27+
      convexScore*.20+
      insideScore*.15;

    const valid=
      mostlyInside &&
      sameSign &&
      areaScore>0 &&
      ratioScore>0 &&
      polygonFill>=.16 &&
      geometryScore>=.34;

    return{
      valid,
      geometryScore,
      center:[
        ((minX+maxX)/2)/Math.max(.0001,photoScale),
        ((minY+maxY)/2)/Math.max(.0001,photoScale)
      ],
      box:{
        x:minX/Math.max(1,photoW),
        y:minY/Math.max(1,photoH),
        width:w/Math.max(1,photoW),
        height:h/Math.max(1,photoH)
      },
      bboxArea,
      ratio,
      polygonFill
    };
  }

  function applyClaheInPlace(gray){
    let clahe=null;
    let dst=null;

    try{
      clahe=new cv.CLAHE(2.0,new cv.Size(8,8));
      dst=new cv.Mat();
      clahe.apply(gray,dst);
      dst.copyTo(gray);
    }finally{
      try{dst?.delete?.();}catch{}
      try{clahe?.delete?.();}catch{}
    }
  }

  function fitImageToTargetMaxSide(image,targetMaxSide){
    const w=Number(image.naturalWidth||image.width||0);
    const h=Number(image.naturalHeight||image.height||0);

    if(!w||!h){
      return fitImageToMaxSide(image,targetMaxSide);
    }

    // 최대 1.25배까지만 업스케일합니다.
    // 원본 픽셀을 과도하게 부풀려 가짜 특징점을 만드는 것을 방지합니다.
    const nativeMax=Math.max(w,h);
    const requested=Math.max(1,Number(targetMaxSide)||1400);
    const scale=Math.min(1.25,requested/nativeMax);

    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(w*scale));
    c.height=Math.max(1,Math.round(h*scale));

    const ctx=c.getContext("2d");
    ctx.imageSmoothingEnabled=true;
    ctx.imageSmoothingQuality="high";
    ctx.drawImage(image,0,0,c.width,c.height);

    return{canvas:c,scale};
  }

  async function determineRearSide(snapshot,example,referenceImage,stickerCenter){
    if(!stickerCenter){
      return{position:"ambiguous",method:"none",value:null};
    }

    // 1순위:
    // 동일 차종 정상예시 전체와 현재 사진을 정렬해서
    // "정상예시에서 번호판→스티커 방향"을 현재 사진으로 변환합니다.
    // 직원이 수기로 잡은 번호판 박스 크기에는 의존하지 않습니다.
    if(example.plate_calibrated){
      const alignment=alignReferencePhoto(
        referenceImage,
        snapshot.photoImage
      );

      if(alignment.valid){
        const refPlateCenter=[
          Number(example.plate_x)+Number(example.plate_width)/2,
          Number(example.plate_y)+Number(example.plate_height)/2
        ];

        const refStickerCenter=[
          Number(example.crop_x)+Number(example.crop_width)/2,
          Number(example.crop_y)+Number(example.crop_height)/2
        ];

        const platePx=[
          refPlateCenter[0]*Number(referenceImage.naturalWidth||referenceImage.width),
          refPlateCenter[1]*Number(referenceImage.naturalHeight||referenceImage.height)
        ];

        const stickerPx=[
          refStickerCenter[0]*Number(referenceImage.naturalWidth||referenceImage.width),
          refStickerCenter[1]*Number(referenceImage.naturalHeight||referenceImage.height)
        ];

        const mappedPlate=mapHomographyPoint(
          alignment.H,
          platePx,
          alignment.refScale,
          alignment.currentScale
        );

        const mappedNormalSticker=mapHomographyPoint(
          alignment.H,
          stickerPx,
          alignment.refScale,
          alignment.currentScale
        );

        if(mappedPlate&&mappedNormalSticker){
          const ax=mappedNormalSticker[0]-mappedPlate[0];
          const ay=mappedNormalSticker[1]-mappedPlate[1];
          const axis2=ax*ax+ay*ay;
          const diag=Math.hypot(
            Number(snapshot.photoImage.naturalWidth||snapshot.photoImage.width),
            Number(snapshot.photoImage.naturalHeight||snapshot.photoImage.height)
          );
          const axisLength=Math.sqrt(axis2);

          if(
            axis2>1 &&
            axisLength>diag*.035 &&
            axisLength<diag*.65
          ){
            const ux=stickerCenter[0]-mappedPlate[0];
            const uy=stickerCenter[1]-mappedPlate[1];
            const projection=(ux*ax+uy*ay)/axis2;

            if(projection>=.20){
              return{
                position:"right",
                method:"normal-example-alignment",
                value:projection
              };
            }

            if(projection<=-.10){
              return{
                position:"left",
                method:"normal-example-alignment",
                value:projection
              };
            }
          }
        }
      }
    }

    // 2순위 fallback:
    // 사진이 거의 정방향이고 사용자가 번호판을 크게 벗어나지 않게 선택한 경우,
    // 번호판 박스 "중심"만 사용합니다. 박스 크기로 스티커 ROI를 계산하지 않습니다.
    if(snapshot.plateSelection){
      const p=snapshot.plateSelection;
      const ratio=Number(p.width)/Math.max(.0001,Number(p.height));

      if(ratio>=1.55){
        const photoW=Number(snapshot.photoImage.naturalWidth||snapshot.photoImage.width);
        const plateCenterX=(Number(p.x)+Number(p.width)/2)*photoW;
        const plateWidth=Number(p.width)*photoW;
        const relative=(stickerCenter[0]-plateCenterX)/Math.max(1,plateWidth);

        // ±8% dead zone: 사람이 박스를 조금 다르게 잡아도 좌우가 뒤집히지 않도록 함.
        if(relative>.08){
          return{
            position:"right",
            method:"plate-center-fallback",
            value:relative
          };
        }

        if(relative<-.08){
          return{
            position:"left",
            method:"plate-center-fallback",
            value:relative
          };
        }
      }
    }

    return{
      position:"ambiguous",
      method:"unresolved",
      value:null
    };
  }

  function alignReferencePhoto(referenceImage,currentImage){
    const ref=fitImageToMaxSide(referenceImage,1200);
    const cur=fitImageToMaxSide(currentImage,1200);

    let src=null,dst=null,g1=null,g2=null;
    let mask1=null,mask2=null,kp1=null,kp2=null;
    let des1=null,des2=null,orb=null,matcher=null;
    let knn=null,srcPts=null,dstPts=null,hMask=null,H=null;

    try{
      src=cv.imread(ref.canvas);
      dst=cv.imread(cur.canvas);
      g1=new cv.Mat();
      g2=new cv.Mat();

      cv.cvtColor(src,g1,cv.COLOR_RGBA2GRAY);
      cv.cvtColor(dst,g2,cv.COLOR_RGBA2GRAY);

      mask1=new cv.Mat();
      mask2=new cv.Mat();
      kp1=new cv.KeyPointVector();
      kp2=new cv.KeyPointVector();
      des1=new cv.Mat();
      des2=new cv.Mat();

      orb=new cv.ORB(4000);
      orb.detectAndCompute(g1,mask1,kp1,des1);
      orb.detectAndCompute(g2,mask2,kp2,des2);

      if(des1.empty()||des2.empty()){
        return{valid:false};
      }

      matcher=new cv.BFMatcher(cv.NORM_HAMMING,false);
      knn=new cv.DMatchVectorVector();
      matcher.knnMatch(des1,des2,knn,2);

      const good=[];

      for(let i=0;i<knn.size();i++){
        const pair=knn.get(i);
        if(pair.size()<2){
          pair.delete();
          continue;
        }

        const m=pair.get(0);
        const n=pair.get(1);

        if(Number(m.distance)<Number(n.distance)*.72){
          good.push({
            queryIdx:Number(m.queryIdx),
            trainIdx:Number(m.trainIdx)
          });
        }

        pair.delete();
      }

      if(good.length<7){
        return{valid:false,goodMatches:good.length};
      }

      const a=[];
      const b=[];

      for(const m of good){
        const p1=kp1.get(m.queryIdx).pt;
        const p2=kp2.get(m.trainIdx).pt;

        a.push(Number(p1.x),Number(p1.y));
        b.push(Number(p2.x),Number(p2.y));
      }

      srcPts=cv.matFromArray(good.length,1,cv.CV_32FC2,a);
      dstPts=cv.matFromArray(good.length,1,cv.CV_32FC2,b);
      hMask=new cv.Mat();

      H=cv.findHomography(
        srcPts,
        dstPts,
        cv.RANSAC,
        5,
        hMask
      );

      if(!H||H.empty()||hMask.empty()){
        return{valid:false,goodMatches:good.length};
      }

      let inliers=0;

      for(let i=0;i<good.length;i++){
        if(Number(hMask.data[i]||0)>0)inliers++;
      }

      const ratio=inliers/Math.max(1,good.length);
      const valid=inliers>=7&&ratio>=.25;

      return{
        valid,
        H:valid ? mat3x3Values(H) : null,
        refScale:ref.scale,
        currentScale:cur.scale,
        inliers,
        goodMatches:good.length,
        ratio
      };

    }finally{
      for(const obj of [
        H,hMask,dstPts,srcPts,knn,matcher,orb,
        des2,des1,kp2,kp1,mask2,mask1,g2,g1,dst,src
      ]){
        try{obj?.delete?.();}catch{}
      }
    }
  }

  function mat3x3Values(mat){
    if(!mat||mat.empty())return null;

    if(mat.data64F&&mat.data64F.length>=9){
      return Array.from(mat.data64F.slice(0,9));
    }

    if(mat.data32F&&mat.data32F.length>=9){
      return Array.from(mat.data32F.slice(0,9));
    }

    return null;
  }

  function mapHomographyPoint(H,point,refScale,currentScale){
    if(!H||H.length<9)return null;

    const x=Number(point[0])*refScale;
    const y=Number(point[1])*refScale;

    const d=H[6]*x+H[7]*y+H[8];

    if(!Number.isFinite(d)||Math.abs(d)<1e-8)return null;

    return[
      (H[0]*x+H[1]*y+H[2])/d/currentScale,
      (H[3]*x+H[4]*y+H[5])/d/currentScale
    ];
  }

  function fitImageToMaxSide(image,maxSide){
    const w=Number(image.naturalWidth||image.width||0);
    const h=Number(image.naturalHeight||image.height||0);
    const scale=Math.min(1,maxSide/Math.max(1,w,h));

    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(w*scale));
    c.height=Math.max(1,Math.round(h*scale));

    c.getContext("2d").drawImage(
      image,0,0,c.width,c.height
    );

    return{canvas:c,scale};
  }

  function fitCanvasMaxSide(source,maxSide){
    const scale=Math.min(
      1,
      maxSide/Math.max(1,source.width,source.height)
    );

    if(scale>=1)return{canvas:source,scale:1};

    const c=document.createElement("canvas");
    c.width=Math.max(1,Math.round(source.width*scale));
    c.height=Math.max(1,Math.round(source.height*scale));
    c.getContext("2d").drawImage(source,0,0,c.width,c.height);

    return{canvas:c,scale};
  }

  function validBox(box){
    return Boolean(
      box &&
      Number.isFinite(Number(box.x)) &&
      Number.isFinite(Number(box.y)) &&
      Number.isFinite(Number(box.width)) &&
      Number.isFinite(Number(box.height)) &&
      Number(box.width)>.005 &&
      Number(box.height)>.005
    );
  }

  function finalUnavailable(message){
    return{
      score:0,
      status:"판정불가",
      recommendation:"관리자 확인",
      findings:[message],
      metrics:{
        finalPresenceV1:true,
        analysisEngine:FINAL_ENGINE,
        stickerDetected:false,
        missing:false,
        confidence:0,
        simpleInspectionV25:true,
        damage:0,
        rearLogoRight:null,
        rearSizeDifference:null,
        analysisError:true
      }
    };
  }

  // ==========================================================
  // 2) PLATE OCR
  // ==========================================================
  //
  // 직원이 잡은 번호판 영역은 OCR 용도로만 사용합니다.
  // 스티커 유무 검출의 위치 기준으로 사용하지 않습니다.

  window.tryNativePlateOcr=async function(enteredVehicleNo){
    const target=normalizeVehicleNo(enteredVehicleNo);

    if(!S.photoImage||!S.plateSelection){
      showOcrManual(
        "번호판 영역을 지정한 뒤 다시 확인해 주세요."
      );
      return;
    }

    if(!window.Tesseract?.createWorker){
      showOcrManual(
        "번호판 OCR 모듈을 불러오지 못했습니다. 번호판을 직접 확인해 주세요."
      );
      return;
    }

    $("plateOcrPreview").textContent="자동판독 중...";
    $("plateOcrMessage").className="message info";
    $("plateOcrMessage").textContent=
      "번호판 문자를 읽고 있습니다. 최초 실행은 조금 더 걸릴 수 있습니다.";

    S.plateMatchConfirmed=false;
    $("plateMatchConfirm").checked=false;

    try{
      let source=cropBoxCanvas(
        S.photoImage,
        S.plateSelection,
        1600
      );

      source=refinePlateCanvas(source);

      const prepared=prepareLocalPlateCanvas(source);
      const worker=await getOcrWorker();

      await worker.setParameters({
        tessedit_pageseg_mode:Tesseract.PSM?.SINGLE_LINE ?? "7",
        tessedit_char_whitelist:`0123456789${PLATE_HANGUL}`
      });

      const full=await worker.recognize(prepared);
      const raw=String(full?.data?.text||"").trim();
      const normalized=normalizeVehicleNo(raw);

      if(target&&normalized&&(
        normalized===target ||
        normalized.includes(target)
      )){
        applyOcrExact(target,target,raw);
        return;
      }

      const expected=parseModernPlate(target);

      if(expected){
        const segmented=await readPlateSegments(
          worker,
          prepared,
          expected
        );

        const candidate=
          `${segmented.left}${segmented.hangul}${segmented.right}`;

        if(segmented.exact){
          applyOcrExact(target,candidate,raw);
          return;
        }

        S.plateOcrResult={
          supported:true,
          localOcr:true,
          text:candidate||normalized||raw,
          matched:false
        };

        $("plateOcrPreview").textContent=
          candidate||normalized||raw||"인식 실패";

        if(
          segmented.left===expected.left &&
          segmented.right===expected.right &&
          !segmented.hangul
        ){
          $("plateOcrMessage").className="message warn";
          $("plateOcrMessage").textContent=
            "숫자는 입력 차량번호와 일치하지만 한글 문자를 확정하지 못했습니다. 번호판을 눈으로 확인해 주세요.";
          return;
        }

        $("plateOcrMessage").className="message warn";
        $("plateOcrMessage").textContent=
          `자동판독 결과 '${candidate||normalized||raw||"인식 실패"}'와 입력값 '${target}'을 자동으로 일치 확정하지 못했습니다. 번호판을 직접 확인해 주세요.`;
        return;
      }

      S.plateOcrResult={
        supported:true,
        localOcr:true,
        text:normalized||raw,
        matched:false
      };

      $("plateOcrPreview").textContent=
        normalized||raw||"인식 실패";
      $("plateOcrMessage").className="message warn";
      $("plateOcrMessage").textContent=
        "자동판독을 확정하지 못했습니다. 번호판을 직접 확인해 주세요.";

    }catch(error){
      console.warn("plate OCR failed",error);

      S.plateOcrResult={
        supported:true,
        localOcr:true,
        text:"",
        matched:false,
        error:true
      };

      showOcrManual(
        "번호판 자동판독에 실패했습니다. 확대된 번호판과 입력 차량번호를 직접 대조해 주세요."
      );
    }
  };

  window.showManualPlateFallback=function(){
    showOcrManual(
      "자동판독을 확정하지 못했습니다. 확대된 번호판과 입력 차량번호를 직접 대조해 주세요."
    );
  };

  function refinePlateCanvas(source){
    if(!window.cv?.Mat)return source;

    let src=null,gray=null,blur=null,edges=null;
    let contours=null,hierarchy=null;

    try{
      src=cv.imread(source);
      gray=new cv.Mat();
      blur=new cv.Mat();
      edges=new cv.Mat();

      cv.cvtColor(src,gray,cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(
        gray,
        blur,
        new cv.Size(5,5),
        0,0,
        cv.BORDER_DEFAULT
      );
      cv.Canny(blur,edges,50,160);

      contours=new cv.MatVector();
      hierarchy=new cv.Mat();

      cv.findContours(
        edges,
        contours,
        hierarchy,
        cv.RETR_LIST,
        cv.CHAIN_APPROX_SIMPLE
      );

      let best=null;

      for(let i=0;i<contours.size();i++){
        const c=contours.get(i);
        const r=cv.boundingRect(c);
        const area=Number(r.width)*Number(r.height);
        const areaFraction=area/Math.max(1,source.width*source.height);
        const ratio=Number(r.width)/Math.max(1,Number(r.height));

        if(
          ratio>=2 &&
          ratio<=7 &&
          areaFraction>=.18 &&
          areaFraction<=.98
        ){
          const cx=r.x+r.width/2;
          const cy=r.y+r.height/2;
          const dx=(cx-source.width/2)/Math.max(1,source.width);
          const dy=(cy-source.height/2)/Math.max(1,source.height);
          const centerPenalty=Math.hypot(dx,dy);
          const score=areaFraction-centerPenalty*.35;

          if(!best||score>best.score){
            best={score,r};
          }
        }

        c.delete();
      }

      if(!best)return source;

      const r=best.r;
      const padX=Math.round(r.width*.035);
      const padY=Math.round(r.height*.10);

      const x=Math.max(0,r.x-padX);
      const y=Math.max(0,r.y-padY);
      const w=Math.min(
        source.width-x,
        r.width+padX*2
      );
      const h=Math.min(
        source.height-y,
        r.height+padY*2
      );

      const out=document.createElement("canvas");
      out.width=Math.max(1,w);
      out.height=Math.max(1,h);
      out.getContext("2d").drawImage(
        source,x,y,w,h,0,0,w,h
      );

      return out;

    }catch{
      return source;
    }finally{
      for(const obj of [
        hierarchy,contours,edges,blur,gray,src
      ]){
        try{obj?.delete?.();}catch{}
      }
    }
  }

  async function getOcrWorker(){
    if(ocrWorkerPromise)return ocrWorkerPromise;

    ocrWorkerPromise=Tesseract.createWorker(
      ["kor","eng"],
      1,
      {}
    ).catch(error=>{
      ocrWorkerPromise=null;
      throw error;
    });

    return ocrWorkerPromise;
  }

  async function readPlateSegments(worker,canvas,expected){
    const leftCanvas=cropCanvasFraction(
      canvas,0,0,.41,1
    );
    const hangulCanvas=cropCanvasFraction(
      canvas,.36,.04,.20,.92
    );
    const rightCanvas=cropCanvasFraction(
      canvas,.50,0,.50,1
    );

    await worker.setParameters({
      tessedit_pageseg_mode:Tesseract.PSM?.SINGLE_LINE ?? "7",
      tessedit_char_whitelist:"0123456789"
    });

    const leftResult=await worker.recognize(leftCanvas);
    const rightResult=await worker.recognize(rightCanvas);

    const left=bestExpectedDigits(
      String(leftResult?.data?.text||""),
      expected.left
    );

    const right=bestExpectedDigits(
      String(rightResult?.data?.text||""),
      expected.right
    );

    await worker.setParameters({
      tessedit_pageseg_mode:Tesseract.PSM?.SINGLE_CHAR ?? "10",
      tessedit_char_whitelist:PLATE_HANGUL
    });

    const hangulResult=await worker.recognize(hangulCanvas);
    const hangul=extractPlateHangul(
      String(hangulResult?.data?.text||"")
    );

    return{
      left,
      hangul,
      right,
      exact:
        left===expected.left &&
        hangul===expected.hangul &&
        right===expected.right
    };
  }

  function parseModernPlate(value){
    const m=String(value||"").match(
      /^([0-9]{2,3})([가-힣])([0-9]{4})$/
    );

    if(!m)return null;

    return{
      left:m[1],
      hangul:m[2],
      right:m[3]
    };
  }

  function bestExpectedDigits(raw,expected){
    const digits=normalizeOcrDigits(raw);

    if(digits===expected)return digits;
    if(digits.includes(expected))return expected;

    return digits.slice(-expected.length);
  }

  function normalizeOcrDigits(raw){
    return String(raw||"")
      .toUpperCase()
      .replace(/[OQ]/g,"0")
      .replace(/[IL|]/g,"1")
      .replace(/Z/g,"2")
      .replace(/S/g,"5")
      .replace(/B/g,"8")
      .replace(/[^0-9]/g,"");
  }

  function extractPlateHangul(raw){
    const chars=String(raw||"").match(/[가-힣]/g)||[];
    return chars.find(ch=>PLATE_HANGUL.includes(ch))||"";
  }

  function prepareLocalPlateCanvas(source){
    const targetWidth=1200;
    const scale=targetWidth/Math.max(1,source.width);

    const c=document.createElement("canvas");
    c.width=targetWidth;
    c.height=Math.max(
      220,
      Math.round(source.height*scale)
    );

    const ctx=c.getContext(
      "2d",
      {willReadFrequently:true}
    );

    ctx.drawImage(source,0,0,c.width,c.height);

    const image=ctx.getImageData(
      0,0,c.width,c.height
    );
    const d=image.data;

    let min=255,max=0;
    const gray=new Uint8ClampedArray(
      c.width*c.height
    );

    for(let p=0,i=0;p<gray.length;p++,i+=4){
      const g=Math.round(
        .299*d[i]+.587*d[i+1]+.114*d[i+2]
      );
      gray[p]=g;
      if(g<min)min=g;
      if(g>max)max=g;
    }

    const span=Math.max(40,max-min);

    for(let p=0,i=0;p<gray.length;p++,i+=4){
      let g=(gray[p]-min)/span*255;
      g=Math.max(
        0,
        Math.min(255,(g-128)*1.22+128)
      );

      d[i]=g;
      d[i+1]=g;
      d[i+2]=g;
      d[i+3]=255;
    }

    ctx.putImageData(image,0,0);
    return c;
  }

  function cropCanvasFraction(source,x,y,w,h){
    const sx=Math.round(source.width*x);
    const sy=Math.round(source.height*y);
    const sw=Math.max(
      1,
      Math.round(source.width*w)
    );
    const sh=Math.max(
      1,
      Math.round(source.height*h)
    );

    const c=document.createElement("canvas");
    c.width=sw;
    c.height=sh;
    c.getContext("2d").drawImage(
      source,
      sx,sy,sw,sh,
      0,0,sw,sh
    );

    return c;
  }

  function applyOcrExact(target,candidate,raw){
    S.plateOcrResult={
      supported:true,
      localOcr:true,
      text:candidate,
      matched:true,
      raw
    };

    $("plateOcrPreview").textContent=
      `${candidate} ✓`;
    $("plateOcrMessage").className=
      "message success";
    $("plateOcrMessage").textContent=
      `자동판독 결과가 입력 차량번호 '${target}'와 일치합니다.`;

    $("plateMatchConfirm").checked=true;
    S.plateMatchConfirmed=true;
  }

  function showOcrManual(message){
    $("plateOcrPreview").textContent=
      "자동판독 미확정";
    $("plateOcrMessage").className=
      "message warn";
    $("plateOcrMessage").textContent=message;
  }

  // ==========================================================
  // SHARED HELPERS
  // ==========================================================

  async function waitForOpenCv(timeoutMs){
    const started=Date.now();

    while(Date.now()-started<timeoutMs){
      if(
        window.cv?.Mat &&
        window.cv?.ORB &&
        window.cv?.BFMatcher &&
        window.cv?.findHomography
      ){
        return true;
      }

      await new Promise(
        resolve=>setTimeout(resolve,120)
      );
    }

    return false;
  }

  function median(values){
    const a=values
      .filter(Number.isFinite)
      .slice()
      .sort((x,y)=>x-y);

    if(!a.length)return 0;

    const m=Math.floor(a.length/2);

    return a.length%2
      ? a[m]
      : (a[m-1]+a[m])/2;
  }

  function round1(value){
    return Math.round(Number(value||0)*10)/10;
  }

  window.addEventListener("pagehide",()=>{
    if(!ocrWorkerPromise)return;

    ocrWorkerPromise
      .then(worker=>worker?.terminate?.())
      .catch(()=>{});

    ocrWorkerPromise=null;
  });
})();