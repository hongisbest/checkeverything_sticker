(() => {
  "use strict";

  let latestReceiptNo="";

  const originalUpload=window.uploadInspectionWithProgress;
  const originalShowSubmitLive=window.showSubmitLive;
  const originalSetSubmitMessage=window.setSubmitMessage;

  if(typeof originalUpload==="function"){
    window.uploadInspectionWithProgress=async function(...args){
      const result=await originalUpload.apply(this,args);
      latestReceiptNo=String(result?.receipt_no||"").trim();
      return result;
    };
  }

  function replaceReceipt(text){
    const value=String(text??"");
    if(!latestReceiptNo)return value;

    return value.replace(
      /접수번호\s*#?\d+/g,
      `접수번호 ${latestReceiptNo}`
    );
  }

  if(typeof originalShowSubmitLive==="function"){
    window.showSubmitLive=function(title,detail,type){
      return originalShowSubmitLive.call(
        this,
        title,
        replaceReceipt(detail),
        type
      );
    };
  }

  if(typeof originalSetSubmitMessage==="function"){
    window.setSubmitMessage=function(text,type){
      return originalSetSubmitMessage.call(
        this,
        replaceReceipt(text),
        type
      );
    };
  }
})();