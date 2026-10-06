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
