# 제공 전 검증 결과

## 1. 기존 사이트/데이터 보존 검증
- Worker 이름을 기존 checkeverything과 다른 sticker-inspector-compare로 분리
- 기존 D1은 재사용하되 신규 st_* 테이블만 사용
- 기존 vc2_* 테이블에 UPDATE/DELETE 없음
- 기존 R2 app-v2/ 경로 사용 안 함
- 신규 R2 sticker-compare/ 경로만 사용
- DROP / TRUNCATE 없음

## 2. 기능 연결 검증
- 관리자 로그인
- 스티커 등록/수정/버전보존/활성화/삭제
- 관리자 판정기준 저장
- 사용자 스티커 선택
- 사진 촬영/업로드
- 사진 내 스티커 영역 드래그 지정
- 스티커 없음 100% 누락 처리
- 형상/손상/색상 비교
- 결과 저장
- 관리자 결과 조회/상태/메모
- 사진 중앙 확대
- CSV 다운로드

## 3. 배포 설정 검증
- 기존 D1 ID 사용
- 기존 R2 bucket 사용
- 별도 Worker name 사용
- Assets binding 포함
- DB 자동 CREATE IF NOT EXISTS
- 새 Worker에 Secret만 별도 설정하면 됨

## 4. 문법/연결 검증
- Worker JS node --check
- Admin JS node --check
- Check JS node --check
- HTML id ↔ JavaScript 정적 참조 일치 검사
- schema.sql SQLite syntax 검사


## V2 정밀 손상/형상 로직 검증

### 데이터/배포 보존
- Worker backend 변경 없음
- D1 schema 변경 없음
- wrangler.jsonc 변경 없음
- 관리자 화면/API 변경 없음
- 기존 st_* 점검 데이터 및 R2 파일 변경 없음

### 알고리즘 변경
- 전체 edge-count 기반 손상률 제거
- reference-feature block loss 방식 적용
- 고신뢰 특징 기반 affine displacement 보정
- 연속 손상영역(cluster) 중심 손상률 적용
- 고립된 반사/노이즈 mismatch 영향 축소
- 스티커 주요 chroma 기반 색상 비교
- 선택영역 종횡비 품질검사 추가

### 회귀시험
- 동일 정상 이미지: 손상률이 0에 가깝게 유지되어야 함
- 밝기/대비 변화: 형상 비교가 밝기 변화에 강해야 함
- 소폭 회전/이동: 정렬보정 후 손상률 급증을 억제
- 훼손 샘플: 구버전 3.7%처럼 지나치게 낮은 결과가 나오지 않도록 reference-feature loss를 검출


## V3 Balanced 회귀시험
실제 사용자 결과화면의 SELECTED STICKER AREA를 사용했습니다.

통과기준:
- 정상 형상유사도 >= 85%
- 정상 손상률 <= 10%
- 훼손 손상률 >= 30%
- 훼손 형상유사도는 정상보다 8%p 이상 낮음

Backend / D1 / R2 / Admin / schema / wrangler는 변경하지 않았습니다.


## V4 동일사진 재현성 검증
- 신규 st_analysis_cache 테이블만 추가
- 기존 st_* 테이블 DROP/TRUNCATE/초기화 없음
- 기존 R2 경로/사진 삭제 없음
- 동일 사진은 64-bit perceptual dHash + sticker_id + algorithm_version 조합으로 재사용
- 분석 crop은 기준 스티커 비율로 자동 보정
- 7개 crop ensemble 중앙값 적용
- 제출 시 사용자가 그린 raw crop 대신 실제 분석 crop 좌표 저장


## V5 검증
1. 데이터 보존
- 기존 st_stickers / st_rules / st_inspections / st_analysis_cache 유지
- 신규 st_examples 테이블만 추가
- DROP / TRUNCATE 없음
- 기존 inspection R2 파일 삭제 없음

2. 기준 구조
- 스티커 원본은 st_stickers에 유지
- 정상부착 예시는 st_examples에 별도 저장
- 예시사진 1번을 사용자 가이드로 사용
- 예시 ROI 변경 시 해당 스티커 분석 캐시 자동 초기화

3. 판정 로직
- 스티커 원본 HOG 구조 특징 추출
- 정상부착 예시 ROI들과 원본을 비교해 정상 변동범위 캘리브레이션
- 정상 예시에서 안정적으로 보존되는 셀만 손상 계산에 사용
- 정상 예시 간 변동폭(MAD)을 자동 허용오차로 반영
- 검출신뢰도가 낮으면 판정불가

