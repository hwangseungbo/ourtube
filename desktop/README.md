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
- 새 버전이 있으면 사용자가 선택할 수 있는 안내 창을 표시합니다.
- 동의 없이 설치 파일을 내려받거나 실행하지 않습니다.
- 다운로드는 `https://ourtube.kr/desktop` 공식 페이지에서 사용자가 직접 진행합니다.
- 현재 개인 배포 설치 파일은 코드 서명되지 않았으므로 공식 페이지에 표시된 SHA-256과
  내려받은 파일의 해시를 비교해야 합니다.
