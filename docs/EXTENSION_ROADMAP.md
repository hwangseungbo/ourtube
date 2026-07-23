# Chrome 확장 프로그램 로드맵

## 현재 구현 구조

```text
홈페이지
  │ URL·권리 확인·화질·진행률
  ▼
웹 브리지 콘텐츠 스크립트
  ▼
Manifest V3 서비스 워커
  ├── 숨겨진 YouTube 임베드 플레이어 우선
  └── 실패할 때만 비활성 임시 탭 포착 후 즉시 종료
  ▼
Offscreen 문서
  ├── SABR 영상·음성 요청
  ├── Mediabunny MP4 remux
  └── OPFS 임시 파일
  ▼
Chrome Downloads API
  ▼
사용자 다운로드 폴더
```

## 완료된 단계

1. Googlevideo 영상·음성 요청을 사용자 Chrome에서 수행하는 연결 검증
2. YouTube 페이지의 SABR 플레이어 응답 포착
3. 여러 화질 목록 표시와 선택
4. Mediabunny를 사용한 재인코딩 없는 MP4 결합
5. 새 다운로드 탭 제거
6. 홈페이지에 분석·화질·진행률·취소·완료 UI 통합
7. Offscreen 문서와 OPFS 임시 파일을 사용한 숨겨진 처리

## 공개 배포 전 남은 단계

1. 실제 HTTPS 서비스 도메인을 확정하고 localhost 전용 권한·발신자 검사를 배포 도메인으로 교체합니다.
2. 개인정보처리방침, 지원 페이지, 데이터 사용 설명, 스토어 등록 이미지와 설명을 준비합니다.
3. 30분 이상·4K 이상 영상, 디스크 부족, 네트워크 단절, 취소, 중복 다운로드를 실제 Chrome에서 시험합니다.
4. 요청 권한을 다시 검토하고 사용하지 않는 권한과 기존 서버 다운로드 경로를 제거합니다.
5. 압축 ZIP을 만들고 Chrome 웹 스토어 비공개 테스트로 먼저 제출합니다.
6. 검토 결과와 정책 피드백을 반영한 뒤 공개 범위를 결정합니다.

## 보안 원칙

- 홈페이지 발신자와 확장 프로그램 Offscreen 발신자를 각각 검증합니다.
- Googlevideo, YouTube, 브라우저 검증 엔드포인트 외의 네트워크 대상은 허용하지 않습니다.
- 사용자 입력 URL과 플레이어 응답의 영상 ID·크기·SABR 호스트를 다시 검증합니다.
- 쿠키, Google 계정 토큰, 브라우저 방문 기록을 수집하지 않습니다.
- 사용자가 권리를 확인한 단일 URL 작업만 수행하고 자동 대량 수집을 만들지 않습니다.
- OPFS 임시 MP4는 Chrome 다운로드가 완료되거나 작업이 실패·취소되면 삭제합니다.

## 공식 기술 문서

- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome Downloads API](https://developer.chrome.com/docs/extensions/reference/api/downloads)
- [Manifest V3 개요](https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3)
- [확장 프로그램 메시지 보안 고려사항](https://developer.chrome.com/docs/extensions/develop/concepts/messaging)
- [Chrome 웹 스토어 검토 과정](https://developer.chrome.com/docs/webstore/review-process)
