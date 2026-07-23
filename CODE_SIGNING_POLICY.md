# 코드 서명 정책

최종 수정일: 2026년 7월 23일

## 현재 상태

아워튜브 0.2.5 Windows 설치 파일은 아직 Authenticode 코드 서명이 적용되지
않았습니다. 공식 설치 파일은 <https://ourtube.kr/desktop>에서 연결하는
`hwangseungbo/ourtube-releases` GitHub Releases를 통해서만 배포하며, 게시된
SHA-256 값으로 무결성을 확인할 수 있습니다.

## SignPath 적용 계획

SignPath Foundation 승인을 받은 이후에는 다음 원칙을 적용합니다.

1. 공개 GitHub 저장소의 태그와 GitHub Actions 빌드만 서명 대상으로 사용합니다.
2. 빌드 결과물은 SignPath의 신뢰 빌드 연동을 통해 제출합니다.
3. 릴리스 서명은 권한 있는 관리자가 수동 승인합니다.
4. 서명된 파일을 기준으로 업데이트 메타데이터와 체크섬을 생성합니다.
5. FFmpeg와 yt-dlp 같은 업스트림 바이너리를 아워튜브 자체 바이너리인 것처럼
   별도 서명하지 않습니다.
6. 서명 주체, 파일 버전 및 제품명이 릴리스 정보와 일치하는지 게시 전에 확인합니다.

승인 전에는 SignPath 또는 SignPath Foundation이 현재 배포물을 서명·보증한다고
표시하지 않습니다. 승인 후 실제 서명된 배포물부터 홈페이지와 릴리스 페이지에
SignPath가 요구하는 제공 문구를 표시합니다.

## 키와 권한

개인 인증서 키를 저장소나 빌드 로그에 저장하지 않습니다. GitHub와 SignPath
계정에는 2단계 인증을 적용하고, API 토큰은 GitHub Actions의 암호화된 Secret으로
관리합니다.

보안 문의: <support@ourtube.kr>
