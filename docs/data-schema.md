# 가구 데이터 구조 (`data/items.json`)

실제 상품이 아니라 **대표 유형**을 모델링한다. 가격·치수는 시중 제품을 참고한 **추정 대표값**이며,
특정 쇼핑몰 상품의 정확한 정보가 아니다. 이미지는 직접 그린 SVG(`assets/furniture/`)라 라이선스 문제가 없다.

| 필드 | 타입 | 설명 |
|---|---|---|
| `id` | string | 고유 ID (이미지 파일명과 동일) |
| `name` | string | 표시 이름 |
| `category` | string | 수납, 조명, 침구, 러그, 커튼, 의자, 책상, 거울, 소품, 벽장식, 테이블 |
| `price` | number | 대표 가격(원) |
| `size` | {w, d, h} | 가로·세로(깊이)·높이(cm) |
| `view` | `front` \| `top` | 이미지 시점. `top`은 러그·침구처럼 위에서 본 모습 |
| `styles` | string[] | 어울리는 스타일: 미니멀, 모던, 우드, 따뜻한 |
| `noDrill` | boolean | 못·타공 없이 설치 가능 여부 (원상복구 고려) |
| `priority` | 1~3 | 필요도. 1이 가장 먼저 채울 항목 |
| `alternativeTo` | string (선택) | **더 비싼** 상품의 id. 예산 초과 시 이 항목이 그 저가 대체품이 된다 |
| `image` | string | 사진 위 배치용 SVG 경로 |

SVG의 `viewBox`는 `front`는 `w x h`, `top`은 `w x d` 비율과 맞춘다.

## 검증
```
python3 tools/validate_data.py
```
필수 필드, 값 범위, id 중복, 대체품이 더 저렴한지, 이미지 파일 존재와 비율, 모든 스타일에 항목이 있는지 검사한다.
