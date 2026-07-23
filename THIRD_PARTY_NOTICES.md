# 제3자 소프트웨어 고지

검토 기준: 아워튜브 0.2.6 · 2026년 7월 23일

아워튜브 자체 소스 코드는 `GPL-3.0-or-later`로 배포됩니다. 아래 구성요소는
각 저작권자와 각자의 라이선스 조건에 따르며, 아워튜브 라이선스로 재허가되지
않습니다.

## 설치 파일에 포함되는 주요 구성요소

| 구성요소 | 포함 버전 | 라이선스 | 소스 및 고지 |
| --- | --- | --- | --- |
| Electron | 43.2.0 | MIT 및 Chromium 제3자 라이선스 | <https://github.com/electron/electron> |
| electron-updater | 6.8.9 | MIT | <https://github.com/electron-userland/electron-builder> |
| yt-dlp | 2026.07.04 | The Unlicense 및 번들 구성요소의 라이선스 | <https://github.com/yt-dlp/yt-dlp/releases/tag/2026.07.04> |
| FFmpeg | 6.1.1 essentials build | GPL v3 | <https://github.com/FFmpeg/FFmpeg/commit/e38092ef93> |
| ffmpeg-static | 5.3.0 | GPL-3.0-or-later | <https://github.com/eugeneware/ffmpeg-static/tree/b6.1.1> |
| Mediabunny | 1.50.9 | MPL-2.0 | <https://github.com/Vanilagy/mediabunny> |
| youtubei.js | 17.2.0 | MIT | <https://github.com/LuanRT/YouTube.js> |
| googlevideo | 4.1.1 | MIT | npm 패키지 `googlevideo` |
| bgutils-js | 4.0.0 | MIT | <https://github.com/LuanRT/BgUtils> |

현재 포함된 `yt-dlp.exe` SHA-256은
`52FE3C26DCF71FBDC85B528589020BB0B8E383155CFA81B64DD447BBE35E24B8`이며,
공식 릴리스의 `SHA2-256SUMS`와 일치합니다.
공식 PyInstaller 실행 파일에 포함되는 추가 라이선스 목록은 해당 릴리스의
[`THIRD_PARTY_LICENSES.txt`](https://github.com/yt-dlp/yt-dlp/blob/fdec00e0bf530dc6c3cc7b1dd780e95d9ae460e9/THIRD_PARTY_LICENSES.txt)에서
확인할 수 있습니다.

현재 포함된 `ffmpeg.exe` SHA-256은
`04E1307997530F9CF2FE35CBA2CA7E8875CA91DA02F89D6C7243DF819C94AD00`입니다.
바이너리에 동봉된 README는 Gyan.dev의
`6.1.1-essentials_build-www.gyan.dev` 빌드와 FFmpeg 커밋
`e38092ef93`을 가리킵니다.

## 런타임 npm 의존성

`package-lock.json`으로 고정된 런타임 의존성의 라이선스 표현은 다음 범주입니다.

- MIT: bgutils-js, builder-util-runtime, debug, electron-updater, fflate,
  fs-extra, googlevideo, js-yaml, jsonfile, lazy-val, lodash 모듈,
  tiny-typed-emitter, universalify, youtubei.js 및 관련 타입 패키지
- ISC: graceful-fs, meriyah, semver
- MPL-2.0: mediabunny
- BlueOak-1.0.0: sax
- Python-2.0: argparse
- Apache-2.0 AND BSD-3-Clause: @bufbuild/protobuf

정확한 패키지 이름, 버전, 무결성 해시와 라이선스 표현은
`package-lock.json`을 기준으로 합니다. 빌드 시 `npm run licenses:prepare`가
배포되는 런타임 패키지의 라이선스 파일과 Electron·Chromium·FFmpeg 고지를
설치 리소스의 `licenses` 폴더로 모읍니다.

## FFmpeg 대응 소스

FFmpeg는 별도 실행 파일로 호출됩니다. 아워튜브는 이를 자체 코드로 재허가하거나
자체 바이너리인 것처럼 서명하지 않습니다. 공개 릴리스마다 설치 파일과 같은
다운로드 위치에서 해당 바이너리의 빌드 정보, GPL 전문 및 대응 소스 획득 방법을
제공합니다. 세부 절차는 `docs/FFMPEG_SOURCE.md`를 따릅니다.

## 라이선스 문의

누락 또는 잘못된 고지를 발견했다면 <support@ourtube.kr>로 알려 주세요.
