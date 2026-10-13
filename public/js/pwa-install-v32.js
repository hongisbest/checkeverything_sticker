(() => {
  "use strict";

  const button=document.getElementById("installAppBtn");
  if(!button)return;

  let deferredPrompt=null;

  const isStandalone=()=>(
    window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone===true
  );

  const isIos=()=>(
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !window.MSStream
  );

  function updateButton(){
    if(isStandalone()){
      button.hidden=true;
      return;
    }

    button.hidden=false;
  }

  window.addEventListener("beforeinstallprompt",event=>{
    event.preventDefault();
    deferredPrompt=event;
    updateButton();
  });

  window.addEventListener("appinstalled",()=>{
    deferredPrompt=null;
    button.hidden=true;
  });

  button.addEventListener("click",async()=>{
    if(isStandalone()){
      button.hidden=true;
      return;
    }

    if(deferredPrompt){
      deferredPrompt.prompt();

      try{
        await deferredPrompt.userChoice;
      }catch{}

      deferredPrompt=null;
      updateButton();
      return;
    }

    if(isIos()){
      alert("iPhone에서는 Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택해 주세요.");
      return;
    }

    alert("브라우저 메뉴에서 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 선택해 주세요.");
  });

  if("serviceWorker" in navigator){
    window.addEventListener("load",()=>{
      navigator.serviceWorker
        .register("/check/service-worker.js",{scope:"/check/"})
        .catch(error=>console.warn("PWA service worker registration failed",error));
    });
  }

  updateButton();
})();
