(() => {
  "use strict";

  if(typeof analyzeSnapshotAgainstMasterAndExamples!=="function"){
    console.warn("V26 presence guard: analyzer not found");
    return;
  }

  const baseAnalyze=analyzeSnapshotAgainstMasterAndExamples;

  analyzeSnapshotAgainstMasterAndExamples=async function(snapshot,examples){
    const result=await baseAnalyze(snapshot,examples);

    try{
      const analysis=result?.analysis;
      const metrics=analysis?.metrics;

      if(!analysis||!metrics||snapshot?.missing){
        return result;
      }

      const detectedBox=metrics.detectedStickerCrop||result?.crop;
      const normalExample=(examples||[]).find(x=>
        x?.calibrated && x?.vehicle_type===snapshot?.vehicleType
      ) || (examples||[]).find(x=>x?.calibrated);

      if(!detectedBox||!normalExample){
        return forcePresenceReview(
          result,
          "스티커 존재여부 검증 기준을 불러오지 못해 관리자가 확인해야 합니다.",
          {presenceValidated:false,presenceReason:"reference-missing"}
        );
      }

      const refImage=await loadImage(normalExample.image_url);

      const refCrop=cropBoxCanvas(refImage,{
        x:Number(normalExample.crop_x),
        y:Number(normalExample.crop_y),
        width:Number(normalExample.crop_width),
        height:Number(normalExample.crop_height)
      },1000);

      const currentCrop=cropBoxCanvas(
        snapshot.photoImage,
        detectedBox,
        1000
      );

      const reference=stickerPresenceDescriptor(refCrop);
      const current=stickerPresenceDescriptor(currentCrop);

      const crossRatio=current.crossRate/Math.max(.002,reference.crossRate);
      const edgeRatio=current.edgeRate/Math.max(.01,reference.edgeRate);

      const crossFloor=Math.max(.010,reference.crossRate*.52);
      const edgeFloor=Math.max(.035,reference.edgeRate*.46);

      const texturePass=current.crossRate>=crossFloor;
      const edgePass=current.edgeRate>=edgeFloor;
      const presencePass=texturePass&&edgePass;

      metrics.presenceValidated=true;
      metrics.presenceMethod="v26-reference-texture-gate";
      metrics.presenceTextureCross=r1(current.crossRate*100);
      metrics.presenceTextureReference=r1(reference.crossRate*100);
      metrics.presenceTextureRatio=r1(crossRatio*100);
      metrics.presenceEdge=r1(current.edgeRate*100);
      metrics.presenceEdgeReference=r1(reference.edgeRate*100);
      metrics.presenceEdgeRatio=r1(edgeRatio*100);
      metrics.presenceTexturePass=texturePass;
      metrics.presenceEdgePass=edgePass;

      if(!presencePass){
        metrics.stickerDetected=false;
        metrics.missing=true;

        return forcePresenceReview(
          result,
          `스티커 존재 근거 부족 → 정상예시 대비 세부형상 ${r1(crossRatio*100)}% / 윤곽 ${r1(edgeRatio*100)}%. `+
          "자동탐색 후보가 있어도 실제 스티커로 인정하지 않습니다.",
          {
            presenceValidated:true,
            presenceReason:"texture-gate-failed"
          }
        );
      }

      metrics.stickerDetected=true;
      metrics.missing=false;
      metrics.presenceReason="texture-gate-passed";

      return result;

    }catch(error){
      console.warn("V26 presence guard failed",error);

      if(result?.analysis?.status==="정상"){
        return forcePresenceReview(
          result,
          "스티커 존재여부 추가검증 중 오류가 발생해 정상으로 확정하지 않았습니다. 관리자가 사진을 확인해 주세요.",
          {
            presenceValidated:false,
            presenceReason:"verifier-error"
          }
        );
      }

      return result;
    }
  };

  function forcePresenceReview(result,message,extraMetrics={}){
    if(!result?.analysis)return result;

    const analysis=result.analysis;
    analysis.status="확인필요";
    analysis.score=0;
    analysis.recommendation="미부착 여부 확인";

    const old=Array.isArray(analysis.findings)
      ? analysis.findings.filter(Boolean)
      : [];

    analysis.findings=[
      message,
      ...old.filter(x=>!String(x).includes("정상범위"))
    ];

    analysis.metrics={
      ...(analysis.metrics||{}),
      ...extraMetrics
    };

    return result;
  }

  function stickerPresenceDescriptor(source){
    const c=document.createElement("canvas");
    c.width=256;
    c.height=128;

    const ctx=c.getContext("2d",{willReadFrequently:true});
    ctx.drawImage(source,0,0,c.width,c.height);

    const rgba=ctx.getImageData(0,0,c.width,c.height).data;
    const gray=new Float32Array(c.width*c.height);

    for(let p=0,i=0;p<gray.length;p++,i+=4){
      gray[p]=.299*rgba[i]+.587*rgba[i+1]+.114*rgba[i+2];
    }

    let cross=0;
    let edge=0;
    let total=0;

    for(let y=1;y<c.height-1;y++){
      for(let x=1;x<c.width-1;x++){
        const p=y*c.width+x;

        const dx=Math.abs(gray[p+1]-gray[p-1]);
        const dy=Math.abs(gray[p+c.width]-gray[p-c.width]);
        const mag=Math.sqrt(dx*dx+dy*dy);

        if(dx>24&&dy>24)cross++;
        if(mag>30)edge++;
        total++;
      }
    }

    return{
      crossRate:cross/Math.max(1,total),
      edgeRate:edge/Math.max(1,total)
    };
  }
})();