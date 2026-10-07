# V9 사용자 촬영가이드 ROI 위치 수정

원인
- 사용자 화면에서 세로 예시사진을 가로 referenceBox에 `object-fit: contain`으로 표시하면서 좌우 여백이 생김
- 관리자 ROI 좌표는 실제 이미지 기준인데 사용자 화면에서는 여백을 포함한 컨테이너 전체에 적용되어 ROI가 오른쪽으로 밀림

수정
- 실제 렌더링된 이미지 크기와 동일한 `guide-media-frame` 생성
- ROI를 `referenceBox`가 아니라 실제 이미지 프레임 내부에 배치
- 화면 크기 변경 시 `ResizeObserver`로 프레임 크기 재계산
- 관리자 ROI 좌표 / D1 / R2 / 판정로직 변경 없음