4. 배포 보존
- Worker 이름 / D1 ID / R2 bucket / Assets 설정 변경 없음
- 기존 관리자 로그인 / 결과관리 / CSV / 사진확대 유지

- 분석 캐시 알고리즘 버전: `v5-master-calibrated`


## V6 점검결과 선택삭제 검증
- 기존 schema 변경 없음
- 점검결과 선택 삭제 API만 추가
- 선택된 st_inspections 행만 DELETE
- 선택된 점검결과의 R2 photo_object_key만 삭제
- st_stickers / st_examples / st_rules / st_analysis_cache 삭제 없음
- 현재 조회결과 전체선택만 지원하여 필터 밖 데이터 오삭제 방지
- 최대 500건 단위 삭제 제한
- 삭제 전 브라우저 확인창 필수


## V7 가로카메라 검증
- Worker / D1 / R2 / schema / 관리자 기능 변경 없음
- 사용자 카메라 UI와 캡처 방향 처리만 변경
- 16:9 프레임, 세로 감지 안내, 90° 회전 버튼 연결
- 0/90/180/270° 회전값이 실제 canvas 캡처에도 반영


## V8 가로카메라 UI 검증
- 90° 회전 버튼/상태/Canvas 회전 제거
- 세로모드 가로회전 안내 유지
- 가로모드 프레임 축소 및 촬영버튼 바로 아래 배치
- Worker / D1 / R2 / schema / 관리자 화면 변경 없음


## V10 4:3 기준 검증
- 업로드 정상사진: 1920×1440 (4:3)
- 가이드 예시 영역 4:3
- 실시간 카메라 요청 4:3
- 촬영 가이드 문구 4:3
- V9 ROI 실제 이미지영역 기준 보정 유지
- Worker / D1 / R2 / schema / 관리자 로직 변경 없음


## V11 검증
- 가로/세로 촬영 강제 제거
- getUserMedia aspectRatio 제거
- 휴대폰 회전 안내 제거
- 한 사진에서 스티커 + 번호판 영역 각각 지정
- 스티커 미부착 시 번호판만 필수 + 손상 100% 처리
- 번호판 노출점수 metrics_json 저장
- 관리자 점검결과에 번호판 확인상태 표시
- V9 촬영가이드 ROI 실제 이미지좌표 보정 유지
- 스티커 원본/정상부착 예시 캘리브레이션 분석 유지
- Worker / D1 schema / R2 / 기존 점검데이터 변경 없음


## V12 직원/관리자 결과분리 검증
- 직원 화면 자동판정 숫자/상태 제거
- 직원 제출 전 스티커/번호판 crop 미리보기 추가
- 촬영영역 크기/선명도 보조안내 추가
- 제출 시에만 내부 스티커 분석
- 분석값은 D1 점검결과 저장용으로만 사용
- 자동분석 오류 시 제출 차단하지 않고 판정불가 저장
- V12 제출 분석에서는 기존 image-hash 분석 캐시 미사용
- 관리자 점검결과의 자동판정 표시 유지
- V9 사용자 가이드 ROI 위치보정 유지
- Worker / schema / wrangler / R2 구조 변경 없음


## V13 제출 안정성 검증
- /api/inspection POST가 자동분석보다 먼저 실행됨
- 초기 저장 status = 분석대기
- 저장 성공 후 alert + 접수번호 + STEP 02 복귀
- 스티커/번호판 hard quality validation 추가
- 분석결과 업데이트는 HMAC 서명 토큰 필요
- 자동분석 실패해도 초기 st_inspections / R2 사진 유지
- 관리자 필터에 분석대기 추가
- D1 schema 변경 없음
- 기존 스티커/예시/점검결과 삭제 없음


## V14 제출 안정성 검증
- submit 버튼 type=button
- submit click addEventListener 연결
- submitInspection 전체가 try/catch/finally 내부 동작
- pre-validation Canvas 오류도 사용자 화면에 표시
- 중복제출 silent return 제거
- XHR upload progress 연결
- 최종 업로드 이미지 max 1800px 재압축
- R2 업로드 실패 / D1 저장 실패 각각 JSON 오류 반환
- 저장 성공 전 STEP 02 초기화 금지
- raw inspection 저장 성공 뒤에만 background analysis 스케줄
- D1 schema / R2 경로 / 기존 데이터 구조 변경 없음
