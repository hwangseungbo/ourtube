# 아워튜브

본인이 제작했거나 저장 권한을 가진 YouTube 영상을 사용자 PC에서 MP4로 저장하는
Windows 데스크톱 앱입니다.

## 현재 배포 구조

- 홈페이지: Windows 앱 안내, 공식 설치 파일 연결, 정책 및 문의
- Windows 앱: URL 확인, 화질 선택, 저장 위치 선택, 진행률 및 취소
- 로컬 엔진: yt-dlp로 영상 정보를 확인하고 FFmpeg로 영상·음성을 MP4에 결합
- 자동 업데이트: GitHub Releases에서 사용자가 승인한 버전만 내려받아 적용

대용량 영상·음성 요청과 MP4 결합은 아워튜브 서버가 아니라 사용자 PC에서
처리됩니다. 가능한 경우 인코딩 패킷을 그대로 복사하는 remux 방식으로 결합합니다.

`extension` 폴더의 Chrome 확장 프로그램 코드는 초기 연구용 구현이며 현재 권장
배포물이 아닙니다.

## 개발 실행

```powershell
npm.cmd install
npm.cmd run desktop
```

Node.js 22 이상이 필요합니다. Windows 설치 빌드는 저장소에 고정된 yt-dlp와
`ffmpeg-static`의 FFmpeg 실행 파일을 포함합니다.

## 개발 검사

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run licenses:prepare
```

## 지원 범위와 이용 조건

- 단일 일반 YouTube 영상, Shorts URL
- 영상별 제공 화질 선택과 MP4 저장
- 다운로드 진행률, 작성량, 취소
- 재생목록, DRM 우회, 로그인 제한 우회, 자동 대량 수집은 지원하지 않음

YouTube가 다운로드 기능을 제공한 경우, 본인 소유 영상, 권리자의 명시적 허락을 받은 영상, 또는 적용
가능한 공개 라이선스·법률상 예외가 확인된 영상에만 사용하세요. 공개 배포 전에는 기능과 스토어 설명,
개인정보처리방침, 최소 권한 설계를 함께 법률·정책 검토해야 합니다.

자세한 판단 근거는 [법률·플랫폼 정책 검토](docs/LEGAL_AND_POLICY.md), 남은 배포 작업은
[Chrome 확장 프로그램 로드맵](docs/EXTENSION_ROADMAP.md)을 참고하세요.

## 라이선스

아워튜브 자체 소스 코드는 [GNU GPL v3 이상](LICENSE)으로 배포됩니다. 제3자
소프트웨어는 각자의 라이선스를 유지하며 자세한 내용은
[제3자 소프트웨어 고지](THIRD_PARTY_NOTICES.md)를 참고하세요.

`아워튜브`, `OurTube` 명칭과 로고의 사용에는 [상표 정책](TRADEMARKS.md)이
별도로 적용됩니다.

보안 문제는 공개 이슈보다 [보안 정책](SECURITY.md)에 따라 먼저 신고해 주세요.
