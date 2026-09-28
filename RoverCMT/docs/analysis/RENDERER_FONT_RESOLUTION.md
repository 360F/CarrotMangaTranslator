# Renderer Font Resolution

## 1. Current Font Contract

선택된 8 fixtures의 final snapshots에는 `fontFamily`가 하나도 없다. Carrot은 `src/shared/blockFontCatalog.ts`의 다음 default CSS stack을 사용한다.

```css
"Malgun Gothic", "Apple SD Gothic Neo", "Segoe UI", sans-serif
```

`src/main/customFonts.ts`의 default preference는 `defaultFontId: "default"`이고 현재 development data root에는 이를 바꾸는 `fonts/preferences.json`이 없다. `src/main/pageExportHtml.ts`는 custom font만 explicit `@font-face` file URL로 주입하므로 default stack은 Windows Chromium platform font resolution에 맡겨진다. 기존 fixture manifest version 1은 변경하지 않았다.

## 2. Inspection Method

`RoverCMT/spikes/renderer-comparison/inspect-chromium-fonts.cjs`를 기존 repository Electron으로 실행했다. 새 dependency나 renderer candidate를 설치하지 않았다.

- Runtime: Electron 43.3.0, Chromium 150.0.7871.212, Windows x64
- BrowserWindow: hidden/offscreen, sandbox/context isolation enabled
- API: Chrome DevTools Protocol `CSS.getPlatformFontsForNode`
- CSS: Carrot의 exact default stack, 각 block의 actual `fontSizePx`, normal/400 face (`bold=false`, `italic=false`)
- Input: 8 snapshots의 non-empty `translatedText` 전체 57 blocks
- 추가 검사: 전체 text에서 추출한 고유 non-whitespace Unicode scalar 280개를 각각 독립 DOM node로 검사
- 결과: `font-inspection-result.json`

이 검사는 CSS family 문자열을 되읽은 것이 아니라 Chromium이 각 DOM node glyph에 실제 사용했다고 보고한 platform font의 `familyName`, `postScriptName`, `glyphCount`, `isCustomFont`를 수집했다. Source 확인상 production PageArtwork도 absent `fontFamily`를 같은 default stack으로 해석한다. 다만 reference 생성 순간을 녹화한 자료는 아니며, 현재 같은 repository Electron/Windows 환경을 사후 검사한 것이다.

## 3. Actual Chromium Font Resolution

모든 57 blocks에서 CDP가 보고한 font set은 하나뿐이었다.

| Property | Result |
|---|---|
| Actual family | `Malgun Gothic` |
| PostScript face | `MalgunGothic` |
| Style | Regular, normal, weight 400 |
| Custom web font | No (`isCustomFont=false`) |
| Block fallback | 없음: 57/57 blocks가 단일 face |

Page별 결과도 동일하다.

| Fixture | Non-empty blocks | CDP platform font |
|---|---:|---|
| `_004.jpg` | 6 | Malgun Gothic / MalgunGothic |
| `_011.jpg` | 8 | Malgun Gothic / MalgunGothic |
| `_012.jpg` | 10 | Malgun Gothic / MalgunGothic |
| `_015.jpg` | 6 | Malgun Gothic / MalgunGothic |
| `_018.jpg` | 10 | Malgun Gothic / MalgunGothic |
| `_029.jpg` | 6 | Malgun Gothic / MalgunGothic |
| `_047.jpg` | 9 | Malgun Gothic / MalgunGothic |
| `_0411.png` | 2 | Malgun Gothic / MalgunGothic |

## 4. Glyph/Fallback Results

고유 non-whitespace glyph 280개 전체가 `Malgun Gothic` / `MalgunGothic` 하나로 resolve됐다. glyph별 복수 font 결과는 0개이며 block별 복수 font 결과도 0개다.

| Category | 실제 고유 glyph 수 | Result |
|---|---:|---|
| Korean/Hangul | 272 | 전부 Malgun Gothic Regular |
| Latin | 0 | 선택 fixture text에 없음; 결론 대상 아님 |
| Digits | 0 | 선택 fixture text에 없음; 결론 대상 아님 |
| Punctuation | 7 | `! ' , . ? 『 』` 모두 Malgun Gothic Regular |
| Symbols | 1 | `~`가 Malgun Gothic Regular |

Whitespace/newline은 standalone visible glyph가 아니므로 unique-glyph 표에서 제외했지만, whitespace/newline을 포함하는 full block node도 단일 Malgun Gothic face만 보고했다. 따라서 **이 fixture set 안에서는** glyph fallback이 갈라진 증거가 없다. Latin/digit까지 같은 face라고 일반화하지 않는다. 해당 category가 실제 입력에 없기 때문이다.

## 5. Windows Font File Mapping

CDP의 family/PostScript 결과를 Windows machine font inventory와 연결했다.

1. `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Fonts`
   - `Malgun Gothic (TrueType)` → `malgun.ttf`
   - `Malgun Gothic Bold (TrueType)` → `malgunbd.ttf`
   - `Malgun Gothic SemiLight (TrueType)` → `malgunsl.ttf`
2. CDP face는 Bold/SemiLight가 아닌 PostScript `MalgunGothic`이다.
3. `malgun.ttf` name table:
   - family: Malgun Gothic
   - subfamily: Regular
   - full/unique name: Malgun Gothic / Malgun Gothic Regular
   - PostScript: MalgunGothic
   - version: 6.68
