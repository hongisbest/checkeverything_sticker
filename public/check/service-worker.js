const VERSION="bgf-check-pwa-v32";

self.addEventListener("install",()=>{
  self.skipWaiting();
});

self.addEventListener("activate",event=>{
  event.waitUntil(self.clients.claim());
});

// 설치요건은 충족하되 캐시는 사용하지 않습니다.
// 기존 점검 기능/분석 파일이 오래된 캐시에 남는 문제를 피하기 위해
// GET 요청도 항상 네트워크의 최신 파일을 사용합니다.
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  event.respondWith(fetch(event.request));
});
