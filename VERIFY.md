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