4. File signature `00 01 00 00`과 `.ttf` 확장자는 standalone TrueType sfnt다. TTC가 아니므로 collection/index는 해당 없음.

| Family / face | File | Format | TTC index | Size |
|---|---|---|---|---:|
| Malgun Gothic Regular / MalgunGothic | `C:\Windows\Fonts\malgun.ttf` | TTF | N/A | 13,457,164 bytes |

이 연결은 CDP PostScript name, Windows registry mapping, actual file name table가 모두 일치하므로 현재 machine에서는 신뢰할 수 있다.

## 6. Hashes

| File | SHA-256 |
|---|---|
| `C:\Windows\Fonts\malgun.ttf` | `0086c19e81d293a542e7d75564c645fb58070cc850aefebf8fa1c397858e510c` |

Bold와 SemiLight는 실제 face가 아니므로 fixture dependency로 채택하지 않는다. 조사 중 참고로 계산했지만 manifest revision에는 Regular 하나만 들어가야 한다.

## 7. Reproducibility Assessment

### 확인된 범위

현재 Windows Carrot Chromium 환경에서 선택 8 fixtures의 모든 실제 non-empty text는 정확히 `malgun.ttf` Regular 하나로 resolve된다. 이 machine에서 candidate가 동일 bytes를 명시적으로 load하도록 하면 current reference와 font identity를 맞춘 local comparison은 가능하다.

### 한계

- Existing reference export 자체에는 사용 font fingerprint가 embedded sidecar로 기록되지 않았다. 이번 결과는 같은 현재 environment의 사후 CDP 검사이므로 reference 생성 이후 browser/system font가 바뀌지 않았다는 전제가 있다.
- CSS stack만 기록한 기존 manifest v1은 다른 Windows version, macOS, Linux에서 같은 file을 보장하지 않는다.
- Linux에는 Malgun Gothic이 기본 제공되지 않으며 repository에 이 file을 넣을 수 있다고 가정할 수 없다.
- 동일 TTF bytes라도 Chromium/DirectWrite, Skia, Pango/Cairo의 shaping, hinting, rasterization은 달라질 수 있다. Font pinning은 중요한 변수를 제거하지만 pixel identity를 보장하지 않는다.

따라서 current reference는 **현재 Windows machine의 local baseline**으로는 사용할 수 있지만, Linux-portable/reproducible comparison의 최종 기준으로 그대로 사용하기에는 부족하다.

## 8. Portability / Distribution Considerations

`malgun.ttf` name table에는 Microsoft copyright와 Microsoft 제품의 license terms 범위에서 display/print/content embedding만 허용하고 그 외 사용을 금지하는 문구가 있다. 이번 작업은 system-installed file을 read-only로 검사했으며 복사하지 않았다.

- 현재 용도: Windows system-only test dependency로만 취급
- Repository/vendor asset: 금지로 간주; 별도 법적 권한 없이 복사/commit/배포하지 않음
- Linux CI/Rover distribution: Malgun Gothic 존재를 전제로 하지 않음
- 장기 fixture: 재배포 가능한 portable font가 필요

이는 정식 법률 검토가 아니라 현재 file metadata에 근거한 보수적 engineering 판단이다.

## 9. Fixture Revision Recommendation

기존 `manifest.json` version 1의 의미를 바꾸거나 font entry를 조용히 overwrite하지 않는다.

권장 구분:

- Revision 1: 현재 그대로 보존. `UNRESOLVED_SYSTEM_FALLBACK`이며 기존 exported references를 가리킨다.
- Windows evidence sidecar: 이번 `font-inspection-result.json`과 문서가 v1 reference의 현재-machine resolution 증거다.
- Revision 2: 재배포 가능한 portable font의 exact file/hash/PostScript face를 explicit dependency로 기록하고, 그 font를 명시적으로 load한 Chromium reference를 새 output에 생성한 뒤 새 manifest 파일 또는 immutable revision ID로 작성한다.

예시 revision metadata:

```json
{
  "version": 2,
  "revision": "portable-font-reference-v1",
  "supersedes": "renderer-comparison-inputs-v1",
  "fontContract": {
    "mode": "explicit-file",
    "family": "<portable family>",
    "face": "<PostScript name>",
    "path": "<managed test asset>",
    "sha256": "<hash>"
  }
}
```

Malgun bytes를 포함하는 v2를 만들지 않는다. Windows-local experiment가 꼭 필요하면 별도의 machine-bound revision에 expected path/hash와 `distribution: system-only`를 기록하되 portable benchmark와 구분한다.

## 10. Exact Next Step

Renderer Comparison Spike를 시작하기 전에 redistribution이 허용되고 Korean/punctuation coverage가 충분한 portable font 하나를 선정한다. 해당 exact font file을 Carrot Chromium export에 explicit `@font-face`로 load해 8 references를 **새 경로에** 재생성하고, file hash와 새 reference hashes를 가진 immutable manifest revision 2를 만든다. 그 이후에만 Skia/node-canvas/Playwright가 동일 bytes를 load하도록 comparison을 시작한다.

현재 reference는 Windows-local diagnostic baseline으로 보존한다. 기존 export, library data, manifest v1은 수정하지 않는다.
