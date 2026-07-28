# FFmpeg 대응 소스 제공 절차

검토 기준: 아워튜브 0.2.7

## 포함 바이너리

- 파일: `node_modules/ffmpeg-static/ffmpeg.exe`
- SHA-256: `04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`
- 표시 버전: `6.1.1-essentials_build-www.gyan.dev`
- 라이선스: GPL v3
- FFmpeg 기준 커밋: `e38092ef93`
- 배포 경로: npm `ffmpeg-static@5.3.0`, 바이너리 릴리스 태그 `b6.1.1`

바이너리에 동봉된 `ffmpeg.exe.README`에 빌드 설정과 포함 라이브러리가
기록되어 있습니다.

## 릴리스 전에 해야 할 일

1. 포함된 `ffmpeg.exe`의 버전·설정·SHA-256을 다시 기록합니다.
2. 바이너리와 함께 제공된 GPL 전문과 README를 설치 리소스에 포함합니다.
3. 동일한 GitHub Release에서 대응 소스 아카이브와 빌드 정보를 받을 수 있게
   제공합니다.
4. FFmpeg 및 정적으로 연결된 GPL 구성요소를 재구성하는 데 필요한 소스와
   빌드 스크립트의 가용성을 확인합니다.
5. 릴리스 페이지와 `THIRD_PARTY_NOTICES.md`에 정확한 다운로드 위치를 기록합니다.
6. 보관 기간과 제공 방식이 GPL v3 제6조의 배포 방식에 맞는지 최종 확인합니다.

단순히 FFmpeg 홈페이지 링크만 제공하는 것으로 대응 소스 의무가 모두 충족된다고
가정하지 않습니다. 대응 소스 묶음이 준비되지 않은 버전은 공개 릴리스하지
않습니다.
