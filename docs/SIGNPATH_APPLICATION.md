# SignPath Foundation 신청 준비

최종 수정일: 2026년 7월 23일

이 문서는 신청서에 사실대로 기재할 프로젝트 정보와 승인 후 설정 작업을 정리한
내부 체크리스트입니다.

## 신청 정보

- Project name: OurTube / 아워튜브
- Project repository: <https://github.com/hwangseungbo/ourtube>
- Project website: <https://ourtube.kr>
- Download page: <https://ourtube.kr/desktop>
- Latest public release:
  <https://github.com/hwangseungbo/ourtube-releases/releases/tag/v0.2.6>
- License: GNU GPL v3 or later (`GPL-3.0-or-later`)
- Code signing policy: <https://ourtube.kr/code-signing>
- Privacy policy: <https://ourtube.kr/privacy>
- Security policy: <https://github.com/hwangseungbo/ourtube/blob/main/SECURITY.md>
- Maintainer: <https://github.com/hwangseungbo>

## 영문 프로젝트 설명 초안

### Tagline

> A Windows desktop application for locally backing up videos that the user
> owns or has permission to save.

### Description

> OurTube is an open-source Windows desktop application for backing up videos
> that the user owns or has permission to save. Video discovery, download and
> FFmpeg remuxing run on the user's PC. The application does not upload media
> files to an OurTube server. It checks ourtube.kr for the current version and,
> only after user approval, downloads updates from the project's public GitHub
> Releases repository.

### Reputation

신청 시점의 실제 공개 지표를 다시 확인하고 숫자를 갱신합니다. 독립 보도나 대규모
사용자가 없다면 이를 과장하지 않습니다.

> OurTube is a newly released independent open-source project in public beta.
> It does not yet have independent media coverage or a large established user
> community. Its complete source, release artifacts, corresponding source
> archives, code-signing policy and GitHub Actions build history are public for
> verification:
> https://github.com/hwangseungbo/ourtube,
> https://github.com/hwangseungbo/ourtube-releases/releases/tag/v0.2.6,
> https://ourtube.kr/code-signing, and
> https://github.com/hwangseungbo/ourtube/actions/runs/29993576452.

### 양식 선택값

- Maintainer Type: `Individual maintainer(s)`
- Build System: `GitHub Actions`
- Company Name: 개인 프로젝트이므로 비워 둠
- Primary Discovery Channel: `AI / LLM tools`
- Exact source: `ChatGPT`
- Wikipedia URL: 해당 문서가 없으므로 비워 둠
- Email: `ghkdtmdqh@naver.com`

## 심사 시 반드시 공개할 내용

- 앱은 사용자가 입력한 YouTube 주소를 처리하며 yt-dlp와 FFmpeg를 포함합니다.
- 저장 권한이 있는 영상의 백업만 허용한다고 문서화했지만 기술적으로 모든 입력
  주소의 권리를 자동 검증하지는 않습니다.
- YouTube 또는 권리자의 승인을 받은 공식 도구라고 주장하지 않습니다.
- SignPath의 보안 우회 및 프로젝트 평판 정책에 따라 거절될 수 있으며 기능을
  축소하거나 숨겨 심사를 우회하지 않습니다.
- FFmpeg와 yt-dlp는 업스트림 오픈소스 바이너리이며 아워튜브 인증서로 별도
  서명하지 않습니다.

## 신청 전 체크

- [ ] GitHub 계정 2단계 인증 활성화
- [ ] SignPath 계정 2단계 인증 활성화
- [ ] `Windows build` GitHub Actions 성공
- [ ] 홈페이지와 저장소의 코드 서명 정책 공개
- [ ] 최신 공개 릴리스와 전체 대응 소스 제공
- [ ] 프로젝트 기능과 네트워크 통신을 신청서에 사실대로 기재
- [ ] 신청 시점의 GitHub·다운로드 지표로 Reputation 문구 갱신
- [ ] 신청자 영문 First Name·Last Name 확인
- [ ] 필수 동의 두 항목을 신청자가 직접 읽고 선택

## 승인 후 GitHub 설정

다음 Repository variable을 등록합니다.

- `SIGNPATH_ENABLED=true`
- `SIGNPATH_ORGANIZATION_ID`
- `SIGNPATH_PROJECT_SLUG`
- `SIGNPATH_SIGNING_POLICY_SLUG`
- `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG`

다음 Repository secret을 등록합니다.

- `SIGNPATH_API_TOKEN`

서명은 `Windows build` 워크플로를 수동 실행하고
`submit_to_signpath=true`를 선택한 경우에만 요청합니다. 서명 결과가 나오면
서명된 설치 파일을 기준으로 blockmap, `latest.yml` 및 SHA-256을 다시 생성하고
별도 검증한 뒤 릴리스합니다.
