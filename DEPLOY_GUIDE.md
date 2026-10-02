# 새 GitHub 저장소 / 새 Cloudflare Worker 배포

기존 사이트는 절대 삭제하지 마세요.
이 사이트는 별도의 Worker로 동시에 운영합니다.

## 1. GitHub
새 저장소를 만듭니다.
추천 이름:
sticker-inspector-compare

ZIP을 풀고 아래 파일/폴더가 저장소 최상단에 바로 보이게 업로드합니다.

package.json
wrangler.jsonc
schema.sql
src/
public/
sample/
README.md
DEPLOY_GUIDE.md
VERIFY.md

## 2. Cloudflare
기존 Git 연결 프로젝트가 아니라 새 Worker 프로젝트를 만듭니다.

Worker 이름:
sticker-inspector-compare

Deploy command:
npx wrangler deploy

이 프로젝트의 wrangler.jsonc는 기존 D1/R2를 재사용하도록 이미 설정되어 있습니다.

D1:
vehicle-sticker-db
ID:
0c00c58c-8c79-496f-ab53-f29f82a2afee

R2:
vehicle-sticker-reference

기존 사이트 데이터와는 테이블명/R2 폴더가 다르므로 서로 섞이지 않습니다.

## 3. 새 Worker Secrets
새 Worker에는 Secret이 별도로 필요합니다.

ADMIN_PASSWORD
- 관리자 로그인 비밀번호

ADMIN_SESSION_SECRET
- 40자 이상 랜덤 문자열 권장

기존 Worker Secret은 새 Worker에 자동 복사되지 않으므로 꼭 등록해야 합니다.

## 4. DB
SQL Console에서 별도 실행할 필요 없습니다.
첫 API 호출 시 st_* 테이블을 CREATE IF NOT EXISTS로 자동 생성합니다.

## 5. 접속
관리자:
https://새-worker주소/admin/

사용자:
https://새-worker주소/check/

## 6. 첫 테스트
압축의 sample 폴더에 아래 테스트 파일이 있습니다.

sticker-reference-sample.png
- 관리자에 기준 스티커로 등록

vehicle-normal-sample.png
- 정상차량 테스트

vehicle-missing-logo-sample.png
- 로고가 사라진 차량 테스트

사용자 화면에서 차량사진을 업로드한 뒤,
로고가 있어야 하는 부분을 타이트하게 드래그해서 분석해 보세요.
