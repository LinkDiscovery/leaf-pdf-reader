# Firebase 동기화 설정

Leaf는 단어장과 문장 모음만 Firebase Authentication + Cloud Firestore에 저장합니다. PDF 원본, PDF 형광펜과 PDF 메모는 업로드하지 않습니다. Analytics와 Cloud Storage도 사용하지 않습니다.

이 저장소의 공개 웹 앱 설정은 `pdfreadermarkmakewordbook` 프로젝트를 가리킵니다. Firebase 웹 앱의 apiKey는 브라우저에 공개되는 프로젝트 식별용 값이며 관리자 비밀 키가 아닙니다. 데이터 접근은 아래 Firestore 규칙으로 보호합니다. 서비스 계정 JSON, private_key, 관리자 인증 토큰을 저장소에 올리지 마세요.

## 프로젝트 소유자가 처음 한 번 설정

1. [Firebase 콘솔](https://console.firebase.google.com/project/pdfreadermarkmakewordbook/overview)에서 **Spark** 무료 요금제를 유지합니다. 결제 계정이나 Cloud Storage를 연결할 필요가 없습니다.
2. **빌드 → Authentication → 시작하기 → 로그인 방법 → Google**을 사용 설정합니다. 프로젝트 지원 이메일을 선택하고 저장합니다.
3. **Authentication → 설정 → 승인된 도메인**에 `linkdiscovery.github.io`, `localhost`, `127.0.0.1`을 등록합니다. 프로토콜이나 `/leaf-pdf-reader/` 경로는 넣지 않습니다. 로컬 접속 주소도 승인해야 합니다.
4. **빌드 → Firestore Database → 데이터베이스 만들기**에서 **Standard edition**, 데이터베이스 ID **(default)**, **프로덕션 모드**를 선택합니다. 한국에서 주로 사용하면 제공되는 위치 중 서울(`asia-northeast3`)을 선택할 수 있습니다. 생성 후 위치는 쉽게 변경할 수 없으므로 확인하세요.
5. **Firestore → 규칙** 편집기에 저장소 루트의 [firestore.rules](../firestore.rules) 전체를 붙여 넣고 **게시**합니다. 테스트 모드의 모든 사용자 허용 규칙을 사용하지 않습니다. 이 규칙은 로그인한 사용자 본인의 `users/{uid}/studyEntries`만 읽고 쓸 수 있도록 합니다.
6. [Leaf 웹 앱](https://linkdiscovery.github.io/leaf-pdf-reader/)에서 Google 로그인 후 단어 하나를 저장합니다. `동기화 완료`가 표시되는지 확인하고, 다른 브라우저나 컴퓨터에서 같은 계정으로 로그인해 같은 기록이 보이는지 확인합니다.

CLI를 사용한다면 다음 명령으로 규칙과 불필요한 자동 색인을 제외하는 설정을 함께 배포할 수 있습니다.

```powershell
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes --project pdfreadermarkmakewordbook
```

규칙을 게시하기 전 또는 Google 로그인을 켜기 전에는 계정 동기화가 동작하지 않습니다. 로그인하지 않은 상태에서는 기기 저장을 사용할 수 있습니다.

## 다른 프로젝트에 연결하기

`public/firebase-config.json`을 자신의 Firebase 웹 앱 설정으로 바꿉니다. 필수 항목은 `apiKey`, `authDomain`, `projectId`, `appId`입니다. 또는 빌드 시 `VITE_FIREBASE_CONFIG` 환경 변수에 동일한 JSON을 넣을 수 있습니다. 이 값은 빌드 결과에 공개되므로 비밀 키를 넣지 않습니다.

```json
{
  "apiKey": "YOUR_WEB_API_KEY",
  "authDomain": "YOUR_PROJECT.firebaseapp.com",
  "projectId": "YOUR_PROJECT",
  "appId": "YOUR_WEB_APP_ID"
}
```

환경 변수는 JSON 문자열이어야 합니다. 설정 파일이 없으면 앱은 기기 저장 모드로 실행됩니다. 프로젝트를 바꾸면 기존 프로젝트의 계정 데이터가 자동 이동하지 않습니다. 먼저 백업 내보내기를 사용하세요.

## 저장·동기화 동작

- **로그인 전:** 현재 브라우저의 IndexedDB에 저장합니다. 다른 브라우저나 기기에는 나타나지 않습니다.
- **로그인 후:** 계정별 Firestore 기록을 표시합니다. 기기의 미로그인 기록을 자동 업로드하지 않습니다. 단어장 탭의 **기기 기록 가져오기**로 명시적으로 복사합니다. 원래 기기 기록은 남습니다.
- **오프라인:** 이미 내려받은 계정 기록과 수정 대기열을 브라우저에 보관합니다. 다시 연결하면 전송합니다. 로그인 자체와 처음 사용하는 기기의 최초 다운로드에는 인터넷이 필요합니다. 앱 페이지 자체를 오프라인에서 최초 실행할 수 있도록 설치하는 기능은 제공하지 않습니다.
- **전송 대기 중:** 다른 기기에 아직 반영되지 않았을 수 있습니다. `동기화 완료`를 확인한 뒤 기기를 전환하세요. 대기 중에는 로그아웃을 막습니다.
- **동시 수정:** 동일 필드의 동시 변경은 서버에 마지막으로 반영된 쓰기가 남습니다. 텍스트 편집은 복습 상태를 덮어쓰지 않습니다. 이미 삭제된 항목을 오래된 기기에서 수정하면 실패 안내를 보여 주고 편집 내용을 복구합니다.
- **가져오기:** 같은 항목 ID가 있으면 기존 항목을 유지합니다. 계정으로 가져올 때는 서버 연결 및 동기화 완료가 필요합니다. 큰 백업은 나누어 전송하므로 실패하면 일부가 이미 반영될 수 있습니다. 다시 가져와도 같은 ID는 중복 추가하지 않습니다.
- **로그아웃:** 화면의 계정 기록을 지우고 기기 기록으로 전환합니다. 브라우저의 오프라인 캐시 자체를 삭제하는 동작은 아닙니다. 개인 기기에서 사용하고, 공용 기기에서는 작업 후 사이트 데이터를 지우세요.
- **백업:** 현재 모드에 보이는 단어와 문장을 JSON으로 내보냅니다. 다른 계정·프로젝트로 옮길 때도 사용할 수 있습니다. 가져오기는 파일당 30MB / 10,000개까지 지원합니다.

## 무료 사용과 문제 해결

Firestore 무료 한도는 프로젝트 전체 기준 1GiB, 하루 읽기 50,000회·쓰기 20,000회입니다. 여러 사용자가 함께 쓰면 합산됩니다. 현재 앱은 로그인 시 개인 학습 기록 전체를 구독하므로 수만 개 이상 쌓이면 페이지 단위 서버 조회로 확장하는 것이 좋습니다. 콘솔의 사용량을 확인하세요.

- `auth/unauthorized-domain`: 접속 도메인을 Authentication 승인된 도메인에 등록합니다.
- 팝업 차단: 사이트 팝업을 허용하고 로그인 버튼을 다시 누릅니다.
- 동기화 권한 오류: 로그인 계정, 데이터베이스 ID `(default)`, 게시된 보안 규칙을 확인합니다.
- 연결 확인 중: 인터넷 연결을 확인합니다. 처음 로그인한 기기에서는 아직 서버 기록이 내려오지 않았을 수 있습니다.
- 프로젝트 API 키의 API 제한을 별도로 설정했다면 Firebase Authentication과 Firestore에 필요한 API가 허용되어야 합니다.

## 개발 검증

```powershell
npm ci
npm run build
npm test
npm run test:rules
```

규칙 검사는 Java 21 이상이 필요하며 로컬 Firebase 에뮬레이터만 사용합니다. 실제 운영 프로젝트의 데이터에 접근하지 않습니다.
