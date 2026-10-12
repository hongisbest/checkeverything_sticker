(() => {
  "use strict";

  const FINAL_ENGINE="final-presence-v1";
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
    const example=(examples||[]).find(x=>
      x?.calibrated && x?.vehicle_type===snapshot?.vehicleType
    ) || (examples||[]).find(x=>x?.calibrated);

    if(!example){
      return finalUnavailable(
        "동일 차종 정상예시의 스티커 기준영역을 불러오지 못했습니다."
      );
    }

    const cvReady=await waitForOpenCv(10000);

    if(!cvReady){
      return finalUnavailable(
        "영상 분석모듈을 불러오지 못해 자동판정을 확정하지 않았습니다."
      );
    }

    let referenceImage=null;

    try{
      referenceImage=await loadImage(example.image_url);

      const referenceStickerBox={
        x:Number(example.crop_x),
        y:Number(example.crop_y),
        width:Number(example.crop_width),
        height:Number(example.crop_height)
      };

      if(!validBox(referenceStickerBox)){
        return finalUnavailable(
          "정상예시 스티커 기준영역이 올바르게 설정되지 않았습니다."
        );
      }

      const referenceSticker=cropBoxCanvas(
        referenceImage,
        referenceStickerBox,
        1200
      );

      // 핵심: 현재 사진 전체에서 정상예시 스티커의 특징점을 직접 찾습니다.
      // 사용자의 번호판 박스는 스티커 존재 검출에 사용하지 않습니다.
      const presence=orbLocateObject(
        referenceSticker,
        snapshot.photoImage
      );

      const metrics={
        finalPresenceV1:true,
        analysisEngine:FINAL_ENGINE,
        vehicleType:snapshot.vehicleType,
        sideHint:snapshot.sticker.side_hint,
        stickerDetected:presence.pass===true,
        missing:presence.pass!==true,
        presenceInliers:presence.inliers,
        presenceGoodMatches:presence.goodMatches,
        presenceTopMeanDistance:round1(presence.topMeanDistance),
        presenceReferenceKeypoints:presence.referenceKeypoints,
        presencePhotoKeypoints:presence.photoKeypoints,
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
              "스티커 미검출 → 정상예시 스티커의 특징점이 현재 사진에서 충분히 확인되지 않았습니다."
            ],
            metrics
          }
        };
      }

      // 측면은 존재 확인만으로 정상 처리.
      if(snapshot.sticker.side_hint!=="rear"){
        return{
          crop:null,
          analysis:{
            score:100,
            status:"정상",
            recommendation:"",
            findings:[
              "스티커 검출 → 정상예시 스티커 특징이 현재 사진에서 확인되었습니다."
            ],
            metrics:{
              ...metrics,
              missing:false
            }
          }
        };
      }

      // 후면은 좌우 위치가 필수.
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

  function orbLocateObject(referenceCanvas,photoImage){
    const photo=fitImageToMaxSide(photoImage,1400);
    const ref=fitCanvasMaxSide(referenceCanvas,800);

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

      mask1=new cv.Mat();
      mask2=new cv.Mat();
      kp1=new cv.KeyPointVector();
      kp2=new cv.KeyPointVector();
      des1=new cv.Mat();
      des2=new cv.Mat();

      orb=new cv.ORB(2500);
      orb.detectAndCompute(g1,mask1,kp1,des1);
      orb.detectAndCompute(g2,mask2,kp2,des2);

      const referenceKeypoints=kp1.size();
      const photoKeypoints=kp2.size();

      if(
        referenceKeypoints<20 ||
        photoKeypoints<30 ||
        des1.empty() ||
        des2.empty()
      ){
        return{
          pass:false,
          inliers:0,
          goodMatches:0,
          topMeanDistance:999,
          referenceKeypoints,
          photoKeypoints,
          confidence:0,
          center:null
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

        all.push({
          distance:d,
          queryIdx:Number(m.queryIdx),
          trainIdx:Number(m.trainIdx)
        });

        if(d<55){
          good.push({
            distance:d,
            queryIdx:Number(m.queryIdx),
            trainIdx:Number(m.trainIdx)
          });
        }
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
          topMeanDistance,
          referenceKeypoints,
          photoKeypoints,
          confidence:0,
          center:null
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
        5,
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

      const center=inlierPoints.length
        ? [
            median(inlierPoints.map(x=>x[0])),
            median(inlierPoints.map(x=>x[1]))
          ]
        : null;

      // 실제 사용자 샘플 + 밝기/블러/JPEG 시뮬레이션으로 고정.
      const pass=
        inliers>=8 &&
        topMeanDistance<=39.0 &&
        Boolean(center);

      const confidence=pass
        ? clamp(
            (Math.min(24,inliers)/24)*65+
            clamp((45-topMeanDistance)/15,0,1)*35,
            0,100
          )
        : 0;

      return{
        pass,
        inliers,
        goodMatches:good.length,
        topMeanDistance,
        referenceKeypoints,
        photoKeypoints,
        confidence,
        center
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