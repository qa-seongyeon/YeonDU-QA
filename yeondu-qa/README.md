# YeonDU-QA

URL을 입력하면 Playwright로 자동 스크린샷을 캡처하고, 직접 업로드한 기준 스크린샷과 픽셀 단위로 비교해 차이를 빨간색으로 하이라이트해주는 모바일웹 UI QA 도구입니다.

## 기능
- URL 입력 → 서버에서 모바일 뷰포트(기본 390×844)로 자동 캡처
- 기준 스크린샷 업로드 (드래그/탭 후 파일 선택)
- 픽셀 단위 diff 비교 → 차이 비율(%) + 차이 하이라이트 이미지 / 캡처본 / 기준본 탭으로 확인
- 뷰포트 너비·높이 직접 조절 가능

## 로컬 실행
```bash
npm install
npm start
# http://localhost:3000 접속
```

`npm install` 시 `postinstall` 스크립트가 Playwright Chromium을 함께 설치합니다 (시간이 좀 걸릴 수 있어요).

## 배포 (Docker 기반 — Render / Fly.io / Railway 등)
Playwright는 브라우저 실행 환경이 필요해서, Vercel 같은 일반 서버리스보다는 **Docker를 지원하는 호스팅(Render, Fly.io, Railway 등)**이 안정적입니다. 이 프로젝트에는 `Dockerfile`이 포함되어 있어요.

### Render 예시
1. GitHub에 이 폴더를 푸시
2. Render 대시보드 → New → Web Service → 해당 repo 선택
3. Environment: **Docker** 선택 (Dockerfile 자동 인식)
4. Instance Type: Free 또는 Starter (스크린샷 캡처는 메모리를 좀 쓰므로 512MB 이상 권장)
5. 배포 후 발급된 URL로 접속

### Fly.io 예시
```bash
fly launch    # Dockerfile 감지 후 설정
fly deploy
```

## 폴더 구조
```
yeondu-qa/
├── server.js          # Node http 서버 (Playwright 캡처 + sharp 픽셀 diff)
├── package.json
├── Dockerfile
└── public/
    ├── index.html      # 모바일웹 UI
    ├── app.js
    └── results/        # 캡처/비교 결과 이미지 저장 (실행 중 생성됨)
```

## 동작 원리
1. 프론트엔드에서 업로드한 기준 이미지를 base64로 인코딩해 `/api/compare`로 전송
2. 서버가 Playwright(Chromium)로 입력한 URL을 지정한 모바일 뷰포트로 캡처
3. `sharp`로 두 이미지를 같은 크기로 정규화한 뒤, 픽셀별 RGB 차이를 계산
4. 차이가 임계값(기본 40)을 넘는 픽셀은 빨간색으로, 나머지는 어둡게 표시한 diff 이미지를 생성
5. 결과(이미지 3종 + 차이 비율)를 JSON으로 반환, 프론트엔드가 탭으로 보여줌

## 알려진 제한
- `fullPage` 스크린샷 기준으로 비교하므로, 페이지 길이가 다르면 비율이 안 맞아 보일 수 있습니다 (현재는 기준 이미지 크기로 강제 리사이즈).
- 애니메이션/캐러셀처럼 매번 다르게 렌더링되는 요소가 있으면 오탐(false positive)이 생길 수 있습니다.
- 로그인이 필요한 페이지는 현재 캡처가 안 됩니다 (쿠키/세션 주입 기능 추가 필요).
