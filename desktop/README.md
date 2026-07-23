# 아워튜브 Windows 데스크톱 앱

Chrome 확장 프로그램 대신 일반 Windows 프로그램으로 설치하는 버전입니다.
영상 분석, 다운로드, MP4 결합은 모두 사용자 PC에서 실행됩니다.

## 개발 실행

```powershell
npm.cmd run desktop
```

## Windows 설치 파일 생성

```powershell
npm.cmd run desktop:dist
```

생성된 설치 파일은 `dist-desktop/OurTube-Setup-<버전>.exe`입니다.

앱에는 공식 yt-dlp Windows 바이너리와 `ffmpeg-static`의 FFmpeg 바이너리가 포함됩니다.

## 업데이트 방식

- 앱은 `https://ourtube.kr/app-version.json`에서 최신 버전만 확인합니다.
- 새 버전이 있으면 `업데이트 다운로드`와 `나중에` 중에서 사용자가 선택합니다.
- 사용자가 동의한 뒤에만 공식 GitHub Releases에서 업데이트를 내려받습니다.
- Windows NSIS blockmap을 이용한 차등 다운로드를 우선하며, 완성된 업데이트는
  `latest.yml`의 SHA-512로 검증합니다.
- 다운로드가 끝나면 `지금 재시작하여 업데이트`와 `나중에` 중에서 다시 선택합니다.
- 업데이트 과정에서 홈페이지나 브라우저를 열지 않습니다.
- 현재 개인 배포 설치 파일은 코드 서명되지 않았으므로 최초 설치 파일은 공식 페이지에 표시된
  SHA-256과 내려받은 파일의 해시를 비교해야 합니다.
