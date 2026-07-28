# Code signing policy · 코드 서명 정책

최종 수정일: 2026년 7월 23일

## 현재 상태

아워튜브 0.2.7 Windows 설치 파일은 아직 Authenticode 코드 서명이 적용되지
않았습니다. 공식 설치 파일은 <https://ourtube.kr/desktop>에서 연결하는
`hwangseungbo/ourtube-releases` GitHub Releases를 통해서만 배포하며, 게시된
SHA-256 값으로 무결성을 확인할 수 있습니다.

## SignPath 제공 표시

아워튜브는 SignPath Foundation의 무료 오픈소스 코드 서명 프로그램에 신청을
준비하고 있습니다. 아직 승인 또는 서명을 받지 않았으므로 현재 배포물에 SignPath가
서명·보증한다고 표시하지 않습니다.

승인 후 SignPath로 실제 서명된 릴리스에만 다음 문구를 표시합니다.

> Free code signing provided by SignPath.io, certificate by SignPath Foundation

## 프로젝트 역할

현재 아워튜브는 단독 유지관리 프로젝트이며 각 역할은 다음과 같습니다.

- Authors and committers: [hwangseungbo](https://github.com/hwangseungbo)
- Reviewers: [hwangseungbo](https://github.com/hwangseungbo)
- Signing approver: [hwangseungbo](https://github.com/hwangseungbo)

외부 기여자의 변경은 유지관리자가 PR에서 검토합니다. 코드 서명 정책, GitHub
Actions 및 배포 설정의 변경은 PR과 자동 검사를 거쳐야 합니다. 단독 유지관리자가
작성한 변경도 자동 검사를 통과해야 하며, 모든 릴리스 서명 요청은 별도로 수동
승인합니다.

## 빌드 및 서명 원칙

1. 공개 GitHub 저장소의 태그와 GitHub Actions 빌드만 서명 대상으로 사용합니다.
2. 모든 서명 대상은 GitHub가 호스팅하는 Windows 실행기에서 `npm ci`로 의존성을
   고정 설치하고 검사·테스트·라이선스 감사를 통과한 뒤 빌드합니다.
3. 빌드 결과물은 GitHub Actions artifact로 먼저 업로드한 뒤 SignPath의 신뢰 빌드
   연동을 통해 제출합니다.
4. SignPath 승인 전이거나 필수 설정·토큰이 없으면 서명 제출 단계는 실행되지
   않습니다.
5. 릴리스 서명은 권한 있는 관리자가 수동 승인합니다.
6. 서명된 파일을 기준으로 업데이트 메타데이터, blockmap 및 체크섬을 다시
   생성한 뒤 공개합니다.
7. FFmpeg와 yt-dlp 같은 업스트림 바이너리는 설치본에 포함할 수 있지만 아워튜브
   자체 바이너리인 것처럼 별도 서명하지 않습니다.
8. 서명 주체, 제품명, 파일 버전 및 제품 버전이 릴리스 정보와 일치하는지 게시
   전에 확인합니다.

## 개인정보와 네트워크 통신

아워튜브는 사용자가 입력한 주소의 영상 정보를 확인하고 저장하기 위해 해당 영상
서비스에 접속합니다. 앱 실행 시 버전 확인을 위해 `ourtube.kr`에 접속하며, 사용자가
업데이트를 승인하면 GitHub Releases에서 설치 파일을 내려받습니다. 사용자가 하단
링크를 누르면 선택한 공식 웹페이지가 브라우저에서 열립니다.

영상 파일과 결합 작업은 사용자 PC에서 처리하며 아워튜브 운영 서버에 업로드하지
않습니다. 자세한 내용과 관련 외부 서비스의 개인정보처리방침은
[개인정보 처리방침](https://ourtube.kr/privacy)에서 확인할 수 있습니다.

## 키와 계정 보안

개인 인증서 키를 저장소나 빌드 로그에 저장하지 않습니다. GitHub와 SignPath
계정에는 2단계 인증을 적용합니다. SignPath API 토큰은 GitHub Actions의 암호화된
Secret으로만 관리하며, 최소 권한의 제출 전용 계정을 사용합니다.

## 설치 제거와 신고

Windows 설정의 설치된 앱 목록에서 아워튜브를 제거할 수 있습니다. 공식 페이지의
버전·파일명·해시 또는 향후 표시될 서명 게시자가 일치하지 않으면 파일을 실행하지
말고 <support@ourtube.kr>로 신고해 주세요.
